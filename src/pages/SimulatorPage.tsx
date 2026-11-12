import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PageLayout } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { Ship } from '../types/ship';
import { Position, ShipPosition } from '../types/encounters';
import { useInventory } from '../contexts/InventoryProvider';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { useSimulatorRuns } from '../hooks/useSimulatorRuns';
import { useStatSweep } from '../hooks/useStatSweep';
import { combatStatsFromShip, shipFinalStats } from '../utils/ship/combatStats';
import { hasAnyOverride, StatOverrides } from '../utils/simulator/statOverrides';
import PlacementBoard, { BoardState, Placement } from '../components/simulator/PlacementBoard';
import StatOverrideModal from '../components/simulator/StatOverrideModal';
import BattlePlayback from '../components/simulator/BattlePlayback';
import DivergencePlayback from '../components/simulator/DivergencePlayback';
import SeedRunControls, { randomSeed } from '../components/simulator/SeedRunControls';
import SeedSetResults from '../components/simulator/SeedSetResults';
import SeedStrip from '../components/simulator/SeedStrip';
import SimulatorVerdict from '../components/simulator/SimulatorVerdict';
import RunComparison from '../components/simulator/RunComparison';
import StatSweepPanel from '../components/simulator/StatSweepPanel';
import { Button } from '../components/ui/Button';
import { Tabs } from '../components/ui/layout/Tabs';
import SquadLeaderPicker from '../components/simulator/SquadLeaderPicker';
import BossEncounterPicker from '../components/simulator/BossEncounterPicker';
import { bossFootprintOfId } from '../constants/bountyBosses';
import {
    loadedBossShipId,
    placementFootprint,
    withoutStrayBossCells,
} from '../utils/simulator/bossBoard';
import { SquadLeaderSelection } from '../utils/combat/preFight';
import {
    SQUAD_LEADER_STORAGE_KEYS,
    readStoredSquadLeaderSelection,
    writeStoredSquadLeaderSelection,
} from '../utils/simulator/squadLeaderSelection';
import SimulatorSetupBar from '../components/simulator/SimulatorSetupBar';
import { bountyPortraitUrl, shipSmallPortraitUrl } from '../components/board/shipPortrait';
import { bountyImageKey } from '../constants/bounties';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import SetupStrip from '../components/simulator/SetupStrip';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { setupChipLabels } from '../utils/simulator/setupSummary';
import {
    DEFAULT_GRID_MODE,
    fitBoardToCells,
    fitNotice,
    gridCells,
    type GridMode,
} from '../utils/simulator/gridMode';
import { SMALL_GRID_POSITIONS } from '../utils/targeting/board';
import { useShipIdResolver } from '../hooks/useShipIdResolver';
import { useShips } from '../contexts/ShipsContext';
import { useShipsData } from '../hooks/useShipsData';
import {
    AUTOSAVE_SETUP_NAME,
    deserializeSetup,
    serializeSetup,
    type DeserializedSetup,
    type SimulatorSetup,
} from '../utils/simulator/simulatorSetup';
import {
    MAX_SAVED_SETUPS,
    readAutosavedSetup,
    readSavedSetups,
    writeAutosavedSetup,
    writeSavedSetups,
} from '../utils/simulator/setupStorage';

type Side = 'player' | 'enemy';

type ResultTab = 'playback' | 'compare' | 'sweep';

type UnsimulatedEntry = { actorId: string; name: string; texts: string[] };

/** One side's list of squad-leader effects the sim could not model this run (conditional /
 *  per-round / modifier-channel effects). */
const UnsimulatedEffectsList: React.FC<{ entries: UnsimulatedEntry[] }> = ({ entries }) => (
    <ul className="text-sm space-y-1">
        {entries.map((entry) => (
            <li key={entry.actorId}>
                <span className="text-theme-text-secondary">{entry.name}: </span>
                <span className="text-amber-400">{entry.texts.join('; ')}</span>
            </li>
        ))}
    </ul>
);

const CLICK_HINT =
    "Click to select a ship, Ctrl+Click to remove a ship, Hover + 1-5 to set attack order, Shift+Click or a ship's cog icon to edit stats";

/** From this width up the whole run bar stays pinned; below it only the summary and Run do. */
const WIDE_QUERY = '(min-width: 640px)';

const SimulatorPage: React.FC = () => {
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const resolveStoredShip = useShipIdResolver();
    // The owned roster and the unit catalogue are the two sources `resolveStoredShip` reads. Both
    // arrive after the first render, so the restore effect below waits on their loading flags and
    // re-runs on their sizes.
    const { loading: shipsLoading, ships: ownedShips } = useShips();
    const { loading: unitsLoading, ships: units } = useShipsData();

    // A playback ship's portrait by its roster name, from the unit catalogue (a result carries no
    // images, and is never re-derived from the live boards).
    const portraitFor = useMemo(() => {
        const keys = new Map(units.map((u) => [u.name.toLowerCase(), u.imageKey]));
        return (name: string) =>
            shipSmallPortraitUrl(keys.get(name.toLowerCase())) ??
            bountyPortraitUrl(bountyImageKey(name));
    }, [units]);

    // Shared combat-stat resolution — see src/utils/ship/combatStats.ts (mirrors DPSCalculatorPage).
    const statsDeps = { getGearPiece, getEngineeringStatsForShipType };

    const [playerBoard, setPlayerBoard] = useState<BoardState>({});
    const [enemyBoard, setEnemyBoard] = useState<BoardState>({});
    // Selected cell per board (the cell a picked ship fills). Independent per side.
    const [playerSelected, setPlayerSelected] = useState<Position | undefined>(undefined);
    const [enemySelected, setEnemySelected] = useState<Position | undefined>(undefined);
    const [seed, setSeed] = useState<number>(() => randomSeed());
    const [runCount, setRunCount] = useState(1);
    // Both sides share one grid; the cells a side can use come from `gridCells(gridMode)`.
    const [gridMode, setGridMode] = useState<GridMode>(DEFAULT_GRID_MODE);
    const [gridNotice, setGridNotice] = useState<string | null>(null);
    // Per-side squad-leader selections (pre-fight faction auras), persisted to
    // localStorage (validated on read — stale/hand-edited values fall back to none).
    const [playerSquadLeader, setPlayerSquadLeader] = useState<SquadLeaderSelection | undefined>(
        () => readStoredSquadLeaderSelection(SQUAD_LEADER_STORAGE_KEYS.player)
    );
    const [enemySquadLeader, setEnemySquadLeader] = useState<SquadLeaderSelection | undefined>(() =>
        readStoredSquadLeaderSelection(SQUAD_LEADER_STORAGE_KEYS.enemy)
    );

    const handleSquadLeaderChange = (side: Side, selection: SquadLeaderSelection | undefined) => {
        (side === 'player' ? setPlayerSquadLeader : setEnemySquadLeader)(selection);
        writeStoredSquadLeaderSelection(SQUAD_LEADER_STORAGE_KEYS[side], selection);
    };

    const [savedSetups, setSavedSetups] = useState<SimulatorSetup[]>(() => readSavedSetups());
    const [loadNotice, setLoadNotice] = useState<string | null>(null);
    // The autosaved setup while it is still waiting to be restored; `undefined` before it has
    // been read, `null` once there is nothing left to restore.
    const pendingRestoreRef = useRef<SimulatorSetup | null | undefined>(undefined);
    // Gates the autosave write: nothing is persisted before the restore has had its first chance.
    const restoreAttemptedRef = useRef(false);
    // Whether the setup last applied to these boards lost cells to ids that did not resolve. Also
    // gates the autosave write — see it for what an unresolved id costs.
    const appliedSetupLostCellsRef = useRef(false);

    // The cell whose stat editor is open, or null when none is. One modal for the whole
    // page, not one per cell — a placement's own overrides are looked up by side + position.
    const [editing, setEditing] = useState<{ side: Side; position: Position } | null>(null);

    // FormationGrid consumes ShipPosition[] (it resolves the full ship by id via useShips).
    const playerFormation = useMemo<ShipPosition[]>(
        () =>
            (Object.entries(playerBoard) as [Position, Placement][]).map(
                ([position, placement]) => ({
                    shipId: placement.ship.id,
                    position,
                })
            ),
        [playerBoard]
    );
    const enemyFormation = useMemo<ShipPosition[]>(
        () =>
            (Object.entries(enemyBoard) as [Position, Placement][]).map(
                ([position, placement]) => ({
                    shipId: placement.ship.id,
                    position,
                })
            ),
        [enemyBoard]
    );

    const boardSetters: Record<
        Side,
        {
            board: BoardState;
            setBoard: React.Dispatch<React.SetStateAction<BoardState>>;
            selected: Position | undefined;
            setSelected: React.Dispatch<React.SetStateAction<Position | undefined>>;
        }
    > = {
        player: {
            board: playerBoard,
            setBoard: setPlayerBoard,
            selected: playerSelected,
            setSelected: setPlayerSelected,
        },
        enemy: {
            board: enemyBoard,
            setBoard: setEnemyBoard,
            selected: enemySelected,
            setSelected: setEnemySelected,
        },
    };

    const editingPlacement = editing
        ? boardSetters[editing.side].board[editing.position]
        : undefined;

    const handleOverridesChange = (next: StatOverrides) => {
        if (!editing) return;
        const { setBoard } = boardSetters[editing.side];
        setBoard((prev) => {
            const placement = prev[editing.position];
            if (!placement) return prev;
            return {
                ...prev,
                [editing.position]: {
                    ship: placement.ship,
                    overrides: hasAnyOverride(next) ? next : undefined,
                },
            };
        });
    };

    // A loaded encounter fills the side's board: its units are fixed, so no cell opens the ship
    // picker and none can be removed alone.
    const handleSelectPosition = (side: Side, position: Position) => {
        if (loadedBossShipId(side === 'player' ? playerBoard : enemyBoard)) return;
        boardSetters[side].setSelected(position);
    };

    const handleRemoveShip = (side: Side, position: Position) => {
        if (loadedBossShipId(side === 'player' ? playerBoard : enemyBoard)) return;
        const { setBoard, selected, setSelected } = boardSetters[side];
        setBoard((prev) => {
            const next = { ...prev };
            delete next[position];
            return next;
        });
        if (selected === position) setSelected(undefined);
    };

    const handlePickShip = (side: Side, ship: Ship) => {
        const { selected, setBoard, setSelected } = boardSetters[side];
        if (!selected) return;
        setBoard((prev) => ({ ...prev, [selected]: { ship } }));
        setSelected(undefined);
    };

    // Replace one side's board with a saved encounter's formation (built in PlacementBoard).
    // Leaves battleResult as-is, matching add/remove — the user re-runs after setting teams.
    const handleLoadEncounter = (side: Side, board: BoardState) => {
        const { setBoard, setSelected } = boardSetters[side];
        setBoard(withoutStrayBossCells(board));
        setSelected(undefined);
    };

    // Copies ships AND their overrides — a near-mirror board is the common setup and rebuilding it
    // by hand is the friction this removes. An un-overridden placement copies to `undefined`, the
    // same "no overrides" representation the override-change handler below writes, so a board
    // never carries the alternate `{}` spelling of the same state.
    const handleCopyBoard = (from: Side) => {
        const source = from === 'player' ? playerBoard : enemyBoard;
        const copy: BoardState = {};
        for (const [position, placement] of Object.entries(source) as [Position, Placement][]) {
            copy[position] = {
                ship: placement.ship,
                overrides: hasAnyOverride(placement.overrides)
                    ? { ...placement.overrides }
                    : undefined,
            };
        }
        (from === 'player' ? setEnemyBoard : setPlayerBoard)(copy);
    };

    const enemyHasBoss = loadedBossShipId(enemyBoard) !== undefined;
    // Whether the user switched the enemy card to boss mode before choosing a boss. The mode
    // itself is derived: a loaded boss always means boss mode, so this never disagrees with the
    // board.
    const [bossModePicked, setBossModePicked] = useState(false);
    const enemyMode: 'team' | 'boss' =
        enemyHasBoss || (bossModePicked && gridMode === 'normal') ? 'boss' : 'team';
    // Edit setup and a load/restore set this; a newly landed result clears it. The setup is
    // collapsed only while a result is displayed and this is false.
    const [editingSetup, setEditingSetup] = useState(false);
    const isWide = useMediaQuery(WIDE_QUERY);
    // A boss board has no squad leader: the picker is hidden and the stored selection neither
    // runs nor saves, but stays in state for when the boss is taken off.
    const activeEnemySquadLeader = enemyHasBoss ? undefined : enemySquadLeader;
    const playerCount = Object.keys(playerBoard).length;
    const enemyCount = Object.keys(enemyBoard).length;

    const {
        battleResult,
        openedSeed,
        completedRuns,
        aggregate,
        baseline,
        divergence,
        handleOpenDivergence,
        handleCloseDivergence,
        runError,
        effectiveSeed,
        effectiveRunCount,
        currentOverrides,
        currentGridMode,
        baselineGridMode,
        canRun,
        buildInput,
        handleRun,
        handleOpenSeed,
        handlePinBaseline,
        handleUnpinBaseline,
        isRunning,
        progress,
        handleCancel,
        handleClearRunState,
    } = useSimulatorRuns({
        playerBoard,
        enemyBoard,
        statsDeps,
        playerSquadLeader,
        enemySquadLeader: activeEnemySquadLeader,
        getGearPiece,
        seed,
        runCount,
        gridMode,
    });

    const hasResult = battleResult !== null || aggregate !== null || divergence !== null;
    const collapsed = hasResult && !editingSetup;

    // Folds the setup when a run lands a result, not when Run is clicked: a rerun that is still
    // going, or was cancelled, leaves the boards open.
    const seenCompletedRuns = useRef(completedRuns);
    useEffect(() => {
        if (completedRuns === seenCompletedRuns.current) return;
        seenCompletedRuns.current = completedRuns;
        setEditingSetup(false);
    }, [completedRuns]);

    // Boss mode with no boss chosen leaves the enemy side as it was, so the hook's own check
    // passes; the run is blocked here instead.
    const bossPending = enemyMode === 'boss' && !enemyHasBoss;

    const handleEnemyModeChange = (mode: string) => {
        if (mode === 'boss') {
            setBossModePicked(true);
            return;
        }
        setBossModePicked(false);
        if (enemyHasBoss) handleLoadEncounter('enemy', {});
    };

    /** The one place a stored setup becomes live state. */
    const applySetup = (result: DeserializedSetup) => {
        setPlayerBoard(withoutStrayBossCells(result.playerBoard));
        setEnemyBoard(withoutStrayBossCells(result.enemyBoard));
        setPlayerSelected(undefined);
        setEnemySelected(undefined);
        setSeed(result.seed);
        setRunCount(result.runCount);
        setGridMode(result.gridMode);
        setGridNotice(null);
        // Leaders route through the change handler: it is what write-throughs to
        // SQUAD_LEADER_STORAGE_KEYS, so the live selection and the stored one cannot diverge.
        handleSquadLeaderChange('player', result.playerSquadLeader);
        // A setup holding a boss saves no enemy leader, so loading it keeps the current one.
        if (loadedBossShipId(result.enemyBoard) === undefined)
            handleSquadLeaderChange('enemy', result.enemySquadLeader);
        // A displayed result describes the boards that produced it and is never re-derived from
        // live state, so replacing the boards has to discard it.
        handleClearRunState();
        setEditingSetup(true);
        setBossModePicked(false);
        appliedSetupLostCellsRef.current = result.dropped.length > 0;
        setLoadNotice(
            result.dropped.length > 0
                ? `${result.dropped.length} ship${result.dropped.length === 1 ? '' : 's'} in this setup could no longer be found and ${result.dropped.length === 1 ? 'was' : 'were'} left out.`
                : null
        );
    };

    // Restore the autosaved setup. The owned roster and the unit catalogue both arrive after the
    // first render, so the stored setup stays pending while it resolves nothing and a later
    // arrival gets another attempt; an id resolved too early is indistinguishable from a deleted
    // ship.
    useEffect(() => {
        if (shipsLoading || unitsLoading) return;
        if (pendingRestoreRef.current === undefined)
            pendingRestoreRef.current = readAutosavedSetup();
        const stored = pendingRestoreRef.current;
        restoreAttemptedRef.current = true;
        if (!stored) return;
        const result = deserializeSetup(stored, resolveStoredShip);
        const placed =
            Object.keys(result.playerBoard).length + Object.keys(result.enemyBoard).length;
        if (placed > 0 || result.dropped.length === 0) pendingRestoreRef.current = null;
        applySetup(result);
        // Keyed on how many ships each source holds, not on the resolver: the resolver is rebuilt
        // every render, so depending on it would re-apply the setup on every render forever.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ownedShips.length, units.length, shipsLoading, unitsLoading]);

    useEffect(() => {
        const timer = setTimeout(() => {
            // Nothing is autosaved before the first restore attempt, and a setup that lost every
            // cell is not written back while the boards are still empty: those ships may simply
            // not have loaded, and persisting the emptiness would destroy them.
            if (!restoreAttemptedRef.current) return;
            if (appliedSetupLostCellsRef.current && playerCount === 0 && enemyCount === 0) return;
            writeAutosavedSetup(
                serializeSetup({
                    name: AUTOSAVE_SETUP_NAME,
                    playerBoard,
                    enemyBoard,
                    playerSquadLeader,
                    enemySquadLeader: activeEnemySquadLeader,
                    seed,
                    runCount,
                    gridMode,
                    savedAt: Date.now(),
                })
            );
        }, 250);
        return () => clearTimeout(timer);
    }, [
        playerBoard,
        enemyBoard,
        playerSquadLeader,
        activeEnemySquadLeader,
        seed,
        runCount,
        gridMode,
        playerCount,
        enemyCount,
    ]);

    // The one place the small grid is enforced: whatever wrote the boards (a toggle, a loaded
    // setup or encounter, a copy), a ship off the grid moves to a free cell, or is left out once
    // the grid is full.
    useEffect(() => {
        if (gridMode !== 'small') return;
        const cells = gridCells(gridMode);
        const player = fitBoardToCells(playerBoard, cells, placementFootprint);
        const enemy = fitBoardToCells(enemyBoard, cells, placementFootprint);
        if (player.board === playerBoard && enemy.board === enemyBoard) return;
        if (player.board !== playerBoard) setPlayerBoard(player.board);
        if (enemy.board !== enemyBoard) setEnemyBoard(enemy.board);
        setGridNotice(fitNotice(player.moved + enemy.moved, player.dropped + enemy.dropped));
    }, [gridMode, playerBoard, enemyBoard]);

    const handleGridModeChange = (value: string) => {
        const mode: GridMode = value === 'small' ? 'small' : 'normal';
        if (mode === gridMode) return;
        // Switching never removes ships: a team too big for the small grid stays on the normal
        // board until some are taken off.
        if (mode === 'small' && Math.max(playerCount, enemyCount) > SMALL_GRID_POSITIONS.length) {
            setGridNotice(
                `The small grid holds ${SMALL_GRID_POSITIONS.length} ships per team. Remove some first.`
            );
            return;
        }
        setGridNotice(null);
        setPlayerSelected(undefined);
        setEnemySelected(undefined);
        setGridMode(mode);
    };

    const handleSaveSetup = (name: string) => {
        const setup = serializeSetup({
            name,
            playerBoard,
            enemyBoard,
            playerSquadLeader,
            enemySquadLeader: activeEnemySquadLeader,
            seed,
            runCount,
            gridMode,
            savedAt: Date.now(),
        });
        // Name-keyed: saving under an existing name replaces that entry rather than growing the
        // list a copy at a time.
        const next = [...savedSetups.filter((entry) => entry.name !== name), setup].slice(
            -MAX_SAVED_SETUPS
        );
        setSavedSetups(next);
        writeSavedSetups(next);
    };

    const handleLoadSetup = (name: string) => {
        const stored = savedSetups.find((entry) => entry.name === name);
        if (!stored) return;
        // A named load is the user's choice and supersedes an autosave still waiting to restore.
        pendingRestoreRef.current = null;
        applySetup(deserializeSetup(stored, resolveStoredShip));
    };

    const handleDeleteSetup = (name: string) => {
        const next = savedSetups.filter((entry) => entry.name !== name);
        setSavedSetups(next);
        writeSavedSetups(next);
    };

    // A sweep owns its own state, abort controller and seed set. It deliberately writes none of
    // the run state above, and ignores any pinned baseline: its reference is its own
    // resolved-value step.
    const sweep = useStatSweep({ buildInput, getGearPiece });

    const [activeTab, setActiveTab] = useState<ResultTab>('playback');

    const seedRunProps = {
        seed: effectiveSeed,
        runCount: effectiveRunCount,
        onSeedChange: setSeed,
        onRunCountChange: setRunCount,
        onRun: handleRun,
        canRun: canRun && !bossPending && !sweep.isSweeping,
        locked: baseline !== null,
        lockedReason: 'Seed and run count are fixed by the pinned baseline. Unpin to change them.',
        onUnpin: handleUnpinBaseline,
        isRunning,
        progress,
        onCancel: handleCancel,
    };

    const pinButton =
        aggregate && !baseline ? (
            <Button variant="secondary" onClick={handlePinBaseline} disabled={isRunning}>
                Pin as baseline
            </Button>
        ) : null;

    const leaderNames = [playerSquadLeader?.name, activeEnemySquadLeader?.name].filter(Boolean);
    const runSummary = [
        `${playerCount} vs ${enemyHasBoss ? 'Boss' : enemyCount}`,
        gridMode === 'small' ? 'Small grid' : 'Normal grid',
        leaderNames.length > 0 ? `Leaders: ${leaderNames.join(', ')}` : 'no squad leaders',
    ].join(' · ');
    const lastRunText = aggregate
        ? `Last run: ${aggregate.wins.player} / ${aggregate.count} wins`
        : battleResult
          ? `Last run: ${battleResult.outcome.winner === 'player' ? 'win' : 'loss'}`
          : null;

    const handleOpenDivergenceFromCompare = (openSeed: number) => {
        handleOpenDivergence(openSeed);
        setActiveTab('playback');
    };

    const unsimulatedBlock = (() => {
        const sections: { label: string; entries: UnsimulatedEntry[] }[] = divergence
            ? [
                  {
                      label: 'Baseline: squad leader effects not simulated this run',
                      entries: divergence.baseline.preFight?.unsimulated ?? [],
                  },
                  {
                      label: 'Current: squad leader effects not simulated this run',
                      entries: divergence.current.preFight?.unsimulated ?? [],
                  },
              ]
            : [
                  {
                      label: 'Squad leader effects not simulated this run',
                      entries: battleResult?.preFight?.unsimulated ?? [],
                  },
              ];
        return sections.filter((section) => section.entries.length > 0);
    })();

    return (
        <>
            <Seo {...SEO_CONFIG.simulator} />
            <PageLayout
                title="Combat Simulator"
                description="Place your team and an enemy team on the boards, then run a full battle simulation using geared stats."
                actionNode={
                    <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 bg-amber-500/10">
                        Experimental
                    </span>
                }
            >
                <div className="space-y-6">
                    {collapsed ? (
                        <SetupStrip
                            playerLabels={setupChipLabels(playerBoard)}
                            enemyLabels={setupChipLabels(enemyBoard)}
                            onEdit={() => setEditingSetup(true)}
                        />
                    ) : (
                        <SimulatorSetupBar
                            saved={savedSetups}
                            onSave={handleSaveSetup}
                            onLoad={handleLoadSetup}
                            onDelete={handleDeleteSetup}
                            canSave={playerCount > 0 || enemyCount > 0}
                            canLoad={!shipsLoading && !unitsLoading}
                            trailing={
                                <SegmentedControl
                                    label="Board"
                                    value={gridMode}
                                    onChange={handleGridModeChange}
                                    options={[
                                        { value: 'normal', label: 'Normal · 12' },
                                        { value: 'small', label: 'Small · 7' },
                                    ]}
                                    helpText="The small grid is the middle cell and the six around it, for both teams."
                                />
                            }
                        />
                    )}
                    <div aria-live="polite" className="space-y-1">
                        {loadNotice && <p className="text-sm text-amber-400">{loadNotice}</p>}
                        {gridNotice && <p className="text-sm text-amber-400">{gridNotice}</p>}
                    </div>
                    {!collapsed && (
                        <>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <PlacementBoard
                                    title={`Your Team${playerCount > 0 ? ` (${playerCount})` : ''}`}
                                    formation={playerFormation}
                                    selectedPosition={playerSelected}
                                    onSelectPosition={(pos) => handleSelectPosition('player', pos)}
                                    onRemoveShip={(pos) => handleRemoveShip('player', pos)}
                                    onPickShip={(ship) => handlePickShip('player', ship)}
                                    onCloseSelector={() => setPlayerSelected(undefined)}
                                    resolveShip={(pos) => playerBoard[pos]?.ship ?? null}
                                    cells={gridCells(gridMode)}
                                    footprintOf={bossFootprintOfId}
                                    onLoadEncounter={(board) =>
                                        handleLoadEncounter('player', board)
                                    }
                                    onCopyToOtherSide={() => handleCopyBoard('player')}
                                    copyLabel="Copy to enemy"
                                    onEditStats={(pos) =>
                                        setEditing({ side: 'player', position: pos })
                                    }
                                    hasOverrides={(pos) =>
                                        hasAnyOverride(playerBoard[pos]?.overrides)
                                    }
                                    hideHint
                                    footerSlot={
                                        <SquadLeaderPicker
                                            side="player"
                                            selection={playerSquadLeader}
                                            onChange={(sel) =>
                                                handleSquadLeaderChange('player', sel)
                                            }
                                            board={playerBoard}
                                        />
                                    }
                                />
                                <PlacementBoard
                                    title={`Enemy Team${enemyCount > 0 ? ` (${enemyCount})` : ''}`}
                                    formation={enemyFormation}
                                    selectedPosition={enemySelected}
                                    onSelectPosition={(pos) => handleSelectPosition('enemy', pos)}
                                    onRemoveShip={(pos) => handleRemoveShip('enemy', pos)}
                                    onPickShip={(ship) => handlePickShip('enemy', ship)}
                                    onCloseSelector={() => setEnemySelected(undefined)}
                                    resolveShip={(pos) => enemyBoard[pos]?.ship ?? null}
                                    cells={gridCells(gridMode)}
                                    onLoadEncounter={(board) => handleLoadEncounter('enemy', board)}
                                    hideEncounterControls={enemyMode === 'boss'}
                                    onCopyToOtherSide={
                                        enemyHasBoss ? undefined : () => handleCopyBoard('enemy')
                                    }
                                    footprintOf={bossFootprintOfId}
                                    headerSlot={
                                        <div className="space-y-3">
                                            <SegmentedControl
                                                label="Enemy"
                                                size="sm"
                                                value={enemyMode}
                                                onChange={handleEnemyModeChange}
                                                options={[
                                                    { value: 'team', label: 'Team' },
                                                    {
                                                        value: 'boss',
                                                        label: 'Bounty boss',
                                                        disabled: gridMode === 'small',
                                                        title:
                                                            gridMode === 'small'
                                                                ? 'Fight a bounty boss instead of a team. Needs the normal board.'
                                                                : undefined,
                                                    },
                                                ]}
                                            />
                                            {gridMode === 'small' && (
                                                <p className="text-xs text-theme-text-secondary">
                                                    Bounty bosses need the normal board.
                                                </p>
                                            )}
                                            {enemyMode === 'boss' && (
                                                <BossEncounterPicker
                                                    board={enemyBoard}
                                                    onChange={(board) =>
                                                        handleLoadEncounter('enemy', board)
                                                    }
                                                    disabled={gridMode === 'small'}
                                                    helpLabel="Fight a bounty boss instead of a team. Needs the normal board."
                                                />
                                            )}
                                        </div>
                                    }
                                    copyLabel="Copy to your team"
                                    mirrored
                                    onEditStats={(pos) =>
                                        setEditing({ side: 'enemy', position: pos })
                                    }
                                    hasOverrides={(pos) =>
                                        hasAnyOverride(enemyBoard[pos]?.overrides)
                                    }
                                    hideHint
                                    footerSlot={
                                        enemyHasBoss ? (
                                            <p className="text-sm text-theme-text-secondary">
                                                Bounty bosses have no squad leader.
                                            </p>
                                        ) : (
                                            <SquadLeaderPicker
                                                side="enemy"
                                                selection={enemySquadLeader}
                                                onChange={(sel) =>
                                                    handleSquadLeaderChange('enemy', sel)
                                                }
                                                board={enemyBoard}
                                            />
                                        )
                                    }
                                />
                            </div>
                            <p className="text-xs text-theme-text-secondary">{CLICK_HINT}</p>
                        </>
                    )}

                    {runError && (
                        <div className="card text-red-400">Simulation error: {runError}</div>
                    )}

                    {(aggregate || battleResult) &&
                        (aggregate ? (
                            <SeedSetResults aggregate={aggregate} />
                        ) : (
                            <SimulatorVerdict result={battleResult} />
                        ))}

                    {/* Squad-leader effects the sim could not model, surfaced so the outcome is
                        never mistaken for a full simulation of the selected leaders. A divergence
                        pair can carry a DIFFERENT selection per side (the baseline may have been
                        pinned under a different squad leader than the current run), so each side
                        keeps its own labelled list inside the one block. */}
                    {unsimulatedBlock.length > 0 && (
                        <div className="card border-amber-500/40 space-y-3">
                            {unsimulatedBlock.map((section) => (
                                <div key={section.label} className="space-y-1">
                                    <p className="text-sm font-semibold text-amber-400">
                                        {section.label}
                                    </p>
                                    <UnsimulatedEffectsList entries={section.entries} />
                                </div>
                            ))}
                        </div>
                    )}

                    {!isWide && (
                        <div className="card">
                            <SeedRunControls {...seedRunProps} showAction={false}>
                                {pinButton}
                            </SeedRunControls>
                        </div>
                    )}

                    <div>
                        <Tabs
                            tabs={[
                                { id: 'playback', label: 'Playback' },
                                {
                                    id: 'compare',
                                    label: 'Compare to baseline',
                                    badge: baseline ? undefined : 'pin one first',
                                },
                                { id: 'sweep', label: 'Stat sweep' },
                            ]}
                            activeTab={activeTab}
                            onChange={(tab) => setActiveTab(tab as ResultTab)}
                        />

                        {activeTab === 'playback' && (
                            <div className="space-y-4">
                                {aggregate && (
                                    <SeedStrip
                                        runs={aggregate.runs}
                                        openedSeed={divergence?.seed ?? openedSeed}
                                        onOpenSeed={handleOpenSeed}
                                    />
                                )}
                                {divergence ? (
                                    <DivergencePlayback
                                        seed={divergence.seed}
                                        baseline={divergence.baseline}
                                        current={divergence.current}
                                        onClose={handleCloseDivergence}
                                        portraitFor={portraitFor}
                                        baselineCells={gridCells(baselineGridMode)}
                                        currentCells={gridCells(currentGridMode)}
                                    />
                                ) : battleResult ? (
                                    <BattlePlayback
                                        result={battleResult}
                                        portraitFor={portraitFor}
                                        cells={gridCells(currentGridMode)}
                                    />
                                ) : (
                                    <p className="text-sm text-theme-text-secondary">
                                        {aggregate
                                            ? 'Pick a seed above to watch that fight.'
                                            : 'Run a simulation to watch the fight here.'}
                                    </p>
                                )}
                            </div>
                        )}

                        {activeTab === 'compare' &&
                            (baseline && aggregate && currentOverrides ? (
                                <RunComparison
                                    baseline={baseline}
                                    current={aggregate}
                                    currentOverrides={currentOverrides}
                                    onOpenDivergence={handleOpenDivergenceFromCompare}
                                />
                            ) : (
                                <p className="text-sm text-theme-text-secondary">
                                    Run several seeds, then use Pin as baseline in the run controls
                                    to compare later runs against it.
                                </p>
                            ))}

                        {/* Stays mounted while another tab shows: its inputs are local state a
                            tab switch must not reset. */}
                        <div hidden={activeTab !== 'sweep'}>
                            <StatSweepPanel
                                playerBoard={playerBoard}
                                enemyBoard={enemyBoard}
                                statsDeps={statsDeps}
                                seed={effectiveSeed}
                                points={sweep.points}
                                provenance={sweep.provenance}
                                isSweeping={sweep.isSweeping}
                                progress={sweep.progress}
                                error={sweep.error}
                                onRunSweep={sweep.runSweep}
                                onCancelSweep={sweep.cancelSweep}
                                disabled={isRunning}
                                alwaysOpen
                            />
                        </div>
                    </div>

                    {/* Right padding clears the app's fixed bottom-right widget stack (App.tsx). */}
                    <div
                        data-testid="run-bar"
                        className="sticky bottom-0 z-30 bg-dark border-t border-dark-border shadow-[0_-4px_12px_rgba(0,0,0,0.4)] pl-4 pr-24 py-3"
                    >
                        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                            <div className="text-sm space-y-0.5">
                                <p>{runSummary}</p>
                                {lastRunText && (
                                    <p className="text-theme-text-secondary">{lastRunText}</p>
                                )}
                                {!canRun ? (
                                    <p className="text-theme-text-secondary">
                                        Place at least one ship on each team to run.
                                    </p>
                                ) : (
                                    bossPending && (
                                        <p className="text-theme-text-secondary">
                                            Pick a bounty boss to run.
                                        </p>
                                    )
                                )}
                            </div>
                            <SeedRunControls {...seedRunProps} showInputs={isWide}>
                                {pinButton}
                            </SeedRunControls>
                        </div>
                    </div>
                </div>

                {editing && editingPlacement && (
                    <StatOverrideModal
                        isOpen
                        onClose={() => setEditing(null)}
                        shipName={editingPlacement.ship.name}
                        position={editing.position}
                        base={combatStatsFromShip(shipFinalStats(editingPlacement.ship, statsDeps))}
                        overrides={editingPlacement.overrides}
                        onChange={handleOverridesChange}
                    />
                )}
            </PageLayout>
        </>
    );
};

export default SimulatorPage;
