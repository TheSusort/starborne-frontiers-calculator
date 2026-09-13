import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { UnitVersionSelector } from '../UnitVersionSelector';
import type { Ship } from '../../../types/ship';
import type { AscensionStat } from '../../../utils/ship/referenceShip';

const baseStats = {
    hp: 12000,
    attack: 3000,
    defence: 1800,
    hacking: 90,
    security: 25,
    crit: 10,
    critDamage: 60,
    speed: 100,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    shieldPenetration: 0,
    defensePenetration: 0,
    damageReduction: 0,
};

const ship = (id: string, name: string, extra: Partial<Ship> = {}): Ship =>
    ({
        id,
        name,
        rarity: 'legendary',
        faction: 'ATLAS',
        type: 'ATTACKER',
        affinity: 'thermal',
        baseStats: { ...baseStats },
        equipment: {},
        implants: {},
        refits: [],
        ...extra,
    }) as unknown as Ship;

const ASCENSION: AscensionStat[] = [
    { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
];

const UNITS = [ship('T_AEGIS', 'Aegis'), ship('T_JUDGE', 'Judge')];

let ownedShips: Ship[] = [];
let ascensionByTemplate: Record<string, AscensionStat[]> = {};
let unitsError: string | null = null;
let availableUnits: Ship[] = [];

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: ownedShips, getShipById: vi.fn() }),
}));

vi.mock('../../../hooks/useShipsData', () => ({
    useShipsData: () => ({
        ships: availableUnits,
        loading: false,
        error: unitsError,
        fetchSingleShip: vi.fn(),
        getAscensionStats: (id: string) => ascensionByTemplate[id] ?? null,
    }),
}));

vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));

vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

/** Step 1 renders one card per unit; clicking a card's name advances to step 2. */
const openUnit = (name: string) => {
    fireEvent.click(screen.getAllByText(name)[0]);
};

describe('UnitVersionSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ownedShips = [];
        ascensionByTemplate = {};
        unitsError = null;
        availableUnits = UNITS;
    });

    const renderSelector = (onSelect = vi.fn(), onClose = vi.fn()) => {
        render(<UnitVersionSelector onSelect={onSelect} onClose={onClose} />);
        return { onSelect, onClose };
    };

    it('lists every unit in the game, not only the ones owned', () => {
        renderSelector();

        expect(screen.getAllByText('Aegis').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Judge').length).toBeGreaterThan(0);
    });

    it('narrows the list by search', () => {
        renderSelector();

        fireEvent.change(screen.getByPlaceholderText('Search units'), {
            target: { value: 'judge' },
        });

        expect(screen.queryByText('Aegis')).toBeNull();
        expect(screen.getAllByText('Judge').length).toBeGreaterThan(0);
    });

    it('offers an R0 reference for a unit nobody owns', () => {
        renderSelector();
        openUnit('Aegis');

        expect(screen.getByText('Reference')).toBeInTheDocument();
        expect(screen.queryByText('Your ships')).toBeNull();
    });

    // A player can own several copies of one unit, so step 2's owned branch is a list.
    it('lists every owned copy of the unit', () => {
        ownedShips = [ship('owned-1', 'Aegis'), ship('owned-2', 'Aegis')];
        renderSelector();
        openUnit('Aegis');

        expect(screen.getByText('Your ships')).toBeInTheDocument();
    });

    // Without ascension data there is nothing to build six refits FROM, so the option is
    // absent rather than silently offering an unrefitted ship under a refitted label.
    it('does not offer a fully refitted version without ascension data', () => {
        renderSelector();
        openUnit('Aegis');

        expect(screen.getByText('R0 level 60')).toBeInTheDocument();
        expect(screen.queryByText('Fully refitted')).toBeNull();
    });

    it('offers a fully refitted version when the unit has ascension data', () => {
        ascensionByTemplate = { T_AEGIS: ASCENSION };
        renderSelector();
        openUnit('Aegis');

        expect(screen.getByText('Fully refitted')).toBeInTheDocument();
    });

    it('hands back a reference ship rather than an owned row', () => {
        const { onSelect } = renderSelector();
        openUnit('Aegis');

        fireEvent.click(screen.getByText('R0 level 60'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        const picked = onSelect.mock.calls[0][0] as Ship;
        expect(picked.id).toBe('template:T_AEGIS:r0');
        expect(picked.equipment).toEqual({});
        expect(picked.refits).toEqual([]);
    });

    it('hands back six refits for the fully refitted version', () => {
        ascensionByTemplate = { T_AEGIS: ASCENSION };
        const { onSelect } = renderSelector();
        openUnit('Aegis');

        fireEvent.click(screen.getByText('Fully refitted'));

        const picked = onSelect.mock.calls[0][0] as Ship;
        expect(picked.id).toBe('template:T_AEGIS:refitted');
        expect(picked.refits).toHaveLength(6);
    });

    it('hands back the owned row itself when an owned copy is picked', () => {
        ownedShips = [ship('owned-1', 'Aegis')];
        const { onSelect } = renderSelector();
        openUnit('Aegis');

        // Scoped to the owned section: both it and the reference section show the unit name.
        const ownedSection = screen.getByText('Your ships').parentElement as HTMLElement;
        fireEvent.click(within(ownedSection).getByText('Aegis'));

        const picked = onSelect.mock.calls[0][0] as Ship;
        expect(picked.id).toBe('owned-1');
    });

    it('closes once a version is picked, so the cell selection clears', () => {
        const { onClose } = renderSelector();
        openUnit('Aegis');

        fireEvent.click(screen.getByText('R0 level 60'));

        expect(onClose).toHaveBeenCalled();
    });

    it('steps back to the unit list', () => {
        renderSelector();
        openUnit('Aegis');

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(screen.getByPlaceholderText('Search units')).toBeInTheDocument();
        expect(screen.getAllByText('Judge').length).toBeGreaterThan(0);
    });

    // An empty list after a failed fetch is not an empty search: telling the player "no
    // matches" sends them hunting a typo that is not theirs.
    describe('when the unit list fails to load', () => {
        beforeEach(() => {
            unitsError = 'network down';
            availableUnits = [];
        });

        it('says the list could not be loaded, not that nothing matched', () => {
            renderSelector();

            expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
            expect(screen.queryByText('No units match that search')).toBeNull();
        });

        it('still says nothing matched when the list loaded and the search is too narrow', () => {
            unitsError = null;
            availableUnits = UNITS;
            renderSelector();

            fireEvent.change(screen.getByPlaceholderText('Search units'), {
                target: { value: 'zzzz' },
            });

            expect(screen.getByText('No units match that search')).toBeInTheDocument();
        });
    });

    // Every step of this picker is a grid of cards, so a mouse-only card makes the whole
    // flow unreachable from the keyboard.
    describe('keyboard', () => {
        it('advances from a unit card on Enter', () => {
            renderSelector();

            fireEvent.keyDown(screen.getAllByRole('button', { name: /Aegis/ })[0], {
                key: 'Enter',
            });

            expect(screen.getByText('Reference')).toBeInTheDocument();
        });

        it('picks a reference version on Space', () => {
            const { onSelect } = renderSelector();
            openUnit('Aegis');

            const card = screen.getByText('R0 level 60').closest('[role="button"]') as HTMLElement;
            fireEvent.keyDown(card, { key: ' ' });

            expect((onSelect.mock.calls[0][0] as Ship).id).toBe('template:T_AEGIS:r0');
        });

        it('picks an owned copy on Enter', () => {
            ownedShips = [ship('owned-1', 'Aegis')];
            const { onSelect } = renderSelector();
            openUnit('Aegis');

            const ownedSection = screen.getByText('Your ships').parentElement as HTMLElement;
            const card = within(ownedSection).getByText('Aegis').closest('[role="button"]');
            fireEvent.keyDown(card as HTMLElement, { key: 'Enter' });

            expect((onSelect.mock.calls[0][0] as Ship).id).toBe('owned-1');
        });

        it('ignores a key that is not Enter or Space', () => {
            const { onSelect } = renderSelector();
            openUnit('Aegis');

            const card = screen.getByText('R0 level 60').closest('[role="button"]') as HTMLElement;
            fireEvent.keyDown(card, { key: 'a' });

            expect(onSelect).not.toHaveBeenCalled();
        });
    });
});
