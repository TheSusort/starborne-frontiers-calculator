/**
 * Integration: an enemy whose CHARGED slot is pure support must still bank charges.
 *
 * `hasChargedSkill` gates the whole charge cadence (`advanceChargeCadence`, state.ts:401 —
 * no-op when the flag is false). It is derived on THREE actor paths, and the enemy path
 * asks a different question than the other two:
 *
 *   - player focus  → `hasCharged(plan)` (battleSimulator.ts:897) — chargeCount >= 1 AND the
 *                     charged slot has AT LEAST ONE ability, of any type.
 *   - walked 'team' → the same `hasCharged(plan)` (battleSimulator.ts:956).
 *   - enemy         → engine.ts:654 — chargeCount >= 1 AND the charged slot carries a DAMAGE
 *                     ability with `multiplier > 0`.
 *
 * The enemy predicate was carried over verbatim from the pre-kit `EnemyAttackerRuntime`
 * ("mirrors EnemyAttackerRuntime logic exactly", f82d6e19), back when enemies were damage-only
 * actors and "has a charged damage ability" was a fair proxy for "has a charged skill". Enemies
 * later gained full ship kits; the predicate was never revisited. The consequence is that every
 * enemy whose charged skill is pure support — heal, shield, buff, cleanse — never banks a single
 * charge and can never fire it. On today's 147-ship corpus that is 25 ships, essentially the
 * entire healer/support roster (Aegis, Chimei, Faust, Mender, Purifier, Salvation, Shelter, …).
 *
 * Harness notes:
 *   - `chargeCount: 5` with `numRounds: 3` keeps the enemy strictly BELOW its charge threshold
 *     for the whole battle, so the charged skill never fires and never resets the counter. The
 *     banked total is therefore exactly the number of turns taken — an unambiguous read.
 *   - Charges are read off the live actor roster via `__testTapActors` (the same objects the
 *     engine mutates in place), not inferred from the log.
 *   - The focus is a plain damage attacker with `hasChargedSkill: false`; it takes no part in
 *     the enemy's cadence and its own is a deliberate no-op.
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** Rounds the enemy acts for. Strictly below `ENEMY_CHARGE_COUNT` so the charged skill never
 *  fires — the banked count stays monotonic and equals the turns taken. */
const ROUNDS = 3;
/** Charge threshold. Above ROUNDS, so nothing resets the counter mid-battle. */
const ENEMY_CHARGE_COUNT = 5;

// ─── Charged-slot ability fixtures ──────────────────────────────────────────────

/** A pure-support charged payload: heals the caster. No damage ability anywhere in the slot. */
const chargedSelfHeal = (id: string): Ability => ({
    id,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});

/** The control payload: an ordinary charged damage ability (multiplier > 0). */
const chargedStrike = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 20 },
});

// ─── Enemy fixture ──────────────────────────────────────────────────────────────

/**
 * An enemy with an ordinary damage active and a caller-supplied CHARGED slot. Everything except
 * the charged slot's ability type is held constant between the two cases, so a behavioural
 * difference isolates that one variable.
 */
const enemyWithChargedSlot = (id: string, chargedAbility: Ability): EnemyAttacker => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, hp: 1_000_000, speed: 100 },
    chargeCount: ENEMY_CHARGE_COUNT,
    startCharged: false, // bank from zero — the whole point of the measurement
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${id}-active-hit`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 5 },
                    },
                ],
            },
            { slot: 'charged', abilities: [chargedAbility] },
        ],
    } as ShipSkills,
});

// ─── Engine input ───────────────────────────────────────────────────────────────

/** A plain damage focus. `hasChargedSkill: false` — its own cadence is a deliberate no-op, so
 *  the only charge movement in the battle belongs to the enemy under test. */
const buildInput = (enemy: EnemyAttacker): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'focus-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 10 },
                    },
                ],
            },
        ],
    },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: ROUNDS,
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
    speed: 200, // focus acts first; irrelevant to the enemy's own cadence
    healTargetId: 'attacker',
    enemyAttackers: [enemy],
});

const chargesAfterBattle = (enemy: EnemyAttacker): number => {
    let captured: CombatActor[] = [];
    runCombat({ ...buildInput(enemy), __testTapActors: (actors) => (captured = actors) });
    const actor = captured.find((a) => a.id === enemy.id);
    if (!actor) throw new Error(`no actor '${enemy.id}' in tapped roster`);
    return actor.charges;
};

// ─── Cases ──────────────────────────────────────────────────────────────────────

describe('enemy charge cadence is gated on the charged slot carrying DAMAGE', () => {
    it('an enemy with a charged DAMAGE skill banks one charge per turn (control)', () => {
        // Establishes that the harness observes charge banking at all: same board, same rounds,
        // same chargeCount — only the charged slot's ability type differs from the case below.
        const charges = chargesAfterBattle(
            enemyWithChargedSlot('e-striker', chargedStrike('e-striker-charged'))
        );

        expect(charges).toBe(ROUNDS);
    });

    it('an enemy whose charged skill is pure SUPPORT banks charges too', () => {
        // The defect: `hasChargedSkill` is false for this enemy because its charged slot has no
        // damage ability, so `advanceChargeCadence` no-ops every turn and it banks nothing. The
        // identical kit on the player side (focus or walked team) banks ROUNDS charges.
        const charges = chargesAfterBattle(
            enemyWithChargedSlot('e-healer', chargedSelfHeal('e-healer-charged'))
        );

        expect(charges).toBe(ROUNDS);
    });
});
