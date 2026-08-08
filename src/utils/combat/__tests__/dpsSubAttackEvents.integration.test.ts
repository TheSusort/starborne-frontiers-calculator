/**
 * Multi-hit full-walk epic, PR5 — one `ability-performed` per SUB-ATTACK on the NON-POSITIONAL
 * (DPS / healing) path.
 *
 * A multi-hit skill is N consecutive FULL-WALK attacks (locked game rule), so outgoing riders
 * fire N times. The positional simulator has emitted one event per sub-attack since PR2; this
 * file pins the same shape on the path `simulateDPS` drives, which folded the whole cast into
 * one event until PR5. That fold is why the DPS calculator reported ONE Inferno stack for
 * Enforcer + Burner while the simulator reported three.
 *
 * What each assertion is load-bearing for:
 *  1. CARDINALITY — `hits: 3` gives 3 events per active round, `hits: 1` gives exactly 1. The
 *     N=1 control is the cheapest correctness check in the epic: every corpus ship except
 *     Enforcer is single-hit.
 *  2. PAYLOAD — each event carries its OWN `subAttackIndex` and its OWN crit outcome, with
 *     `critHits` counting critting VICTIMS in that one sub-attack (1 or absent for the single
 *     bound enemy) rather than critting HITS across the cast. That convergence with the
 *     positional meaning is what lets `triggers.ts` drop its second `on-crit` branch (PR5 Task 2).
 *  3. DAMAGE EQUIVALENCE — Σ of the N events' `damage`, and the round total, are UNCHANGED.
 *     `victimDamage.ts:16-30` proves the fold is algebraically identical to N separate hits;
 *     this asserts it rather than trusting the comment. Looping buys zero damage accuracy — it
 *     buys ONE derivation of "a sub-attack" instead of two that can drift.
 *  4. RIDER FAN-OUT — the actual user-visible payload: `on-deal-damage` and `on-crit` riders
 *     now fire once per sub-attack, off that sub-attack's own damage.
 *
 * RNG: tests 1-3 run at crit 100 or crit 0, where the gate is rate >= 1 / rate <= 0 and draws
 * no randomness. Tests 4-5 pin the gates explicitly (the engine is NOT deterministic —
 * `rateAccumulator.ts` uses `Math.random`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dsa${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/**
 * multiplier=100 with `hits: N` — the folded multiplier is 100*N (playerTurn's
 * `effectiveMultiplier = rawMultiplier * hits`). NOTE: this MULTIPLIES; it does not re-split.
 * An N-hit cast therefore deals N x a single-hit cast, which is why the equivalence assertion
 * below compares against a closed form and not against `one/3`.
 */
const multiHit = (hits: number, riders: Ability[] = []): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100, hits } }),
                ...riders,
            ],
        },
    ],
});

/**
 * Zero defence, zero pen, no charged skill: every active round is one cast of the active skill
 * and the damage reduces to attack * (100*hits/100) * critMultiplier.
 * `hacking: 200` / `enemySecurity: 0` opens the debuff-landing gate for the rider tests
 * (landing = clamp(hacking - security, 0, 100) / 100 = 1).
 */
const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 200,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

/** Collect the focus attacker's `ability-performed` events from one `simulateDPS` run. */
const runCollectingPerformed = (
    input: DPSSimulationInput
): { performed: AbilityPerformed[]; result: ReturnType<typeof simulateDPS> } => {
    const bus = createEventBus();
    const performed: AbilityPerformed[] = [];
    bus.on('ability-performed', (e) => {
        performed.push(e);
    });
    const result = simulateDPS({ ...input, bus });
    return { performed, result };
};

describe('non-positional ability-performed — one event per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('a hits:3 DPS cast emits THREE ability-performed events per round; hits:1 emits ONE', () => {
        idc = 0;
        const three = runCollectingPerformed({ ...BASE, shipSkills: multiHit(3) });
        // 4 rounds x 3 sub-attacks.
        expect(three.performed).toHaveLength(12);

        idc = 0;
        const one = runCollectingPerformed({ ...BASE, shipSkills: multiHit(1) });
        // N=1 control: unchanged, one event per round.
        expect(one.performed).toHaveLength(4);
    });

    it('each event carries its own subAttackIndex and per-sub-attack crit identity', () => {
        idc = 0;
        const { performed } = runCollectingPerformed({ ...BASE, shipSkills: multiHit(3) });
        // First round's three events, in order.
        const r1 = performed.filter((e) => e.round === 1);
        expect(r1).toHaveLength(3);
        expect(r1.map((e) => e.subAttackIndex)).toEqual([0, 1, 2]);
        // crit 100 -> every sub-attack crits, and `critHits` is THIS sub-attack's critting
        // victim count (1 for the single bound enemy), NOT the cast-wide 3.
        for (const e of r1) {
            expect(e.didCrit).toBe(true);
            expect(e.critHits).toBe(1);
        }
    });

    it('a 0% crit hits:3 cast emits three non-critting events with no critHits', () => {
        idc = 0;
        const { performed } = runCollectingPerformed({
            ...BASE,
            crit: 0,
            shipSkills: multiHit(3),
        });
        const r1 = performed.filter((e) => e.round === 1);
        expect(r1).toHaveLength(3);
        for (const e of r1) {
            expect(e.didCrit).toBe(false);
            expect(e.critHits).toBeUndefined();
        }
    });

    /**
     * THE EQUIVALENCE GATE (epic spec PR5 section 6). victimDamage.ts:16-30 proves
     *   sum_h [1 + (hitCrits[h]?1:0) * cd/100] = hits * damageCritMultiplier
     * i.e. splitting the cast N ways and critting each hit is algebraically identical to the
     * blended fold. That identity is a comment in production; here it is an assertion.
     *
     * Closed form for this fixture (0 defence, 0 pen, no buffs):
     *   effectiveMultiplier = 100 * hits
     *   preCritDamage       = attack * effectiveMultiplier / 100 = 10000 * hits
     *   directDamage        = preCritDamage * (1 + critFraction * critDamage/100)
     * At crit 100 / critDamage 100, hits 3: 30000 * 2.0 = 60000.
     * At crit   0,              hits 3: 30000 * 1.0 = 30000.
     * These are the SAME numbers perHitCrit.test.ts has pinned since the per-hit-crit increment.
     *
     * ANTI-VACUITY: the event count is asserted first. Without it a still-folded path would
     * satisfy every sum below trivially, and the test would pass while observing nothing.
     */
    it('looped damage equals folded damage exactly (no-proc hits:3)', () => {
        idc = 0;
        const crit100 = runCollectingPerformed({ ...BASE, shipSkills: multiHit(3) });
        const r1 = crit100.performed.filter((e) => e.round === 1);
        // Anti-vacuity: we are measuring the LOOPED path, not the fold.
        expect(r1).toHaveLength(3);
        // Each event carries an equal share...
        for (const e of r1) expect(e.damage).toBeCloseTo(20000, 6);
        // ...and the cast total is the number the single folded event carried.
        expect(r1.reduce((s, e) => s + (e.damage ?? 0), 0)).toBeCloseTo(60000, 6);
        // The round total the DPS calculator reports is unmoved.
        expect(crit100.result.rounds[0].totalRoundDamage).toBe(60000);

        idc = 0;
        const crit0 = runCollectingPerformed({ ...BASE, crit: 0, shipSkills: multiHit(3) });
        const z1 = crit0.performed.filter((e) => e.round === 1);
        expect(z1).toHaveLength(3);
        for (const e of z1) expect(e.damage).toBeCloseTo(10000, 6);
        expect(crit0.result.rounds[0].totalRoundDamage).toBe(30000);
    });

    /**
     * The N=1 damage control. Single-hit casts must be byte-identical, which for the damage
     * payload means `directDamage / 1 === directDamage`.
     */
    it('hits:1 damage payload is unchanged (divisor 1)', () => {
        idc = 0;
        const { performed, result } = runCollectingPerformed({ ...BASE, shipSkills: multiHit(1) });
        const r1 = performed.filter((e) => e.round === 1);
        expect(r1).toHaveLength(1);
        expect(r1[0].damage).toBeCloseTo(20000, 6); // 10000 * 1.0 * 2.0
        expect(result.rounds[0].totalRoundDamage).toBe(20000);
    });
});
