/**
 * Barrier — full damage immunity (Task 1).
 *
 * "Barrier" = FULL DAMAGE IMMUNITY for the duration of the buff. While a ship carries
 * an active Barrier status, ALL incoming damage to it is blocked — direct attacks, DoT
 * ticks, AND bomb detonations. It is duration-based (expires via the normal timed
 * lifecycle), NOT consumed on first hit. It is strictly "in front of" both the shield
 * pool AND Cheat Death: a lethal-sized hit fully blocked by Barrier does NOT trigger
 * Cheat Death.
 *
 * Harness mirrors the healing-mode runCombat fixtures in hpCrossing.test.ts: a focus
 * attacker that IS the heal target (does no damage), ship-/manual-backed enemy
 * attackers, and the heal target carrying an always-active no-payload self-buff
 * (`buffName:'Barrier'`) — the same shape as the Cheat-Death self-buff there, which
 * `selfBuffNamesForOwners` reports as active for the whole scenario.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `br${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A manual flat enemy: one synthesized basic attack, no skills. */
const manualEnemy = (
    id: string,
    attack: number,
    speed = 50,
    extra: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    ...extra,
});

/** A no-payload, always-active Barrier self-buff (surfaces in the snapshot as recurring,
 *  the same shape the Cheat-Death tests use — active for the whole scenario). */
const barrierBuff = () => ({
    id: 'barrier',
    buffName: 'Barrier',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

/** A no-payload, always-active Cheat Death self-buff. */
const cheatDeathBuff = () => ({
    id: 'cheat-death',
    buffName: 'Cheat Death',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 10_000,
    healTargetId: 'attacker',
    ...overrides,
});

const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
    bus.on('cheat-death-activated', (e) => cheated.push(e));
    const result = runCombat({ ...input, bus });
    return { cheated, result };
};

describe('Barrier — full damage immunity (Task 1)', () => {
    // ── Direct attack while barriered → HP unchanged; barrierAbsorbed == damage; shield untouched ──
    it('blocks a direct attack: HP unchanged, barrierAbsorbed == attack damage, shieldPool untouched', () => {
        const { result } = run(
            healBase({
                numRounds: 1,
                hp: 10_000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // HP fully intact — the attack was fully blocked.
        expect(rounds[0].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
        // The blocked total is tracked separately as barrierAbsorbed (NOT shieldAbsorbed).
        expect(rounds[0].barrierAbsorbed).toBe(3000);
        // Shield pool untouched (no shield ability → 0, and barrier did NOT drain it).
        expect(rounds[0].shieldAbsorbed).toBe(0);
        // Blocked damage still "arrives": it counts toward incomingDamage even though its
        // effect is nullified (mirrors the control test's incomingDamage assertion).
        expect(rounds[0].incomingDamage).toBe(3000);
    });

    // ── DoT batch (Corrosion) while barriered → HP unchanged (DoT fully blocked) ──
    // The corrosion ticks at the tank's turn start in round 2; round 3's targetHpPctStart
    // observes the post-tick HP. With Barrier it is fully blocked → still 100% at round 3.
    // Non-vacuous: round 2's incomingDamage > 0 proves the tick damage actually arrived.
    it('blocks a DoT batch (Corrosion): tick arrives but HP unchanged (round-3 start still 100%)', () => {
        const corrosionDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'corrosion', tier: 7, stacks: 10, duration: 5 },
            });
        const dotEnemy = manualEnemy('dotEnemy', 1000, 50, {
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionDot()] }] },
        });

        const { result } = run(
            healBase({
                numRounds: 3,
                hp: 1000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [dotEnemy],
            })
        );

        const rounds = result.healing!.rounds;
        // The DoT tick damage arrived this run (non-vacuous: it was incoming damage)…
        expect(rounds.some((rd) => rd.incomingDamage > 0)).toBe(true);
        // …but Barrier fully blocked it → HP at the start of round 3 is still 100%.
        expect(rounds[2].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    // ── Bomb detonation while barriered → HP unchanged ──
    // The enemy applies a bomb (countdown 2) AND carries a detonate-dot:bomb so the
    // applied bomb bursts on a later enemy turn — its detonation damage funnels into
    // enemyTurn.detonationDamage → applyIncomingToTarget. Barrier fully blocks it.
    it('blocks a bomb detonation: detonation arrives but HP unchanged (last round still 100%)', () => {
        const bombDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'bomb', tier: 7, stacks: 10, duration: 2 },
            });
        const detonate = () =>
            ab({
                type: 'detonate-dot',
                target: 'enemy',
                config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
            });
        const bombEnemy = manualEnemy('bombEnemy', 1000, 50, {
            shipSkills: { slots: [{ slot: 'active', abilities: [bombDot(), detonate()] }] },
        });

        const { result } = run(
            healBase({
                numRounds: 4,
                hp: 10_000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [bombEnemy],
            })
        );

        const rounds = result.healing!.rounds;
        // Bomb detonation damage arrived (non-vacuous)…
        expect(rounds.some((rd) => rd.incomingDamage > 0)).toBe(true);
        // …but Barrier fully blocked it → HP at the start of the last round is still 100%.
        expect(rounds[rounds.length - 1].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    // ── Otherwise-lethal hit while barriered → HP unchanged AND NO cheat-death-activated ──
    it('a lethal hit blocked by Barrier does NOT trigger Cheat Death (Barrier is in front of it)', () => {
        const { result, cheated } = run(
            healBase({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal sized
                selfBuffs: [barrierBuff(), cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // HP unchanged — Barrier blocked the whole (lethal-sized) hit.
        expect(rounds[0].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
        // Cheat Death was NOT consumed: Barrier is strictly in front of it.
        expect(cheated).toHaveLength(0);
    });

    // ── Control: identical run WITHOUT Barrier → HP drains (proves the guard is load-bearing) ──
    it('control (no Barrier): the same direct attack drains HP normally', () => {
        const { result } = run(
            healBase({
                numRounds: 1,
                hp: 10_000,
                selfBuffs: [], // NO Barrier
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // 3000 of 10000 max HP landed → barrierAbsorbed 0, incoming damage drained HP.
        expect(rounds[0].barrierAbsorbed).toBe(0);
        expect(rounds[0].incomingDamage).toBe(3000);
        expect(rounds[0].shieldAbsorbed).toBe(0);
    });
});
