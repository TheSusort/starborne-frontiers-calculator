import React, { useMemo, useState } from 'react';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
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
import PlacementBoard from '../components/simulator/PlacementBoard';
import RoundStepper from '../components/simulator/RoundStepper';
import BattleBoard from '../components/simulator/BattleBoard';
import RoundEventLog from '../components/simulator/RoundEventLog';
import ShipRoundCard from '../components/simulator/ShipRoundCard';
import { StatCard } from '../components/ui/StatCard';
import { overlaysForRound } from '../utils/simulator/boardOverlays';

/** One placement board's state: a Position → Ship map. The Position key is the grid cell;
 *  the Ship is the fully-loaded inventory ship whose geared stats Run resolves. */
type BoardState = Partial<Record<Position, Ship>>;

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
    // Round-stepper playback position (1-based). Tasks 4 render this round's board/log/card.
    const [currentRound, setCurrentRound] = useState(1);
    // Pinned ship (synthetic roster actorId) for the per-ship detail card; null = none.
    const [pinned, setPinned] = useState<string | null>(null);

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
            const result = simulateBattle({
                playerTeam: buildTeam(playerBoard),
                enemyTeam: buildTeam(enemyBoard),
            });
            setBattleResult(result);
            setCurrentRound(1);
            setPinned(null);
        } catch (err) {
            setBattleResult(null);
            setRunError(err instanceof Error ? err.message : 'Simulation failed');
        }
    };

    const outcomeLabel = (result: BattleResult): string => {
        const { winner } = result.outcome;
        return winner === 'player' ? 'Your team wins' : winner === 'enemy' ? 'Enemy wins' : 'Draw';
    };

    // The round currently shown by the stepper (1-based, clamped to the trimmed rounds).
    const total = battleResult?.rounds.length ?? 0;
    const curRound =
        battleResult && total > 0
            ? battleResult.rounds[Math.min(currentRound, total) - 1]
            : undefined;

    return (
        <PageLayout
            title="Combat Simulator"
            description="Place your team and an enemy team on the boards, then run a full battle simulation using geared stats."
        >
            <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <PlacementBoard
                        title={`Your Team${playerCount > 0 ? ` (${playerCount})` : ''}`}
                        formation={playerFormation}
                        selectedPosition={playerSelected}
                        onSelectPosition={(pos) => handleSelectPosition('player', pos)}
                        onRemoveShip={(pos) => handleRemoveShip('player', pos)}
                        onPickShip={(ship) => handlePickShip('player', ship)}
                        onCloseSelector={() => setPlayerSelected(undefined)}
                    />
                    <PlacementBoard
                        title={`Enemy Team${enemyCount > 0 ? ` (${enemyCount})` : ''}`}
                        formation={enemyFormation}
                        selectedPosition={enemySelected}
                        onSelectPosition={(pos) => handleSelectPosition('enemy', pos)}
                        onRemoveShip={(pos) => handleRemoveShip('enemy', pos)}
                        onPickShip={(ship) => handlePickShip('enemy', ship)}
                        onCloseSelector={() => setEnemySelected(undefined)}
                    />
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

                {runError && <div className="card text-red-400">Simulation error: {runError}</div>}

                {battleResult && (
                    <StatCard
                        title="Outcome"
                        value={outcomeLabel(battleResult)}
                        subtitle={`Round ${battleResult.outcome.lastRound}`}
                        color={
                            battleResult.outcome.winner === 'player'
                                ? 'green'
                                : battleResult.outcome.winner === 'enemy'
                                  ? 'red'
                                  : 'yellow'
                        }
                    />
                )}

                {battleResult && curRound && (
                    <RoundStepper
                        round={Math.min(currentRound, total)}
                        total={total}
                        onChange={setCurrentRound}
                    />
                )}

                {battleResult && curRound && (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <BattleBoard
                                title="Your Team"
                                overlays={overlaysForRound(curRound, 'player', battleResult.roster)}
                                pinnedActorId={pinned}
                                onPinShip={setPinned}
                            />
                            <BattleBoard
                                title="Enemy Team"
                                overlays={overlaysForRound(curRound, 'enemy', battleResult.roster)}
                                mirrored
                                pinnedActorId={pinned}
                                onPinShip={setPinned}
                            />
                        </div>

                        {pinned && (
                            <ShipRoundCard
                                actorId={pinned}
                                round={curRound}
                                roster={battleResult.roster}
                            />
                        )}

                        <RoundEventLog round={curRound} roster={battleResult.roster} />
                    </>
                )}
            </div>
        </PageLayout>
    );
};

export default SimulatorPage;
