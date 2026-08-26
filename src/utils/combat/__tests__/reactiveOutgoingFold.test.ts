/**
 * #395 — a COUNTER-ATTACK and a REACTIVE PROC must read the same outgoing-damage channel every
 * other attack reads.
 *
 * ── THE BUG THIS FILE PINS ────────────────────────────────────────────────────────────────────
 * #389 made a defender-applied `Attack Down` / `Out. Damage Down` reduce what its attacker throws.
 * That fix landed on the APPLIED-DAMAGE path, where the outgoing fold is centralised in a single
 * `effectiveDamageStatsOf` call. Two paths never went through it and were left behind:
 *
 *   • `applyCounterAttack`   (engine.ts) — Centurion's "retaliates dealing 100%"
 *   • `applyReactiveDamage`  (engine.ts) — every on-crit / on-resist / on-debuffed proc
 *
 * Both read `effectiveStatsOf` (SELF-side layers only) and hardcoded `outgoingDamageBuffPct: 0`.
 * Two consequences, and the fix closes both because the second is what makes the first sound:
 *
 *   1. ENEMY-APPLIED SUPPRESSION IS IGNORED (the filed bug). An enemy's `Attack Down III` on the
 *      counter owner lands in the owner's per-victim ENEMY store, which `effectiveStatsOf` does
 *      not read — so the retaliation swings at full strength. In-fight: Opal's first passive
 *      inflicts `Attack Down II` on whatever directly damages it; that attacker then counters,
 *      and today its counter does not care.
 *
 *   2. THE OWNER'S OWN `Out. Damage Up` IS DROPPED, by the hardcoded 0. In-fight: Grif's active
 *      ("All allies are granted `Out. Damage Up III` for 2 turns") on a team with Centurion
 *      ("When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing
 *      100%"). `Attack Up III` from the same cast DID reach the retaliation — attack folds —
 *      while `Out. Damage Up III` did not.
 *
 * WHY 2 IS LOAD-BEARING FOR 1, and not scope creep. `shadowedDelta` implements the locked
 * highest-tier-wins rule by SUBTRACTING the owner's own same-family contribution when the enemy
 * tier wins. That subtraction is only sound if the owner's own contribution is IN the total. On
 * the `attack` channel it always was (`effectiveStatsOf(...).attack` folds `attackBuff`); on the
 * `outgoingDamage` channel the total was a hardcoded 0, so shadowing there would have removed a
 * term the total never held — the exact trap the `shadowedDelta` doc warns about. Folding the
 * owner's own outgoing total is what gives the enemy-applied delta something real to shadow.
 *
 * ── WHY THE CORPUS COULD NOT FIND THIS ────────────────────────────────────────────────────────
 * Measured before the fix (#395): 861 counter-attack and 783 reactive invocations across the whole
 * suite, ZERO with a suppressed owner. The probe was validated in both directions — removing its
 * guard surfaced all 1,644 — so that zero was a real zero, not a broken instrument. The
 * combination is ordinary play, just absent from the corpus, which is why every fixture here is
 * hand-authored.
 *
 * ── THE THREE ARMS, AND WHY THE SELF ARM IS NOT DECORATION ────────────────────────────────────
 * Mirrors `enemyAppliedStatChannels.test.ts` (#398), for the same reason: an observable that does
 * not move under a SELF-applied payload cannot testify about an ENEMY-applied one.
 *
 *   CONTROL — the applier casts an inert marker carrying no `parsedEffects` at all, through the
 *             identical cast path. Isolates the payload from the cast, the turn order and the
 *             landing roll.
 *   ENEMY   — the payload cast at `target: 'enemy'`, landing in the owner's per-victim ENEMY store.
 *   SELF    — the byte-identical payload on the owner's own SCHEDULED self-buff channel.
 *
 * Every arm also asserts store membership off the LIVE status engine (`__testTapStatusEngine`), so
 * a null result can never be "the payload never landed".
 *
 * ── EXACT NUMBERS, NEVER "LESS THAN BASELINE" ─────────────────────────────────────────────────
 * Both channels are folded at ONE site each after the fix, but a consumer that summed the self and
 * enemy halves instead of shadowing them would still produce a smaller-than-baseline counter. So
 * the shadowing case asserts the exact figure a doubling cannot reach: own `Attack Down I` (-20)
 * meeting an enemy `Attack Down III` (-60) resolves to -60 → 4,000, not -80 → 2,000.
 *
 * ── SIDE SYMMETRY ─────────────────────────────────────────────────────────────────────────────
 * The counter fixture is player-side only, inherited from `counterAttack.integration.test.ts`:
 * enemy victims do not emit `attacked`, so an enemy-side counter cannot be driven end-to-end. The
 * fix itself is side-agnostic by construction — `effectiveOutgoingStatsOf` is keyed by `actorId`
 * and reads the same two stores regardless of side, exactly as `foldActorBuffTotals` does — and
 * the accessor's own unit suite (`effectiveStats.test.ts`) pins that arithmetic directly.
 *
 * No RNG seeding: the owner has `crit: 0`, so the counter/proc crit gate never draws.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects, SelectedGameBuff } from '../../../types/calculator';
import type { StatusEngine } from '../statusEngine';
import { dealtBy } from '../__testutils__/perTargetDealt';

const OWNER_ID = 'attacker'; // the focus's engine id — the counter/proc OWNER
const FOE_ID = 'foe'; // the enemy that hits the owner and applies the payload

/** The marker a CONTROL run plants through the identical cast path, carrying no effects. */
const CONTROL_NAME = 'Inert Marker';

/** Owner attack × counter multiplier 100% vs defence 0 / neutral affinity / no crit. */
const BASELINE_COUNTER = 10_000;

// ── Ability factories ─────────────────────────────────────────────────────────────────────────

/** The owner's retaliation: `counter` at 100% of its effective attack (Centurion's shape). */
const counterAbility = (): Ability => ({
    id: 'own-counter',
    type: 'counter',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'counter', multiplier: 100 },
});

/** The foe's cast: the payload debuff on the owner FIRST, then the damage clause that wakes the
 *  retaliation — written order is resolution order, so the payload is standing when the owner
 *  counters. `application: 'apply'` always lands, so nothing here rides the hacking/security roll. */
const foeSkills = (buffName: string, parsedEffects: ParsedBuffEffects): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `cast-${buffName}`,
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName,
                        parsedEffects,
                        stacks: 1,
                        isStackable: false,
                        duration: 10,
                        application: 'apply',
                    },
                },
                {
                    id: 'foe-hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

/** A scheduled self-buff on the OWNER — the SELF-store half of a channel, standing from round 1. */
let selfBuffId = 0;
const ownSelfBuff = (
    buffName: string,
    parsedEffects: ParsedBuffEffects,
    stacks = 1
): SelectedGameBuff => ({
    id: `own-${++selfBuffId}`,
    buffName,
    stacks,
    parsedEffects,
    isStackable: stacks > 1,
});

// ── The fixture ───────────────────────────────────────────────────────────────────────────────

interface Run {
    /** Every counter the owner landed on the foe, in order — the magnitude observable. */
    counters: number[];
    /** Buff names standing in the OWNER's per-victim ENEMY store, read off the LIVE engine. */
    ownerEnemyStore: string[];
    /** Buff names standing in the OWNER's own SELF store (scheduled self-buffs). */
    ownerSelfBuffs: string[];
}

/** Healing-mode harness (mirrors counterAttack.test.ts): the FOCUS is the heal target and carries
 *  the retaliation; one enemy attacker debuffs it and hits it each round. The focus never attacks
 *  the foe in this mode, so every `reactive-damage-performed` row aimed at the foe is a counter. */
function runCounter(
    payloadName: string,
    payload: ParsedBuffEffects,
    ownSelfBuffs: SelectedGameBuff[] = []
): Run {
    let statusEngine: StatusEngine | undefined;
    const bus = createEventBus();
    const counters: number[] = [];
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.targetId === FOE_ID && e.sourceId === OWNER_ID) counters.push(e.amount);
        }
    );

    const input: CombatEngineInput = {
        attack: 10_000, // the counter OWNER's attack
        crit: 0, // no crit → the counter gate never draws
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'passive', abilities: [counterAbility()] }] },
        numRounds: 3,
        selfBuffs: ownSelfBuffs,
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000,
        healTargetId: OWNER_ID,
        mode: 'healing',
        enemyAttackers: [
            {
                id: FOE_ID,
                stats: {
                    attack: 3_000,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000,
                    speed: 50,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: foeSkills(payloadName, payload),
            },
        ],
        bus,
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
    };

    runCombat(input);

    return {
        counters,
        ownerEnemyStore: statusEngine!
            .timedAbilityStatuses('enemy', undefined, OWNER_ID)
            .map((s) => s.payload.buffName),
        ownerSelfBuffs: statusEngine!.snapshot(OWNER_ID).activeSelfBuffs.map((b) => b.buffName),
    };
}

describe('#395 — the counter-attack site reads the outgoing-damage channel', () => {
    it("CONTROL: an inert marker leaves the counter at the owner's full attack", () => {
        const control = runCounter(CONTROL_NAME, {});
        // Instrument validation: the marker DID land, so a later null result cannot be "no cast".
        expect(control.ownerEnemyStore).toContain(CONTROL_NAME);
        expect(control.counters.length).toBeGreaterThan(0);
        for (const c of control.counters) expect(c).toBeCloseTo(BASELINE_COUNTER, 6);
    });

    it('an ENEMY-applied Attack Down III suppresses the counter (#395, the filed bug)', () => {
        const run = runCounter('Attack Down III', { attack: -60 });
        expect(run.ownerEnemyStore).toContain('Attack Down III');
        expect(run.counters.length).toBeGreaterThan(0);
        // 10,000 × (1 − 0.60) × 100% = 4,000.
        for (const c of run.counters) expect(c).toBeCloseTo(4_000, 6);
    });

    it('an ENEMY-applied Out. Damage Down III suppresses the counter', () => {
        const run = runCounter('Out. Damage Down III', { outgoingDamage: -60 });
        expect(run.ownerEnemyStore).toContain('Out. Damage Down III');
        expect(run.counters.length).toBeGreaterThan(0);
        // 10,000 × (1 − 0.60) = 4,000 — the outgoing multiplier, not the attack basis.
        for (const c of run.counters) expect(c).toBeCloseTo(4_000, 6);
    });

    it("the owner's OWN Out. Damage Up III reaches the counter (Grif → Centurion)", () => {
        const run = runCounter(CONTROL_NAME, {}, [
            ownSelfBuff('Out. Damage Up III', { outgoingDamage: 30 }),
        ]);
        // Instrument validation: the self-side payload is standing.
        expect(run.ownerSelfBuffs).toContain('Out. Damage Up III');
        expect(run.counters.length).toBeGreaterThan(0);
        // 10,000 × (1 + 0.30) = 13,000. Before #395 the hardcoded 0 dropped this entirely.
        for (const c of run.counters) expect(c).toBeCloseTo(13_000, 6);
    });

    it('SELF and ENEMY halves of one family SHADOW (highest tier wins), never sum', () => {
        const run = runCounter('Attack Down III', { attack: -60 }, [
            ownSelfBuff('Attack Down I', { attack: -20 }),
        ]);
        // Both halves are standing — the straddle is real, not a one-sided fixture.
        expect(run.ownerEnemyStore).toContain('Attack Down III');
        expect(run.ownerSelfBuffs).toContain('Attack Down I');
        expect(run.counters.length).toBeGreaterThan(0);
        // Highest tier wins: -60, so 4,000. A SUM would be -80 → 2,000; own-wins would be
        // -20 → 8,000. All three are distinguishable, so a wrong rule cannot pass.
        for (const c of run.counters) expect(c).toBeCloseTo(4_000, 6);
    });

    it('the two channels are DIFFERENT families and still combine', () => {
        const run = runCounter('Attack Down III', { attack: -60 }, [
            ownSelfBuff('Out. Damage Down II', { outgoingDamage: -30 }),
        ]);
        expect(run.counters.length).toBeGreaterThan(0);
        // 10,000 × (1 − 0.60) × (1 − 0.30) = 2,800. Shadowing is PER NAMED FAMILY; collapsing
        // across families would score 4,000 here.
        for (const c of run.counters) expect(c).toBeCloseTo(2_800, 6);
    });
});

// ── The reactive-proc site ────────────────────────────────────────────────────────────────────
// A SECOND, INDEPENDENT PATH. `applyReactiveDamage` is its own closure with its own copy of the
// same walk, so the counter arms above say nothing about it — reverting either site alone must
// redden its own arms and only its own. (Verified by reverting each in turn; see the PR body.)
//
// Shape: FrontLine's real `on-enemy-charged-cast` proc, mirroring
// `reactiveDamageMitigation.integration.test.ts`. The enemy's CHARGED cast carries the payload
// debuff in its first clause and the damage in its second, so the payload is standing on the owner
// by the time the reaction drains.

/** The owner's reactive proc: 80% of its effective attack at the charging enemy. */
const procAbility = (): Ability => ({
    id: 'own-proc',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-enemy-charged-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 80, hits: 1, noCrit: true },
});

/** The charging enemy: payload debuff on the owner FIRST, then its own damage clause. Both slots
 *  carry a real multiplier>0 damage ability so `hasChargedSkill` derivation holds. */
const chargingFoe = (buffName: string, parsedEffects: ParsedBuffEffects) => ({
    id: FOE_ID,
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 40 },
    chargeCount: 1,
    startCharged: true,
    shipSkills: {
        slots: [
            {
                slot: 'active' as const,
                abilities: [
                    {
                        id: 'foe-active',
                        type: 'damage' as const,
                        target: 'enemy' as const,
                        trigger: 'on-cast' as const,
                        conditions: [],
                        config: { type: 'damage' as const, multiplier: 50 },
                    },
                ],
            },
            {
                slot: 'charged' as const,
                abilities: [
                    {
                        id: `charged-${buffName}`,
                        type: 'debuff' as const,
                        target: 'enemy' as const,
                        trigger: 'on-cast' as const,
                        conditions: [],
                        config: {
                            type: 'debuff' as const,
                            buffName,
                            parsedEffects,
                            stacks: 1,
                            isStackable: false,
                            duration: 10,
                            application: 'apply' as const,
                        },
                    },
                    {
                        id: 'foe-charged-hit',
                        type: 'damage' as const,
                        target: 'enemy' as const,
                        trigger: 'on-cast' as const,
                        conditions: [],
                        config: { type: 'damage' as const, multiplier: 150 },
                    },
                ],
            },
        ],
    },
});

interface ProcRun {
    /** Total damage the owner's proc dealt across the run. */
    dealt: number;
    ownerEnemyStore: string[];
    ownerSelfBuffs: string[];
}

/** Same three arms as `runCounter`, driven through the OTHER path: the owner's proc reacts to the
 *  foe's CHARGED cast, whose first clause plants the payload on the owner. Observable is the
 *  per-victim dealt credit (`perTargetDealt`), which is where `applyReactiveDamage` books. */
function runProc(
    payloadName: string,
    payload: ParsedBuffEffects,
    ownSelfBuffs: SelectedGameBuff[] = []
): ProcRun {
    let statusEngine: StatusEngine | undefined;
    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'passive', abilities: [procAbility()] },
            ],
        },
        numRounds: 1,
        selfBuffs: ownSelfBuffs,
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
        speed: 200,
        healTargetId: OWNER_ID,
        mode: 'healing',
        enemyAttackers: [chargingFoe(payloadName, payload)],
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
    };
    const result = runCombat(input);
    return {
        dealt: dealtBy(result.rounds, OWNER_ID),
        ownerEnemyStore: statusEngine!
            .timedAbilityStatuses('enemy', undefined, OWNER_ID)
            .map((s) => s.payload.buffName),
        ownerSelfBuffs: statusEngine!.snapshot(OWNER_ID).activeSelfBuffs.map((b) => b.buffName),
    };
}

describe('#395 — the reactive-proc site reads the outgoing-damage channel', () => {
    it("CONTROL: an inert marker leaves the proc at the owner's full attack", () => {
        const control = runProc(CONTROL_NAME, {});
        expect(control.ownerEnemyStore).toContain(CONTROL_NAME);
        // 10,000 × 80% vs defence 0 = 8,000.
        expect(control.dealt).toBeCloseTo(8_000, 0);
    });

    it('an ENEMY-applied Attack Down III suppresses the proc', () => {
        const run = runProc('Attack Down III', { attack: -60 });
        expect(run.ownerEnemyStore).toContain('Attack Down III');
        expect(run.dealt).toBeCloseTo(3_200, 0);
    });

    it('an ENEMY-applied Out. Damage Down III suppresses the proc', () => {
        const run = runProc('Out. Damage Down III', { outgoingDamage: -60 });
        expect(run.ownerEnemyStore).toContain('Out. Damage Down III');
        expect(run.dealt).toBeCloseTo(3_200, 0);
    });

    it("the owner's OWN Out. Damage Up III reaches the proc", () => {
        const run = runProc(CONTROL_NAME, {}, [
            ownSelfBuff('Out. Damage Up III', { outgoingDamage: 30 }),
        ]);
        expect(run.ownerSelfBuffs).toContain('Out. Damage Up III');
        // 8,000 × 1.30 = 10,400.
        expect(run.dealt).toBeCloseTo(10_400, 0);
    });

    it('SELF and ENEMY halves of one family SHADOW (highest tier wins), never sum', () => {
        const run = runProc('Attack Down III', { attack: -60 }, [
            ownSelfBuff('Attack Down I', { attack: -20 }),
        ]);
        expect(run.ownerEnemyStore).toContain('Attack Down III');
        expect(run.ownerSelfBuffs).toContain('Attack Down I');
        // -60 wins → 3,200. A sum (-80) would score 1,600; own-wins (-20) 6,400.
        expect(run.dealt).toBeCloseTo(3_200, 0);
    });
});
