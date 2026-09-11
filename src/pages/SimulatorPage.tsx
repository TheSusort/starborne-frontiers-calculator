import React, { useMemo, useState } from 'react';
import { PageLayout } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { Ship } from '../types/ship';
import { Position, ShipPosition } from '../types/encounters';
import { useInventory } from '../contexts/InventoryProvider';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { BattleResult } from '../utils/calculators/battleSimulator';
import { runSeededBattle, runSeedSet, SeedSetAggregate } from '../utils/simulator/seededRuns';
import { buildTeam } from '../utils/simulator/buildTeam';
import { combatStatsFromShip, shipFinalStats } from '../utils/ship/combatStats';
import { hasAnyOverride, StatOverrides } from '../utils/simulator/statOverrides';
import { snapshotOverrides, PinnedBaseline } from '../utils/simulator/compareRuns';
import PlacementBoard, { BoardState, Placement } from '../components/simulator/PlacementBoard';
import StatOverrideModal from '../components/simulator/StatOverrideModal';
import BattlePlayback from '../components/simulator/BattlePlayback';
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

type Side = 'player' | 'enemy';

const SimulatorPage: React.FC = () => {
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();

    // Shared combat-stat resolution — see src/utils/ship/combatStats.ts (mirrors DPSCalculatorPage).
    const statsDeps = { getGearPiece, getEngineeringStatsForShipType };

    const [playerBoard, setPlayerBoard] = useState<BoardState>({});
    const [enemyBoard, setEnemyBoard] = useState<BoardState>({});
    // Selected cell per board (the cell a picked ship fills). Independent per side.
    const [playerSelected, setPlayerSelected] = useState<Position | undefined>(undefined);
    const [enemySelected, setEnemySelected] = useState<Position | undefined>(undefined);
    const [battleResult, setBattleResult] = useState<BattleResult | null>(null);
    const [aggregate, setAggregate] = useState<SeedSetAggregate | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [seed, setSeed] = useState<number>(() => randomSeed());
    const [runCount, setRunCount] = useState(1);
    // The comparison point for the current session. While set, the seed and run count are
    // read-only and forced onto the baseline's values (see the locked SeedRunControls below) —
    // otherwise a "variant" run could sample a different seed set and the comparison would be
    // unpaired while looking paired.
    const [baseline, setBaseline] = useState<PinnedBaseline | null>(null);
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
    // by hand is the friction this removes.
    const handleCopyBoard = (from: Side) => {
        const source = from === 'player' ? playerBoard : enemyBoard;
        const copy: BoardState = {};
        for (const [position, placement] of Object.entries(source) as [Position, Placement][]) {
            copy[position] = { ship: placement.ship, overrides: { ...placement.overrides } };
        }
        (from === 'player' ? setEnemyBoard : setPlayerBoard)(copy);
    };

    const playerCount = Object.keys(playerBoard).length;
    const enemyCount = Object.keys(enemyBoard).length;
    const canRun = playerCount > 0 && enemyCount > 0;

    // Shared engine input for both a fresh run and a seed re-open — both call sites need the
    // same fully-resolved teams and squad-leader selections.
    const buildInput = () => ({
        playerTeam: buildTeam(playerBoard, statsDeps),
        enemyTeam: buildTeam(enemyBoard, statsDeps),
        playerSquadLeader,
        enemySquadLeader,
    });

    // While a baseline is pinned, the seed and run count are the baseline's own — never the raw
    // `seed`/`runCount` state, which keeps whatever the user last typed before pinning. A variant
    // run must reuse the baseline's exact seed set or the comparison is unpaired.
    const effectiveSeed = baseline ? baseline.aggregate.baseSeed : seed;
    const effectiveRunCount = baseline ? baseline.aggregate.count : runCount;

    const handleRun = () => {
        // Guard: simulateBattle throws on an empty side.
        if (!canRun) return;
        setRunError(null);
        const input = buildInput();
        try {
            if (effectiveRunCount === 1) {
                setAggregate(null);
                setBattleResult(runSeededBattle(input, effectiveSeed, getGearPiece));
            } else {
                setBattleResult(null);
                setAggregate(runSeedSet(input, effectiveSeed, effectiveRunCount, getGearPiece));
            }
        } catch (err) {
            setBattleResult(null);
            setAggregate(null);
            setRunError(err instanceof Error ? err.message : 'Simulation failed');
        }
    };

    // Re-runs a single seed from the aggregate. Determinism guarantees the playback matches the
    // row it was opened from, so the fight does not need to be retained alongside the summary.
    const handleOpenSeed = (openSeed: number) => {
        if (!canRun) return;
        setBattleResult(runSeededBattle(buildInput(), openSeed, getGearPiece));
    };

    const handlePinBaseline = () => {
        if (!aggregate) return;
        setBaseline({ aggregate, overrides: snapshotOverrides(playerBoard, enemyBoard) });
    };

    const handleUnpinBaseline = () => setBaseline(null);

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

                    {/* Squad-leader effects the sim could not model this run (conditional /
                        per-round / modifier-channel effects) — surfaced so the outcome is
                        never mistaken for a full simulation of the selected leaders. */}
                    {battleResult?.preFight && battleResult.preFight.unsimulated.length > 0 && (
                        <div className="card border-amber-500/40 space-y-1">
                            <p className="text-sm font-semibold text-amber-400">
                                Squad leader effects not simulated this run
                            </p>
                            <ul className="text-sm space-y-1">
                                {battleResult.preFight.unsimulated.map((entry) => (
                                    <li key={entry.actorId}>
                                        <span className="text-theme-text-secondary">
                                            {entry.name}:{' '}
                                        </span>
                                        <span className="text-amber-400">
                                            {entry.texts.join('; ')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {aggregate && (
                        <div className="space-y-2">
                            <SeedSetResults
                                aggregate={aggregate}
                                roster={aggregate.roster}
                                onOpenSeed={handleOpenSeed}
                            />
                            {!baseline && (
                                <Button variant="secondary" onClick={handlePinBaseline}>
                                    Pin as baseline
                                </Button>
                            )}
                        </div>
                    )}

                    {baseline && aggregate && (
                        <RunComparison
                            baseline={baseline}
                            current={aggregate}
                            currentOverrides={snapshotOverrides(playerBoard, enemyBoard)}
                            roster={aggregate.roster}
                            onUnpin={handleUnpinBaseline}
                        />
                    )}

                    {battleResult && <BattlePlayback result={battleResult} />}
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
