/**
 * Group E (Task 7): DPS-calculator-level proof that the Decimation gear set raises DoT
 * damage in the DPS calc — not just the battle-sim engine.
 *
 * This test routes through the PUBLIC DPS calculator entry point `simulateDPS`
 * (src/utils/calculators/dpsSimulator.ts), which the DPS page uses. `simulateDPS` calls
 * `runCombat` and walks the SAME `runPlayerTurn` as the battle sim, so the
 * `dotDamage` → `dotMult` fold (effectiveDamageStatsOf.selfDotDamageModifier) applies
 * here too with no extra wiring.
 *
 * The Decimation modifier is NOT hand-rolled: the ship's abilities are built via the REAL
 * registry (`buildShipAbilitiesWithEquipment(ship, getGearPiece)`) with gear pieces whose
 * `setBonus` is 'DECIMATION'. The registry emits a passive `modifier` ability
 * `{channel:'dotDamage', value: floor(pieces/2)*10}`. If someone breaks the DECIMATION
 * registry entry (e.g. zeroes its value) or the dotDamage fold, this test fails — it is the
 * DPS-calc trip-wire for the engine fold.
 *
 * Setup: a DoT-only ship (active = single-hit inferno DoT, NO direct damage) so the +10%
 * shows cleanly in `summary.totalInfernoDamage` (the direct/secondary/conditional channels
 * stay zero and cannot dilute the ratio). The DPS run is executed twice — once with 2
 * DECIMATION pieces, once without (identical otherwise) — and the boosted run's inferno
 * total must be exactly ×1.10 the control (affinity neutral → the ratio cancels everything
 * except the fold factor).
 */
import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { Ability, ShipSkills } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';

// ---------------------------------------------------------------------------
// Harness helpers (mirrored from gearSetDotPair.integration.test.ts)
// ---------------------------------------------------------------------------

/** Minimal Ship stub. Equipment is provided by overrides. */
function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'test-ship',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    } as Ship;
}

/** Minimal GearPiece stub. */
function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    } as GearPiece;
}

/** getGearPiece factory backed by an id→GearPiece map. */
function makeGetGearPiece(map: Record<string, GearPiece>): (id: string) => GearPiece | undefined {
    return (id) => map[id];
}

/**
 * A DoT-only active skill: a single-hit inferno DoT and NO direct damage. The carrier DoT
 * whose ticks Decimation scales. Tier 15, 1 stack, 2 turns.
 */
const activeInferno: Ability = {
    id: 'active-inferno',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
};

// 2 DECIMATION pieces (2pc → 1 set → +10% DoT damage).
const DECIMATION_2PC = [
    makePiece({ id: 'decim-1', slot: 'software', setBonus: 'DECIMATION' }),
    makePiece({ id: 'decim-2', slot: 'thruster', setBonus: 'DECIMATION' }),
];

/**
 * Build ShipSkills from the REAL registry: equip `pieces`, run buildShipAbilitiesWithEquipment,
 * then prepend the carrier inferno DoT in the active slot so the ship applies a real DoT each
 * cast. The registry-built passive slot (carrying the DECIMATION modifier) is carried over verbatim.
 */
function skillsWithRegistry(pieces: GearPiece[]): {
    shipSkills: ShipSkills;
    passiveAbilityIds: string[];
} {
    const equipment: Record<string, string> = {};
    const map: Record<string, GearPiece> = {};
    for (const p of pieces) {
        equipment[p.slot] = p.id;
        map[p.id] = p;
    }
    const ship = makeShip({ equipment: equipment as Ship['equipment'] });
    const built = buildShipAbilitiesWithEquipment(ship, makeGetGearPiece(map));
    const passive = built.slots.find((s) => s.slot === 'passive');
    return {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [activeInferno] },
                ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
            ],
        },
        passiveAbilityIds: passive?.abilities.map((a) => a.id) ?? [],
    };
}

/** Base DPS-calc input: neutral stats, enemy never dies, no crit/affinity variance. */
const DPS_BASE = {
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    rounds: 5,
    selfBuffs: [],
    enemyDebuffs: [],
};

// ---------------------------------------------------------------------------
// Decimation scales DoT in the DPS calculator (real registry + shared engine fold)
// ---------------------------------------------------------------------------

describe('DPS calculator — Decimation scales DoT damage (real registry + shared engine fold)', () => {
    it('2 DECIMATION pieces: DPS-calc inferno total is exactly ×1.10 vs no-Decimation control', () => {
        // Control: no Decimation — carrier inferno only (no passive slot).
        const controlSkills: ShipSkills = {
            slots: [{ slot: 'active', abilities: [activeInferno] }],
        };
        // Boosted: same carrier inferno + 2 Decimation pieces via the REAL registry.
        const boosted = skillsWithRegistry(DECIMATION_2PC);

        // Pre-condition: the DECIMATION modifier landed in the passive slot via the registry.
        expect(boosted.passiveAbilityIds).toContain('equip-set-DECIMATION');

        const controlResult = simulateDPS({ ...DPS_BASE, shipSkills: controlSkills });
        const boostedResult = simulateDPS({ ...DPS_BASE, shipSkills: boosted.shipSkills });

        const controlInferno = controlResult.summary.totalInfernoDamage;
        const boostedInferno = boostedResult.summary.totalInfernoDamage;

        // DoT-only ship: direct/secondary/conditional channels stay zero, so they cannot
        // dilute the inferno ratio.
        expect(controlResult.summary.totalDirectDamage).toBe(0);
        expect(boostedResult.summary.totalDirectDamage).toBe(0);

        expect(controlInferno).toBeGreaterThan(0);
        // Decimation 2pc → +10% dotDamage → dotMult 1.0→1.1 → boosted = control × 1.10 exactly.
        // (affinity neutral so the ratio cancels attack/affinity.) Allow rounding tolerance.
        expect(boostedInferno).toBeCloseTo(controlInferno * 1.1, 3);
    });
});
