/**
 * Phase 3 PR-E — combat-integration tests for the ally-debuff reactive promotions:
 *   - Oleander (2nd passive): "When an ally inflicts a debuff ... once per ally per round,
 *     grants Repair Over Time II to that Ally" — on-ally-debuff-inflicted, source-scoped,
 *     routed to the inflicting ally via eventCtx.damagedAllyId, capped once per ally per round.
 *   - Hayyan (2nd passive, 2nd sentence): "When a debuff is inflicted on an ally, this Unit
 *     repairs the ally for 6% of this Unit's Max HP" — NEW on-ally-debuffed trigger,
 *     victim-scoped, routed to the debuffed ally via eventCtx.damagedAllyId.
 *
 * Both owner abilities are extracted through the REAL production path (`buildShipAbilities`)
 * fed verbatim skill text copied from `docs/ship-skills.csv` (parser source of truth) — never a
 * hand-built ability array. The surrounding cast (allies/enemies that merely need to inflict a
 * debuff/DoT to generate the triggering event) are minimal hand-built actors, following the
 * `enemySideAttacked.integration.test.ts` harness style.
 *
 * Non-vacuity: reverting the Task 2/3/4 src changes (skillTextParser.ts / buildShipAbilities.ts /
 * triggers.ts) turns every "fires" assertion in this file red (verified manually; see the PR-E
 * report for the exact revert/restore transcript).
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

/** Collect every `buff-applied` event from a run (Oleander's RoT grant is a BUFF — verifiable
 *  via the bus, unlike a reactive HEAL; see sumDirectHeal below for why Hayyan's repair needs a
 *  different verification path). */
function runAndCollectBuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    runCombat({ ...input, bus });
    return { buffsApplied };
}

// =============================================================================
// Oleander — "When an ally inflicts a debuff ... once per ally per round, grants Repair Over
// Time II to that Ally" (docs/ship-skills.csv, verbatim).
// =============================================================================

const OLEANDER_P3 =
    "When an ally inflicts a debuff, this Unit <unit-aid>adds 1 charge</unit-aid> to it's Charged Skill and then, once per ally per round, grants <unit-skill>Repair Over Time II</unit-skill> to that Ally for 2 turns.";

/** Extracts Oleander's RoT-to-ally grant through the REAL parser/builder (production routing). */
function oleanderRotGrant(): Ability {
    const abilities =
        buildShipAbilities(ship({ firstPassiveSkillText: OLEANDER_P3 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const rot = abilities.find((a) => a.type === 'buff' && a.target === 'ally');
    if (!rot) throw new Error('mutation guard: Oleander RoT-to-ally grant not found');
    return rot;
}

// Sanity-check the extracted ability BEFORE using it as engine input — a mutation guard so a
// regression in Tasks 2/3 fails loudly here rather than silently no-op'ing the engine tests below.
describe('Oleander RoT grant — extracted ability shape (mutation guard)', () => {
    it('rides on-ally-debuff-inflicted with the per-ally-per-round cap flag set', () => {
        const rot = oleanderRotGrant();
        expect(rot.trigger).toBe('on-ally-debuff-inflicted');
        expect(rot.target).toBe('ally');
        expect(rot.oncePerRoundPerAlly).toBe(true);
    });
});

const debuffAbility = (buffName: string): Ability => ({
    id: `deb-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply', // always lands — isolates the reactive-routing behavior under test
        duration: 5,
    },
});

describe('Oleander (player-side) — RoT routes to the inflicting ally, capped once per ally per round', () => {
    const oleanderFocusSkills = (): ShipSkills => ({
        slots: [noopActiveSlot(), { slot: 'passive', abilities: [oleanderRotGrant()] }],
    });

    const allyA = (): TeamActor =>
        ({
            id: 'ally-a',
            speed: 130,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                // TWO debuffs in ONE cast → two debuff-applied events from the SAME ally in the
                // SAME round, proving the per-ally cap (not a plain once-per-round-overall cap).
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [debuffAbility('Def Down'), debuffAbility('Hacking Down')],
                        },
                    ],
                },
                stats: {
                    attack: 100,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 100,
                    defence: 0,
                    hp: 10_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        }) as TeamActor;

    const allyB = (): TeamActor =>
        ({
            id: 'ally-b',
            speed: 120,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [debuffAbility('Speed Down')] }],
                },
                stats: {
                    attack: 100,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 100,
                    defence: 0,
                    hp: 10_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        }) as TeamActor;

    const BASE = (): CombatEngineInput => ({
        attack: 100,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: oleanderFocusSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
        teamActors: [allyA(), allyB()],
    });

    it('grants RoT to ally-a ONCE (despite 2 inflictions) and to ally-b ONCE; never to the owner', () => {
        const { buffsApplied } = runAndCollectBuffs(BASE());
        const rot = buffsApplied.filter((b) => b.buffName === 'Repair Over Time II');

        // Per-ally cap: ally-a inflicted twice this round but only received ONE grant.
        expect(rot.filter((b) => b.actorId === 'ally-a')).toHaveLength(1);
        // A DIFFERENT ally still procs — the cap is per-ally, not once-per-round-overall.
        expect(rot.filter((b) => b.actorId === 'ally-b')).toHaveLength(1);
        // The owner (Oleander/'attacker') never inflicted a debuff itself → never receives it.
        expect(rot.some((b) => b.actorId === 'attacker')).toBe(false);
        // Exactly 2 grants total this round.
        expect(rot).toHaveLength(2);
    });
});

describe('Oleander (enemy-side) — team symmetry: an enemy Oleander reacts to its OWN ally', () => {
    it('grants the RoT to the inflicting ENEMY ally, not to itself', () => {
        const enemyOleander: EnemyAttacker = {
            id: 'enemy-oleander',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'passive', abilities: [oleanderRotGrant()] }] },
        } as EnemyAttacker;

        const enemyAllyDebuffer: EnemyAttacker = {
            id: 'enemy-ally',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1_000_000_000,
                speed: 200,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [{ slot: 'active', abilities: [debuffAbility('Def Down')] }] },
        } as EnemyAttacker;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [noopActiveSlot()] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemyAllyDebuffer, enemyOleander],
        };

        const { buffsApplied } = runAndCollectBuffs(input);
        const rot = buffsApplied.filter((b) => b.buffName === 'Repair Over Time II');
        expect(rot).toHaveLength(1);
        expect(rot[0].actorId).toBe('enemy-ally');
    });
});

// =============================================================================
// Hayyan — "When a debuff is inflicted on an ally, this Unit repairs the ally for 6% of this
// Unit's Max HP" (docs/ship-skills.csv, verbatim isolated sentence — matches the triage probe).
// =============================================================================

const HAYYAN_P3 =
    "When a debuff is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's Max HP.";

/** Extracts Hayyan's ally-debuffed repair through the REAL parser/builder (production routing). */
function hayyanAllyDebuffedHeal(): Ability {
    const abilities =
        buildShipAbilities(ship({ firstPassiveSkillText: HAYYAN_P3 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const heal = abilities.find((a) => a.type === 'heal' && a.trigger === 'on-ally-debuffed');
    if (!heal) throw new Error('mutation guard: Hayyan on-ally-debuffed repair not found');
    return heal;
}

const HAYYAN_HP = 20_000;
const HAYYAN_HEAL_PCT = 6;

describe('Hayyan RoT-repair — extracted ability shape (mutation guard)', () => {
    it('rides the NEW on-ally-debuffed trigger, targeting the ally', () => {
        const heal = hayyanAllyDebuffedHeal();
        expect(heal.trigger).toBe('on-ally-debuffed');
        expect(heal.target).toBe('ally');
    });
});

/** An enemy that lands a timed (non-DoT) debuff on the player focus every round. */
const debuffEnemy = (id: string): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'enemy-debuff',
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 1,
                            },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

/** An enemy that lands a DoT (not a timed debuff) on the player focus every round. */
const dotEnemy = (id: string): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'enemy-dot',
                            type: 'dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 1,
                                duration: 3,
                            },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

const hayyanTeamActor = (): TeamActor =>
    ({
        id: 'hayyan',
        speed: 80,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [{ slot: 'passive', abilities: [hayyanAllyDebuffedHeal()] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HAYYAN_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActor;

const HAYYAN_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActiveSlot()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 1, // slower than the enemy → the enemy's debuff/DoT lands before the focus acts
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

// A reactive heal never re-emits `heal-performed` (deliberate chain guard — triggers.ts ~2019:
// "a reactive heal must not re-trigger heal listeners"). It DOES credit the healing-mode
// per-round bookkeeping (`ctx.healing.credit(ownerId, 'directHeal', raw)`), so verification reads
// `result.healing.rounds[].perActor.get(ownerId).directHeal`, mirroring purgeReactiveIntegration's
// Salvation/Sefuba pattern.
function sumDirectHeal(result: ReturnType<typeof runCombat>, actorId: string): number {
    return (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.directHeal ?? 0),
        0
    );
}

describe('Hayyan (player-side) — repairs ONLY the debuffed ally, not itself, not on a DoT', () => {
    it('an enemy debuff on the ally (focus) is repaired by Hayyan (team actor) for 6% of Hayyan Max HP', () => {
        const result = runCombat(
            HAYYAN_BASE({
                teamActors: [hayyanTeamActor()],
                enemyAttackers: [debuffEnemy('enemy-deb')],
            })
        );
        // numRounds:1 → exactly one qualifying debuff-applied event → one 6%-of-max-HP grant.
        expect(sumDirectHeal(result, 'hayyan')).toBeCloseTo((HAYYAN_HP * HAYYAN_HEAL_PCT) / 100, 6);
    });

    it('a debuff landing on Hayyan ITSELF (self, not an ally) does NOT fire on-ally-debuffed', () => {
        // Hayyan IS the focus here (ownerId === 'attacker'); the enemy debuffs 'attacker' → the
        // targetId equals the OWNER's own id → isSameSideAlly excludes it (that is on-debuffed's
        // job, not on-ally-debuffed's).
        const selfHayyanSkills: ShipSkills = {
            slots: [noopActiveSlot(), { slot: 'passive', abilities: [hayyanAllyDebuffedHeal()] }],
        };
        const result = runCombat(
            HAYYAN_BASE({
                shipSkills: selfHayyanSkills,
                enemyAttackers: [debuffEnemy('enemy-deb')],
            })
        );
        expect(sumDirectHeal(result, 'attacker')).toBe(0);
    });

    it('a DoT (not a timed debuff) landing on the ally does NOT fire on-ally-debuffed', () => {
        const result = runCombat(
            HAYYAN_BASE({
                teamActors: [hayyanTeamActor()],
                enemyAttackers: [dotEnemy('enemy-dot')],
            })
        );
        expect(sumDirectHeal(result, 'hayyan')).toBe(0);
    });
});

describe('Hayyan (enemy-side) — team symmetry: an enemy Hayyan repairs its OWN debuffed ally', () => {
    it('repairs the ally the PLAYER just debuffed (a real, placed enemy-side ally), scaled off its OWN max HP', () => {
        // SP-4b-1: the debuffed ally is now a REAL, placed enemy actor rather than the shared
        // dummy. This test used to lean on "the player's non-positional debuff always lands on the
        // singular dummy `enemy` actor", which was enemy-side and therefore a same-side ally to
        // enemy-hayyan. The normalization boundary places every actor and synthesizes the focus's
        // `front enemy` targeting, so the debuff now resolves onto a real opposing cell — and with
        // enemy-hayyan the only enemy that would be ITSELF, which is on-attacked scope, not
        // on-ALLY-debuffed. Giving the roster a front-most victim restores the ally relationship the
        // trigger is about, and states it positionally instead of borrowing the dummy.
        const enemyVictim: EnemyAttacker = {
            id: 'enemy-victim',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 5 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4', // front-most enemy → the focus's `front enemy` debuff lands here
            shipSkills: { slots: [] },
        } as EnemyAttacker;

        const enemyHayyan: EnemyAttacker = {
            id: 'enemy-hayyan',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HAYYAN_HP, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            position: 'M3', // behind the victim, so it is never the debuff's own target
            shipSkills: { slots: [{ slot: 'passive', abilities: [hayyanAllyDebuffedHeal()] }] },
        } as EnemyAttacker;

        const playerDebuffSkills: ShipSkills = {
            slots: [{ slot: 'active', abilities: [debuffAbility('Def Down')] }],
        };

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: playerDebuffSkills,
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 200, // player acts first — its debuff wakes the enemy reactive same round
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [enemyVictim, enemyHayyan],
        };

        const result = runCombat(input);
        // Scaled off HAYYAN's OWN max HP, not the debuffed ally's (which is 1e9 here — a value the
        // expected number would be nowhere near if the wrong actor's pool were used).
        expect(sumDirectHeal(result, 'enemy-hayyan')).toBeCloseTo(
            (HAYYAN_HP * HAYYAN_HEAL_PCT) / 100,
            6
        );
        // The reactive is ALLY-scoped: the debuffed actor itself repairs nothing.
        expect(sumDirectHeal(result, 'enemy-victim')).toBe(0);
    });
});
