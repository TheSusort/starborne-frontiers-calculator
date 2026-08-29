import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { AutogearQuickSettings } from '../AutogearQuickSettings';
import { Ship } from '../../../types/ship';
import { AutogearAlgorithm } from '../../../utils/autogear/AutogearStrategy';
import type { ShipTypeName } from '../../../constants';
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../../types/autogear';
import type { SharedAutogearBuild } from '../../../types/communityRecommendation';

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

// Captures what the panel hands down, so the wiring can be asserted without
// rendering the real (fetching) component. Keyed by the ship id the row was
// rendered for — with two or more ships mounted, an unkeyed single-slot
// capture is last-write-wins and silently loses every row but the last.
const communityProps = vi.hoisted(() => {
    const current: Record<string, Record<string, unknown>> = {};
    return { current };
});

vi.mock('../CommunityRecommendations', () => ({
    CommunityRecommendations: (props: Record<string, unknown>) => {
        const selectedShip = props.selectedShip as { id: string } | null;
        const shipId = selectedShip?.id;
        if (shipId) {
            communityProps.current[shipId] = props;
        }
        return null;
    },
}));

const makeShip = (id: string, name: string): Ship => ({ id, name }) as Ship;

// Explicitly typed: `typeof CONFIG` on an untyped literal would pin shipRole to
// `null` and reject 'ATTACKER' in the tests below.
type ShipConfig = {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs: FleetBuff[];
    excludedImplantTypes: string[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    selectedAlgorithm: AutogearAlgorithm;
    showSecondaryRequirements: boolean;
    optimizeImplants: boolean;
};

const CONFIG: ShipConfig = {
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
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
            onApplyBuild={vi.fn()}
            getShipConfig={() => CONFIG}
        />
    );

    return { onMoveShipUp, onMoveShipDown };
};

/** The same render as renderPanel, with an overridable per-ship config. */
const renderPanelWithConfig = (ships: (Ship | null)[], config: ShipConfig) => {
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
            onMoveShipUp={vi.fn()}
            onMoveShipDown={vi.fn()}
            onApplyBuild={vi.fn()}
            getShipConfig={() => config}
        />
    );
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

describe('AutogearQuickSettings community build wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        communityProps.current = {};
    });

    it('passes a null currentBuild when the ship has no role configured', () => {
        renderPanel([makeShip('1', 'Lodolite')]);
        expect(communityProps.current['1']?.currentBuild).toBeNull();
    });

    it('passes the full build, including fleet buffs and implant exclusions', () => {
        renderPanelWithConfig([makeShip('1', 'Lodolite')], {
            ...CONFIG,
            shipRole: 'ATTACKER',
            fleetBuffs: [{ stat: 'attack', percentage: 30 }],
            excludedImplantTypes: ['MARTYRDOM'],
            optimizeImplants: true,
        });
        expect(communityProps.current['1']?.currentBuild).toEqual({
            version: 1,
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [{ stat: 'attack', percentage: 30 }],
            excludedImplantTypes: ['MARTYRDOM'],
            optimizeImplants: true,
        });
    });

    it('reports hasExistingConfig false for an untouched config', () => {
        renderPanelWithConfig([makeShip('1', 'Lodolite')], { ...CONFIG, shipRole: 'ATTACKER' });
        expect(communityProps.current['1']?.hasExistingConfig).toBe(false);
    });

    it('reports hasExistingConfig true once anything is configured', () => {
        renderPanelWithConfig([makeShip('1', 'Lodolite')], {
            ...CONFIG,
            shipRole: 'ATTACKER',
            statPriorities: [{ stat: 'crit', minLimit: 100 }],
        });
        expect(communityProps.current['1']?.hasExistingConfig).toBe(true);
    });

    it("forwards the SECOND ship's own id when its onApplyBuild is invoked, not the first's", () => {
        const onApplyBuild = vi.fn();
        const sampleBuild: SharedAutogearBuild = {
            version: 1,
            shipRole: 'ATTACKER',
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
        };

        render(
            <AutogearQuickSettings
                selectedShips={[makeShip('1', 'Lodolite'), makeShip('2', 'Zeolite')]}
                onShipSelect={vi.fn()}
                onAddShip={vi.fn()}
                onAddTeam={vi.fn()}
                onSaveTeam={vi.fn()}
                canSaveTeam={false}
                onRemoveShip={vi.fn()}
                onOpenSettings={vi.fn()}
                onFindOptimalGear={vi.fn()}
                onMoveShipUp={vi.fn()}
                onMoveShipDown={vi.fn()}
                onApplyBuild={onApplyBuild}
                getShipConfig={() => CONFIG}
            />
        );

        const applyFromRow2 = communityProps.current['2']?.onApplyBuild as (
            build: SharedAutogearBuild
        ) => void;
        expect(applyFromRow2).toBeInstanceOf(Function);

        applyFromRow2(sampleBuild);

        expect(onApplyBuild).toHaveBeenCalledWith('2', sampleBuild);
        expect(onApplyBuild).not.toHaveBeenCalledWith('1', sampleBuild);

        // The first row's own callback must independently forward its own id —
        // proves the two rows aren't sharing one closed-over ship reference.
        const applyFromRow1 = communityProps.current['1']?.onApplyBuild as (
            build: SharedAutogearBuild
        ) => void;
        applyFromRow1(sampleBuild);
        expect(onApplyBuild).toHaveBeenCalledWith('1', sampleBuild);
    });
});
