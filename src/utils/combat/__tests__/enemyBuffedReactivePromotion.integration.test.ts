/**
 * Combat-integration tests for the `on-enemy-buffed` reactive trigger, driven by Nuqtu's passive
 * (docs/ship-skills.csv, verbatim): "Every turn this Unit cleanses 1 debuff, once per round, and
 * when an enemy gains a buff this Unit gains Terran Bolster III for 1 turn." Both effects are
 * SELF-target. The cleanse is an every-turn self-cleanse capped at once per round
 * (start-of-turn, Ability.oncePerRound); only the Terran Bolster III grant (and, at refit 2, the
 * Core Charge I stack) rides `on-enemy-buffed`, whose listener (triggers.ts) wakes on an
 * opposing `buff-applied`.
 *
 * Nuqtu's ability is extracted through the REAL production path (`buildShipAbilities`) fed skill
 * text copied verbatim from `docs/ship-skills.csv` (parser source of truth) — never a hand-built
 * ability array. The surrounding cast (an enemy that self-buffs to generate the triggering event,
 * an enemy that debuffs Nuqtu so its cleanse has something real to remove) are minimal hand-built
 * actors, following `onEnemyRepairedReactivePromotion.integration.test.ts`'s harness style.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// A no-op active (0-multiplier hit) so a focus/team actor with no offensive purpose still takes
// a valid turn each round without ending combat early or erroring.
const noopActiveSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

/** Collect every `buff-applied` event from a run. `actorId` is the buff RECIPIENT (events.ts). */
function runAndCollectBuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    const result = runCombat({ ...input, bus });
    return { buffsApplied, result };
}

function cleanseCountFor(result: ReturnType<typeof runCombat>, actorId: string): number {
    return (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.cleanseCount ?? 0),
        0
    );
}

// A self-buff-on-cast ability — the minimal "this actor gets buffed" trigger for
// on-enemy-buffed. Any actor (enemy or player/ally) carrying this on its active slot emits
// `buff-applied` keyed on ITS OWN id when it acts (playerTurn.ts's per-recipient emission
// covers both sides identically).
const selfBuffOnCast = (id: string, buffName: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
    },
});

// A single-hit debuff-on-cast ability (target 'enemy' from the CASTER's perspective) — used to
// seed a real, removable debuff on Nuqtu before its cleanse reactive fires. Mirrors
// ownCleanseReactivePromotion.integration.test.ts's debuffEnemy fixture.
const debuffOnCast = (id: string, buffName: string): Ability => ({
    id,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: { attack: -30 },
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 5,
    },
});

// =============================================================================
// Nuqtu — "Every turn this Unit cleanses 1 debuff, once per round, and when an enemy gains a buff
// this Unit gains Terran Bolster III for 1 turn" (docs/ship-skills.csv, verbatim — base passive).
// =============================================================================

const NUQTU_P1 =
    'Every turn this Unit <unit-skill>cleanses 1 debuff</unit-skill>, once per round, and when an enemy gains a <unit-aid>buff</unit-aid> this Unit gains <unit-skill>Terran Bolster III</unit-skill> for 1 turn.';

/** Extracts Nuqtu's REAL production passive slot (the self-cleanse + Terran Bolster III grant). */
function nuqtuPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ firstPassiveSkillText: NUQTU_P1 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

function nuqtuCleanse(): Ability {
    const cleanse = nuqtuPassiveAbilities().find((a) => a.type === 'cleanse');
    if (!cleanse) throw new Error('mutation guard: Nuqtu self-cleanse not found');
    return cleanse;
}

function nuqtuBolsterGrant(): Ability {
    const grant = nuqtuPassiveAbilities().find(
        (a) =>
            a.type === 'buff' &&
            a.config.type === 'buff' &&
            a.config.buffName === 'Terran Bolster III'
    );
    if (!grant) throw new Error('mutation guard: Nuqtu Terran Bolster III grant not found');
    return grant;
}

// Sanity-check the extracted abilities BEFORE using them as engine input — a mutation guard so a
// regression in the parser/builder wiring fails loudly here rather than silently no-op'ing the
// engine tests below.
describe('Nuqtu every-turn cleanse + Terran Bolster III — extracted ability shape (mutation guard)', () => {
    it('the grant rides on-enemy-buffed; the cleanse is an every-turn self-cleanse capped once per round', () => {
        const cleanse = nuqtuCleanse();
        const grant = nuqtuBolsterGrant();
        expect(cleanse.trigger).toBe('start-of-turn');
        expect(cleanse.target).toBe('self');
        expect(cleanse.oncePerRound).toBe(true);
        expect(grant.trigger).toBe('on-enemy-buffed');
        expect(grant.target).toBe('self');
        expect(grant.oncePerRound).toBeUndefined();
        // COLLISION-SCOPE: the reactive grant must NOT also carry the manual enemy-buff
        // condition (double-gating would silently suppress the reactive).
        expect(grant.conditions.some((c) => c.subject === 'enemy-buff')).toBe(false);
    });
});

// =============================================================================
// Nuqtu — REFIT (2nd) passive: "Every turn this Unit cleanses 1 debuff, once per round, and when
// an enemy gains a buff this Unit gains Terran Bolster III for 1 turn and gains 1 stack of Core
// Charge I" (docs/ship-skills.csv, verbatim — refit-active passive). Per this project's
// convention only the refit-active passive applies in-game — getShipSkillRows resolves
// refitCount >= 2 to `secondPassiveSkillText` (src/utils/ship/skillRows.ts) — so THIS is the
// passive a real, refitted Nuqtu actually runs. It adds a THIRD clause over the base passive
// above: a Core Charge I stack grant, sharing the same "when an enemy gains a buff" clause.
// =============================================================================

const NUQTU_P2_REFIT =
    'Every turn this Unit <unit-skill>cleanses 1 debuff</unit-skill>, once per round, and when an enemy gains a <unit-aid>buff</unit-aid> this Unit gains <unit-skill>Terran Bolster III</unit-skill> for 1 turn and gains 1 stack of <unit-skill>Core Charge I</unit-skill>.';

/**
 * Extracts Nuqtu's REAL production REFIT passive slot. `ship()` defaults to 4 refits, so with
 * only `secondPassiveSkillText` set (no thirdPassiveSkillText), getShipSkillRows's refitCount >= 2
 * branch resolves this text as the active passive row — exactly what a refitted Nuqtu runs.
 */
function nuqtuRefitPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ secondPassiveSkillText: NUQTU_P2_REFIT })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

describe('Nuqtu REFIT passive — every-turn cleanse + Terran Bolster III + Core Charge I stack — extracted ability shape (mutation guard)', () => {
    it('both grants ride on-enemy-buffed; the cleanse is an every-turn self-cleanse capped once per round', () => {
        const abilities = nuqtuRefitPassiveAbilities();
        const cleanse = abilities.find((a) => a.type === 'cleanse');
        const bolster = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === 'Terran Bolster III'
        );
        const coreCharge = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === 'Core Charge I'
        );
        if (!cleanse) throw new Error('mutation guard: Nuqtu refit self-cleanse not found');
        if (!bolster)
            throw new Error('mutation guard: Nuqtu refit Terran Bolster III grant not found');
        if (!coreCharge)
            throw new Error('mutation guard: Nuqtu refit Core Charge I stack grant not found');

        for (const ability of [bolster, coreCharge]) {
            expect(ability.trigger).toBe('on-enemy-buffed');
            expect(ability.target).toBe('self');
            // COLLISION-SCOPE: neither reactive grant may carry the manual enemy-buff condition
            // (double-gating would silently suppress the reactive).
            expect(ability.conditions.some((c) => c.subject === 'enemy-buff')).toBe(false);
        }
        expect(cleanse.trigger).toBe('start-of-turn');
        expect(cleanse.target).toBe('self');
        expect(cleanse.oncePerRound).toBe(true);
        expect(bolster.oncePerRound).toBeUndefined();
        expect(coreCharge.oncePerRound).toBeUndefined();
    });
});

describe('Nuqtu (player-side) — an opposing buff wakes the Terran Bolster III grant', () => {
    const nuqtuFocusSkills = (): ShipSkills => ({
        slots: [noopActiveSlot(), { slot: 'passive', abilities: nuqtuPassiveAbilities() }],
    });

    // Faster than every other actor: lands a real, removable debuff on Nuqtu before Nuqtu's own
    // turn, so its every-turn cleanse has something to remove.
    const debuffEnemy = (id: string): EnemyAttacker => ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1000,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [{ slot: 'active', abilities: [debuffOnCast('deb', 'Attack Down')] }],
        },
    });

    const buffEnemy = (id: string, speed: number, buffName = 'Damage Up I'): EnemyAttacker => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [{ slot: 'active', abilities: [selfBuffOnCast('buf', buffName)] }],
        },
    });

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        enemyAttackers: [],
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: nuqtuFocusSkills(),
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1, // Nuqtu acts last — irrelevant to the reactive, which fires off the ENEMIES' turns
        healTargetId: 'attacker',
        mode: 'healing',
        ...overrides,
    });

    it('an enemy self-buffing grants Nuqtu Terran Bolster III; the every-turn cleanse runs once', () => {
        const { buffsApplied, result } = runAndCollectBuffs(
            BASE({ enemyAttackers: [debuffEnemy('enemy-deb'), buffEnemy('enemy-buf', 900)] })
        );
        expect(cleanseCountFor(result, 'attacker')).toBe(1);
        const bolster = buffsApplied.filter(
            (b) => b.buffName === 'Terran Bolster III' && b.actorId === 'attacker'
        );
        expect(bolster).toHaveLength(1);
    });

    it('TWO opposing self-buffs in one round grant Terran Bolster III TWICE; the every-turn cleanse runs only ONCE', () => {
        const debuffEnemyB = (id: string): EnemyAttacker => ({
            id,
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 950,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [{ slot: 'active', abilities: [debuffOnCast('deb-b', 'Defense Down')] }],
            },
        });

        const { buffsApplied, result } = runAndCollectBuffs(
            BASE({
                enemyAttackers: [
                    debuffEnemy('enemy-deb-a'), // speed 1000: seeds 'Attack Down'
                    debuffEnemyB('enemy-deb-b'), // speed 950: seeds 'Defense Down' (2nd removable debuff)
                    buffEnemy('enemy-buf-1', 900), // 1st on-enemy-buffed firing
                    buffEnemy('enemy-buf-2', 800), // 2nd on-enemy-buffed firing, same round
                ],
            })
        );
        // Two debuffs stand and the cleanse runs once this round. That count alone does not tell
        // an every-turn cleanse from a once-per-round reactive one; the NEGATIVE control below
        // (cleanse = 1 with no opposing buff) is what pins the every-turn parse.
        expect(cleanseCountFor(result, 'attacker')).toBe(1);
        // The buff GRANT carries no cap — it fires on every qualifying opposing buff this round.
        const bolster = buffsApplied.filter(
            (b) => b.buffName === 'Terran Bolster III' && b.actorId === 'attacker'
        );
        expect(bolster).toHaveLength(2);
    });

    it('a same-side ALLY buffing itself does NOT wake the reactive (opposing-scoped)', () => {
        const allyBuff = (): TeamActor => ({
            id: 'ally-buffer',
            speed: 950,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [selfBuffOnCast('ally-buf', 'Damage Up I')],
                        },
                    ],
                },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 20_000,
                },
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        });

        const { buffsApplied, result } = runAndCollectBuffs(
            BASE({ teamActors: [allyBuff()], enemyAttackers: [debuffEnemy('enemy-deb')] })
        );
        // The every-turn cleanse runs on Nuqtu's own turn start regardless of the ally's buff.
        expect(cleanseCountFor(result, 'attacker')).toBe(1);
        expect(
            buffsApplied.some(
                (b) => b.buffName === 'Terran Bolster III' && b.actorId === 'attacker'
            )
        ).toBe(false);
    });

    it('NEGATIVE control: no opposing buff this round → the grant does not fire; the every-turn cleanse still does', () => {
        const passiveEnemy: EnemyAttacker = {
            id: 'enemy-passive',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 500 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] },
        };

        const { buffsApplied, result } = runAndCollectBuffs(
            BASE({ enemyAttackers: [debuffEnemy('enemy-deb'), passiveEnemy] })
        );
        // The cleanse runs on Nuqtu's own turn start, with or without an opposing buff.
        expect(cleanseCountFor(result, 'attacker')).toBe(1);
        expect(
            buffsApplied.some(
                (b) => b.buffName === 'Terran Bolster III' && b.actorId === 'attacker'
            )
        ).toBe(false);
    });
});

describe('Nuqtu (enemy-side) — team symmetry: an enemy Nuqtu reacts to a PLAYER self-buff', () => {
    it("a player self-buffing wakes the enemy Nuqtu's Terran Bolster III grant", () => {
        const enemyDebuffsAttacker = (id: string): EnemyAttacker => ({
            id,
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 5,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] },
        });

        const enemyNuqtu: EnemyAttacker = {
            id: 'enemy-nuqtu',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            // The player's OWN self-buff below is the ONLY event under test.
            shipSkills: { slots: [{ slot: 'passive', abilities: nuqtuPassiveAbilities() }] },
        };

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // The player (attacker) self-buffs on cast — the triggering event for the enemy Nuqtu.
            shipSkills: {
                slots: [{ slot: 'active', abilities: [selfBuffOnCast('atk-buf', 'Damage Up I')] }],
            },
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 200, // player acts first — its self-buff wakes the enemy Nuqtu the same round
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemyDebuffsAttacker('enemy-filler'), enemyNuqtu],
        };

        const { buffsApplied } = runAndCollectBuffs(input);
        const bolster = buffsApplied.filter(
            (b) => b.buffName === 'Terran Bolster III' && b.actorId === 'enemy-nuqtu'
        );
        expect(bolster).toHaveLength(1);
    });
});
