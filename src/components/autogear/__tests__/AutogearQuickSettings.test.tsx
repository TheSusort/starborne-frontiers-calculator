import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { AutogearQuickSettings } from '../AutogearQuickSettings';
import { Ship } from '../../../types/ship';
import { AutogearAlgorithm } from '../../../utils/autogear/AutogearStrategy';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// ShipSelector reads the ships context and opens a modal; CommunityRecommendations
// fetches. Neither is under test here — the arrow contract is.
vi.mock('../../ship/ShipSelector', () => ({
    ShipSelector: ({ selected }: { selected: Ship | null }) => (
        <div>{selected ? selected.name : 'empty row'}</div>
    ),
}));

vi.mock('../CommunityRecommendations', () => ({
    CommunityRecommendations: () => null,
}));

const makeShip = (id: string, name: string): Ship => ({ id, name }) as Ship;

const CONFIG = {
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    ignoreEquipped: false,
    ignoreUnleveled: true,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    selectedAlgorithm: AutogearAlgorithm.Genetic,
    showSecondaryRequirements: false,
    optimizeImplants: false,
};

const renderPanel = (ships: (Ship | null)[]) => {
    const onMoveShipUp = vi.fn();
    const onMoveShipDown = vi.fn();

    render(
        <AutogearQuickSettings
            selectedShips={ships}
            onShipSelect={vi.fn()}
            onAddShip={vi.fn()}
            onAddTeam={vi.fn()}
            onSaveTeam={vi.fn()}
            canSaveTeam={false}
            onRemoveShip={vi.fn()}
            onOpenSettings={vi.fn()}
            onFindOptimalGear={vi.fn()}
            onMoveShipUp={onMoveShipUp}
            onMoveShipDown={onMoveShipDown}
            getShipConfig={() => CONFIG}
        />
    );

    return { onMoveShipUp, onMoveShipDown };
};

describe('AutogearQuickSettings reorder arrows', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders no arrows for a single row', () => {
        renderPanel([makeShip('1', 'Lodolite')]);

        expect(screen.queryByRole('button', { name: 'Move ship up' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Move ship down' })).not.toBeInTheDocument();
    });

    it('omits the up arrow on the first row and the down arrow on the last', () => {
        renderPanel([makeShip('1', 'Lodolite'), makeShip('2', 'Zeolite')]);

        expect(screen.getAllByRole('button', { name: 'Move ship up' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Move ship down' })).toHaveLength(1);
    });

    it('reports the clicked row index when moving down', () => {
        const { onMoveShipDown } = renderPanel([
            makeShip('1', 'Lodolite'),
            makeShip('2', 'Zeolite'),
            makeShip('3', 'Hemlock'),
        ]);

        fireEvent.click(screen.getAllByRole('button', { name: 'Move ship down' })[0]);

        expect(onMoveShipDown).toHaveBeenCalledWith(0);
    });

    it('reports the clicked row index when moving up', () => {
        const { onMoveShipUp } = renderPanel([
            makeShip('1', 'Lodolite'),
            makeShip('2', 'Zeolite'),
            makeShip('3', 'Hemlock'),
        ]);

        // Rows 1 and 2 have up arrows; the second of them is row index 2.
        fireEvent.click(screen.getAllByRole('button', { name: 'Move ship up' })[1]);

        expect(onMoveShipUp).toHaveBeenCalledWith(2);
    });
});
