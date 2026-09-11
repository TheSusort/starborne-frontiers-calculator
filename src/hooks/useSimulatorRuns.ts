import { useState } from 'react';
import type { GearPiece } from '../types/gear';
import type { BattleResult, BattleSimulationInput } from '../utils/calculators/battleSimulator';
import { runSeededBattle, runSeedSet, type SeedSetAggregate } from '../utils/simulator/seededRuns';
import { buildTeam } from '../utils/simulator/buildTeam';
import type { CombatStatsDeps } from '../utils/ship/combatStats';
import {
    snapshotOverrides,
    type OverrideSnapshot,
    type PinnedBaseline,
} from '../utils/simulator/compareRuns';
import { effectiveRunParams } from '../utils/simulator/effectiveRunParams';
import type { BoardState } from '../components/simulator/PlacementBoard';
import type { SquadLeaderSelection } from '../utils/combat/preFight';

/** What produced the currently displayed `battleResult`/`aggregate`: the fully-resolved engine
 *  input and the override snapshot at the moment the run started. Frozen at that moment —
 *  neither field is re-derived from live board state afterwards, which is what lets
 *  `handleOpenSeed` and a consumer's override diff stay correct after the boards are edited. */
export interface RunProvenance {
    input: BattleSimulationInput;
    overrides: OverrideSnapshot;
}

interface UseSimulatorRunsArgs {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    statsDeps: CombatStatsDeps;
    playerSquadLeader: SquadLeaderSelection | undefined;
    enemySquadLeader: SquadLeaderSelection | undefined;
    getGearPiece?: (id: string) => GearPiece | undefined;
    seed: number;
    runCount: number;
}

export interface UseSimulatorRunsResult {
    battleResult: BattleResult | null;
    aggregate: SeedSetAggregate | null;
    baseline: PinnedBaseline | null;
    runError: string | null;
    /** The seed/run-count actually in effect — the pinned baseline's while one is pinned,
     *  otherwise the caller's own `seed`/`runCount` (see `effectiveRunParams`). */
    effectiveSeed: number;
    effectiveRunCount: number;
    /** The override snapshot that produced the currently displayed `aggregate`/`battleResult`,
     *  or `null` before any run. Read this instead of snapshotting the live boards — see
     *  `RunProvenance`'s doc. */
    currentOverrides: OverrideSnapshot | null;
    canRun: boolean;
    handleRun: () => void;
    handleOpenSeed: (seed: number) => void;
    handlePinBaseline: () => void;
    handleUnpinBaseline: () => void;
}

/**
 * Owns every piece of state a simulator run produces (`battleResult`, `aggregate`, `baseline`)
 * plus the provenance of whichever one is currently displayed. Board/formation state stays in
 * the page — this hook only reads it to build an engine input and never writes it back.
 */
export function useSimulatorRuns({
    playerBoard,
    enemyBoard,
    statsDeps,
    playerSquadLeader,
    enemySquadLeader,
    getGearPiece,
    seed,
    runCount,
}: UseSimulatorRunsArgs): UseSimulatorRunsResult {
    const [battleResult, setBattleResult] = useState<BattleResult | null>(null);
    const [aggregate, setAggregate] = useState<SeedSetAggregate | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [baseline, setBaseline] = useState<PinnedBaseline | null>(null);
    const [provenance, setProvenance] = useState<RunProvenance | null>(null);

    const playerCount = Object.keys(playerBoard).length;
    const enemyCount = Object.keys(enemyBoard).length;
    const canRun = playerCount > 0 && enemyCount > 0;

    const buildInput = (): BattleSimulationInput => ({
        playerTeam: buildTeam(playerBoard, statsDeps),
        enemyTeam: buildTeam(enemyBoard, statsDeps),
        playerSquadLeader,
        enemySquadLeader,
    });

    const { seed: effectiveSeed, runCount: effectiveRunCount } = effectiveRunParams(
        baseline,
        seed,
        runCount
    );

    const handleRun = () => {
        // Guard: simulateBattle throws on an empty side.
        if (!canRun) return;
        setRunError(null);
        // Captured once, up front, so the provenance recorded for this run and the result it
        // produces always describe the SAME boards — never a mix of a stale input and a fresh
        // snapshot (or vice versa) from two separate reads of live state.
        const input = buildInput();
        const overrides = snapshotOverrides(playerBoard, enemyBoard);
        try {
            if (effectiveRunCount === 1) {
                setAggregate(null);
                setBattleResult(runSeededBattle(input, effectiveSeed, getGearPiece));
            } else {
                setBattleResult(null);
                setAggregate(runSeedSet(input, effectiveSeed, effectiveRunCount, getGearPiece));
            }
            setProvenance({ input, overrides });
        } catch (err) {
            setBattleResult(null);
            setAggregate(null);
            setProvenance(null);
            setRunError(err instanceof Error ? err.message : 'Simulation failed');
        }
    };

    // Replays one seed from the input that produced the CURRENT aggregate, so the playback
    // always matches the row it was opened from regardless of any board edit made since that
    // run. Never rebuild from the live boards here.
    const handleOpenSeed = (openSeed: number) => {
        if (!provenance) {
            setRunError('No run to replay yet.');
            return;
        }
        setRunError(null);
        try {
            setBattleResult(runSeededBattle(provenance.input, openSeed, getGearPiece));
        } catch (err) {
            setBattleResult(null);
            setRunError(err instanceof Error ? err.message : 'Simulation failed');
        }
    };

    const handlePinBaseline = () => {
        if (!aggregate || !provenance) return;
        setBaseline({ aggregate, overrides: provenance.overrides });
    };

    const handleUnpinBaseline = () => setBaseline(null);

    return {
        battleResult,
        aggregate,
        baseline,
        runError,
        effectiveSeed,
        effectiveRunCount,
        currentOverrides: provenance?.overrides ?? null,
        canRun,
        handleRun,
        handleOpenSeed,
        handlePinBaseline,
        handleUnpinBaseline,
    };
}
