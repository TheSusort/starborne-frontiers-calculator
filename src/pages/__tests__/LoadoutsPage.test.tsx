import { render, screen, fireEvent, waitFor } from '../../test-utils/test-utils';
import { LoadoutsPage } from '../manager/LoadoutsPage';
import { Loadout, TeamLoadout } from '../../types/loadout';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { vi } from 'vitest';
import React from 'react';
import { LoadoutCard } from '../../components/loadout/LoadoutCard';

window.scrollTo = vi.fn();

// Mock data
const mockLoadouts: Loadout[] = [
    {
        id: 'loadout1',
        name: 'Test Loadout',
        shipId: 'ship1',
        equipment: {
            weapon: 'gear1',
            armor: 'gear2',
        },
        createdAt: Date.now(),
    },
];

const mockTeamLoadouts: TeamLoadout[] = [
    {
        id: 'team1',
        name: 'Test Team',
        shipLoadouts: [
            {
                position: 1,
                shipId: 'ship1',
                equipment: {
                    weapon: 'gear1',
                },
            },
            {
                position: 2,
                shipId: 'ship2',
                equipment: {
                    armor: 'gear2',
                },
            },
        ],
        createdAt: Date.now(),
    },
];

const mockGear: GearPiece[] = [
    {
        id: 'gear1',
        slot: 'weapon',
        level: 10,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: 'CRITICAL',
    },
    {
        id: 'gear2',
        slot: 'armor',
        level: 8,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'hp', value: 2000, type: 'flat' },
        subStats: [],
        setBonus: 'FORTITUDE',
    },
];

const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship 1',
        type: 'ATTACKER',
        faction: 'TERRAN',
        rarity: 'legendary',
        equipment: {},
        equipmentLocked: false,
        baseStats: {
            hp: 1000,
            attack: 1000,
            defence: 1000,
            hacking: 1000,
            security: 1000,
            speed: 1000,
            crit: 1000,
            critDamage: 1000,
            healModifier: 0,
        },
        refits: [],
        implants: [],
    },
    {
        id: 'ship2',
        name: 'Test Ship 2',
        type: 'DEFENDER',
        faction: 'TERRAN',
        rarity: 'epic',
        equipment: {},
        equipmentLocked: false,
        baseStats: {
            hp: 1000,
            attack: 1000,
            defence: 1000,
            hacking: 1000,
            security: 1000,
            speed: 1000,
            crit: 1000,
            critDamage: 1000,
            healModifier: 0,
        },
        refits: [],
        implants: [],
    },
];

// Mock hooks
const mockAddLoadout = vi.fn();
const mockUpdateLoadout = vi.fn();
const mockDeleteLoadout = vi.fn();
const mockAddTeamLoadout = vi.fn();
const mockUpdateTeamLoadout = vi.fn();
const mockDeleteTeamLoadout = vi.fn();
const mockAddNotification = vi.fn();

vi.mock('../../hooks/useLoadouts', () => ({
    useLoadouts: () => ({
        loadouts: mockLoadouts,
        addLoadout: mockAddLoadout,
        updateLoadout: mockUpdateLoadout,
        deleteLoadout: mockDeleteLoadout,
        teamLoadouts: mockTeamLoadouts,
        addTeamLoadout: mockAddTeamLoadout,
        updateTeamLoadout: mockUpdateTeamLoadout,
        deleteTeamLoadout: mockDeleteTeamLoadout,
    }),
}));

vi.mock('../../hooks/useInventory', () => ({
    useInventory: () => ({
        inventory: mockGear,
        getGearPiece: (id: string) => mockGear.find((gear) => gear.id === id),
    }),
}));

vi.mock('../../hooks/useShips', () => ({
    useShips: () => ({
        ships: mockShips,
        handleEquipGear: vi.fn(),
    }),
}));

vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: mockAddNotification,
    }),
}));

// Mock UI components
vi.mock('../../components/ui', () => ({
    PageLayout: ({
        children,
        title,
        description,
        action,
    }: {
        children: React.ReactNode;
        title: string;
        description: string;
        action: { onClick: () => void; label: string };
    }) => (
        <div>
            <h1>{title}</h1>
            <p>{description}</p>
            <button onClick={action?.onClick}>{action?.label}</button>
            {children}
        </div>
    ),
    CollapsibleForm: ({
        children,
        isVisible,
    }: {
        children: React.ReactNode;
        isVisible: boolean;
    }) => <div className={isVisible ? '' : 'max-h-0'}>{children}</div>,
    Tabs: ({
        tabs,
        activeTab,
        onChange,
    }: {
        tabs: { id: string; label: string }[];
        activeTab: string;
        onChange: (id: string) => void;
    }) => (
        <div>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => onChange(tab.id)}
                    data-active={activeTab === tab.id}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    ),
}));

// Mock form components
vi.mock('../../components/loadout/LoadoutForm', () => ({
    LoadoutForm: ({ onSubmit }: { onSubmit: (loadout: Loadout) => void }) => (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                    id: 'new-loadout',
                    name: 'New Loadout',
                    shipId: 'ship1',
                    equipment: { weapon: 'gear1' },
                    createdAt: Date.now(),
                });
            }}
        >
            <button type="submit">Create Loadout</button>
        </form>
    ),
}));

vi.mock('../../components/loadout/TeamLoadoutForm', () => ({
    TeamLoadoutForm: ({ onSubmit }: { onSubmit: (teamLoadout: TeamLoadout) => void }) => (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                    id: 'new-team',
                    name: 'New Team',
                    shipLoadouts: [
                        {
                            position: 1,
                            shipId: 'ship1',
                            equipment: { weapon: 'gear1' },
                        },
                    ],
                    createdAt: Date.now(),
                });
            }}
        >
            <button type="submit">Create Team</button>
        </form>
    ),
}));

// Mock LoadoutCard component
vi.mock('../../components/loadout/LoadoutCard', () => ({
    LoadoutCard: ({
        name,
        ship,
        equipment,
        onEquip,
        onDelete,
    }: {
        name?: string;
        ship: Ship;
        equipment: Record<string, string>;
        onEquip?: () => void;
        onDelete?: () => void;
    }) => (
        <div className="loadout-card">
            {name && <h3>{name}</h3>}
            <div>Ship: {ship.name}</div>
            <div>Equipment: {Object.keys(equipment).length} pieces</div>
            {onEquip && (
                <button onClick={onEquip} aria-label="Equip loadout">
                    Equip
                </button>
            )}
            {onDelete && (
                <button onClick={onDelete} aria-label="Delete loadout">
                    Delete
                </button>
            )}
        </div>
    ),
}));

// Mock TeamLoadoutCard component
vi.mock('../../components/loadout/TeamLoadoutCard', () => ({
    TeamLoadoutCard: ({
        teamLoadout,
        onDelete,
    }: {
        teamLoadout: TeamLoadout;
        onDelete: (id: string) => void;
    }) => (
        <div className="team-loadout-card">
            <h3>{teamLoadout.name}</h3>
            <div>Ships: {teamLoadout.shipLoadouts.length}</div>
            <button onClick={() => onDelete(teamLoadout.id)} aria-label="Delete team loadout">
                Delete Team
            </button>
            <button aria-label="Equip team loadout">Equip Team</button>
        </div>
    ),
}));

// Also mock LoadoutList and TeamLoadoutCard components
vi.mock('../../components/loadout/LoadoutList', () => ({
    LoadoutList: ({
        loadouts,
        onDelete,
        getGearPiece,
        availableGear,
    }: {
        loadouts: Loadout[];
        onDelete: (id: string) => void;
        getGearPiece: (id: string) => GearPiece | undefined;
        availableGear: GearPiece[];
    }) => (
        <div>
            {loadouts.map((loadout) => (
                <div key={loadout.id}>
                    <LoadoutCard
                        name={loadout.name}
                        ship={mockShips.find((s) => s.id === loadout.shipId)!}
                        equipment={loadout.equipment}
                        getGearPiece={getGearPiece}
                        availableGear={availableGear}
                        onDelete={() => onDelete(loadout.id)}
                        onUpdate={() => {}}
                        onEquip={() => {}}
                    />
                </div>
            ))}
        </div>
    ),
}));

describe('LoadoutsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders page title and description', () => {
        render(<LoadoutsPage />);
        expect(screen.getByText('Loadouts')).toBeInTheDocument();
        expect(screen.getByText(/Manage your ship gear loadouts/i)).toBeInTheDocument();
    });

    test('switches between individual and team tabs', () => {
        render(<LoadoutsPage />);

        // Should start with individual loadouts
        expect(screen.getByText('Individual Loadouts')).toBeInTheDocument();
        expect(screen.getByText('Test Loadout')).toBeInTheDocument();

        // Switch to team loadouts
        fireEvent.click(screen.getByText('Team Loadouts'));
        expect(screen.getByText('Test Team')).toBeInTheDocument();
    });

    test('handles individual loadout creation', async () => {
        render(<LoadoutsPage />);

        fireEvent.click(screen.getByRole('button', { name: /new loadout/i }));
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        await waitFor(() => {
            expect(mockAddLoadout).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'New Loadout',
                    shipId: 'ship1',
                    equipment: expect.objectContaining({
                        weapon: 'gear1',
                    }),
                })
            );
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Loadout created successfully'
            );
        });
    });

    test('handles team loadout creation', async () => {
        render(<LoadoutsPage />);

        // Switch to team tab
        fireEvent.click(screen.getByText('Team Loadouts'));

        fireEvent.click(screen.getByRole('button', { name: /new team/i }));
        fireEvent.click(screen.getByRole('button', { name: /create team/i }));

        await waitFor(() => {
            expect(mockAddTeamLoadout).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'New Team',
                    shipLoadouts: expect.arrayContaining([
                        expect.objectContaining({
                            position: 1,
                            shipId: 'ship1',
                        }),
                    ]),
                })
            );
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Team loadout created successfully'
            );
        });
    });

    test('handles form visibility toggling', () => {
        render(<LoadoutsPage />);

        const form = screen.getByText('Create Loadout')?.closest('.max-h-0');
        expect(form).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /new loadout/i }));
        expect(form).not.toHaveClass('max-h-0');

        fireEvent.click(screen.getByRole('button', { name: /hide form/i }));
        expect(form).toHaveClass('max-h-0');
    });

    test('renders individual loadouts with controls', () => {
        render(<LoadoutsPage />);

        expect(screen.getByText('Test Loadout')).toBeInTheDocument();
        expect(screen.getByText('Ship: Test Ship 1')).toBeInTheDocument();
        expect(screen.getByText('Equipment: 2 pieces')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /equip loadout/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete loadout/i })).toBeInTheDocument();
    });

    test('renders team loadouts with controls', () => {
        render(<LoadoutsPage />);

        // Switch to team tab
        fireEvent.click(screen.getByText('Team Loadouts'));

        expect(screen.getByText('Test Team')).toBeInTheDocument();
        expect(screen.getByText('Ships: 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /equip team loadout/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete team loadout/i })).toBeInTheDocument();
    });

    test('handles loadout deletion', async () => {
        render(<LoadoutsPage />);

        fireEvent.click(screen.getByRole('button', { name: /delete loadout/i }));

        await waitFor(() => {
            expect(mockDeleteLoadout).toHaveBeenCalledWith('loadout1');
        });
    });

    test('handles team loadout deletion', async () => {
        render(<LoadoutsPage />);

        fireEvent.click(screen.getByText('Team Loadouts'));
        fireEvent.click(screen.getByRole('button', { name: /delete team loadout/i }));

        await waitFor(() => {
            expect(mockDeleteTeamLoadout).toHaveBeenCalledWith('team1');
        });
    });
});
