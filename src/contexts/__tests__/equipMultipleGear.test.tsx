import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ShipsProvider, useShips } from '../ShipsContext';
import { fakeSupabase, deletesOn, upsertsOn } from '../../__tests__/services/fakeSupabase';
import { StorageKey } from '../../constants/storage';
import type { Ship } from '../../types/ship';

const { notify, profile } = vi.hoisted(() => ({
    notify: vi.fn(),
    profile: { id: null as string | null },
}));

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: notify }),
}));
vi.mock('../ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: profile.id, profilesLoading: false }),
    PROFILE_SWITCH_EVENT: 'app:profile:switch',
}));

const USER = '44444444-4444-4444-8444-444444444444';

const ship = (id: string, overrides: Partial<Ship> = {}): Ship =>
    ({
        id,
        name: id,
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        type: 'SUPPORTER',
        baseStats: {},
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'x',
        activeTarget: 'enemy',
        ...overrides,
    }) as unknown as Ship;

/** Hayyan takes a weapon and a major implant that Paracelsus currently wears. */
const fleet = (): Ship[] => [
    ship('hayyan', {
        equipment: { weapon: 'old-weapon' },
        implants: { implant_major: 'old-major', implant_ultimate: 'kept-ultimate' },
    }),
    ship('paracelsus', {
        equipment: { weapon: 'new-weapon' },
        implants: { implant_major: 'new-major' },
    }),
];

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ShipsProvider>{children}</ShipsProvider>
);

const mountSignedOut = async () => {
    profile.id = null;
    localStorage.setItem(StorageKey.SHIPS, JSON.stringify(fleet()));
    const view = renderHook(() => useShips(), { wrapper });
    await waitFor(() => expect(view.result.current.ships).toHaveLength(2));
    return view;
};

const mountSignedOutWith = async (ships: Ship[]) => {
    profile.id = null;
    localStorage.setItem(StorageKey.SHIPS, JSON.stringify(ships));
    const view = renderHook(() => useShips(), { wrapper });
    await waitFor(() => expect(view.result.current.ships).toHaveLength(ships.length));
    return view;
};

const byId = (ships: Ship[], id: string) => ships.find((s) => s.id === id)!;
const stored = (): Ship[] => JSON.parse(localStorage.getItem(StorageKey.SHIPS) ?? '[]');

/** The joined row `loadShips` selects, for a signed-in mount. */
const shipRow = (s: Ship) => ({
    id: s.id,
    name: s.name,
    rarity: s.rarity,
    faction: s.faction,
    type: s.type,
    user_id: USER,
    ship_base_stats: {},
    ship_equipment: Object.entries(s.equipment).map(([slot, gear_id]) => ({ slot, gear_id })),
    ship_implants: Object.entries(s.implants).map(([slot, id]) => ({ slot, id })),
    ship_refits: [],
    ship_templates: { image_key: '', active_skill_text: 'x', active_target: 'enemy' },
});

const mountSignedIn = async () => {
    profile.id = USER;
    const ops = fakeSupabase({ ships: fleet().map(shipRow) });
    const view = renderHook(() => useShips(), { wrapper });
    await waitFor(() => expect(view.result.current.ships).toHaveLength(2));
    return { ops, view };
};

const equipHayyan = async (api: ReturnType<typeof useShips>) =>
    act(async () => {
        await api.equipMultipleGear(
            'hayyan',
            [{ slot: 'weapon', gearId: 'new-weapon' }],
            [{ slot: 'implant_major', gearId: 'new-major' }]
        );
    });

describe('equipMultipleGear with implants (#558)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('keeps both the gear and the implant half, and strips both from the donor', async () => {
        const { result } = await mountSignedOut();
        await equipHayyan(result.current);

        for (const ships of [result.current.ships, stored()]) {
            const hayyan = byId(ships, 'hayyan');
            expect(hayyan.equipment.weapon).toBe('new-weapon');
            expect(hayyan.implants).toEqual({
                implant_major: 'new-major',
                implant_ultimate: 'kept-ultimate',
            });
            const paracelsus = byId(ships, 'paracelsus');
            expect(paracelsus.equipment.weapon).toBeUndefined();
            expect(paracelsus.implants.implant_major).toBeUndefined();
        }
    });

    it('leaves the gear alone on an implants-only write', async () => {
        const { result } = await mountSignedOut();
        await act(async () => {
            await result.current.equipMultipleGear(
                'hayyan',
                [],
                [{ slot: 'implant_major', gearId: 'new-major' }]
            );
        });
        expect(byId(result.current.ships, 'hayyan').equipment.weapon).toBe('old-weapon');
    });

    it('frees the donor implant row before inserting the merged set', async () => {
        const { ops, view } = await mountSignedIn();
        ops.length = 0;
        await equipHayyan(view.result.current);

        const implantOps = ops.filter((op) => op.table === 'ship_implants');
        expect(implantOps.map((op) => op.kind)).toEqual(['delete', 'delete', 'insert']);
        const [donorDelete, targetDelete, insert] = implantOps;
        expect(donorDelete.filters).toEqual([{ column: 'id', values: ['new-major'] }]);
        expect(targetDelete.filters).toEqual([{ column: 'ship_id', values: ['hayyan'] }]);
        expect(insert.payload).toEqual(
            expect.arrayContaining([
                { ship_id: 'hayyan', slot: 'implant_major', id: 'new-major' },
                { ship_id: 'hayyan', slot: 'implant_ultimate', id: 'kept-ultimate' },
            ])
        );
        expect((insert.payload as unknown[]).length).toBe(2);

        expect(deletesOn(ops, 'ship_equipment')[0].values).toEqual(['new-weapon']);
        expect(upsertsOn(ops, 'ship_equipment')[0].payload).toEqual([
            { ship_id: 'hayyan', slot: 'weapon', gear_id: 'new-weapon' },
        ]);
        expect(notify).not.toHaveBeenCalledWith('error', expect.anything());
    });
});

describe('writers issued back-to-back in one tick (#560)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('a team-loadout-style equip on two different ships keeps both writes, not just the last', async () => {
        const { result } = await mountSignedOut();
        // Captured once, like TeamLoadoutCard.handleEquipTeam holds `equipMultipleGear` from its
        // own render: both calls below go through this SAME closure, so a fix that only relies
        // on re-rendering between calls would not be exercised.
        const api = result.current;

        await act(async () => {
            await api.equipMultipleGear('hayyan', [{ slot: 'weapon', gearId: 'team-weapon-1' }]);
            await api.equipMultipleGear('paracelsus', [
                { slot: 'weapon', gearId: 'team-weapon-2' },
            ]);
        });

        for (const ships of [result.current.ships, stored()]) {
            expect(byId(ships, 'hayyan').equipment.weapon).toBe('team-weapon-1');
            expect(byId(ships, 'paracelsus').equipment.weapon).toBe('team-weapon-2');
        }
    });

    it('equipGear on one ship then lockEquipment on another in the same tick both survive', async () => {
        const { result } = await mountSignedOut();
        const api = result.current;

        await act(async () => {
            await api.equipGear('hayyan', 'weapon', 'fresh-weapon');
            await api.lockEquipment('paracelsus', true);
        });

        for (const ships of [result.current.ships, stored()]) {
            expect(byId(ships, 'hayyan').equipment.weapon).toBe('fresh-weapon');
            expect(byId(ships, 'paracelsus').equipmentLocked).toBe(true);
        }
    });

    it("a partial equipMultipleGear keeps the target ship's other equipped slots", async () => {
        const twoSlotFleet = () => [
            ship('hayyan', {
                equipment: { weapon: 'old-weapon', hull: 'old-hull' },
                implants: {},
            }),
            ship('paracelsus', { equipment: {}, implants: {} }),
        ];
        const { result } = await mountSignedOutWith(twoSlotFleet());

        await act(async () => {
            await result.current.equipMultipleGear('hayyan', [
                { slot: 'weapon', gearId: 'new-weapon' },
            ]);
        });

        for (const ships of [result.current.ships, stored()]) {
            const hayyan = byId(ships, 'hayyan');
            expect(hayyan.equipment.weapon).toBe('new-weapon');
            expect(hayyan.equipment.hull).toBe('old-hull');
        }
    });
});

describe('ship lookups stay reactive', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('a consumer memoized on getShipById recomputes once ships load', async () => {
        profile.id = null;
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify(fleet()));
        const view = renderHook(
            () => {
                const { getShipById, getShipName } = useShips();
                // Memoized on the lookup's identity, as GearPieceDisplay and CalibrationModal are.
                const found = React.useMemo(() => getShipById('hayyan'), [getShipById]);
                const name = React.useMemo(() => getShipName('paracelsus'), [getShipName]);
                return { found, name };
            },
            { wrapper }
        );
        await waitFor(() => expect(view.result.current.found?.id).toBe('hayyan'));
        expect(view.result.current.name).toBe('paracelsus');
    });
});
