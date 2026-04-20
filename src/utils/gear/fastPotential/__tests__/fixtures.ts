import type { GearPiece } from '../../../../types/gear';
import type { Ship } from '../../../../types/ship';
import type { GearSetName } from '../../../../constants/gearSets';

/**
 * Shared test fixtures for fastPotential tests. Keep these as TYPE-STRICT
 * builders — every required field on GearPiece / Ship must be present so
 * `npx tsc --noEmit` stays clean.
 */

export function makeMinimalPiece(
    id: string,
    slot: string,
    setBonus: GearSetName | null = null
): GearPiece {
    return {
        id,
        slot: slot,
        setBonus,
        rarity: 'legendary',
        level: 0,
        stars: 6,
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
    } as GearPiece;
}

export function makeShip(overrides: Partial<Ship> = {}): Ship {
    return {
        id: 'ship-1',
        type: 'ATTACKER',
        name: 'TestShip',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        baseStats: {
            hp: 20000,
            attack: 5000,
            defence: 4000,
            speed: 120,
            hacking: 0,
            security: 0,
            crit: 20,
            critDamage: 80,
            healModifier: 0,
            hpRegen: 0,
            shield: 0,
            damageReduction: 0,
            defensePenetration: 0,
        },
        refits: [],
        equipment: {},
        implants: {},
        ...overrides,
    } as Ship;
}
