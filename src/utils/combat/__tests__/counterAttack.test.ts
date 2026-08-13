/**
 * counterAttack.test.ts — G PR1: the LIVE counter executor branch.
 *
 * A ship carrying a `counter` reactive ability (trigger `on-attacked`) hits its attacker back for
 * `owner.attack × multiplier/100`, mitigated by the attacker's defence/affinity. The counter:
 *   - is mitigated/crit-walked through the engine's `applyCounterAttack` (no `attacked` event → no
 *     re-counter — a counter-of-a-counter never fires);
 *   - collapses the per-hit `attacked` events of ONE SUB-ATTACK to a SINGLE counter, while each
 *     sub-attack of a `hits: N` cast counters on its own (the guard key carries the triggering
 *     event's `subAttackIndex` since the multi-hit epic's PR6; before that it was keyed on the
 *     turn alone and a 3-hit cast drew ONE counter);
 *   - obeys the `requirePrimaryTarget` gate (the live emit always sets isPrimaryTarget:true, so the
 *     false-case is asserted at the executor gate level; the true-case is asserted end-to-end).
 *
 * END-TO-END harness: driven through `runCombat` in healing mode (mirrors
 * reactiveExtraAction.test.ts) — the player FOCUS is the heal target ('attacker') and carries the
 * counter reactive in its shipSkills; an `enemyAttackers` actor lands a real basic hit on it each
 * turn. The counter surfaces as the enemy attacker's incoming damage via the round's
 * `perTargetDamage` map (the same channel REFLECT thorns use).
 *
 * GATE-LEVEL harness for the primary-target FALSE case: the executor (`executeIntent`) is driven
 * directly with a hand-built ctx + a spy `applyCounterAttack` (mirrors reactiveDamageTakenShield.test.ts).
 *
 * The counter abilities are constructed INLINE (no parser — that is Task 5).
 */
import { describe, it, expect, vi } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createStatusEngine } from '../statusEngine';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `cnt${++idCounter}`,
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    ...partial,
});

/** ShipSkills with a single passive `counter` reactive (owner counters the enemy that hits it). */
const counterSkills = (
    multiplier: number,
    extra: Partial<import('../../../types/abilities').AbilityConfig> = {}
): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'counter',
                        target: 'self',
                        trigger: 'on-attacked',
                        config: { type: 'counter', multiplier, ...extra } as Extract<
                            import('../../../types/abilities').AbilityConfig,
                            { type: 'counter' }
                        >,
                    }),
                ],
            },
        ],
    };
};

/** A non-counter ShipSkills (no reactive) for the control / non-countering ships. */
const noSkills = (): ShipSkills => ({ slots: [] });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** An enemy attacker that lands a single-hit basic attack (synthesized 100% active) on the focus. */
const basicEnemy = (id: string, attack: number, opts: Partial<EnemyAttacker> = {}): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        ...opts,
    }) as EnemyAttacker;

/** Healing-mode base: the FOCUS ('attacker') is the heal target and carries `skills`; one enemy
 *  attacker hits it each round. owner crit 0 → no crit → deterministic counter magnitude. */
const counterBase = (
    skills: ShipSkills,
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000, // OWNER (counter source) attack
    crit: 0, // no crit → didCrit false → predictable counter
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skills,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 3,
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
    hp: 1_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [basicEnemy('foe', 3_000)],
    ...overrides,
});

/** Cumulative damage credited to `actorId` across the run via the round perTargetDamage maps. */
const totalPerTargetDamage = (result: ReturnType<typeof runCombat>, actorId: string): number => {
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

describe('G PR1 — counter executor branch (end-to-end via runCombat)', () => {
    // (a) MAGNITUDE: owner attack 10000 × 50% vs defence 0 / neutral affinity / no crit = 5000
    // per counter. The enemy attacks once per round → one counter per round.
    it('(a) the attacker takes mitigated counter damage = owner.attack × multiplier/100', () => {
        const result = runCombat(counterBase(counterSkills(50)));

        // The enemy ('foe') took counter damage; a non-countering control credits nothing.
        const withCounter = totalPerTargetDamage(result, 'foe');
        const control = runCombat(counterBase(noSkills()));
        expect(totalPerTargetDamage(control, 'foe')).toBe(0);

        // Per round: exactly one counter of 10000 × 0.50 = 5000. The enemy attacks every round
        // (3 rounds) → 3 counters total. Assert the PER-ROUND magnitude is exactly 5000.
        for (const rd of result.rounds) {
            const dealt = rd.perTargetDamage?.['foe'] ?? 0;
            // Some round(s) the enemy may not have acted (it acts last at speed 50) — but with a
            // living focus it attacks each round. Assert any non-zero round is exactly one counter.
            if (dealt > 0) expect(dealt).toBeCloseTo(5000, 6);
        }
        // And the total is a positive multiple of one counter (≥ one round's worth).
        expect(withCounter).toBeGreaterThanOrEqual(5000 - 1e-6);
        expect(withCounter % 5000).toBeCloseTo(0, 6);
    });

    // (b) ONCE PER SUB-ATTACK: a 3-hit enemy attack is 3 consecutive FULL attacks (R1), and a
    // counter is an INCOMING-triggered reaction, so it draws 3 counters (3 × 5000 = 15000).
    // HISTORY (multi-hit epic, PR6): this case previously asserted exactly ONE counter (5000).
    // That was faithful to the engine of the time — `counterFiredThisTurn` was keyed
    // `ownerId:abilityId` and cleared only at actor turn-start, so all N sub-attacks of one cast
    // shared a single guard slot — but it stopped being correct the moment R1 landed, and a test
    // that keeps asserting the old number turns into a defect the suite defends. The key now
    // carries the triggering event's `subAttackIndex` (triggers.ts, counter branch SCOPE NOTE),
    // so each sub-attack counters on its own while the per-HIT `attacked` events WITHIN one
    // sub-attack still collapse to one.
    it('(b) a multi-hit attack triggers ONE counter PER SUB-ATTACK (3 hits → 3 counters)', () => {
        idCounter = 0;
        // Enemy with a 3-hit active: 3 consecutive full attacks, each drawing its own counter.
        const multiHitEnemy: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'foe-active',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 90, hits: 3 },
                        },
                    ],
                },
            ],
        };
        const result = runCombat(
            counterBase(counterSkills(50), {
                enemyAttackers: [basicEnemy('foe', 3_000, { shipSkills: multiHitEnemy })],
            })
        );
        // Each round the 3-hit attack lands → 3 counters of 5000 = 15000. The single-hit control
        // is case (a) above, which pins 5000 per round off the same fixture — so the pair
        // discriminates a per-SUB-ATTACK guard from a per-TURN collapse (which would score 5000
        // here too). It does NOT discriminate against a DELETED guard: each sub-attack emits one
        // `attacked` event for this victim, so an unguarded executor scores 3 here and 1 in case
        // (a) — the same numbers. That half of the guard is pinned at the executor level instead,
        // by "3 attacked events from the SAME sub-attack collapse to ONE counter" below.
        for (const rd of result.rounds) {
            const dealt = rd.perTargetDamage?.['foe'] ?? 0;
            if (dealt > 0) expect(dealt).toBeCloseTo(15_000, 6);
        }
        expect(totalPerTargetDamage(result, 'foe')).toBeGreaterThan(0);
    });

    // (c-true) PRIMARY-TARGET gate fires on a normal primary hit (the live emit sets
    // isPrimaryTarget:true). The counter still lands.
    it('(c) requirePrimaryTarget:true → the counter DOES fire on a normal primary hit', () => {
        const result = runCombat(counterBase(counterSkills(50, { requirePrimaryTarget: true })));
        expect(totalPerTargetDamage(result, 'foe')).toBeGreaterThan(0);
    });

    // (d) NO RE-COUNTER: the enemy also carries a counter ability. The player's counter hits the
    // enemy WITHOUT emitting an `attacked` event, so the enemy's own counter never fires → the
    // player owner ('attacker') takes ZERO counter-of-counter damage.
    it("(d) the counter hit does not itself trigger the attacked ship's counter (no re-counter)", () => {
        idCounter = 0;
        // Enemy carries BOTH a basic 100% active (to attack the focus) AND a counter passive.
        const enemyWithCounter: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'foe-active',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'foe-counter',
                            type: 'counter',
                            target: 'self',
                            trigger: 'on-attacked',
                            conditions: [],
                            config: { type: 'counter', multiplier: 100 },
                        },
                    ],
                },
            ],
        };
        const result = runCombat(
            counterBase(counterSkills(50), {
                enemyAttackers: [basicEnemy('foe', 3_000, { shipSkills: enemyWithCounter })],
            })
        );
        // The player's counter DID fire (the enemy took counter damage)...
        expect(totalPerTargetDamage(result, 'foe')).toBeGreaterThan(0);
        // ...but the enemy's counter NEVER fired in response — the player owner takes ZERO counter
        // damage (the counter walk emits no `attacked` event → no re-counter).
        expect(totalPerTargetDamage(result, 'attacker')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// (c-false) PRIMARY-TARGET gate at the executor level: with requirePrimaryTarget:true and an
// eventCtx whose isPrimaryTarget !== true, the executor must NOT call applyCounterAttack.
// ---------------------------------------------------------------------------

const OWNER = 'owner';

function makeCounterCtx(spy: IntentExecContext['applyCounterAttack']): IntentExecContext {
    return {
        round: 1,
        runtimes: new Map([[OWNER, { actor: { id: OWNER } } as never]]),
        statusEngine: createStatusEngine({ selfBuffs: [], enemyDebuffs: [] }),
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        applyCounterAttack: spy,
        counterFiredThisTurn: new Set<string>(),
    } as unknown as IntentExecContext;
}

function counterIntent(
    cfg: Extract<import('../../../types/abilities').AbilityConfig, { type: 'counter' }>,
    eventCtx: Intent['eventCtx']
): Intent {
    return {
        ability: {
            id: 'cnt-gate',
            type: 'counter',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: cfg,
        },
        sourceSlot: 'passive',
        ownerId: OWNER,
        eventCtx,
    };
}

describe('G PR1 — counter primary-target gate (executor level)', () => {
    it('requirePrimaryTarget:true + isPrimaryTarget:true → fires', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent(
                { type: 'counter', multiplier: 50, requirePrimaryTarget: true },
                { counterTargetId: 'foe', isPrimaryTarget: true }
            ),
            makeCounterCtx(spy)
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(OWNER, 'foe', 'cnt-gate', 50, 1);
    });

    it('requirePrimaryTarget:true + isPrimaryTarget NOT true → does NOT fire', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent(
                { type: 'counter', multiplier: 50, requirePrimaryTarget: true },
                { counterTargetId: 'foe', isPrimaryTarget: false }
            ),
            makeCounterCtx(spy)
        );
        expect(spy).not.toHaveBeenCalled();
    });

    it('no requirePrimaryTarget → fires regardless of isPrimaryTarget', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent({ type: 'counter', multiplier: 50 }, { counterTargetId: 'foe' }),
            makeCounterCtx(spy)
        );
        expect(spy).toHaveBeenCalledTimes(1);
    });

    // G PR2 — Nyxen shield-hit gate (executor level): requireShieldHit gates on
    // eventCtx.shieldWasHit. The counter fires only when the triggering hit actually drained the
    // owner's shield (> 0 absorbed).
    it('requireShieldHit:true + shieldWasHit:true → fires', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent(
                { type: 'counter', multiplier: 100, requireShieldHit: true },
                { counterTargetId: 'foe', shieldWasHit: true }
            ),
            makeCounterCtx(spy)
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(OWNER, 'foe', 'cnt-gate', 100, 1);
    });

    it('requireShieldHit:true + shieldWasHit false → does NOT fire', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent(
                { type: 'counter', multiplier: 100, requireShieldHit: true },
                { counterTargetId: 'foe', shieldWasHit: false }
            ),
            makeCounterCtx(spy)
        );
        expect(spy).not.toHaveBeenCalled();
    });

    it('requireShieldHit:true + shieldWasHit absent → does NOT fire', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent(
                { type: 'counter', multiplier: 100, requireShieldHit: true },
                { counterTargetId: 'foe' }
            ),
            makeCounterCtx(spy)
        );
        expect(spy).not.toHaveBeenCalled();
    });

    it('once-per-attack: a second intent with the same owner:ability key in the same turn is suppressed', () => {
        const spy = vi.fn();
        const ctx = makeCounterCtx(spy);
        const intent = counterIntent(
            { type: 'counter', multiplier: 50 },
            { counterTargetId: 'foe' }
        );
        executeIntent(intent, ctx);
        executeIntent(intent, ctx); // same turn, same key → guarded
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// G PR2 — Centurion self/adjacent-ally counter (executor level).
//
// Centurion builds TWO counters (self on-attacked + adjacent-ally on-ally-attacked). Neither
// carries requirePrimaryTarget/requireShieldHit. The adjacency gate (requireDamagedAllyAdjacent)
// lives in the LISTENER (registerReactiveListeners), NOT the executor — by the time an intent
// reaches executeIntent, counterTargetId is already routed. So at the executor level both fire
// purely on a routed counterTargetId (no gates). The adjacency positive/negative is asserted at
// the integration level (counterAttack.integration.test.ts).
// ---------------------------------------------------------------------------
describe('G PR2 — Centurion self/adjacent-ally counter (executor level)', () => {
    it('self counter (no primary/shield gate): fires on a routed counterTargetId', () => {
        const spy = vi.fn();
        executeIntent(
            counterIntent({ type: 'counter', multiplier: 50 }, { counterTargetId: 'foe' }),
            makeCounterCtx(spy)
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(OWNER, 'foe', 'cnt-gate', 50, 1);
    });

    it('counter does NOT fire when no attacker is routed (counterTargetId absent)', () => {
        const spy = vi.fn();
        executeIntent(counterIntent({ type: 'counter', multiplier: 50 }, {}), makeCounterCtx(spy));
        expect(spy).not.toHaveBeenCalled();
    });

    it('once-per-SUB-ATTACK: 3 attacked events from the SAME sub-attack collapse to ONE counter', () => {
        // The per-HIT fan-out within one sub-attack still collapses — this is the half of the
        // guard PR6 did NOT change.
        const spy = vi.fn();
        const ctx = makeCounterCtx(spy);
        const intent = counterIntent(
            { type: 'counter', multiplier: 100 },
            { counterTargetId: 'foe', subAttackIndex: 0 }
        );
        executeIntent(intent, ctx);
        executeIntent(intent, ctx);
        executeIntent(intent, ctx);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('3 attacked events from DIFFERENT sub-attacks each draw their own counter', () => {
        // PR6: the half of the guard that DID change. Before the key carried `subAttackIndex`
        // these three collapsed to one, which is what made a 3-hit cast draw a single counter.
        const spy = vi.fn();
        const ctx = makeCounterCtx(spy);
        for (const subAttackIndex of [0, 1, 2]) {
            executeIntent(
                counterIntent(
                    { type: 'counter', multiplier: 100 },
                    { counterTargetId: 'foe', subAttackIndex }
                ),
                ctx
            );
        }
        expect(spy).toHaveBeenCalledTimes(3);
    });

    it('an intent carrying NO subAttackIndex falls back to the old turn-scoped collapse', () => {
        // The `?? 'x'` fallback is unreachable from the engine (`emitAttacked` stamps a defined
        // index on every path) but is pinned here so a future reader knows the hand-built-fixture
        // behaviour is deliberate, not an accident of the key format.
        const spy = vi.fn();
        const ctx = makeCounterCtx(spy);
        const intent = counterIntent(
            { type: 'counter', multiplier: 100 },
            { counterTargetId: 'foe' }
        );
        executeIntent(intent, ctx);
        executeIntent(intent, ctx);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
