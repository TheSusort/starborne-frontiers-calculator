import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, AbilityTarget, AbilityTrigger, ShipSkills } from '../../../types/abilities';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { makeRateGate, setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import type { CombatActor } from '../state';

type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;

// ---------------------------------------------------------------------------
// C1 Task 4: reactive-path cleanse REMOVES debuffs (player-side, side-correct).
//
// Mirrors cleanseCastPath.test.ts but drives the cleanse through the REACTIVE
// trigger machinery (executeIntent) instead of the on-cast path. A player healer
// (focus = the heal target) carries a `start-of-round` reactive cleanse targeting
// itself; a FASTER enemy attacker applies a removable debuff (`Attack Down`,
// application 'apply' → always lands) to the heal target each round. Because
// `start-of-round` fires at the TOP of each round (before any turn), the debuff
// applied in round N is present when the reactive cleanse fires at the top of
// round N+1 — so it is removed, and `cleanseCount` reflects the ACTUAL removed
// count (NOT the nominal cfg.count, which was the pre-T4 behaviour).
// ---------------------------------------------------------------------------
describe('C1 Task 4: reactive-path cleanse removes debuffs (player-side)', () => {
    const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `c${Math.random().toString(36).slice(2)}`,
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        enemyAttackers: [],
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
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
        hp: 10000,
        ...overrides,
    });

    // Focus healer: a reactive (start-of-round) cleanse-1 on a passive slot, targeting
    // self (the heal target). A reactive trigger routes through executeIntent's cleanse
    // branch — the path this task wires.
    const reactiveCleanseSkills = (count: number): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'cleanse',
                        target: 'self',
                        trigger: 'start-of-round',
                        config: { type: 'cleanse', count },
                    }),
                ],
            },
        ],
    });

    // Enemy attacker: a FASTER (speed 200) actor whose active cast applies a single
    // removable debuff (Attack Down, application 'apply' → always lands) to the heal target.
    const debuffEnemy = () => ({
        id: 'enemy1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'enemy', // from the enemy's view the heal target is its enemy
                            config: {
                                type: 'debuff',
                                buffName: 'Attack Down',
                                parsedEffects: { attack: -30 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 5,
                            },
                        }),
                    ],
                },
            ],
        },
    });

    it('reactive cleanse REMOVES the enemy-applied debuff and credits the ACTUAL removed count', () => {
        const events: CleansePerformed[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));

        const NUM_ROUNDS = 3;
        const result = runCombat(
            BASE({
                numRounds: NUM_ROUNDS,
                healTargetId: 'attacker',
                mode: 'healing',
                bus,
                shipSkills: reactiveCleanseSkills(1),
                enemyAttackers: [debuffEnemy()],
            })
        );

        // Round timeline:
        //   R1: start-of-round cleanse fires (nothing on focus yet → 0 removed), then the
        //       faster enemy applies Attack Down to the focus.
        //   R2: start-of-round cleanse fires → removes the Attack Down from R1 (1), then the
        //       enemy re-applies Attack Down.
        //   R3: start-of-round cleanse fires → removes the Attack Down from R2 (1), then re-apply.
        // → total ACTUAL removed = 2 (NOT the nominal 1 × 3 = 3 the pre-T4 credit-only path gave).
        const totalCleanse = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.cleanseCount ?? 0),
            0
        );
        expect(totalCleanse).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Task 3: reactive cleanse honors procChance + crit-count (Reactive Ward executor)
//
// These tests drive executeIntent directly (no full runCombat) to isolate the
// cleanse executor branch. Pattern mirrors reactiveDamageProcGate.test.ts.
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner1';
// For 'self'-target cleanse, reactiveRecipients returns [ownerId]; seed debuffs on OWNER_ID.
const TARGET_ID = OWNER_ID;

// A minimal timed enemy debuff seeded into the status engine (enemy-side, per-victim).
const mkTimed = (
    buffName: string,
    duration = 3
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration,
    payload: { buffName, stacks: 1, parsedEffects: {} },
});

/** Build a reactive cleanse Intent for the test owner. */
function makeCleanseIntent(opts: {
    count?: number;
    critCount?: number;
    procChance?: number;
    didCrit?: boolean;
}): Intent {
    return {
        ownerId: OWNER_ID,
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-cleanse-ab',
            type: 'cleanse',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            ...(opts.procChance !== undefined ? { procChance: opts.procChance } : {}),
            config: {
                type: 'cleanse',
                count: opts.count ?? 1,
                ...(opts.critCount !== undefined ? { critCount: opts.critCount } : {}),
            },
        },
        ...(opts.didCrit !== undefined ? { eventCtx: { didCrit: opts.didCrit } } : {}),
    } as unknown as Intent;
}

/**
 * Build a minimal IntentExecContext for the cleanse branch.
 *
 * The cleanse branch reads:
 *   - ctx.healing  → must be truthy to not short-circuit
 *   - ctx.statusEngine  → for cleanse() calls
 *   - ctx.procChanceGates  → provided when testing the gate
 *
 * `healing.targetId` is the recipient to cleanse (TARGET_ID, same as owner for 'self').
 * `healing.credit` is the spy tracking cleanseCount credits.
 */
function makeCtx(opts?: {
    procChanceGates?: Map<string, ReturnType<typeof makeRateGate>>;
    creditSpy?: ReturnType<typeof vi.fn>;
    statusEngine?: ReturnType<typeof createStatusEngine>;
}): IntentExecContext {
    const bus = createEventBus();
    const se = opts?.statusEngine ?? createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    const creditSpy = opts?.creditSpy ?? vi.fn();

    return {
        round: 1,
        statusEngine: se,
        bus,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([
            [
                OWNER_ID,
                {
                    actor: { id: OWNER_ID, chargeCount: 0, charges: 0 } as unknown as CombatActor,
                    attack: 10000,
                    defence: 0,
                    hp: 10000,
                    healModifier: 0,
                    selfDotModifier: 0,
                    defensePenetrationBuff: 0,
                    affinityDamageModifier: 0,
                    affinityCritCap: 100,
                    affinityCritPenalty: 0,
                    affinityDisadvantage: false,
                    selfBuffLookup: new Map(),
                    enemyDebuffLookup: new Map(),
                } as never,
            ],
        ]),
        grantAllyCharges: () => {},
        grantExtraAction: () => {},
        playerIds: [OWNER_ID],
        lastTurnCtxByActor: new Map(),
        recordResisted: () => {},
        procChanceGates: opts?.procChanceGates,
        // Minimal healing ctx: targetId = TARGET_ID (same as owner for 'self'),
        // credit is the spy, stubs for unused methods.
        healing: {
            targetId: TARGET_ID,
            credit: creditSpy,
            recipientMaxHp: () => 10000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => undefined,
            applyHealToTarget: () => ({ reversed: false as const, consumed: 0, overheal: 0 }),
            grantShieldToTarget: () => {},
            playerIds: [OWNER_ID],
            enemyIds: [],
            // SP-4e fix wave 1: production supplies `(id) => allActorsById.get(id)`, which
            // resolves every roster id. `() => undefined` mis-modelled that — the reactive heal
            // branch reads it to pick whose pool to drain, so an always-undefined stub silently
            // repairs nobody. That exact mis-modelling is what moved 8 tests in this task.
            recipientActor: (id: string) =>
                id === OWNER_ID ? ({ id: OWNER_ID } as CombatActor) : undefined,
        },
    } as unknown as IntentExecContext;
}

/** Seed `count` distinct debuffs onto TARGET_ID in the given status engine. */
function seedDebuffs(se: ReturnType<typeof createStatusEngine>, count: number): void {
    se.beginRound(1);
    for (let i = 0; i < count; i++) {
        se.applyTimedAbilityStatus(1, mkTimed(`Debuff-${i}`), 'attacker', TARGET_ID);
    }
}

/** Build a reactive reduce-duration Intent for the test owner. `count` defaults to 1 (the
 *  pre-PR11 newest-only shape, e.g. Warpstrike); pass 'all' for PR11's Heliodor/Pestilence
 *  ALL-debuffs shape. `trigger` defaults to 'on-attacked' (Heliodor's shape); pass
 *  'on-debuff-inflicted' for Pestilence's shape. */
function makeReduceDurationIntent(opts: {
    durationTurns?: number;
    procChance?: number;
    count?: number | 'all';
    trigger?: AbilityTrigger;
    target?: AbilityTarget;
}): Intent {
    return {
        ownerId: OWNER_ID,
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-reduce-dur-ab',
            type: 'cleanse',
            target: opts.target ?? 'self',
            trigger: opts.trigger ?? 'on-attacked',
            conditions: [],
            ...(opts.procChance !== undefined ? { procChance: opts.procChance } : {}),
            config: {
                type: 'cleanse',
                mode: 'reduce-duration',
                count: opts.count ?? 1, // unused in reduce-duration mode UNLESS 'all' (PR11)
                ...(opts.durationTurns !== undefined ? { durationTurns: opts.durationTurns } : {}),
            },
        },
    } as unknown as Intent;
}

describe('Task 4: reactive cleanse executor — reduce-duration mode', () => {
    it('F. reduce-duration: newest debuff loses 1 turn; older debuff unchanged; credits cleanseCount:1', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        // Seed two debuffs in sequence: Debuff-0 first (older, seq=1), Debuff-1 second (newer, seq=2).
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-0', 3), 'attacker', TARGET_ID);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-1', 5), 'attacker', TARGET_ID);

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({ durationTurns: 1 });
        executeIntent(intent, ctx);

        // Credit should be called with cleanseCount = 1 (one debuff had its duration reduced).
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 1);

        // Inspect remaining durations via timedAbilityStatuses('enemy', ownerId, targetId).
        // TARGET_ID = OWNER_ID so both arguments are the same string.
        const statuses = se.timedAbilityStatuses('enemy', OWNER_ID, TARGET_ID);
        const byName = new Map(statuses.map((s) => [s.active.buffName, s.active.turnsRemaining]));

        // Debuff-1 is the newest (higher appliedSeq) → its duration was reduced by 1 (5→4).
        expect(byName.get('Debuff-1')).toBe(4);
        // Debuff-0 is older → unchanged (still 3).
        expect(byName.get('Debuff-0')).toBe(3);
    });

    it('G. reduce-duration without healing ctx: still reduces debuff, no throw, no credit attempted', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-X', 4), 'attacker', TARGET_ID);

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        // Remove healing ctx entirely.
        (ctx as unknown as Record<string, unknown>).healing = undefined;

        const intent = makeReduceDurationIntent({ durationTurns: 1 });
        // Must not throw even without healing.
        expect(() => executeIntent(intent, ctx)).not.toThrow();

        // The debuff duration must have been reduced (4 → 3).
        const statuses = se.timedAbilityStatuses('enemy', OWNER_ID, TARGET_ID);
        const debuffX = statuses.find((s) => s.active.buffName === 'Debuff-X');
        expect(debuffX?.active.turnsRemaining).toBe(3);

        // No credit should be called (ctx.healing is absent).
        expect(creditSpy).not.toHaveBeenCalled();
    });

    it('H. reduce-duration with no eligible debuff: affected 0, no throw, credit 0 when healing present', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        // No debuffs seeded — actor is clean.

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({ durationTurns: 1 });

        expect(() => executeIntent(intent, ctx)).not.toThrow();
        // affected = 0, so credit called with 0.
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 0);
    });
});

// PR11 (epic PR11): reduce-duration mode with count:'all' — Heliodor/Pestilence's "reduces the
// duration of all active Debuffs … by 1 turn". The defining behavioral difference from Task 4's
// count:1 (newest-only) tests above is proven directly: with TWO debuffs present, count:1 only
// ever touches the newest (Debuff-1, proven above), while count:'all' touches BOTH.
describe("PR11: reactive cleanse executor — reduce-duration mode, count:'all'", () => {
    it("I. count:'all': BOTH debuffs lose 1 turn (not just the newest); credits cleanseCount:2", () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-0', 3), 'attacker', TARGET_ID);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-1', 5), 'attacker', TARGET_ID);

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({ durationTurns: 1, count: 'all' });
        executeIntent(intent, ctx);

        // Both debuffs affected — distinct from the count:1 case (Task 4 test 'F'), which
        // credits 1 and leaves Debuff-0 untouched.
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 2);
        const statuses = se.timedAbilityStatuses('enemy', OWNER_ID, TARGET_ID);
        const byName = new Map(statuses.map((s) => [s.active.buffName, s.active.turnsRemaining]));
        expect(byName.get('Debuff-1')).toBe(4);
        expect(byName.get('Debuff-0')).toBe(2); // count:1 would have left this at 3
    });

    it("J. count:'all' removes every debuff whose reduced duration is <= 0", () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-Short', 1), 'attacker', TARGET_ID);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-Long', 3), 'attacker', TARGET_ID);

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({ durationTurns: 1, count: 'all' });
        executeIntent(intent, ctx);

        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 2);
        const statuses = se.timedAbilityStatuses('enemy', OWNER_ID, TARGET_ID);
        expect(statuses.find((s) => s.active.buffName === 'Debuff-Short')).toBeUndefined();
        expect(
            statuses.find((s) => s.active.buffName === 'Debuff-Long')?.active.turnsRemaining
        ).toBe(2);
    });

    it("K. count:'all' on-debuff-inflicted trigger (Pestilence shape): the executor is trigger-agnostic — same reduction fires", () => {
        // The reduce-duration branch does not inspect the intent's trigger at all (any live
        // trigger reaches executeIntent identically) — this proves Pestilence's
        // on-debuff-inflicted shape drives the SAME count:'all' behavior as Heliodor's
        // on-attacked shape above, just via a different ability.trigger value.
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-0', 3), 'attacker', TARGET_ID);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-1', 5), 'attacker', TARGET_ID);

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({
            durationTurns: 1,
            count: 'all',
            trigger: 'on-debuff-inflicted',
            target: 'all-allies',
        });
        executeIntent(intent, ctx);

        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 2);
    });

    it("L. count:'all' with no eligible debuffs: affected 0, no throw", () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({ durationTurns: 1, count: 'all' });

        expect(() => executeIntent(intent, ctx)).not.toThrow();
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 0);
    });

    it('M. count:1 (Warpstrike, unchanged) still reduces only the newest — byte-identical guard against PR11 regressing the pre-existing shape', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-0', 3), 'attacker', TARGET_ID);
        se.applyTimedAbilityStatus(1, mkTimed('Debuff-1', 5), 'attacker', TARGET_ID);

        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeReduceDurationIntent({ durationTurns: 1, count: 1 });
        executeIntent(intent, ctx);

        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 1);
        const statuses = se.timedAbilityStatuses('enemy', OWNER_ID, TARGET_ID);
        const byName = new Map(statuses.map((s) => [s.active.buffName, s.active.turnsRemaining]));
        expect(byName.get('Debuff-1')).toBe(4);
        expect(byName.get('Debuff-0')).toBe(3);
    });
});

describe('Task 3: reactive cleanse executor — procChance + crit-count', () => {
    afterEach(() => resetRateGateRng());

    it('A. remove-mode, no procChance: cleanses cfg.count debuffs (preserved behavior)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        seedDebuffs(se, 3);
        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeCleanseIntent({ count: 2 });
        executeIntent(intent, ctx);
        // Should have removed 2 debuffs and credited that count.
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 2);
    });

    it('B. didCrit=true + critCount=2: cleanses critCount (2), not count (1)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        seedDebuffs(se, 3);
        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeCleanseIntent({ count: 1, critCount: 2, didCrit: true });
        executeIntent(intent, ctx);
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 2);
    });

    it('C. didCrit=false + critCount=2: cleanses count (1), NOT critCount (2)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        seedDebuffs(se, 3);
        const creditSpy = vi.fn();
        const ctx = makeCtx({ statusEngine: se, creditSpy });
        const intent = makeCleanseIntent({ count: 1, critCount: 2, didCrit: false });
        executeIntent(intent, ctx);
        expect(creditSpy).toHaveBeenCalledWith(OWNER_ID, 'cleanseCount', 1);
    });

    it('D. procChance gate does NOT fire: cleanses 0, credit not called', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        seedDebuffs(se, 3);
        const creditSpy = vi.fn();
        // procChance 0.5 gate. Force the RNG to never fire (draw 0.999999 ≥ rate)
        // to exercise the "gate does NOT fire" path deterministically.
        setRateGateRng(() => 0.999999);
        const procChanceGates = new Map<string, ReturnType<typeof makeRateGate>>();
        const intent = makeCleanseIntent({ count: 1, procChance: 0.5 });
        const ctx = makeCtx({ statusEngine: se, creditSpy, procChanceGates });
        executeIntent(intent, ctx);
        // Call 1 with rate 0.5: floor(1*0.5)=0 > floor(0*0.5)=0 → false → gate rejects.
        expect(creditSpy).not.toHaveBeenCalled();
    });

    it('E. ctx.healing undefined: returns early (no throw, no cleanse, gate NOT consumed)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        seedDebuffs(se, 2);
        const creditSpy = vi.fn();
        // Use a shared gate map with a procChance so we can verify gate is not consumed.
        // Force never-fire so that, even after restoring healing, the gate would not fire —
        // the early-return assertion is about the gate NOT being consumed, not about firing.
        setRateGateRng(() => 0.999999);
        const procChanceGates = new Map<string, ReturnType<typeof makeRateGate>>();
        const intent = makeCleanseIntent({ count: 1, procChance: 0.5 });
        const ctx = makeCtx({ statusEngine: se, creditSpy, procChanceGates });
        // Remove the healing ctx to simulate non-healing mode.
        (ctx as unknown as Record<string, unknown>).healing = undefined;

        // Should not throw.
        expect(() => executeIntent(intent, ctx)).not.toThrow();
        // Should not credit anything.
        expect(creditSpy).not.toHaveBeenCalled();
        // Gate should NOT have been touched: re-run WITH healing and expect it fires on call 2
        // (even-call fire), confirming call 1 was never consumed.
        // If the early-return was correct (before gate), gate call 1 is still unused.
        // Restore healing and call again (this is call 1 to the gate — should NOT fire).
        (ctx as unknown as Record<string, unknown>).healing = {
            targetId: TARGET_ID,
            credit: creditSpy,
            recipientMaxHp: () => 10000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => undefined,
            applyHealToTarget: () => ({ reversed: false as const, consumed: 0, overheal: 0 }),
            grantShieldToTarget: () => {},
            playerIds: [OWNER_ID],
            enemyIds: [],
            // Faithful to production (see the note on the main double above).
            recipientActor: (id: string) =>
                id === OWNER_ID ? ({ id: OWNER_ID } as CombatActor) : undefined,
        };
        executeIntent(intent, ctx);
        // This is still call 1 to the gate (early-return did NOT consume it) → should not fire.
        expect(creditSpy).not.toHaveBeenCalled();
    });
});
