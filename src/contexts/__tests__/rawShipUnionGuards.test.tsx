import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ShipsProvider, useShips } from '../ShipsContext';
import { fakeSupabase } from '../../__tests__/services/fakeSupabase';

const { profile } = vi.hoisted(() => ({ profile: { id: null as string | null } }));

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));
vi.mock('../ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: profile.id, profilesLoading: false }),
    PROFILE_SWITCH_EVENT: 'app:profile:switch',
}));

const USER = '55555555-5555-4555-8555-555555555555';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ShipsProvider>{children}</ShipsProvider>
);

/** A minimal `ships` row shaped like `loadShips`'s join select, with a raw `affinity`/`type`
 *  that a bad or absent Supabase value can take — `affinity` is nullable in the schema, and
 *  `type` predates any runtime check on this row (#564). */
const rawShipRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    affinity: null,
    user_id: USER,
    ship_base_stats: {},
    ship_equipment: [],
    ship_implants: [],
    ship_refits: [],
    ship_templates: { image_key: '', active_skill_text: 'x', active_target: 'enemy' },
    ...overrides,
});

const mountSignedIn = async (ships: ReturnType<typeof rawShipRow>[]) => {
    profile.id = USER;
    fakeSupabase({ ships });
    const view = renderHook(() => useShips(), { wrapper });
    await waitFor(() => expect(view.result.current.ships.length).toBeGreaterThan(0));
    return view;
};

describe('RawShipData union guards on load (#564)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        profile.id = null;
        localStorage.clear();
    });

    // `ships.affinity` is nullable. `isValidShip` requires `affinity` to be `undefined` or a
    // `string` — a raw `null` fails that check, so a ship must never reach it with `affinity:
    // null`; the load boundary owns turning `null` into `undefined`.
    it('keeps a ship whose affinity column is null, as undefined rather than null', async () => {
        const { result } = await mountSignedIn([rawShipRow({ affinity: null })]);

        expect(result.current.ships).toHaveLength(1);
        expect(result.current.ships[0].affinity).toBeUndefined();
    });

    it('coerces a real affinity value through untouched', async () => {
        const { result } = await mountSignedIn([rawShipRow({ affinity: 'chemical' })]);

        expect(result.current.ships[0].affinity).toBe('chemical');
    });

    // A `type` value outside `ShipTypeName` (a retired/renamed role, or a corrupted row) must
    // not crash the load, and — because the row is the user's own ship — must not be dropped
    // either; it keeps the ship under the `toShipTypeName` fallback instead.
    it('keeps a ship whose type is unrecognised, falling back to ATTACKER', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = await mountSignedIn([rawShipRow({ type: 'RETIRED_ROLE' })]);

        expect(result.current.ships).toHaveLength(1);
        expect(result.current.ships[0].type).toBe('ATTACKER');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('RETIRED_ROLE'));
        warn.mockRestore();
    });
});
