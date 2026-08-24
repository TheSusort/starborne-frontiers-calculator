/**
 * revengeGearSet.integration.test.ts
 *
 * Integration tests for the REVENGE gear set: a missing-HP-scaled outgoing damage
 * modifier (+0.25 × missingHpPct, capped at +25pp). Routes through the REAL
 * `buildEquipmentAbilities` registry and `modifierTotalsFromAbilities` fold.
 *
 * Spec:
 *  - 2pc gear set (default minPieces) activates the modifier
 *  - condition[0]: { subject: 'self-hp-missing-pct', derivable: true } (bare scaling source)
 *  - ability: modifier / outgoingDamage, value 0, scaling { conditionIndex:0, perUnit:0.25, cap:25 }
 *  - At selfHpPct 40 → missingPct 60 → 0.25 × 60 = 15 (modifier total)
 *  - At selfHpPct 100 → missingPct 0 → 0 (inert in DPS mode)
 *  - At selfHpPct 0 → missingPct 100 → 0.25 × 100 = 25 → capped at 25
 */

import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { modifierTotalsFromAbilities } from '../../abilities/applyAbilities';
import { makeConditionContext } from '../../abilities/__tests__/conditionContextFixture';
import { GEAR_SETS } from '../../../constants/gearSets';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors equipmentCoverage.test.ts pattern)
// ---------------------------------------------------------------------------

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'revenge-ship',
        name: 'Revenge Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    };
}

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}

/** Build abilities for a ship wearing `minPieces` of the REVENGE gear set. */
function buildRevengeAbilities() {
    const setDef = GEAR_SETS['REVENGE'];
    const minPieces = setDef?.minPieces ?? 2;
    const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};

    for (let i = 0; i < minPieces; i++) {
        const id = `REVENGE-piece-${i}`;
        const slot = slots[i % slots.length];
        equipment[slot] = id;
        pieceMap[id] = makePiece({ id, slot, setBonus: 'REVENGE' });
    }

    const ship = makeShip({ equipment });
    return buildEquipmentAbilities(ship, (id) => pieceMap[id]);
}

// ---------------------------------------------------------------------------
// Registry shape assertions
// ---------------------------------------------------------------------------

describe('REVENGE gear set — registry shape', () => {
    it('produces exactly 1 ability with id equip-set-REVENGE', () => {
        const abilities = buildRevengeAbilities();
        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe('equip-set-REVENGE');
    });

    it('is a modifier / outgoingDamage ability', () => {
        const ab = buildRevengeAbilities()[0];
        expect(ab.type).toBe('modifier');
        expect(ab.config.type).toBe('modifier');
        // @ts-expect-error modifier config
        expect(ab.config.channel).toBe('outgoingDamage');
        // @ts-expect-error modifier config
        expect(ab.config.value).toBe(0);
    });

    it('has scaling { conditionIndex:0, perUnit:0.25, cap:25 }', () => {
        const ab = buildRevengeAbilities()[0];
        expect(ab.scaling).toEqual({ conditionIndex: 0, perUnit: 0.25, cap: 25 });
    });

    it('has condition[0] with subject self-hp-missing-pct (bare scaling source)', () => {
        const ab = buildRevengeAbilities()[0];
        expect(ab.conditions).toHaveLength(1);
        expect(ab.conditions[0].subject).toBe('self-hp-missing-pct');
        expect(ab.conditions[0].derivable).toBe(true);
        // Bare scaling source: no countComparator
        expect(ab.conditions[0].countComparator).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Modifier fold assertions (via modifierTotalsFromAbilities)
// ---------------------------------------------------------------------------

describe('REVENGE gear set — modifier fold', () => {
    const abilities = buildRevengeAbilities();

    it('selfHpPct 40 → outgoingDamage total === 15 (0.25 × 60 missing)', () => {
        const ctx = makeConditionContext({ selfHpPct: 40 });
        const totals = modifierTotalsFromAbilities(abilities, ctx);
        expect(totals.outgoingDamage).toBe(15);
    });

    it('selfHpPct 100 → outgoingDamage total === 0 (full HP — inert in DPS mode)', () => {
        const ctx = makeConditionContext({ selfHpPct: 100 });
        const totals = modifierTotalsFromAbilities(abilities, ctx);
        expect(totals.outgoingDamage).toBe(0);
    });

    it('selfHpPct 0 → outgoingDamage total === 25 (capped: 0.25 × 100 = 25)', () => {
        const ctx = makeConditionContext({ selfHpPct: 0 });
        const totals = modifierTotalsFromAbilities(abilities, ctx);
        expect(totals.outgoingDamage).toBe(25);
    });
});
