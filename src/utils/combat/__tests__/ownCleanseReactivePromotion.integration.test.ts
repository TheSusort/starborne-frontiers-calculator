/**
 * Phase 3 PR-H — combat-integration tests for the NEW `on-own-cleanse` reactive trigger:
 *   - Morao (3rd passive): "This Unit repairs 5% of its Max HP every turn and, upon Cleansing a
 *     Debuff, repairs an additional 5% of its Max HP while gaining Defense Up II for 2 turns" —
 *     the "every turn" repair now rides start-of-turn (SP-G G1a, 2026-07-09: detectEveryTurnTrigger
 *     closed the "every turn" recurring-trigger gap this file's own comments used to call
 *     out-of-scope); the "upon Cleansing" repair + Defense Up II ride on-own-cleanse. Self-target —
 *     no actor capture needed.
 *   - Cultivator (1st passive): "When this Unit cleanses a Debuff, it also repairs that ally for
 *     4% of this Unit's Max HP" — 'ally'-target, routed to the ACTUALLY-cleansed ally via
 *     eventCtx.cleansedAllyIds (cleanse-performed.targets), fanning out over every real removal
 *     (not just the cleanse ability's nominal target set).
 *
 * Both owner abilities are extracted through the REAL production path (`buildShipAbilities`) fed
 * skill text copied verbatim from `docs/ship-skills.csv` (parser source of truth) — never a
 * hand-built ability array. The cleanse ACTION itself (which drives the reaction) is hand-built,
 * mirroring `cleanseCastPath.test.ts`/`enemyCleanse.integration.test.ts`'s harness style.
 *
 * Non-vacuity: reverting the PR-H src changes (skillTextParser.ts / buildShipAbilities.ts /
 * triggers.ts / playerTurn.ts / events.ts) turns every "fires"/"routes to" assertion in this file
 * red (verified manually — see the PR-H report for the revert/restore transcript).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createStatusEngine } from '../statusEngine';
import type { PlayerActorRuntime, HealingRuntimeCtx } from '../playerTurn';
import type { CombatActor } from '../state';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

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

/** Collect every `buff-applied` event from a run (Morao's Defense Up II grant is a BUFF —
 *  verifiable via the bus, unlike the reactive HEALs; see sumDirectHeal below). */
function runAndCollectBuffs(input: CombatEngineInput) {
    const bus = createEventBus();
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    runCombat({ ...input, bus });
    return { buffsApplied };
}

/** A reactive heal never re-emits `heal-performed` (deliberate chain guard — triggers.ts: "a
 *  reactive heal must not re-trigger heal listeners"). It DOES credit the healing-mode per-round
 *  bookkeeping (`ctx.healing.credit(ownerId, 'directHeal'|'effectiveHeal', raw)`), so verification
 *  reads `result.healing.rounds[].perActor.get(ownerId)`, mirroring PR-E's Hayyan pattern.
 *  `directHeal` is credited to the OWNER regardless of WHICH recipient actually received the
 *  repair; `effectiveHeal` is credited (possibly 0) only when the recipient equals
 *  `ctx.healing.targetId` — the distinguishing signal used by the Cultivator routing tests below. */
function sumBucket(
    result: ReturnType<typeof runCombat>,
    actorId: string,
    bucket: 'directHeal' | 'effectiveHeal'
): number {
    return (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );
}

// =============================================================================
// Morao — "This Unit repairs 5% of its Max HP every turn and, upon Cleansing a Debuff, repairs
// an additional 5% of its Max HP while gaining Defense Up II for 2 turns" (docs/ship-skills.csv,
// verbatim).
// =============================================================================

const MORAO_P3 =
    'This Unit <unit-damage>repairs 5%</unit-damage> of its Max HP every turn and, upon <unit-aid>Cleansing a</unit-aid> Debuff, repairs an additional <unit-damage>5%</unit-damage> of its Max HP while gaining <unit-skill>Defense Up II</unit-skill> for 2 turns.';
const MORAO_HP = 20_000;
const MORAO_BASE_PCT = 5; // "every turn" — start-of-turn (SP-G G1a)
const MORAO_REACTIVE_PCT = 5; // "upon Cleansing a Debuff" — on-own-cleanse

/** Extracts Morao's REAL production passive slot (all 3 abilities, unfiltered — the baseline
 *  every-turn repair, the reactive repair, and the reactive Defense Up II grant). */
function moraoPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ firstPassiveSkillText: MORAO_P3 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

describe('Morao passive — extracted ability shapes (mutation guard)', () => {
    it('the "every turn" repair rides start-of-turn (SP-G G1a); the "upon Cleansing" repair + Defense Up II ride on-own-cleanse', () => {
        const abilities = moraoPassiveAbilities();
        const heals = abilities.filter((a) => a.type === 'heal');
        const buffs = abilities.filter((a) => a.type === 'buff');
        expect(heals).toHaveLength(2);
        expect(heals.filter((a) => a.trigger === 'start-of-turn')).toHaveLength(1);
        expect(heals.filter((a) => a.trigger === 'on-own-cleanse')).toHaveLength(1);
        expect(buffs).toHaveLength(1);
        expect(buffs[0].trigger).toBe('on-own-cleanse');
        expect(buffs[0].target).toBe('self');
        expect(buffs[0].config.type === 'buff' && buffs[0].config.buffName).toBe('Defense Up II');
    });
});

// Focus casts a self-target cleanse each round (mirrors cleanseCastPath.test.ts).
const selfCleanseActive = (count: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'self-cleanse',
            type: 'cleanse',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'cleanse', count },
        },
    ],
});

/** A FASTER enemy whose active applies ONE removable debuff to the heal target (mirrors
 *  cleanseCastPath.test.ts's debuffEnemy). */
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
                                buffName: 'Attack Down',
                                parsedEffects: { attack: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 5,
                            },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

const MORAO_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [selfCleanseActive(1), { slot: 'passive', abilities: moraoPassiveAbilities() }],
    },
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
    hp: MORAO_HP,
    speed: 1, // slower than the debuff enemy → the debuff lands before Morao's own cleanse cast
    healTargetId: 'attacker',
    ...overrides,
});

describe('Morao (player-side) — self-cleanse drives the reactive repair + Defense Up II', () => {
    it('a pre-existing debuff removed by its OWN cleanse fires BOTH the baseline and reactive repair (10% total) + Defense Up II', () => {
        const { buffsApplied } = runAndCollectBuffs(
            MORAO_BASE({ enemyAttackers: [debuffEnemy('enemy-deb')] })
        );
        const result = runCombat(MORAO_BASE({ enemyAttackers: [debuffEnemy('enemy-deb')] }));
        // Baseline (5%, start-of-turn — SP-G G1a, always fires) + reactive (5%, on-own-cleanse) = 10% total.
        expect(sumBucket(result, 'attacker', 'directHeal')).toBeCloseTo(
            (MORAO_HP * (MORAO_BASE_PCT + MORAO_REACTIVE_PCT)) / 100,
            6
        );
        const defenseUp = buffsApplied.filter((b) => b.buffName === 'Defense Up II');
        expect(defenseUp).toHaveLength(1);
        expect(defenseUp[0].actorId).toBe('attacker');
    });

    it('NEGATIVE control: no debuff to cleanse → only the baseline 5% fires, no Defense Up II', () => {
        const { buffsApplied } = runAndCollectBuffs(MORAO_BASE());
        const result = runCombat(MORAO_BASE());
        // Only the baseline "every turn" repair (start-of-turn) fires — the reactive never triggers.
        expect(sumBucket(result, 'attacker', 'directHeal')).toBeCloseTo(
            (MORAO_HP * MORAO_BASE_PCT) / 100,
            6
        );
        expect(buffsApplied.filter((b) => b.buffName === 'Defense Up II')).toHaveLength(0);
    });
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Player active: a damage hit PLUS a removable debuff onto the positionally-anchored front enemy
// (mirrors enemyCleanse.integration.test.ts's damageThenDebuff).
const damageThenDebuff = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'p-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
        {
            id: 'p-debuff',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Attack Down',
                parsedEffects: { attack: -30 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 5,
            },
        } as unknown as Ability,
    ],
});

// Deliberately independent of MORAO_HP (20_000, the 'attacker'-side fixture above) — enemyAt is a
// shared generic enemy-attacker factory (also used by the Cultivator team-symmetry test below),
// so its HP is its own fixture value. FOE_HP names it for the self-heal-basis math below.
const FOE_HP = 40_000;
const enemyAt = (id: string, position: Position, shipSkills: ShipSkills): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1_000, crit: 0, critDamage: 0, defence: 0, hp: FOE_HP, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills,
    }) as EnemyAttacker;

describe('Morao (enemy-side) — team symmetry: an enemy Morao self-cleanses and reacts', () => {
    it('the player-applied debuff, once self-cleansed, fires the reactive repair + Defense Up II on the enemy', () => {
        const foeSkills: ShipSkills = {
            slots: [selfCleanseActive(1), { slot: 'passive', abilities: moraoPassiveAbilities() }],
        };
        const input: CombatEngineInput = {
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [damageThenDebuff()] },
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
            speed: 200, // player acts first, anchoring + debuffing 'foe' before its own turn
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            healTargetId: 'attacker',
            enemyAttackers: [enemyAt('foe', 'M4', foeSkills)],
        };
        const { buffsApplied } = runAndCollectBuffs(input);
        const result = runCombat(input);
        // SP-G G1a: the "every turn" repair now rides start-of-turn, so — team-symmetrically with
        // the 'attacker'-side test above — BOTH self-heals fire on the enemy actor too (previously
        // only the on-own-cleanse repair fired here; the base repair was dormant on the enemy side
        // since 'on-cast' never applied to a walked enemy attacker). The basis is 'foe's OWN HP
        // (FOE_HP, enemyAt's fixture value), not the player-fixture's MORAO_HP.
        expect(sumBucket(result, 'foe', 'directHeal')).toBeCloseTo(
            (FOE_HP * (MORAO_BASE_PCT + MORAO_REACTIVE_PCT)) / 100,
            6
        );
        const defenseUp = buffsApplied.filter((b) => b.buffName === 'Defense Up II');
        expect(defenseUp).toHaveLength(1);
        expect(defenseUp[0].actorId).toBe('foe');
    });
});

// =============================================================================
// Cultivator — "When this Unit cleanses a Debuff, it also repairs that ally for 4% of this
// Unit's Max HP" (docs/ship-skills.csv, verbatim isolated sentence — matches the triage probe).
// =============================================================================

const CULTIVATOR_P2 =
    "When this Unit <unit-aid>cleanses a Debuff</unit-aid>, it also <unit-damage>repairs that ally for 4%</unit-damage> of this Unit's Max HP.";
const CULTIVATOR_HP = 20_000;
const CULTIVATOR_HEAL_PCT = 4;

/** Extracts Cultivator's ally-repair through the REAL parser/builder (production routing). */
function cultivatorReactiveHeal(): Ability {
    const abilities =
        buildShipAbilities(ship({ firstPassiveSkillText: CULTIVATOR_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? [];
    const heal = abilities.find((a) => a.type === 'heal' && a.trigger === 'on-own-cleanse');
    if (!heal) throw new Error('mutation guard: Cultivator on-own-cleanse repair not found');
    return heal;
}

describe('Cultivator repair — extracted ability shape (mutation guard)', () => {
    it('rides the NEW on-own-cleanse trigger, targeting the ally', () => {
        const heal = cultivatorReactiveHeal();
        expect(heal.trigger).toBe('on-own-cleanse');
        expect(heal.target).toBe('ally');
    });
});

// An ALL-ALLIES cleanse (NOT Cultivator's real single-ally shape — a deliberately broader hand-
// built cast) proves the underlying fan-out is robust: only recipients that ACTUALLY had a debuff
// removed land in eventCtx.cleansedAllyIds, and the reactive repair follows THOSE ids rather than
// whatever `healing.targetId`/ownerId default the recipient-resolution would otherwise fall back
// to (the brief's "Cultivator cleanses 1, but do it robustly").
const allAlliesCleanseActive = (count: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'cultivator-cleanse',
            type: 'cleanse',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'cleanse', count },
        },
    ],
});

/** A FASTER enemy that both damages AND debuffs 'attacker' (so it is BELOW max HP — giving the
 *  reactive repair real room to register `effectiveHeal` — AND carries a removable debuff). */
const damageAndDebuffEnemy = (id: string): EnemyAttacker =>
    ({
        id,
        stats: { attack: 500, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'enemy-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                        {
                            id: 'enemy-debuff',
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Attack Down',
                                parsedEffects: { attack: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 5,
                            },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

const cultivatorTeamActor = (): TeamActor =>
    ({
        id: 'cultivator',
        speed: 10, // slowest — acts after both the enemy AND the other actors
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: {
                slots: [
                    allAlliesCleanseActive(1),
                    { slot: 'passive', abilities: [cultivatorReactiveHeal()] },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 100,
                defence: 0,
                hp: CULTIVATOR_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActor;

/** A second ally with NO debuff — included in the all-allies cleanse's target SET but contributes
 *  zero real removal, so it must never appear in eventCtx.cleansedAllyIds. */
const allyBTeamActor = (): TeamActor =>
    ({
        id: 'ally-b',
        speed: 30,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [noopActiveSlot()] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
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

const CULTIVATOR_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
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
    speed: 50, // faster than Cultivator's own turn but slower than the enemy
    teamActors: [cultivatorTeamActor(), allyBTeamActor()],
    ...overrides,
});

describe('Cultivator (player-side) — end-to-end: self-cast all-allies cleanse fires the ally repair', () => {
    // NOTE: in this engine, a non-positional enemy attack always targets `healTargetId` (the
    // "tank") — so a full-engine run can't decouple "who got debuffed" from "who healTargetId
    // points at" to prove the reaction follows eventCtx.cleansedAllyIds rather than a
    // healing.targetId fallback. That precise routing distinction is proven at the unit level
    // (executeIntent/reactiveRecipients, below); these end-to-end tests confirm the REAL
    // production wiring fires with the right magnitude and stays silent with nothing to cleanse.
    it('a pre-existing debuff on the heal target, once cleansed, fires the reaction for 4% of Cultivator Max HP', () => {
        const result = runCombat(
            CULTIVATOR_BASE({
                healTargetId: 'attacker',
                enemyAttackers: [damageAndDebuffEnemy('enemy-deb')],
            })
        );
        expect(sumBucket(result, 'cultivator', 'directHeal')).toBeCloseTo(
            (CULTIVATOR_HP * CULTIVATOR_HEAL_PCT) / 100,
            6
        );
        expect(sumBucket(result, 'cultivator', 'effectiveHeal')).toBeGreaterThan(0);
    });

    it('NEGATIVE control: no debuff anywhere → cleanse removes nothing → the reaction never fires', () => {
        const result = runCombat(CULTIVATOR_BASE({ healTargetId: 'attacker' }));
        expect(sumBucket(result, 'cultivator', 'directHeal')).toBe(0);
    });
});

// ----------------------------------------------------------------------------------------------
// Unit-level routing precision (mirrors triggers.test.ts's "damagedAllyId recipient routing"
// pattern) — proves reactiveRecipients() follows eventCtx.cleansedAllyIds rather than falling
// back to healing.targetId, with healing.targetId fully decoupled from the cleanse outcome (the
// full-engine harness above cannot decouple the two — see the note above).
// ----------------------------------------------------------------------------------------------
describe("Cultivator's on-own-cleanse ally-target heal — cleansedAllyIds routing (executeIntent unit-level)", () => {
    const PLAYER_IDS = ['cultivator', 'team1', 'tank'];

    const makeHealIntent = (cleansedAllyIds?: string[]): Intent => ({
        ownerId: 'cultivator',
        sourceSlot: 'passive',
        ability: {
            id: 'cultivator-ally-repair',
            type: 'heal',
            target: 'ally',
            trigger: 'on-own-cleanse',
            conditions: [],
            config: { type: 'heal', pct: 4, basis: 'hp' },
        },
        ...(cleansedAllyIds !== undefined ? { eventCtx: { cleansedAllyIds } } : {}),
    });

    const buildHealCtx = (): {
        ctx: IntentExecContext;
        applied: number[];
        credits: Array<{ actorId: string; bucket: string; amount: number }>;
    } => {
        const applied: number[] = [];
        const credits: Array<{ actorId: string; bucket: string; amount: number }> = [];
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        const healing: HealingRuntimeCtx = {
            targetId: 'tank',
            credit: (actorId, bucket, amount) => credits.push({ actorId, bucket, amount }),
            recipientMaxHp: () => 1000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => 1000,
            applyHealToTarget: (raw) => {
                applied.push(raw);
                return { consumed: raw, overheal: 0 };
            },
            grantShieldToTarget: () => 0,
            playerIds: PLAYER_IDS,
            enemyIds: [],
            recipientActor: () => undefined,
        };
        const ctx: IntentExecContext = {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                [
                    'cultivator',
                    {
                        actor: { id: 'cultivator' },
                        healModifier: 0,
                        attack: 0,
                        defence: 0,
                        hp: 20_000,
                    } as unknown as PlayerActorRuntime,
                ],
            ]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: PLAYER_IDS,
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            healing,
        };
        return { ctx, applied, credits };
    };

    it('a SINGLE cleansedAllyIds entry DIFFERENT from healing.targetId routes there, NOT to the target (no fallback)', () => {
        const { ctx, applied, credits } = buildHealCtx();
        executeIntent(makeHealIntent(['team1']), ctx);
        // 4% of Cultivator's 20,000 HP = 800, credited as directHeal regardless of recipient...
        expect(credits.filter((c) => c.bucket === 'directHeal')).toEqual([
            { actorId: 'cultivator', bucket: 'directHeal', amount: 800 },
        ]);
        // ...but the pool-consumption path (applyHealToTarget/effectiveHeal) only fires when the
        // recipient equals healing.targetId ('tank') — 'team1' never triggers it, proving the
        // routing did NOT fall back to healing.targetId when cleansedAllyIds named someone else.
        expect(applied).toHaveLength(0);
        expect(credits.some((c) => c.bucket === 'effectiveHeal')).toBe(false);
    });

    it('a SINGLE cleansedAllyIds entry EQUAL to healing.targetId consumes the pool (effectiveHeal credited)', () => {
        const { ctx, applied, credits } = buildHealCtx();
        executeIntent(makeHealIntent(['tank']), ctx);
        expect(applied).toEqual([800]);
        expect(credits).toContainEqual({
            actorId: 'cultivator',
            bucket: 'effectiveHeal',
            amount: 800,
        });
    });

    it("MULTIPLE cleansedAllyIds fan out to EVERY actually-cleansed ally (robustness beyond Cultivator's real single-ally shape)", () => {
        const { ctx, applied, credits } = buildHealCtx();
        executeIntent(makeHealIntent(['team1', 'tank']), ctx);
        // Both recipients are credited directHeal (one entry per recipient in the fan-out loop)...
        expect(credits.filter((c) => c.bucket === 'directHeal')).toHaveLength(2);
        // ...but only 'tank' (matching healing.targetId) consumes the pool.
        expect(applied).toEqual([800]);
        expect(credits.filter((c) => c.bucket === 'effectiveHeal')).toHaveLength(1);
    });

    it('NO cleansedAllyIds (absent) falls back to the plain healing.targetId (PR1 contract, unchanged for every OTHER ally-target reactive)', () => {
        const { ctx, applied, credits } = buildHealCtx();
        executeIntent(makeHealIntent(undefined), ctx);
        expect(applied).toEqual([800]);
        expect(credits).toContainEqual({
            actorId: 'cultivator',
            bucket: 'effectiveHeal',
            amount: 800,
        });
    });
});

describe('Cultivator (enemy-side) — team symmetry: an enemy Cultivator repairs its OWN cleansed ally', () => {
    it('repairs the OTHER enemy ally the player just debuffed (positional: the non-positional dummy target has no `ally`-selection candidate)', () => {
        // NOTE: an 'ally'-target cleanse's enemy-caster branch picks via lowestHpEnemyAllyId(),
        // which iterates `healing.enemyIds` — the EXPLICIT enemyAttackers list only (NOT the
        // singular non-positional dummy `enemy` target, which the player's non-positional debuff
        // always lands on regardless of enemyAttackers — verified manually). So a genuine SECOND
        // EnemyAttacker (not the dummy) is required here, positionally targeted by the player
        // (mirrors enemyCleanse.integration.test.ts's positional harness).
        const enemyCultivator: EnemyAttacker = {
            id: 'enemy-cultivator',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: CULTIVATOR_HP, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'enemy-cultivator-cleanse',
                                type: 'cleanse',
                                target: 'ally',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'cleanse', count: 1 },
                            },
                        ],
                    },
                    { slot: 'passive', abilities: [cultivatorReactiveHeal()] },
                ],
            },
        } as EnemyAttacker;

        // The OTHER enemy ally: positionally anchored at M4/front, no skills of its own (never
        // acts meaningfully) — only exists to receive the player's debuff and be Cultivator's
        // sole `ally`-selection candidate (lowestHpEnemyAllyId excludes the caster itself).
        const enemyAlly = enemyAt('enemy-ally', 'M4', { slots: [] });

        const input: CombatEngineInput = {
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [damageThenDebuff()] },
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
            speed: 200, // player acts first — its debuff lands on enemy-ally before enemy-cultivator's turn
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            healTargetId: 'attacker',
            enemyAttackers: [enemyAlly, enemyCultivator],
        };

        const result = runCombat(input);
        expect(sumBucket(result, 'enemy-cultivator', 'directHeal')).toBeCloseTo(
            (CULTIVATOR_HP * CULTIVATOR_HEAL_PCT) / 100,
            6
        );
    });
});
