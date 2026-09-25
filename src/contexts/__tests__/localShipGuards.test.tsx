import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { ShipsProvider, useShips } from '../ShipsContext';
import { StorageKey } from '../../constants/storage';

const { profile } = vi.hoisted(() => ({ profile: { id: null as string | null } }));

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));
vi.mock('../ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: profile.id, profilesLoading: false }),
    PROFILE_SWITCH_EVENT: 'app:profile:switch',
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ShipsProvider>{children}</ShipsProvider>
);

/** A ship shaped like old/corrupted localStorage: mixed-case rarity, a null affinity (both
 *  legal JSON, neither a real `RarityName`/`AffinityName` value) and a retired ship type.
 *  `activeSkillText`/`activeTarget` are pre-filled so the unauthenticated skill-text-enrichment
 *  fetch (`ShipsContext`'s `ship_templates` lookup) is skipped — this test is about the
 *  rarity/type/affinity guard, not that fetch. */
const badLocalShip = {
    id: 'local-ship-1',
    name: 'Test Ship',
    rarity: 'Epic',
    faction: 'TERRAN',
    type: 'RETIRED_ROLE',
    affinity: null,
    baseStats: { hp: 1000, attack: 100, defence: 50, speed: 100, crit: 10, critDamage: 50 },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'x',
    activeTarget: 'enemy',
};

describe('signed-out localStorage ship guards (#568)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        profile.id = null;
        localStorage.clear();
        localStorage.setItem(StorageKey.SHIPS, JSON.stringify([badLocalShip]));
    });

    it('keeps the ship, lowercasing rarity, clearing affinity and falling back type to ATTACKER', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { result } = renderHook(() => useShips(), { wrapper });

        await waitFor(() => expect(result.current.ships).toHaveLength(1));

        const ship = result.current.ships[0];
        expect(ship.id).toBe('local-ship-1');
        expect(ship.rarity).toBe('epic');
        expect(ship.affinity).toBeUndefined();
        expect(ship.type).toBe('ATTACKER');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('RETIRED_ROLE'));

        warn.mockRestore();
    });
});
