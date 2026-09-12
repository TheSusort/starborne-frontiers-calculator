import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratePlayerData } from '../../utils/migratePlayerData';
import { StorageKey, inventoryCacheKey } from '../../constants/storage';
import { getFromIndexedDB, setInIndexedDB } from '../../hooks/useStorage';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { Loadout, TeamLoadout } from '../../types/loadout';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useStorage', () => ({
    getFromIndexedDB: vi.fn(),
    setInIndexedDB: vi.fn().mockResolvedValue(undefined),
}));

const USER_ID = '33333333-3333-4333-8333-333333333333';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pre-UUID local ids, as a player who only ever used the app signed out has
 * them: every id is a hand-made string, so every one of them is remapped.
 */
const gear = (id: string, extra: Partial<GearPiece> = {}): GearPiece => ({
    id,
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 100, type: 'flat' },
    subStats: [],
    setBonus: 'CRITICAL',
    ...extra,
});

const INVENTORY: GearPiece[] = [
    gear('gear-weapon'),
    gear('gear-implant', { slot: 'implant_major' }),
    gear('gear-calibrated', { slot: 'hull', calibration: { shipId: 'ship-local' } }),
];

const SHIPS: Ship[] = [
    {
        id: 'ship-local',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN',
        type: 'ATTACKER',
        baseStats: {
            hp: 1,
            attack: 1,
            defence: 1,
            hacking: 1,
            security: 1,
            crit: 1,
            critDamage: 1,
            speed: 1,
            healModifier: 1,
        },
        equipment: { weapon: 'gear-weapon' },
        implants: { implant_major: 'gear-implant' },
        refits: [],
    },
];

const LOADOUTS: Loadout[] = [
    {
        id: 'loadout-local',
        name: 'Loadout',
        shipId: 'ship-local',
        equipment: { weapon: 'gear-weapon' },
        createdAt: 0,
    },
];

const TEAM_LOADOUTS: TeamLoadout[] = [
    {
        id: 'team-local',
        name: 'Team',
        shipLoadouts: [
            {
                position: 1,
                shipId: 'ship-local',
                equipment: { weapon: 'gear-weapon' },
            },
        ],
        createdAt: 0,
    },
];

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('migratePlayerData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocked(setInIndexedDB).mockResolvedValue(undefined);
        // A signed-out player's gear sits under the unscoped inventory cache key.
        mocked(getFromIndexedDB).mockImplementation((key: string) =>
            Promise.resolve(key === inventoryCacheKey(null) ? INVENTORY : undefined)
        );
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify(SHIPS));
        localStorage.setItem(StorageKey.LOADOUTS, JSON.stringify(LOADOUTS));
        localStorage.setItem(StorageKey.TEAM_LOADOUTS, JSON.stringify(TEAM_LOADOUTS));
    });

    it('reads the inventory from the IndexedDB cache, not localStorage', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(result.inventory).toHaveLength(3);
        expect(result.inventory.map((piece) => piece.slot)).toEqual([
            'weapon',
            'implant_major',
            'hull',
        ]);
        expect(result.inventory.every((piece) => UUID.test(piece.id))).toBe(true);
    });

    it('migrates nothing when the cache holds no gear', async () => {
        mocked(getFromIndexedDB).mockResolvedValue(undefined);

        const result = await migratePlayerData(USER_ID);

        expect(result.inventory).toEqual([]);
    });

    it('writes the migrated inventory to the signed-in profile cache key', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(setInIndexedDB).toHaveBeenCalledWith(inventoryCacheKey(USER_ID), result.inventory);
        expect(localStorage.getItem(StorageKey.INVENTORY)).toBeNull();
    });

    it('falls back to the unscoped cache key when there is no profile yet', async () => {
        const result = await migratePlayerData(null);

        expect(setInIndexedDB).toHaveBeenCalledWith(inventoryCacheKey(null), result.inventory);
    });

    it('remaps the gear ids equipped on ships', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(result.ships[0].equipment.weapon).toBe(result.inventory[0].id);
    });

    it('remaps the gear ids slotted as ship implants', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(result.ships[0].implants.implant_major).toBe(result.inventory[1].id);
    });

    it('remaps the gear ids in loadouts', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(result.loadouts[0].equipment.weapon).toBe(result.inventory[0].id);
        expect(result.loadouts[0].shipId).toBe(result.ships[0].id);
    });

    it('remaps the gear ids in team loadouts', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(result.teamLoadouts[0].shipLoadouts[0].equipment.weapon).toBe(
            result.inventory[0].id
        );
        expect(result.teamLoadouts[0].shipLoadouts[0].shipId).toBe(result.ships[0].id);
    });

    it('remaps the ship a gear piece is calibrated to', async () => {
        const result = await migratePlayerData(USER_ID);

        expect(result.inventory[2].calibration?.shipId).toBe(result.ships[0].id);
    });
});
