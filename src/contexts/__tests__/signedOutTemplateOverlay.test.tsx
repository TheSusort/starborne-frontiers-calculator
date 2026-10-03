import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ShipsProvider, useShips } from '../ShipsContext';
import { supabase } from '../../config/supabase';
import { StorageKey } from '../../constants/storage';
import type { Ship } from '../../types/ship';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));
vi.mock('../ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: null, profilesLoading: false }),
    PROFILE_SWITCH_EVENT: 'app:profile:switch',
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ShipsProvider>{children}</ShipsProvider>
);

const TEMPLATES = [
    {
        name: 'Alpha',
        active_skill_text: 'NEW TEXT',
        charge_skill_text: null,
        charge_skill_charge: null,
        first_passive_skill_text: 'NEW PASSIVE',
        second_passive_skill_text: null,
        third_passive_skill_text: null,
        active_target: 'all',
        active_pattern: null,
        charged_target: null,
        charged_pattern: null,
    },
];

/** Names handed to each `ship_templates` query, in call order. */
const inNames: string[][] = [];

const installTemplates = () => {
    inNames.length = 0;
    vi.mocked(supabase.from).mockImplementation((() => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.in = (_col: string, names: string[]) => {
            inNames.push(names);
            return chain;
        };
        chain.abortSignal = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) =>
            resolve({
                data: TEMPLATES.filter((t) => inNames[inNames.length - 1].includes(t.name)),
                error: null,
            });
        return chain;
    }) as never);
};

const ship = (id: string, name: string, overrides: Partial<Ship> = {}): Ship =>
    ({
        id,
        name,
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        type: 'ATTACKER',
        baseStats: {},
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'OLD TEXT',
        firstPassiveSkillText: 'OLD PASSIVE',
        activeTarget: 'front',
        ...overrides,
    }) as unknown as Ship;

const mount = async (ships: Ship[]) => {
    localStorage.setItem(StorageKey.SHIPS, JSON.stringify(ships));
    const view = renderHook(() => useShips(), { wrapper });
    await waitFor(() => expect(view.result.current.ships).toHaveLength(ships.length));
    return view;
};

describe('signed-out ships overlay ship_templates text', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        installTemplates();
    });

    it('replaces stale stored text and targeting with the template row', async () => {
        const { result } = await mount([ship('a1', 'Alpha')]);
        await waitFor(() => expect(result.current.ships[0].activeSkillText).toBe('NEW TEXT'));
        const s = result.current.ships[0];
        expect(s.activeTarget).toBe('all');
        expect(s.firstPassiveSkillText).toBe('NEW PASSIVE');
        // Same null handling as the signed-in read: a null template field is undefined.
        expect(s.chargeSkillText).toBeUndefined();
    });

    it('leaves a ship with no template row as it is', async () => {
        const { result } = await mount([ship('a1', 'Alpha'), ship('z1', 'Zeta')]);
        await waitFor(() => expect(result.current.ships[0].activeSkillText).toBe('NEW TEXT'));
        const zeta = result.current.ships.find((s) => s.id === 'z1')!;
        expect(zeta.activeSkillText).toBe('OLD TEXT');
        expect(zeta.activeTarget).toBe('front');
    });

    it('does not re-query templates for names it already fetched', async () => {
        const { result } = await mount([ship('a1', 'Alpha'), ship('z1', 'Zeta')]);
        await waitFor(() => expect(result.current.ships[0].activeSkillText).toBe('NEW TEXT'));
        expect(inNames).toEqual([['Alpha', 'Zeta']]);

        await act(async () => {
            await result.current.updateShip('a1', { starred: true });
        });
        await waitFor(() => expect(result.current.ships[0].starred).toBe(true));

        expect(inNames).toEqual([['Alpha', 'Zeta']]);
        expect(result.current.ships[0].activeSkillText).toBe('NEW TEXT');
    });

    it('fetches only the names it has not seen when a new ship appears', async () => {
        const { result } = await mount([ship('a1', 'Alpha')]);
        await waitFor(() => expect(result.current.ships[0].activeSkillText).toBe('NEW TEXT'));
        await act(async () => {
            await result.current.addShip(ship('n1', 'Nu', { id: undefined }));
        });
        await waitFor(() => expect(result.current.ships).toHaveLength(2));
        await waitFor(() => expect(inNames).toEqual([['Alpha'], ['Nu']]));
    });

    const installQuery = (
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => unknown
    ) =>
        vi.mocked(supabase.from).mockImplementation((() => {
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.in = () => chain;
            chain.abortSignal = () => chain;
            chain.then = then;
            return chain;
        }) as never);

    it('shows the stored ships while the template request is still pending', async () => {
        installQuery(() => undefined); // never settles
        const { result } = await mount([ship('a1', 'Alpha')]);
        expect(result.current.ships[0].activeSkillText).toBe('OLD TEXT');
    });

    it('keeps showing the stored ships when the template request fails', async () => {
        installQuery((_resolve, reject) => reject(new Error('network down')));
        const { result } = await mount([ship('a1', 'Alpha')]);
        expect(result.current.ships[0].activeSkillText).toBe('OLD TEXT');
    });
});
