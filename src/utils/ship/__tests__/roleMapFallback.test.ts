import { describe, it, expect, vi } from 'vitest';
import { analyzeGearQuality } from '../gearSuggestions';
import { analyzeUpgrades } from '../upgradeAnalysis';
import * as shipTypesModule from '../../../constants/shipTypes';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { SlotContribution } from '../statDistribution';
import type { BaseStats } from '../../../types/stats';
import type { UpgradeReason } from '../../../types/analysis';

// `DESIRED_STATS` (gearSuggestions.ts) and `DESIRED_SETS` (upgradeAnalysis.ts) resolve through
// `resolveRoleEntry`'s exact-match-then-category fallback (constants/shipTypes.ts): an exact
// role entry wins outright, and only a role with none falls back to its category's entry. This
// file walks the two real consumers (not `resolveRoleEntry` directly) for the two cases that
// fallback must get right:
//   - DEBUFFER_BOMBER has no entry of its own and must resolve DEBUFFER's list (its category),
//     not an empty one.
//   - SUPPORTER_BUFFER has its OWN entry and must keep it, even though it also matches the
//     SUPPORTER category by prefix (`matchesRoleCategory`) and would otherwise fall back to
//     SUPPORTER's different list.
// A test that only asserts "does not throw" is vacuous here: `resolveRoleEntry(...) ?? []`
// guarantees that for every role whether or not the fallback resolves correctly. These tests
// instead observe the resolved list's CONTENT, via reasons that only fire when a specific stat
// or set name is (or is not) a member of it.

const baseStats: BaseStats = {
    hp: 1000,
    attack: 200,
    defence: 150,
    hacking: 100,
    security: 80,
    crit: 50,
    critDamage: 150,
    speed: 100,
};

function makeShip(type: ShipTypeName): Ship {
    return {
        id: 'ship-1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'terran',
        type,
        baseStats,
        equipment: { weapon: 'gear-1' },
        implants: {},
        refits: [],
    };
}

function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

// High enough that the boost-set and gear-quality branches never fire on their own, so the
// only thing left to explain a "Low relevant substat count"/"Not optimal set bonus" reason
// appearing or not is the resolved stat/set list itself.
const highContribution: SlotContribution = {
    slotName: 'weapon',
    absoluteScore: 1000,
    relativeScore: 1000,
    primaryStats: [],
};

function getGearPiece(gear: GearPiece): (id: string) => GearPiece | undefined {
    return (id: string) => (id === gear.id ? gear : undefined);
}

const reasonTitles = (reasons: UpgradeReason[] | string) =>
    Array.isArray(reasons) ? reasons.map((r) => r.title) : [];

describe('resolveRoleEntry fallback, through analyzeGearQuality (DESIRED_STATS)', () => {
    it('SUPPORTER_BUFFER keeps its own stat list, not its SUPPORTER category fallback', () => {
        // 'speed' and 'defence' are in SUPPORTER_BUFFER's own DESIRED_STATS entry, but NOT in
        // SUPPORTER's — falling back to the category would score 0 relevant substats here.
        const gear = makeGear({
            subStats: [
                { name: 'speed', value: 10, type: 'flat' },
                { name: 'defence', value: 500, type: 'flat' },
            ],
        });
        const check = analyzeGearQuality(
            gear,
            makeShip('SUPPORTER_BUFFER'),
            baseStats,
            getGearPiece(gear),
            highContribution
        );
        expect(check.reasons.map((r) => r.title)).not.toContain('Low relevant substat count');
    });

    it("DEBUFFER_BOMBER falls back to DEBUFFER's stat list rather than an empty one", () => {
        // 'hacking' and 'attack' are in DEBUFFER's DESIRED_STATS entry. DEBUFFER_BOMBER has no
        // entry of its own, so an empty-fallback bug would score 0 relevant substats here.
        const gear = makeGear({
            subStats: [
                { name: 'hacking', value: 50, type: 'flat' },
                { name: 'attack', value: 300, type: 'flat' },
            ],
        });
        const check = analyzeGearQuality(
            gear,
            makeShip('DEBUFFER_BOMBER'),
            baseStats,
            getGearPiece(gear),
            highContribution
        );
        expect(check.reasons.map((r) => r.title)).not.toContain('Low relevant substat count');
    });

    it('non-vacuity: the same substats score 0 relevant under a role neither list covers', () => {
        // DEFENDER's own list is ['hp', 'defence', 'security'] — 'speed' is in neither
        // DEFENDER's list nor (irrelevant here) any fallback, so the check above is not
        // trivially true for any role/substat combination.
        const gear = makeGear({ subStats: [{ name: 'speed', value: 10, type: 'flat' }] });
        const check = analyzeGearQuality(
            gear,
            makeShip('SUPPORTER_OFFENSIVE'),
            baseStats,
            getGearPiece(gear),
            highContribution
        );
        expect(check.reasons.map((r) => r.title)).toContain('Low relevant substat count');
    });
});

describe('resolveRoleEntry fallback, through analyzeUpgrades (DESIRED_SETS)', () => {
    it('SUPPORTER_BUFFER keeps its own set list, not its SUPPORTER category fallback', () => {
        // BOOST is in SUPPORTER_BUFFER's own DESIRED_SETS entry but not SUPPORTER's — a
        // category fallback would treat the equipped set as irrelevant and flag it.
        const gear = makeGear({ setBonus: 'BOOST' });
        const suggestions = analyzeUpgrades(
            [highContribution],
            { weapon: gear.id },
            getGearPiece(gear),
            makeShip('SUPPORTER_BUFFER'),
            baseStats,
            [makeGear({ id: 'orphan', setBonus: 'FORTITUDE' })]
        );
        const suggestion = suggestions.find((s) => s.slotName === 'weapon');
        expect(reasonTitles(suggestion?.reasons ?? [])).not.toContain('Not optimal set bonus');
    });

    it("DEBUFFER_BOMBER falls back to DEBUFFER's set list rather than an empty one", () => {
        // HACKING is in DEBUFFER's DESIRED_SETS entry. DEBUFFER_BOMBER has no entry of its
        // own, so an empty-fallback bug would treat it as irrelevant and flag it.
        const gear = makeGear({ setBonus: 'HACKING' });
        const suggestions = analyzeUpgrades(
            [highContribution],
            { weapon: gear.id },
            getGearPiece(gear),
            makeShip('DEBUFFER_BOMBER'),
            baseStats,
            [makeGear({ id: 'orphan', setBonus: 'FORTITUDE' })]
        );
        const suggestion = suggestions.find((s) => s.slotName === 'weapon');
        expect(reasonTitles(suggestion?.reasons ?? [])).not.toContain('Not optimal set bonus');
    });
});

describe('non-vacuity: mutating resolveRoleEntry to always return the category fails the pin above', () => {
    it("SUPPORTER_BUFFER regresses to SUPPORTER's stat list under an always-category resolver", () => {
        const spy = vi
            .spyOn(shipTypesModule, 'resolveRoleEntry')
            .mockImplementation(<T>(table: Partial<Record<ShipTypeName, T>>) => table.SUPPORTER);

        try {
            const gear = makeGear({
                subStats: [
                    { name: 'speed', value: 10, type: 'flat' },
                    { name: 'defence', value: 500, type: 'flat' },
                ],
            });
            const check = analyzeGearQuality(
                gear,
                makeShip('SUPPORTER_BUFFER'),
                baseStats,
                getGearPiece(gear),
                highContribution
            );
            // Under the mutation this is 'Low relevant substat count' (neither 'speed' nor
            // 'defence' is in SUPPORTER's own list) — the opposite of the real pin above,
            // proving that pin is not vacuously true.
            expect(check.reasons.map((r) => r.title)).toContain('Low relevant substat count');
        } finally {
            spy.mockRestore();
        }
    });
});
