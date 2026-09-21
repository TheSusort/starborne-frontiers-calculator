import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationProvider } from '../../../contexts/NotificationProvider';
import AutogearPage from '../AutogearPage';
import type { Ship } from '../../../types/ship';

// Sidebar pulls in a favicon asset Vitest cannot resolve — same workaround as
// AutogearTeamsModal.test.tsx.
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../components/seo/Seo', () => ({ default: () => null }));

// Fixtures and the `run` spy, hoisted above the `vi.mock` factories that close over them.
const H = vi.hoisted(() => {
    const OLD_GEAR = 'gear-old-weapon';
    const NEW_GEAR = 'gear-new-weapon';
    const SHIP_ID = 'focus-ship';

    const makeShip = (weaponGearId: string): Ship => ({
        id: SHIP_ID,
        name: 'Focus',
        rarity: 'legendary',
        faction: 'Alliance',
        type: 'ATTACKER',
        baseStats: {
            hp: 1000,
            attack: 100,
            defence: 100,
            hacking: 50,
            security: 50,
            crit: 50,
            critDamage: 150,
            speed: 100,
        },
        equipment: { weapon: weaponGearId },
        implants: {},
        refits: [],
    });

    const runMock = vi.fn();

    const metricKeys = [
        'winRate',
        'rounds',
        'focusDamageDealt',
        'focusDamageTaken',
        'focusHealingDone',
        'teamDamageDealt',
    ] as const;

    const candidateRow = {
        id: 'DEFENDER:best',
        cells: Object.fromEntries(
            metricKeys.map((metric) => [
                metric,
                { metric, mean: 10, se: 1, n: 20, distinguishable: true },
            ])
        ),
    };

    const candidateSimRow = {
        id: 'DEFENDER:best',
        role: 'DEFENDER' as const,
        rank: 'best' as const,
        run: {} as unknown,
        loadout: [{ slotName: 'weapon', gearId: NEW_GEAR, score: 1 }],
    };

    return { OLD_GEAR, NEW_GEAR, SHIP_ID, makeShip, runMock, candidateRow, candidateSimRow };
});

// A reactive stand-in for ShipsContext: `equipMultipleGear` mutates local component state so the
// page re-renders with a new `ships` array, exactly like the real Supabase/localStorage-backed
// context does after a write resolves.
vi.mock('../../../contexts/ShipsContext', async () => {
    const React = await import('react');
    const emptyGearToShipMap = new Map<string, string>();
    const staticFns = {
        lockEquipment: vi.fn(),
        updateShip: vi.fn(async () => {}),
        toggleStarred: vi.fn(),
    };
    return {
        useShips: () => {
            const [ships, setShips] = React.useState<Ship[]>([H.makeShip(H.OLD_GEAR)]);

            // Stable across renders (deps on `ships` only) — an identity that changes every
            // render would re-trigger every effect keyed on `getShipById`.
            const getShipById = React.useCallback(
                (id: string) => ships.find((s) => s.id === id),
                [ships]
            );

            const equipMultipleGear = React.useCallback(
                async (shipId: string, assignments: { slot: string; gearId: string }[]) => {
                    setShips((prev) =>
                        prev.map((s) =>
                            s.id === shipId
                                ? {
                                      ...s,
                                      equipment: {
                                          ...s.equipment,
                                          ...Object.fromEntries(
                                              assignments.map((a) => [a.slot, a.gearId])
                                          ),
                                      },
                                  }
                                : s
                        )
                    );
                },
                []
            );

            return {
                getShipById,
                equipMultipleGear,
                gearToShipMap: emptyGearToShipMap,
                ships,
                ...staticFns,
            };
        },
    };
});

// Each factory below defines its stable identities INSIDE itself (not as outer `const`s the
// factory would close over): `vi.mock` factories run during import resolution, before this
// file's own top-level statements — other than a `vi.hoisted` block — have executed.
vi.mock('../../../contexts/InventoryProvider', () => {
    const getGearPiece = () => undefined;
    return { useInventory: () => ({ getGearPiece, inventory: [] }) };
});

vi.mock('../../../contexts/AutogearConfigContext', () => {
    const getConfig = () => null;
    return {
        useAutogearConfig: () => ({
            getConfig,
            saveConfig: vi.fn(),
            resetConfig: vi.fn(),
        }),
    };
});

vi.mock('../../../hooks/useEngineeringStats', () => {
    const getEngineeringStatsForShipType = () => undefined;
    return {
        useEngineeringStats: () => ({ getEngineeringStatsForShipType }),
    };
});

vi.mock('../../../hooks/useAutogearTeams', () => ({
    useAutogearTeams: () => ({
        teams: [],
        saveTeam: vi.fn(),
        updateTeamOrder: vi.fn(),
        deleteTeam: vi.fn(),
    }),
}));

vi.mock('../../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: 'profile-1' }),
}));

vi.mock('../../../contexts/TutorialContext', () => ({
    useTutorial: () => ({
        startGroup: vi.fn(),
        startTour: vi.fn(),
        isTutorialActive: false,
        hasCompletedGroup: () => true,
    }),
}));

vi.mock('../../../hooks/useGearUpgrades', () => ({
    useGearUpgrades: () => ({
        getUpgradedGearPiece: vi.fn(),
        upgrades: {},
        simulateUpgrades: vi.fn(),
    }),
}));

vi.mock('../../../services/arenaModifierService', () => ({
    getActiveSeason: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({
        encounters: [],
        loading: false,
        addEncounter: vi.fn(),
        updateEncounter: vi.fn(),
        deleteEncounter: vi.fn(),
    }),
}));

vi.mock('../../../utils/simulator/setupStorage', () => ({
    readSavedSetups: () => [],
}));

vi.mock('../../../components/autogear/CommunityRecommendations', () => ({
    CommunityRecommendations: () => null,
}));

vi.mock('../../../components/ship/ShipSelector', () => ({
    ShipSelector: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// A controlled stand-in for the candidate-comparison hook: `run` records its args (so a test can
// read what `focus` it was called with) and flips the section into a 'done' state carrying one
// fixed candidate row, mirroring what a real completed comparison would hand the table.
vi.mock('../../../hooks/useSimRerank', async () => {
    const React = await import('react');
    return {
        useSimRerank: () => {
            const [done, setDone] = React.useState(false);
            const run = async (args: unknown) => {
                H.runMock(args);
                setDone(true);
            };
            // Stable across renders, matching the real hook's own `useCallback` — the section's
            // context-invalidation effect depends on this identity, and a fresh function every
            // render would fire that effect (and wipe `done`) on every unrelated re-render.
            const reset = React.useCallback(() => setDone(false), []);
            return {
                state: done
                    ? {
                          status: 'done',
                          progress: { completed: 1, total: 1 },
                          rows: [H.candidateSimRow],
                          table: [H.candidateRow],
                          excluded: [],
                          ownBestExcluded: false,
                          dropped: [],
                      }
                    : {
                          status: 'idle',
                          progress: { completed: 0, total: 0 },
                          rows: [],
                          table: [],
                          excluded: [],
                          ownBestExcluded: false,
                          dropped: [],
                      },
                run,
                cancel: vi.fn(),
                reset,
            };
        },
    };
});

// Renders the real SimRerankSection directly, skipping the (large, unrelated) settings form the
// real AutogearSettingsModal also renders — this test's wiring is entirely inside
// `simRerank`/`selectedShip`, which this preserves exactly.
vi.mock('../../../components/autogear/AutogearSettingsModal', async () => {
    const { SimRerankSection } = await import('../../../components/autogear/SimRerankSection');
    return {
        AutogearSettingsModal: (props: {
            isOpen: boolean;
            selectedShip: Ship | null;
            simRerank?: Record<string, unknown>;
        }) =>
            props.isOpen && props.selectedShip && props.simRerank ? (
                <SimRerankSection
                    ship={props.selectedShip}
                    {...(props.simRerank as unknown as Omit<
                        React.ComponentProps<typeof SimRerankSection>,
                        'ship'
                    >)}
                />
            ) : null,
    };
});

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={[`/autogear?shipId=${H.SHIP_ID}`]}>
            <NotificationProvider>
                <AutogearPage />
            </NotificationProvider>
        </MemoryRouter>
    );

describe('AutogearPage sim-rerank Apply refreshes the Settings-modal ship', () => {
    beforeEach(() => {
        H.runMock.mockClear();
    });

    it("a Run after Apply reads the ship's new equipment, not the pre-Apply build", async () => {
        const { container } = renderPage();

        const settingsButton = container.querySelector(
            '[data-tutorial="autogear-settings-button"]'
        ) as HTMLElement;
        expect(settingsButton).toBeTruthy();
        fireEvent.click(settingsButton);

        fireEvent.click(await screen.findByText('Simulate candidates'));

        // First Run: the focus passed in is the pre-Apply ship.
        fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
        await waitFor(() => expect(H.runMock).toHaveBeenCalledTimes(1));
        expect((H.runMock.mock.calls[0][0] as { focus: Ship }).focus.equipment.weapon).toBe(
            H.OLD_GEAR
        );

        // Apply the candidate row — this equips its loadout (the new weapon) onto the ship.
        const applyButton = await screen.findByRole('button', { name: 'Apply' });
        await act(async () => {
            fireEvent.click(applyButton);
            await Promise.resolve();
        });

        // Run again: the focus/baseline this second call reads must reflect the equipment Apply
        // just wrote, not the stale build from before Apply.
        fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
        await waitFor(() => expect(H.runMock).toHaveBeenCalledTimes(2));
        expect((H.runMock.mock.calls[1][0] as { focus: Ship }).focus.equipment.weapon).toBe(
            H.NEW_GEAR
        );
    });
});
