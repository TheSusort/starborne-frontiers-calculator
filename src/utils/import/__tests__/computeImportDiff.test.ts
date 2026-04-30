// src/utils/import/__tests__/computeImportDiff.test.ts
import { describe, it, expect } from 'vitest';
import { computeImportDiff, hasChanges } from '../computeImportDiff';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { ImportDiff } from '../../../types/importDiff';

// ---------------------------------------------------------------------------
// Minimal builders — only set fields the diff logic reads
// ---------------------------------------------------------------------------

function makeShip(overrides: Partial<Ship> = {}): Ship {
    return {
        id: 'ship-1',
        name: 'Test Ship',
        rarity: 'rare',
        level: 50,
        refits: [],
        rank: 0,
        faction: 'TERRAN_COMBINE',
        type: 'ATTACKER',
        affinity: 'antimatter',
        baseStats: {
            hp: 10000,
            attack: 1000,
            defence: 500,
            hacking: 100,
            security: 100,
            crit: 10,
            critDamage: 50,
            speed: 100,
            healModifier: 0,
            hpRegen: 0,
            shield: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            damageReduction: 0,
        },
        equipment: {},
        implants: {},
        copies: 1,
        equipmentLocked: false,
        ...overrides,
    };
}

function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 5,
        rarity: 'epic',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: 'ATTACK',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Ships — legendary individual tracking
// ---------------------------------------------------------------------------

describe('computeImportDiff — legendary ships', () => {
    it('detects a new legendary ship', () => {
        const newShip = makeShip({ id: 'leg-1', rarity: 'legendary', name: 'Vanguard Prime' });
        const diff = computeImportDiff([], [], [newShip], []);
        expect(diff.ships.legendary.added).toHaveLength(1);
        expect(diff.ships.legendary.added[0].name).toBe('Vanguard Prime');
    });

    it('detects a legendary ship that leveled up', () => {
        const old = makeShip({ id: 'leg-1', rarity: 'legendary', level: 55 });
        const updated = makeShip({ id: 'leg-1', rarity: 'legendary', level: 60 });
        const diff = computeImportDiff([old], [], [updated], []);
        expect(diff.ships.legendary.leveled).toHaveLength(1);
        expect(diff.ships.legendary.leveled[0].oldLevel).toBe(55);
        expect(diff.ships.legendary.leveled[0].ship.level).toBe(60);
    });

    it('detects a legendary ship that gained a refit', () => {
        const old = makeShip({
            id: 'leg-1',
            rarity: 'legendary',
            refits: [{ id: 'r1', stats: [] }],
        });
        const updated = makeShip({
            id: 'leg-1',
            rarity: 'legendary',
            refits: [
                { id: 'r1', stats: [] },
                { id: 'r2', stats: [] },
            ],
        });
        const diff = computeImportDiff([old], [], [updated], []);
        expect(diff.ships.legendary.refitted).toHaveLength(1);
        expect(diff.ships.legendary.refitted[0].oldRefitCount).toBe(1);
    });

    it('shows a legendary ship in BOTH leveled and refitted when both changed', () => {
        const old = makeShip({
            id: 'leg-1',
            rarity: 'legendary',
            level: 52,
            refits: [{ id: 'r1', stats: [] }],
        });
        const updated = makeShip({
            id: 'leg-1',
            rarity: 'legendary',
            level: 60,
            refits: [
                { id: 'r1', stats: [] },
                { id: 'r2', stats: [] },
            ],
        });
        const diff = computeImportDiff([old], [], [updated], []);
        expect(diff.ships.legendary.leveled).toHaveLength(1);
        expect(diff.ships.legendary.refitted).toHaveLength(1);
    });

    it('detects a removed legendary ship', () => {
        const old = makeShip({ id: 'leg-1', rarity: 'legendary', name: 'Phantom Raider' });
        const diff = computeImportDiff([old], [], [], []);
        expect(diff.ships.legendary.removed).toHaveLength(1);
        expect(diff.ships.legendary.removed[0].name).toBe('Phantom Raider');
    });

    it('does not list a legendary ship as added when it already exists', () => {
        const ship = makeShip({ id: 'leg-1', rarity: 'legendary' });
        const diff = computeImportDiff([ship], [], [ship], []);
        expect(diff.ships.legendary.added).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Ships — epic counts + individual leveled/refitted
// ---------------------------------------------------------------------------

describe('computeImportDiff — epic ships', () => {
    it('counts new epic ships in epic.added', () => {
        const newShip = makeShip({ id: 'ep-1', rarity: 'epic' });
        const diff = computeImportDiff([], [], [newShip], []);
        expect(diff.ships.epic.added).toBe(1);
    });

    it('counts removed epic ships in epic.removed', () => {
        const old = makeShip({ id: 'ep-1', rarity: 'epic' });
        const diff = computeImportDiff([old], [], [], []);
        expect(diff.ships.epic.removed).toBe(1);
    });

    it('tracks leveled epic ship individually', () => {
        const old = makeShip({ id: 'ep-1', rarity: 'epic', level: 48 });
        const updated = makeShip({ id: 'ep-1', rarity: 'epic', level: 52 });
        const diff = computeImportDiff([old], [], [updated], []);
        expect(diff.ships.epic.leveled).toHaveLength(1);
        expect(diff.ships.epic.leveled[0].oldLevel).toBe(48);
    });

    it('tracks refitted epic ship individually', () => {
        const old = makeShip({ id: 'ep-1', rarity: 'epic', refits: [] });
        const updated = makeShip({ id: 'ep-1', rarity: 'epic', refits: [{ id: 'r1', stats: [] }] });
        const diff = computeImportDiff([old], [], [updated], []);
        expect(diff.ships.epic.refitted).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Ships — other (rare/uncommon/common) — net delta only
// ---------------------------------------------------------------------------

describe('computeImportDiff — other ships', () => {
    it('computes positive otherDelta for new common ships', () => {
        const ships = [
            makeShip({ id: 'c-1', rarity: 'common' }),
            makeShip({ id: 'c-2', rarity: 'rare' }),
        ];
        const diff = computeImportDiff([], [], ships, []);
        expect(diff.ships.otherDelta).toBe(2);
    });

    it('computes negative otherDelta for removed common ships', () => {
        const old = [makeShip({ id: 'c-1', rarity: 'common' })];
        const diff = computeImportDiff(old, [], [], []);
        expect(diff.ships.otherDelta).toBe(-1);
    });

    it('does not track rare ships in legendary or epic', () => {
        const ship = makeShip({ id: 'r-1', rarity: 'rare' });
        const diff = computeImportDiff([], [], [ship], []);
        expect(diff.ships.legendary.added).toHaveLength(0);
        expect(diff.ships.epic.added).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Gear
// ---------------------------------------------------------------------------

describe('computeImportDiff — gear', () => {
    it('counts new gear pieces', () => {
        const g = makeGear({ id: 'g-1' });
        const diff = computeImportDiff([], [], [], [g]);
        expect(diff.gear.added).toBe(1);
    });

    it('counts removed gear pieces', () => {
        const g = makeGear({ id: 'g-1' });
        const diff = computeImportDiff([], [g], [], []);
        expect(diff.gear.removed).toBe(1);
    });

    it('highlights new legendary 6-star gear', () => {
        const g = makeGear({ id: 'g-1', rarity: 'legendary', stars: 6 });
        const diff = computeImportDiff([], [], [], [g]);
        expect(diff.gear.newLegendary6Star).toHaveLength(1);
        expect(diff.gear.newLegendary6Star[0].id).toBe('g-1');
    });

    it('does not highlight existing legendary 6-star gear', () => {
        const g = makeGear({ id: 'g-1', rarity: 'legendary', stars: 6 });
        const diff = computeImportDiff([], [g], [], [g]);
        expect(diff.gear.newLegendary6Star).toHaveLength(0);
    });

    it('does not count legendary 5-star gear as highlighted', () => {
        const g = makeGear({ id: 'g-1', rarity: 'legendary', stars: 5 });
        const diff = computeImportDiff([], [], [], [g]);
        expect(diff.gear.newLegendary6Star).toHaveLength(0);
    });

    it('excludes implant slots from all gear counts', () => {
        const implant = makeGear({
            id: 'imp-1',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            slot: 'implant_major' as any,
            rarity: 'legendary',
            stars: 6,
        });
        const diff = computeImportDiff([], [], [], [implant]);
        expect(diff.gear.added).toBe(0);
        expect(diff.gear.newLegendary6Star).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// hasChanges helper
// ---------------------------------------------------------------------------

describe('hasChanges', () => {
    const emptyDiff: ImportDiff = {
        ships: {
            legendary: { added: [], leveled: [], refitted: [], removed: [] },
            epic: { leveled: [], refitted: [], added: 0, removed: 0 },
            otherDelta: 0,
        },
        gear: { added: 0, removed: 0, newLegendary6Star: [] },
    };

    it('returns false for an empty diff', () => {
        expect(hasChanges(emptyDiff)).toBe(false);
    });

    it('returns true when a legendary ship was added', () => {
        const diff: ImportDiff = {
            ...emptyDiff,
            ships: {
                ...emptyDiff.ships,
                legendary: { ...emptyDiff.ships.legendary, added: [makeShip()] },
            },
        };
        expect(hasChanges(diff)).toBe(true);
    });

    it('returns true when gear was added', () => {
        const diff: ImportDiff = {
            ...emptyDiff,
            gear: { added: 5, removed: 0, newLegendary6Star: [] },
        };
        expect(hasChanges(diff)).toBe(true);
    });

    it('returns true when otherDelta is non-zero', () => {
        const diff: ImportDiff = { ...emptyDiff, ships: { ...emptyDiff.ships, otherDelta: -2 } };
        expect(hasChanges(diff)).toBe(true);
    });
});
