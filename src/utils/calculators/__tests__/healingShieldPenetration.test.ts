// ─────────────────────────────────────────────────────────────────────────────
// HEALING-CALC SHIELD-PENETRATION SPLIT — locking scenario (Shield System H1, Task 7).
//
// The engine-level pen split is proven in combat/__tests__/shieldAbsorption.test.ts.
// This file proves the HEALING-CALC ADAPTER path (healingEngineAdapter.simulateHealing)
// threads an enemy attacker's `shieldPenetration` end-to-end and that the healing surface
// (shield bucket / shieldAbsorbed / target HP) reflects the direct-hit pen split:
//
//   direct hit D, pen p%  →  shieldEligible = D × (1 − p/100)
//                            absorbed       = min(pool, eligible)
//                            hpDamage       = D − absorbed
//
// This is a STANDALONE numeric/behavioural test (no snapshot) so it is fully additive —
// it does not couple to the healingGoldenParity goldens (which stay byte-identical: their
// enemy fixtures never set shieldPenetration, so pen defaults 0 and shields absorb in full).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `p${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const HEALER: HealerStats = {
    hp: 100000,
    attack: 5000,
    defence: 0, // enemy reduction term 0 → enemy hit = its attack exactly (clean integers)
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 100, // > enemy speed 50 → focus acts first: shield is STANDING before the hit lands
};

// A charged self-shield that grants 30% of max HP (= 30000) BEFORE the enemy hit each charged
// round. chargeCount 1 + startCharged true → the charged slot fires on round 1, so a 30000 pool
// is standing when the round-1 enemy hit lands (proven by golden scenario 13's cadence).
const SHIELDED_TANK_SKILLS: ShipSkills = {
    slots: [
        {
            slot: 'charged',
            abilities: [
                ab({
                    type: 'shield',
                    target: 'self',
                    config: { type: 'shield', pct: 30, basis: 'hp' },
                }),
            ],
        },
    ],
};

// A bare (no-kit) enemy attacker: one basic hit/round. attack 4000, defence 0 on the tank →
// hit = 4000 exactly. crit 0 → deterministic, no crit fold.
const bareEnemy = (shieldPenetration: number) => ({
    id: 'e1',
    stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50, shieldPenetration },
    chargeCount: 0,
    startCharged: false,
});

const input = (shieldPenetration: number): HealingSimulationInput => {
    idCounter = 0;
    return {
        healer: HEALER,
        chargeCount: 1,
        startCharged: true,
        shipSkills: SHIELDED_TANK_SKILLS,
        selfBuffs: [],
        healTargetId: 'healer',
        enemies: [bareEnemy(shieldPenetration)],
        rounds: 1,
    };
};

describe('healing-calc shield penetration split (adapter path)', () => {
    // Control: pen 0 → the standing 30000 shield is fully eligible, so the 4000 hit is fully
    // absorbed (eligible 4000 ≤ pool 30000). No HP damage; shieldAbsorbed = the full hit.
    it('pen 0: shield fully absorbs the direct hit (no HP loss)', () => {
        const result = simulateHealing(input(0));
        const r1 = result.rounds[0];

        expect(r1.shield).toBe(30000); // the charged grant
        expect(r1.shieldAbsorbed).toBe(4000); // full hit absorbed
        expect(r1.incomingDamage).toBe(4000);
        // Target enters round 1 at full HP (targetHpPct is the ENTERING %). No HP damage round 1
        // → it is still at full HP at the destroyedRound check / never destroyed.
        expect(result.summary.destroyedRound).toBeUndefined();
    });

    // Pen 25: the direct hit's shield-eligible portion is 4000 × (1 − 25/100) = 3000. The standing
    // 30000 pool absorbs that 3000; the remaining 1000 (the 25% penetration bypass) reaches HP.
    // This is the headline: shieldAbsorbed (3000) is STRICTLY LESS than the full hit (4000), and
    // the 1000 bypass lands on HP — proving the adapter threaded the enemy's pen into the engine
    // and the healing surface reflects the split.
    it('pen 25: 25% of the hit bypasses to HP; shield absorbs only the 75% eligible portion', () => {
        const result = simulateHealing(input(25));
        const r1 = result.rounds[0];

        expect(r1.shield).toBe(30000); // the charged grant (unchanged by pen)
        // Eligible = 4000 × 0.75 = 3000 → absorbed 3000 < full hit 4000.
        expect(r1.shieldAbsorbed).toBe(3000);
        expect(r1.shieldAbsorbed).toBeLessThan(r1.incomingDamage);
        expect(r1.incomingDamage).toBe(4000);
    });

    // Direct comparison: pen lowers shieldAbsorbed relative to the no-pen control by exactly the
    // penetrated portion (4000 − 3000 = 1000), and that 1000 is the HP bypass.
    it('pen 25 absorbs 1000 less than pen 0 (the bypass that reaches HP)', () => {
        const control = simulateHealing(input(0)).rounds[0];
        const penetrated = simulateHealing(input(25)).rounds[0];

        expect(control.shieldAbsorbed - penetrated.shieldAbsorbed).toBe(1000);
    });
});
