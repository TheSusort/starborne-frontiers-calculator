import React, { useMemo, useState } from 'react';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { Ship } from '../types/ship';
import { Position, ShipPosition } from '../types/encounters';
import { useInventory } from '../contexts/InventoryProvider';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { shipFinalStats, combatStatsFromShip } from '../utils/ship/combatStats';
import {
    simulateBattle,
    BattleResult,
    BattlePlacement,
} from '../utils/calculators/battleSimulator';
import PlacementBoard, { BoardState } from '../components/simulator/PlacementBoard';
import BattlePlayback from '../components/simulator/BattlePlayback';
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
    const [runError, setRunError] = useState<string | null>(null);
    // Per-side squad-leader selections (pre-fight faction auras), persisted to
    // localStorage (validated on read — stale/hand-edited values fall back to none).
    const [playerSquadLeader, setPlayerSquadLeader] = useState<SquadLeaderSelection | undefined>(
        () => readStoredSquadLeaderSelection(SQUAD_LEADER_STORAGE_KEYS.player)
    );
    const [enemySquadLeader, setEnemySquadLeader] = useState<SquadLeaderSelection | undefined>(
        () => readStoredSquadLeaderSelection(SQUAD_LEADER_STORAGE_KEYS.enemy)
    );

    const handleSquadLeaderChange = (side: Side, selection: SquadLeaderSelection | undefined) => {
        (side === 'player' ? setPlayerSquadLeader : setEnemySquadLeader)(selection);
        writeStoredSquadLeaderSelection(SQUAD_LEADER_STORAGE_KEYS[side], selection);
    };

    // FormationGrid consumes ShipPosition[] (it resolves the full ship by id via useShips).
    const playerFormation = useMemo<ShipPosition[]>(
        () =>
            (Object.entries(playerBoard) as [Position, Ship][]).map(([position, ship]) => ({
                shipId: ship.id,
                position,
            })),
        [playerBoard]
    );
    const enemyFormation = useMemo<ShipPosition[]>(
        () =>
            (Object.entries(enemyBoard) as [Position, Ship][]).map(([position, ship]) => ({
                shipId: ship.id,
                position,
            })),
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
        setBoard((prev) => ({ ...prev, [selected]: ship }));
        setSelected(undefined);
    };

    // Replace one side's board with a saved encounter's formation (built in PlacementBoard).
    // Leaves battleResult as-is, matching add/remove — the user re-runs after setting teams.
    const handleLoadEncounter = (side: Side, board: BoardState) => {
        const { setBoard, setSelected } = boardSetters[side];
        setBoard(board);
        setSelected(undefined);
    };

    // Build the engine input for one side: each placed ship → BattlePlacement with
    // fully gear/refit/engineering-resolved stats as statOverrides (else combat floors to
    // un-geared base stats — see the WARNING in battleSimulator.ts).
    const buildTeam = (board: BoardState): BattlePlacement[] =>
        (Object.entries(board) as [Position, Ship][]).map(([position, ship]) => ({
            ship,
            position,
            statOverrides: combatStatsFromShip(shipFinalStats(ship, statsDeps)),
        }));

    const playerCount = Object.keys(playerBoard).length;
    const enemyCount = Object.keys(enemyBoard).length;
    const canRun = playerCount > 0 && enemyCount > 0;

    const handleRun = () => {
        // Guard: simulateBattle throws on an empty side.
        if (!canRun) return;
        setRunError(null);
        try {
            const result = simulateBattle(
                {
                    playerTeam: buildTeam(playerBoard),
                    enemyTeam: buildTeam(enemyBoard),
                    playerSquadLeader,
                    enemySquadLeader,
                },
                getGearPiece
            );
            setBattleResult(result);
        } catch (err) {
            setBattleResult(null);
            setRunError(err instanceof Error ? err.message : 'Simulation failed');
        }
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
                                mirrored
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
                        <Button variant="primary" onClick={handleRun} disabled={!canRun}>
                            Run Simulation
                        </Button>
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

                    {battleResult && <BattlePlayback result={battleResult} />}
                </div>
            </PageLayout>
        </>
    );
};

export default SimulatorPage;
