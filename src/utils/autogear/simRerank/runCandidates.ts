import type { Position } from '../../../types/encounters';
import type { CombatStatsDeps } from '../../ship/combatStats';
import { buildTeam } from '../../simulator/buildTeam';
import { runSeedSetAsync, type SeedSetAggregate } from '../../simulator/seededRuns';
import type { FightBoards } from './fightSources';

export interface CandidateRun {
    /** Identifies the row: which role produced this build, or 'equipped'. */
    id: string;
    aggregate: SeedSetAggregate;
    /** The engine actorId the focus ship fought under. */
    focusActorId: string;
}

/**
 * The engine actorId the focus ship fought under, found by the cell it occupies.
 *
 * `simulateBattle` names player index 0 `'attacker'`, an id that carries no ship id, and every
 * other player actor `p:<shipId>:<i>`. Index 0 is whichever ship sits earliest in `buildTeam`'s
 * `POSITION_ORDER`, which has nothing to do with which ship is being geared, so matching on ship
 * id would have to special-case `'attacker'` and would still be ambiguous if a ship appeared
 * twice. A board cell is unique and the roster carries it, so position is the identifier that
 * works for both cases.
 *
 * Throws rather than falling back: a wrong actor here produces plausible numbers for the wrong
 * ship, which no reader could catch.
 */
export function focusActorId(aggregate: SeedSetAggregate, focusPosition: Position): string {
    const entry = aggregate.roster.find((r) => r.side === 'player' && r.position === focusPosition);
    if (!entry) {
        throw new Error(`no player actor occupies ${focusPosition} in this fight`);
    }
    return entry.actorId;
}

export interface RunCandidateArgs {
    id: string;
    fight: FightBoards;
    deps: CombatStatsDeps;
    seed: number;
    runCount: number;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
}

/**
 * Run one candidate build over a seed set and report the focus ship's totals.
 *
 * `seed` and `runCount` are the caller's, unchanged, so every candidate in a comparison runs the
 * same seed set — `deltaStats` presents its comparison as paired, and an unpaired run under that
 * presentation is the failure it exists to prevent. Resolves null when aborted, never a partial
 * aggregate, matching `runSeedSetAsync`'s own contract.
 */
export async function runCandidate(args: RunCandidateArgs): Promise<CandidateRun | null> {
    const { id, fight, deps, seed, runCount, signal, onProgress } = args;

    const aggregate = await runSeedSetAsync(
        {
            playerTeam: buildTeam(fight.playerBoard, deps),
            enemyTeam: buildTeam(fight.enemyBoard, deps),
            playerSquadLeader: fight.playerSquadLeader,
            enemySquadLeader: fight.enemySquadLeader,
        },
        seed,
        runCount,
        { getGearPiece: deps.getGearPiece, signal, onProgress }
    );
    if (!aggregate) return null;

    return { id, aggregate, focusActorId: focusActorId(aggregate, fight.focusPosition) };
}
