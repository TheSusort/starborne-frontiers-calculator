import { describe, it, expect } from 'vitest';
import { buildShipAbilitiesWithEquipment } from '../buildShipAbilitiesWithEquipment';
import { buildShipAbilities } from '../buildShipAbilities';
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
// Ship fixture with NO equipment (baseline)
// ---------------------------------------------------------------------------
const bareShip = makeShip({});

// ---------------------------------------------------------------------------
// Case 1: Ship with Leech set + Bloodthirst implant
// ---------------------------------------------------------------------------
describe('buildShipAbilitiesWithEquipment — equipment-bearing ship', () => {
    const leechA = makePiece({ id: 'leech-1', setBonus: 'LEECH' });
    const leechB = makePiece({ id: 'leech-2', slot: 'hull', setBonus: 'LEECH' });
    const bloodthirst = makePiece({
        id: 'bt-implant',
        slot: 'implant_major',
        rarity: 'legendary',
        setBonus: 'BLOODTHIRST',
    });

    const ship = makeShip({
        equipment: { weapon: 'leech-1', hull: 'leech-2' },
        implants: { implant_major: 'bt-implant' },
    });

    const getGearPiece = makeGetGearPiece({
        'leech-1': leechA,
        'leech-2': leechB,
        'bt-implant': bloodthirst,
    });

    it('passive slot contains the ship own passive abilities PLUS the two equipment abilities', () => {
        const result = buildShipAbilitiesWithEquipment(ship, getGearPiece);

        const passive = result.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();

        // Two equipment abilities: Leech set + Bloodthirst implant
        const equipIds = passive!.abilities
            .filter((a) => a.id.startsWith('equip-'))
            .map((a) => a.id);
        expect(equipIds).toContain('equip-set-LEECH');
        expect(equipIds).toContain('equip-implant-BLOODTHIRST');
    });

    it('equipment abilities are appended after ship own passive abilities', () => {
        const basePassive = buildShipAbilities(ship).slots.find((s) => s.slot === 'passive');
        const baseCount = basePassive?.abilities.length ?? 0;

        const result = buildShipAbilitiesWithEquipment(ship, getGearPiece);
        const passive = result.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        // Two equip abilities appended
        expect(passive!.abilities.length).toBe(baseCount + 2);
    });
});

// ---------------------------------------------------------------------------
// Case 2: Ship with empty equipment — output deep-equals buildShipAbilities
// ---------------------------------------------------------------------------
describe('buildShipAbilitiesWithEquipment — empty equipment', () => {
    it('returns output deep-equal to buildShipAbilities when no equipment resolves', () => {
        const getGearPiece = makeGetGearPiece({});
        const base = buildShipAbilities(bareShip);
        const result = buildShipAbilitiesWithEquipment(bareShip, getGearPiece);
        expect(result).toEqual(base);
    });
});

// ---------------------------------------------------------------------------
// Case 3: else-branch — ship whose base ShipSkills has NO passive slot, but
// has Leech-set equipment → wrapper must CREATE a new passive slot.
//
// Construction: a ship with only `activeSkillText` (no firstPassiveSkillText /
// secondPassiveSkillText / thirdPassiveSkillText) has no passive-row in
// getShipSkillRows, so buildShipAbilities never pushes to the passive bucket
// and returns a ShipSkills with no passive Skill entry. We assert that
// invariant in the test before exercising the wrapper.
// ---------------------------------------------------------------------------
describe('buildShipAbilitiesWithEquipment — else-branch (no base passive slot)', () => {
    // Ship with an active skill only; all passive text fields are absent.
    const activeOnlyShip = makeShip({
        activeSkillText: 'Fires a basic attack at an enemy.',
        // no firstPassiveSkillText / secondPassiveSkillText / thirdPassiveSkillText
    });

    const leechA = makePiece({ id: 'leech-no-passive-1', setBonus: 'LEECH' });
    const leechB = makePiece({ id: 'leech-no-passive-2', slot: 'hull', setBonus: 'LEECH' });

    const shipWithLeech = makeShip({
        activeSkillText: 'Fires a basic attack at an enemy.',
        equipment: { weapon: 'leech-no-passive-1', hull: 'leech-no-passive-2' },
    });

    const getGearPiece = makeGetGearPiece({
        'leech-no-passive-1': leechA,
        'leech-no-passive-2': leechB,
    });

    it('base buildShipAbilities output has NO passive slot (precondition)', () => {
        const base = buildShipAbilities(activeOnlyShip);
        const passive = base.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeUndefined();
    });

    it('wrapper creates a new passive slot containing the Leech set ability', () => {
        const result = buildShipAbilitiesWithEquipment(shipWithLeech, getGearPiece);
        const passive = result.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        expect(passive!.abilities.map((a) => a.id)).toContain('equip-set-LEECH');
    });

    it('the new passive slot contains ONLY the equipment abilities (no ship-own abilities)', () => {
        const result = buildShipAbilitiesWithEquipment(shipWithLeech, getGearPiece);
        const passive = result.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        expect(passive!.abilities).toHaveLength(1);
        expect(passive!.abilities[0].id).toBe('equip-set-LEECH');
    });
});
