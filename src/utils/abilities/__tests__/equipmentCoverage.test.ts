/**
 * equipmentCoverage.test.ts
 *
 * Documents CURRENT buildEquipmentAbilities coverage across the full IMPLANTS +
 * GEAR_SETS corpus.  The intent is a living regression guard: when D-PR2 adds new
 * effects, this file is updated deliberately so reviewers can see coverage grow.
 *
 * Assertions are plain `expect` calls — no snapshot files.
 */

import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'coverage-ship',
        name: 'Coverage Ship',
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
    } as GearPiece;
}

/**
 * Build a minimal ship equipping enough pieces of a gear set (≥ its minPieces)
 * and return the ability count produced by buildEquipmentAbilities.
 */
function gearSetAbilityCount(setKey: string): number {
    const setDef = GEAR_SETS[setKey];
    const minPieces = setDef?.minPieces ?? 2;

    // Gear slot names used in the test — just need enough distinct slots.
    const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};

    for (let i = 0; i < minPieces; i++) {
        const id = `${setKey}-piece-${i}`;
        const slot = slots[i % slots.length];
        equipment[slot] = id;
        pieceMap[id] = makePiece({ id, slot, setBonus: setKey });
    }

    const ship = makeShip({ equipment });
    return buildEquipmentAbilities(ship, (id) => pieceMap[id]).length;
}

/**
 * Build a minimal ship equipping one implant piece (at the given rarity) and
 * return the ability count produced by buildEquipmentAbilities.
 */
function implantAbilityCount(implantKey: string, rarity: GearPiece['rarity']): number {
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    const ship = makeShip({ implants: { implant_major: id } });
    return buildEquipmentAbilities(ship, (gearId) => pieceMap[gearId]).length;
}

// ---------------------------------------------------------------------------
// Regression guard: implemented effect names must equal exactly this set.
// Update deliberately when D-PR2 adds more.
// ---------------------------------------------------------------------------

describe('equipmentCoverage — implemented effects registry', () => {
    it('exactly { LEECH (gear set), BLOODTHIRST (implant) } are currently implemented', () => {
        // Gear sets with an ability builder
        const implementedSets = Object.keys(GEAR_SETS).filter(
            (key) => gearSetAbilityCount(key) > 0
        );
        expect(implementedSets).toEqual(['LEECH']);

        // Implants with an ability builder (check each implant with a rarity that exists)
        const implementedImplants = Object.keys(IMPLANTS).filter((key) => {
            const variants = IMPLANTS[key].variants;
            // Try the first available rarity for each implant.
            return variants.some((v) => implantAbilityCount(key, v.rarity) > 0);
        });
        expect(implementedImplants).toEqual(['BLOODTHIRST']);
    });
});

// ---------------------------------------------------------------------------
// Gear-set coverage: one assertion per set
// ---------------------------------------------------------------------------

describe('equipmentCoverage — gear sets', () => {
    it('LEECH produces exactly 1 ability (the standing leech)', () => {
        expect(gearSetAbilityCount('LEECH')).toBe(1);
    });

    const nonLeechSets = Object.keys(GEAR_SETS).filter((k) => k !== 'LEECH');
    for (const setKey of nonLeechSets) {
        it(`${setKey} produces 0 abilities (not yet implemented)`, () => {
            expect(gearSetAbilityCount(setKey)).toBe(0);
        });
    }
});

// ---------------------------------------------------------------------------
// Implant coverage: one assertion per implant
// ---------------------------------------------------------------------------

describe('equipmentCoverage — implants', () => {
    it('BLOODTHIRST (uncommon) produces >= 1 ability (on-crit heal)', () => {
        expect(implantAbilityCount('BLOODTHIRST', 'uncommon')).toBeGreaterThanOrEqual(1);
    });

    it('BLOODTHIRST (epic) produces >= 1 ability (on-crit heal)', () => {
        expect(implantAbilityCount('BLOODTHIRST', 'epic')).toBeGreaterThanOrEqual(1);
    });

    it('BLOODTHIRST (legendary) produces >= 1 ability (on-crit heal)', () => {
        expect(implantAbilityCount('BLOODTHIRST', 'legendary')).toBeGreaterThanOrEqual(1);
    });

    const nonBloodthirstImplants = Object.keys(IMPLANTS).filter((k) => k !== 'BLOODTHIRST');
    for (const implantKey of nonBloodthirstImplants) {
        it(`${implantKey} produces 0 abilities (not yet implemented)`, () => {
            const variants = IMPLANTS[implantKey].variants;
            // Check all available rarities — none should produce abilities yet.
            for (const v of variants) {
                expect(implantAbilityCount(implantKey, v.rarity)).toBe(0);
            }
        });
    }
});
