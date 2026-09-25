import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratePlayerData, syncMigratedDataToSupabase } from '../../utils/migratePlayerData';
import { fakeSupabase } from '../services/fakeSupabase';
import { EngineeringStats } from '../../types/stats';
import { StorageKey, inventoryCacheKey } from '../../constants/storage';
import { getFromIndexedDB, setInIndexedDB } from '../../hooks/useStorage';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { Loadout, TeamLoadout } from '../../types/loadout';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    },
}));
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

    // See `normaliseShipFields` — a stored ship is a trust boundary; the migrated payload this
    // function hands to `syncMigratedDataToSupabase` for upload must already be normalised (#568).
    it("normalises a legacy ship's rarity/type/affinity before migration", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const legacyShip: Ship = {
            ...SHIPS[0],
            id: 'ship-legacy',
            rarity: 'Epic' as Ship['rarity'],
            type: 'RETIRED_ROLE' as Ship['type'],
            affinity: null as unknown as Ship['affinity'],
        };
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([...SHIPS, legacyShip]));

        const result = await migratePlayerData(USER_ID);
        const migrated = result.ships[1];

        expect(migrated.rarity).toBe('epic');
        expect(migrated.type).toBe('ATTACKER');
        expect(migrated.affinity).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('RETIRED_ROLE'));

        warn.mockRestore();
    });
});

/**
 * The sign-in and import paths run no `pruneSupabaseDataNotInLocal` afterwards, so this step
 * is the only thing that removes an engineering stat the user dropped locally. It replaced
 * the section with a delete followed by an insert, inside a `catch` that logs and continues:
 * a rejected insert emptied the user's cloud stats silently.
 */
describe('syncMigratedDataToSupabase engineering stats', () => {
    const EMPTY = {
        ships: [],
        inventory: [],
        encounters: [],
        loadouts: [],
        teamLoadouts: [],
        wishlistEntries: [],
        autogearTeams: [],
    };

    const section = (entries: Array<{ shipType: string; names: string[] }>) => ({
        stats: entries.map(({ shipType, names }) => ({
            shipType,
            stats: names.map((name) => ({ name, value: 1, type: 'flat' })),
        })),
    });

    const cloudRow = (shipType: string, statName: string) => ({
        user_id: USER_ID,
        ship_type: shipType,
        stat_name: statName,
        value: 1,
        type: 'flat',
    });

    const sync = async (
        entries: Array<{ shipType: string; names: string[] }>,
        cloud: Array<Record<string, unknown>>
    ) => {
        const ops = fakeSupabase({ engineering_stats: cloud });
        await syncMigratedDataToSupabase(USER_ID, {
            ...EMPTY,
            engineeringStats: section(entries) as EngineeringStats,
        });
        return ops.filter((op) => op.table === 'engineering_stats');
    };

    it('upserts on the composite key and never deletes the whole section', async () => {
        const ops = await sync(
            [{ shipType: 'ATTACKER', names: ['attack'] }],
            [cloudRow('ATTACKER', 'attack')]
        );

        const upsert = ops.find((op) => op.kind === 'upsert');
        expect(upsert?.onConflict).toBe('user_id,ship_type,stat_name');
        // The old shape: a delete keyed on user_id alone, taking every row the user has.
        expect(ops.filter((op) => op.kind === 'delete' && op.filters?.length === 1)).toHaveLength(
            0
        );
    });

    it('writes before it removes, so a rejected write leaves the cloud standing', async () => {
        const ops = await sync(
            [{ shipType: 'ATTACKER', names: ['attack'] }],
            [cloudRow('ATTACKER', 'attack')]
        );

        expect(ops.findIndex((op) => op.kind === 'upsert')).toBeLessThan(
            ops.findIndex((op) => op.kind === 'delete')
        );
    });

    it('removes a stat name the section no longer carries for a ship type it names', async () => {
        const ops = await sync(
            [{ shipType: 'ATTACKER', names: ['attack'] }],
            [cloudRow('ATTACKER', 'attack'), cloudRow('ATTACKER', 'hp')]
        );

        expect(ops.filter((op) => op.kind === 'delete')).toContainEqual(
            expect.objectContaining({
                filters: [
                    { column: 'user_id', values: [USER_ID] },
                    { column: 'ship_type', values: ['ATTACKER'] },
                    { column: 'stat_name', values: ['attack'], negated: true },
                ],
            })
        );
    });

    it('removes a ship type the section drops entirely, which no per-type delete names', async () => {
        const ops = await sync(
            [{ shipType: 'ATTACKER', names: ['attack'] }],
            [cloudRow('ATTACKER', 'attack'), cloudRow('DEFENDER', 'hp')]
        );

        expect(ops.filter((op) => op.kind === 'delete')).toContainEqual(
            expect.objectContaining({
                filters: [
                    { column: 'user_id', values: [USER_ID] },
                    { column: 'ship_type', values: ['ATTACKER'], negated: true },
                ],
            })
        );
    });
});
