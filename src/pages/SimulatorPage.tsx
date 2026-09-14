import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PageLayout } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { Ship } from '../types/ship';
import { Position, ShipPosition } from '../types/encounters';
import { useInventory } from '../contexts/InventoryProvider';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { useSimulatorRuns } from '../hooks/useSimulatorRuns';
import { combatStatsFromShip, shipFinalStats } from '../utils/ship/combatStats';
import { hasAnyOverride, StatOverrides } from '../utils/simulator/statOverrides';
import PlacementBoard, { BoardState, Placement } from '../components/simulator/PlacementBoard';
import StatOverrideModal from '../components/simulator/StatOverrideModal';
import BattlePlayback from '../components/simulator/BattlePlayback';
import DivergencePlayback from '../components/simulator/DivergencePlayback';
import SeedRunControls, { randomSeed } from '../components/simulator/SeedRunControls';
import SeedSetResults from '../components/simulator/SeedSetResults';
import RunComparison from '../components/simulator/RunComparison';
import { Button } from '../components/ui/Button';
import SquadLeaderPicker from '../components/simulator/SquadLeaderPicker';
import { SquadLeaderSelection } from '../utils/combat/preFight';
import {
    SQUAD_LEADER_STORAGE_KEYS,
    readStoredSquadLeaderSelection,
    writeStoredSquadLeaderSelection,
} from '../utils/simulator/squadLeaderSelection';
import SimulatorSetupBar from '../components/simulator/SimulatorSetupBar';
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

const SimulatorPage: React.FC = () => {
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const resolveStoredShip = useShipIdResolver();
    // The owned roster and the unit catalogue are the two sources `resolveStoredShip` reads. Both
    // arrive after the first render, so the restore effect below waits on their loading flags and
    // re-runs on their sizes.
    const { loading: shipsLoading, ships: ownedShips } = useShips();
    const { loading: unitsLoading, ships: units } = useShipsData();

    // Shared combat-stat resolution — see src/utils/ship/combatStats.ts (mirrors DPSCalculatorPage).
    const statsDeps = { getGearPiece, getEngineeringStatsForShipType };

    const [playerBoard, setPlayerBoard] = useState<BoardState>({});
    const [enemyBoard, setEnemyBoard] = useState<BoardState>({});
    // Selected cell per board (the cell a picked ship fills). Independent per side.
    const [playerSelected, setPlayerSelected] = useState<Position | undefined>(undefined);
    const [enemySelected, setEnemySelected] = useState<Position | undefined>(undefined);
    const [seed, setSeed] = useState<number>(() => randomSeed());
    const [runCount, setRunCount] = useState(1);
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

    const handleSelectPosition = (side: Side, position: Position) => {
        boardSetters[side].setSelected(position);
    };

    const handleRemoveShip = (side: Side, position: Position) => {
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
        setBoard(board);
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

    const playerCount = Object.keys(playerBoard).length;
    const enemyCount = Object.keys(enemyBoard).length;

    const {
        battleResult,
        aggregate,
        baseline,
        divergence,
        handleOpenDivergence,
        handleCloseDivergence,
        runError,
        effectiveSeed,
        effectiveRunCount,
        currentOverrides,
        canRun,
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
        enemySquadLeader,
        getGearPiece,
        seed,
        runCount,
    });

    /** The one place a stored setup becomes live state. */
    const applySetup = (result: DeserializedSetup) => {
        setPlayerBoard(result.playerBoard);
        setEnemyBoard(result.enemyBoard);
        setPlayerSelected(undefined);
        setEnemySelected(undefined);
        setSeed(result.seed);
        setRunCount(result.runCount);
        // Leaders route through the change handler: it is what write-throughs to
        // SQUAD_LEADER_STORAGE_KEYS, so the live selection and the stored one cannot diverge.
        handleSquadLeaderChange('player', result.playerSquadLeader);
        handleSquadLeaderChange('enemy', result.enemySquadLeader);
        // A displayed result describes the boards that produced it and is never re-derived from
        // live state, so replacing the boards has to discard it.
        handleClearRunState();
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
                    enemySquadLeader,
                    seed,
                    runCount,
                    savedAt: Date.now(),
                })
            );
        }, 250);
        return () => clearTimeout(timer);
    }, [
        playerBoard,
        enemyBoard,
        playerSquadLeader,
        enemySquadLeader,
        seed,
        runCount,
        playerCount,
        enemyCount,
    ]);

    const handleSaveSetup = (name: string) => {
        const setup = serializeSetup({
            name,
            playerBoard,
            enemyBoard,
            playerSquadLeader,
            enemySquadLeader,
            seed,
            runCount,
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
                    <SimulatorSetupBar
                        saved={savedSetups}
                        onSave={handleSaveSetup}
                        onLoad={handleLoadSetup}
                        onDelete={handleDeleteSetup}
                        canSave={playerCount > 0 || enemyCount > 0}
                    />
                    <div aria-live="polite">
                        {loadNotice && <p className="text-sm text-amber-400">{loadNotice}</p>}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <PlacementBoard
                                title={`Your Team${playerCount > 0 ? ` (${playerCount})` : ''}`}
                                formation={playerFormation}
                                selectedPosition={playerSelected}
                                onSelectPosition={(pos) => handleSelectPosition('player', pos)}
                                onRemoveShip={(pos) => handleRemoveShip('player', pos)}
                                onPickShip={(ship) => handlePickShip('player', ship)}
                                onCloseSelector={() => setPlayerSelected(undefined)}
                                resolveShip={(pos) => playerBoard[pos]?.ship ?? null}
                                onLoadEncounter={(board) => handleLoadEncounter('player', board)}
                                onCopyToOtherSide={() => handleCopyBoard('player')}
                                copyLabel="Copy to enemy"
                                onEditStats={(pos) => setEditing({ side: 'player', position: pos })}
                                hasOverrides={(pos) => hasAnyOverride(playerBoard[pos]?.overrides)}
                            />
                            <SquadLeaderPicker
                                side="player"
                                selection={playerSquadLeader}
                                onChange={(sel) => handleSquadLeaderChange('player', sel)}
                                board={playerBoard}
                            />
                        </div>
                        <div className="space-y-4">
                            <PlacementBoard
                                title={`Enemy Team${enemyCount > 0 ? ` (${enemyCount})` : ''}`}
                                formation={enemyFormation}
                                selectedPosition={enemySelected}
                                onSelectPosition={(pos) => handleSelectPosition('enemy', pos)}
                                onRemoveShip={(pos) => handleRemoveShip('enemy', pos)}
                                onPickShip={(ship) => handlePickShip('enemy', ship)}
                                onCloseSelector={() => setEnemySelected(undefined)}
                                resolveShip={(pos) => enemyBoard[pos]?.ship ?? null}
                                onLoadEncounter={(board) => handleLoadEncounter('enemy', board)}
                                onCopyToOtherSide={() => handleCopyBoard('enemy')}
                                copyLabel="Copy to your team"
                                mirrored
                                onEditStats={(pos) => setEditing({ side: 'enemy', position: pos })}
                                hasOverrides={(pos) => hasAnyOverride(enemyBoard[pos]?.overrides)}
                            />
                            <SquadLeaderPicker
                                side="enemy"
                                selection={enemySquadLeader}
                                onChange={(sel) => handleSquadLeaderChange('enemy', sel)}
                                board={enemyBoard}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <SeedRunControls
                            seed={effectiveSeed}
                            runCount={effectiveRunCount}
                            onSeedChange={setSeed}
                            onRunCountChange={setRunCount}
                            onRun={handleRun}
                            canRun={canRun}
                            locked={baseline !== null}
                            lockedReason="Seed and run count are fixed by the pinned baseline. Unpin to change them."
                            onUnpin={handleUnpinBaseline}
                            isRunning={isRunning}
                            progress={progress}
                            onCancel={handleCancel}
                        />
                        {!canRun && (
                            <span className="text-sm text-theme-text-secondary">
                                Place at least one ship on each team to run.
                            </span>
                        )}
                    </div>

                    {runError && (
                        <div className="card text-red-400">Simulation error: {runError}</div>
                    )}

                    {/* Squad-leader effects the sim could not model, surfaced so the outcome is
                        never mistaken for a full simulation of the selected leaders. A divergence
                        pair can carry a DIFFERENT selection per side (the baseline may have been
                        pinned under a different squad leader than the current run), so each side
                        gets its own labelled list rather than one merged list. */}
                    {divergence ? (
                        <>
                            {(divergence.baseline.preFight?.unsimulated.length ?? 0) > 0 && (
                                <div className="card border-amber-500/40 space-y-1">
                                    <p className="text-sm font-semibold text-amber-400">
                                        Baseline: squad leader effects not simulated this run
                                    </p>
                                    <UnsimulatedEffectsList
                                        entries={divergence.baseline.preFight!.unsimulated}
                                    />
                                </div>
                            )}
                            {(divergence.current.preFight?.unsimulated.length ?? 0) > 0 && (
                                <div className="card border-amber-500/40 space-y-1">
                                    <p className="text-sm font-semibold text-amber-400">
                                        Current: squad leader effects not simulated this run
                                    </p>
                                    <UnsimulatedEffectsList
                                        entries={divergence.current.preFight!.unsimulated}
                                    />
                                </div>
                            )}
                        </>
                    ) : (
                        battleResult?.preFight &&
                        battleResult.preFight.unsimulated.length > 0 && (
                            <div className="card border-amber-500/40 space-y-1">
                                <p className="text-sm font-semibold text-amber-400">
                                    Squad leader effects not simulated this run
                                </p>
                                <UnsimulatedEffectsList
                                    entries={battleResult.preFight.unsimulated}
                                />
                            </div>
                        )
                    )}

                    {aggregate && (
                        <div className="space-y-2">
                            <SeedSetResults aggregate={aggregate} onOpenSeed={handleOpenSeed} />
                            {!baseline && (
                                <Button
                                    variant="secondary"
                                    onClick={handlePinBaseline}
                                    disabled={isRunning}
                                >
                                    Pin as baseline
                                </Button>
                            )}
                        </div>
                    )}

                    {baseline && aggregate && currentOverrides && (
                        <RunComparison
                            baseline={baseline}
                            current={aggregate}
                            currentOverrides={currentOverrides}
                            onOpenDivergence={handleOpenDivergence}
                        />
                    )}

                    {divergence ? (
                        <DivergencePlayback
                            seed={divergence.seed}
                            baseline={divergence.baseline}
                            current={divergence.current}
                            onClose={handleCloseDivergence}
                        />
                    ) : (
                        battleResult && <BattlePlayback result={battleResult} />
                    )}
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
