import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';

/** Build a minimal Ship for test purposes. */
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

/** Build a minimal GearPiece for test purposes. */
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

/** Factory that returns a getGearPiece function backed by the given id→GearPiece map. */
function makeGetGearPiece(map: Record<string, GearPiece>): (id: string) => GearPiece | undefined {
    return (id) => map[id];
}

// ---------------------------------------------------------------------------
// Case 1: Leech set active (≥2 pieces)
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — Leech set', () => {
    it('emits the Leech ability when ≥2 LEECH pieces are equipped', () => {
        const pieceA = makePiece({ id: 'leech-1', setBonus: 'LEECH' });
        const pieceB = makePiece({ id: 'leech-2', slot: 'hull', setBonus: 'LEECH' });
        const ship = makeShip({
            equipment: { weapon: 'leech-1', hull: 'leech-2' },
        });
        const getGearPiece = makeGetGearPiece({ 'leech-1': pieceA, 'leech-2': pieceB });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities).toHaveLength(1);
        const [ab] = abilities;
        expect(ab.id).toBe('equip-set-LEECH');
        expect(ab.type).toBe('heal');
        expect(ab.target).toBe('self');
        expect(ab.trigger).toBe('on-cast');
        expect(ab.config).toEqual({
            type: 'heal',
            pct: 15,
            basis: 'damage-dealt',
            leechScope: 'all',
            noCrit: true,
        });
    });

    // Case 2: Leech set inactive (1 piece)
    it('emits nothing when only 1 LEECH piece is equipped', () => {
        const pieceA = makePiece({ id: 'leech-1', setBonus: 'LEECH' });
        const ship = makeShip({
            equipment: { weapon: 'leech-1' },
        });
        const getGearPiece = makeGetGearPiece({ 'leech-1': pieceA });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 3: Bloodthirst implant (legendary)
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — Bloodthirst implant', () => {
    it('emits on-crit heal with procChance 0.20 and pct 20 for legendary Bloodthirst', () => {
        const implantPiece = makePiece({
            id: 'bt-implant',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'BLOODTHIRST',
        });
        const ship = makeShip({
            implants: { implant_major: 'bt-implant' },
        });
        const getGearPiece = makeGetGearPiece({ 'bt-implant': implantPiece });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities.length).toBeGreaterThanOrEqual(1);
        const ab = abilities.find((a) => a.trigger === 'on-crit');
        expect(ab).toBeDefined();
        expect(ab!.procChance).toBeCloseTo(0.2);
        expect(ab!.config.type).toBe('heal');
        if (ab!.config.type === 'heal') {
            expect(ab!.config.pct).toBe(20);
        }
    });
});

// ---------------------------------------------------------------------------
// Case 4: Missing piece — no entry in map
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — missing piece', () => {
    it('skips gracefully when an implant id has no entry in the map', () => {
        const ship = makeShip({
            implants: { implant_major: 'nonexistent-id' },
        });
        const getGearPiece = makeGetGearPiece({});

        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 5: Stat-only implant (e.g. STRIKE minor with no description)
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — stat-only implant', () => {
    it('emits nothing for a stat-only implant with no description', () => {
        const implantPiece = makePiece({
            id: 'strike-implant',
            slot: 'implant_minor_sigma',
            rarity: 'legendary',
            setBonus: 'STRIKE',
        });
        const ship = makeShip({
            implants: { implant_minor_sigma: 'strike-implant' },
        });
        const getGearPiece = makeGetGearPiece({ 'strike-implant': implantPiece });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 6: Unknown implant key — not in IMPLANTS registry
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — unknown implant key', () => {
    it('skips gracefully when the implant setBonus key is unknown (not in IMPLANTS)', () => {
        // The piece has a setBonus that doesn't exist in IMPLANTS at all, so it is
        // skipped before any description is read — this is an unknown-key guard, not a
        // parse failure.
        const implantPiece = makePiece({
            id: 'fake-implant',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'FAKE_NONEXISTENT_IMPLANT' as never,
        });
        const ship = makeShip({
            implants: { implant_major: 'fake-implant' },
        });
        const getGearPiece = makeGetGearPiece({ 'fake-implant': implantPiece });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        expect(abilities).toHaveLength(0);
    });
});
