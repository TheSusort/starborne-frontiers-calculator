/**
 * shieldBasisDpsParity.test.ts — PR9(a), locks the real DPS-calculator path (`simulateDPS`,
 * the entry point the DPS page actually uses — NOT a direct `runCombat` call with
 * `healTargetId` set, which is a different test idiom used by engine-level integration tests).
 *
 * `simulateDPS` never sets `healTargetId` (grep dpsSimulator.ts — the field is absent), so a
 * solo DPS run never activates the healing-gated self-shield-grant block. Consequently a
 * ship's OWN on-cast "gains a Shield equal to X%" ability never accrues in the DPS number —
 * only an UNCONDITIONAL "at the start of combat" pre-combat shield seed (seedPreCombatShields,
 * epic PR4 — FrontLine/Crucialis-shape) counts, since that seeding runs regardless of
 * healing mode. This file locks BOTH halves of that behavior for the new
 * `additional-damage(stat:'shield')` mechanic:
 *   1. A ship with NO pre-combat shield grant: shieldPool stays 0 all game → the shield-basis
 *      additional-damage contributes ZERO every round (Malvex/Quixilver's real DPS shape).
 *   2. A ship WITH a pre-combat shield grant (FrontLine's real shape): the pool is seeded ONCE
 *      before round 1 and then constant (per-cast self-grants stay inert in DPS mode) — the
 *      shield-basis additional-damage contributes the SAME nonzero amount every round.
 */
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sbdp${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const damageAbility = (multiplier: number): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

const shieldBasisAdditionalDamage = (pct: number): Ability =>
    ab({
        type: 'additional-damage',
        target: 'enemy',
        config: { type: 'additional-damage', stat: 'shield', pct },
    });

// Same "clean math" baseline as the engine-level integration test — crit 0, enemyDefense 0,
// so directDamage == effectiveAttack*(mult/100) + secondaryStatValue exactly.
const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    hp: 100_000, // own max HP — the pre-combat shield's basis
    defence: 0,
};

describe('PR9a DPS-parity: shield-basis additional-damage in the real simulateDPS path', () => {
    it("Malvex/Quixilver shape (NO pre-combat shield grant): additional-damage stays ZERO every round — DPS mode's self-shield-grant block is inert (no healTargetId)", () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [shieldBasisAdditionalDamage(20), damageAbility(100)],
                },
            ],
        };
        const result = simulateDPS({ ...BASE, shipSkills });
        expect(result.rounds.map((r) => r.directDamage)).toEqual([10000, 10000, 10000]);
    });

    it('FrontLine shape (an UNCONDITIONAL "start of combat" pre-combat shield grant): additional-damage is a CONSTANT nonzero amount every round, seeded once before round 1', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [shieldBasisAdditionalDamage(20), damageAbility(100)],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'shield',
                            target: 'self',
                            trigger: 'pre-combat',
                            config: { type: 'shield', pct: 25, basis: 'hp' },
                        }),
                    ],
                },
            ],
        };
        const result = simulateDPS({ ...BASE, shipSkills });
        // Pre-combat seed: 25% of 100,000 max HP = 25,000, seeded ONCE before round 1 — then
        // constant (round-to-round self-grants from the healing-gated block never fire here,
        // since simulateDPS never sets healTargetId). Additional-damage = 20% of 25,000 = 5,000
        // every round → 10,000 base + 5,000 = 15,000, all 3 rounds identical.
        expect(result.rounds.map((r) => r.directDamage)).toEqual([15000, 15000, 15000]);
    });
});

// PR9(b): the standalone shield-strip ability targets the DPS-mode dummy enemy's shieldPool,
// which starts at (and, absent any enemy-side kit, stays at) 0. Stripping a % of 0 is a no-op
// (`stripShieldPct`'s `Math.max(0, 0 * ...)`), so the ability must not crash the DPS run and
// must not perturb the reported damage numbers — the strip has no damage-number side effect
// either way (it only ever mutates a shieldPool, a field the DPS-summary damage totals never
// read). Locks that this new ability type is safe/inert in the real DPS-calculator path.
describe('PR9b DPS-parity: standalone shield-strip is inert (no crash, no damage-number change) in simulateDPS', () => {
    const shieldStripAbility: Ability = ab({
        type: 'shield-strip',
        config: { type: 'shield-strip', pct: 30 },
    });

    it('reported round damage is IDENTICAL with and without the shield-strip ability present', () => {
        const withoutStrip: ShipSkills = {
            slots: [{ slot: 'active', abilities: [damageAbility(100)] }],
        };
        const withStrip: ShipSkills = {
            slots: [{ slot: 'active', abilities: [shieldStripAbility, damageAbility(100)] }],
        };
        const a = simulateDPS({ ...BASE, shipSkills: withoutStrip });
        const b = simulateDPS({ ...BASE, shipSkills: withStrip });
        expect(b.rounds.map((r) => r.directDamage)).toEqual(a.rounds.map((r) => r.directDamage));
    });
});
