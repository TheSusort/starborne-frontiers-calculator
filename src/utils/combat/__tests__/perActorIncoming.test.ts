/**
 * PR5a correctness lock: per-actor incoming bucket == heal-target scalar (byte-identical).
 *
 * For each round, the per-actor bucket `row.perActorIncoming.get(healTarget.id)` must equal
 * the existing scalar fields `row.incomingDamage`, `row.shieldAbsorbed`, `row.barrierAbsorbed`.
 *
 * Three scenarios exercise each channel in isolation:
 *   1. Normal hit (incoming > 0, shield = 0, barrier = 0)
 *   2. Shield-pool hit (shieldAbsorbed > 0 — target carries a shield, no Barrier)
 *   3. Barrier-protected round (barrierAbsorbed > 0 — target carries an always-active Barrier)
 *
 * IMPORTANT: All enemies are MANUAL (no `position` field).  Setting `position` activates the
 * positional AoE path where the tank's scalar bucket is intentionally inflated (it absorbs the
 * total AoE intake, not just the anchor share), which would break the scalar == bucket equality.
 * Manual enemies produce a 1-to-1 hit on the heal target and stay in the single-target path.
 *
 * Additionally asserts that no bucket entry is created for the dummy enemy id 'enemy'
 * (player→dummy intake must NOT be recorded as incoming damage).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pai${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** Manual flat enemy — NO `position` field (avoids the positional AoE path). */
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

/** Always-active Barrier self-buff (blocks all incoming damage for its duration). */
const barrierBuff = () => ({
    id: 'barrier',
    buffName: 'Barrier',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

/** Self-shield ability: grants a shield pool equal to `pct`% of the target's max HP. */
const shieldSelf = (pct = 25) =>
    ab({
        type: 'shield',
        target: 'self',
        config: { type: 'shield', pct, basis: 'hp' },
    });

const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
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
    hp: 10_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const result = runCombat({ ...input, bus });
    return result;
};

describe('PR5a — per-actor incoming bucket == heal-target scalar (byte-identical foundation)', () => {
    // ── Channel 1: normal hit (incoming > 0, shieldAbsorbed = 0, barrierAbsorbed = 0) ──
    it('incoming channel: bucket.incoming === row.incomingDamage for every round (non-vacuous)', () => {
        const targetId = 'attacker';
        const result = run(
            healBase({
                numRounds: 3,
                hp: 10_000,
                healTargetId: targetId,
                mode: 'healing',
                enemyAttackers: [manualEnemy('atk1', 2500)],
            })
        );

        const rounds = result.healing!.rounds;

        // NON-VACUOUS: at least one round has non-zero incomingDamage AND a bucket entry.
        const nonZeroRounds = rounds.filter((rd) => rd.incomingDamage > 0);
        expect(nonZeroRounds.length).toBeGreaterThan(0);
        expect(nonZeroRounds.every((rd) => rd.perActorIncoming.has(targetId))).toBe(true);

        // INVARIANT: bucket == scalar for every round (both channels).
        for (const rd of rounds) {
            const bucket = rd.perActorIncoming.get(targetId);
            expect(bucket?.incoming ?? 0).toBe(rd.incomingDamage);
            expect(bucket?.shieldAbsorbed ?? 0).toBe(rd.shieldAbsorbed);
            expect(bucket?.barrierAbsorbed ?? 0).toBe(rd.barrierAbsorbed);
        }

        // ISOLATION: no bucket entry for the dummy enemy (player→dummy is outgoing, not incoming).
        for (const rd of rounds) {
            expect(rd.perActorIncoming.has('enemy')).toBe(false);
        }
    });

    // ── Channel 2: shield-pool hit (shieldAbsorbed > 0, no Barrier) ──
    // The attacker has a self-shield ability (25% of 10000 hp = 2500 pool).
    // Enemy hits 2000 per round — absorbed by the shield in early rounds before it depletes.
    it('shieldAbsorbed channel: bucket.shieldAbsorbed === row.shieldAbsorbed for every round (non-vacuous)', () => {
        const targetId = 'attacker';
        const result = run(
            healBase({
                numRounds: 3,
                hp: 10_000,
                healTargetId: targetId,
                mode: 'healing',
                // Shield self ability — grants 2500 pool on round 1 (25% of 10000)
                shipSkills: { slots: [{ slot: 'active', abilities: [shieldSelf(25)] }] },
                enemyAttackers: [manualEnemy('shieldAtk', 2000)],
            })
        );

        const rounds = result.healing!.rounds;

        // NON-VACUOUS: at least one round has non-zero shieldAbsorbed AND a bucket entry.
        const shieldRounds = rounds.filter((rd) => rd.shieldAbsorbed > 0);
        expect(shieldRounds.length).toBeGreaterThan(0);
        expect(shieldRounds.every((rd) => rd.perActorIncoming.has(targetId))).toBe(true);

        // INVARIANT: bucket == scalar for every round (all three channels).
        for (const rd of rounds) {
            const bucket = rd.perActorIncoming.get(targetId);
            expect(bucket?.incoming ?? 0).toBe(rd.incomingDamage);
            expect(bucket?.shieldAbsorbed ?? 0).toBe(rd.shieldAbsorbed);
            expect(bucket?.barrierAbsorbed ?? 0).toBe(rd.barrierAbsorbed);
        }

        // ISOLATION: no bucket entry for the dummy enemy.
        for (const rd of rounds) {
            expect(rd.perActorIncoming.has('enemy')).toBe(false);
        }
    });

    // ── Channel 3: Barrier-protected round (barrierAbsorbed > 0) ──
    // Heal target carries an always-active Barrier self-buff (full damage immunity).
    // Enemy hits 3000 per round — all blocked by Barrier → barrierAbsorbed 3000, shieldAbsorbed 0.
    it('barrierAbsorbed channel: bucket.barrierAbsorbed === row.barrierAbsorbed for every round (non-vacuous)', () => {
        const targetId = 'attacker';
        const result = run(
            healBase({
                numRounds: 3,
                hp: 10_000,
                healTargetId: targetId,
                mode: 'healing',
                selfBuffs: [barrierBuff()],
                enemyAttackers: [manualEnemy('barrierAtk', 3000)],
            })
        );

        const rounds = result.healing!.rounds;

        // NON-VACUOUS: at least one round has non-zero barrierAbsorbed AND a bucket entry.
        const barrierRounds = rounds.filter((rd) => rd.barrierAbsorbed > 0);
        expect(barrierRounds.length).toBeGreaterThan(0);
        expect(barrierRounds.every((rd) => rd.perActorIncoming.has(targetId))).toBe(true);

        // INVARIANT: bucket == scalar for every round (all three channels).
        for (const rd of rounds) {
            const bucket = rd.perActorIncoming.get(targetId);
            expect(bucket?.incoming ?? 0).toBe(rd.incomingDamage);
            expect(bucket?.shieldAbsorbed ?? 0).toBe(rd.shieldAbsorbed);
            expect(bucket?.barrierAbsorbed ?? 0).toBe(rd.barrierAbsorbed);
        }

        // ISOLATION: no bucket entry for the dummy enemy.
        for (const rd of rounds) {
            expect(rd.perActorIncoming.has('enemy')).toBe(false);
        }
    });
});
