/**
 * counterAttack.test.ts — G PR1: the LIVE counter executor branch.
 *
 * A ship carrying a `counter` reactive ability (trigger `on-attacked`) hits its attacker back for
 * `owner.attack × multiplier/100`, mitigated by the attacker's defence/affinity. The counter:
 *   - is mitigated/crit-walked through the engine's `applyCounterAttack` (no `attacked` event → no
 *     re-counter — a counter-of-a-counter never fires);
 *   - collapses ALL per-hit `attacked` events of ONE attack to a SINGLE counter (per-turn guard);
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

    // (b) ONCE PER ATTACK: a 3-hit enemy attack produces exactly ONE counter (5000), not 3×.
    it('(b) a multi-hit attack triggers exactly ONE counter (once-per-attack guard)', () => {
        idCounter = 0;
        // Enemy with a 3-hit active: each hit emits its own `attacked` event, but the per-turn
        // guard collapses them to a single counter.
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
        // Each round the 3-hit attack lands → exactly ONE counter (5000), never 3 × 5000 = 15000.
        for (const rd of result.rounds) {
            const dealt = rd.perTargetDamage?.['foe'] ?? 0;
            if (dealt > 0) expect(dealt).toBeCloseTo(5000, 6);
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
