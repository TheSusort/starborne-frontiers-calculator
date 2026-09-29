import { z } from 'zod';
import { fetchEngineeringStats, fetchGearByIds, fetchShips } from '../../services/fleetReads';
import type { BattleSimulationInput } from '../../utils/calculators/battleSimulator';
import type { GearPiece } from '../../types/gear';
import { clearGearStatsCache } from '../../utils/ship/statsCalculator';
import {
    runSeedSet,
    runSeededBattle,
    SimulationDeadlineError,
} from '../../utils/simulator/seededRuns';
import { OVERRIDABLE_STATS } from '../../utils/simulator/statOverrides';
import { runStatSweep, sweepSteps } from '../../utils/simulator/statSweep';
import { analyseSweep } from '../../utils/simulator/sweepAnalysis';
import type { PairedDelta } from '../../utils/simulator/deltaStats';
import {
    MAX_BATTLES,
    boardInputShape,
    buildBattleInput,
    refineBoards,
    type BoardData,
    type BoardInput,
} from '../simBoards';
import { McpToolError, type McpTool, type McpToolContext } from '../types';
import { fetchProfiles } from './profiles';
import { findShipTemplates } from './ships';

/** Wall-clock time one tool call may spend, database reads included. Per-battle cost grows with
 *  how many rounds a fight lasts, so `MAX_BATTLES` alone cannot keep a call inside the
 *  function's time limit; this stops the battles before the platform kills the call. */
export const SIM_TIME_BUDGET_MS = 20_000;

/** Runs `battles`, turning a passed deadline into an error the assistant can act on. */
function withinBudget<T>(battles: () => T): T {
    try {
        return battles();
    } catch (error) {
        if (error instanceof SimulationDeadlineError) {
            throw new McpToolError(
                `Stopped after ${error.completed} battles: one call has about ${SIM_TIME_BUDGET_MS / 1000} seconds. Lower runs (or runs_per_step, or the number of steps) and try again.`
            );
        }
        throw error;
    }
}

/** Reads everything `buildBattleInput` needs, as the caller (RLS applies). */
async function loadBoardData(board: BoardInput, ctx: McpToolContext): Promise<BoardData> {
    const profileId = board.profile_id ?? ctx.authUserId;
    const profiles = await fetchProfiles(ctx);
    if (!profiles.some((profile) => profile.id === profileId)) {
        throw new McpToolError('not one of your profiles');
    }

    const templateNames = board.enemy.flatMap((cell) =>
        'template' in cell ? [cell.template] : []
    );
    const [ships, engineering, templates] = await Promise.all([
        fetchShips(ctx.db, profileId),
        fetchEngineeringStats(ctx.db, profileId),
        templateNames.length > 0
            ? findShipTemplates(ctx.db, templateNames)
            : Promise.resolve(new Map()),
    ]);

    const placedIds = new Set(
        [...board.player, ...board.enemy].flatMap((cell) =>
            'ship_id' in cell ? [cell.ship_id] : []
        )
    );
    const gearIds = ships
        .filter((ship) => placedIds.has(ship.id))
        .flatMap((ship) => [...Object.values(ship.equipment), ...Object.values(ship.implants)])
        .filter((id): id is string => Boolean(id));
    const gear = await fetchGearByIds(ctx.db, profileId, gearIds);
    // `calculateTotalStats` caches gear stats by gear id in module scope; a warm function
    // instance serves many requests, so the cache must not outlive this one.
    clearGearStatsCache();

    return {
        ships,
        templates,
        gearById: new Map(gear.map((piece) => [piece.id, piece])),
        engineering: engineering ?? { stats: [] },
    };
}

/** Squad-leader effect texts the engine does not model. They are found in the pre-fight pass,
 *  which runs only when a leader is set, so a leaderless board costs no extra battle. */
const unsimulatedEffects = (
    input: BattleSimulationInput,
    seed: number,
    getGearPiece: (id: string) => GearPiece | undefined
) => {
    if (!input.playerSquadLeader && !input.enemySquadLeader) return [];
    const { preFight } = runSeededBattle(input, seed, getGearPiece);
    return (preFight?.unsimulated ?? []).map(({ name, texts }) => ({ ship: name, texts }));
};

const CAVEATS =
    ' An implant stored by its description rather than an id is not read (#578). `unsimulated` lists squad-leader effects the simulator does not model; figures are less reliable when it is not empty.';

const simulateBattleInput = z
    .object({
        ...boardInputShape,
        runs: z
            .number()
            .int()
            .min(1)
            .max(200)
            .default(1)
            .describe(
                'Seeds seed .. seed+runs-1. One run replays one fight; compare configurations over 20 or more.'
            ),
    })
    .superRefine(refineBoards);

export const simulateBattle: McpTool<z.output<typeof simulateBattleInput>> = {
    name: 'simulate_battle',
    description:
        "Fight your ships against enemies in the planner's combat simulator, with gear, implants, refits and engineering applied as the Simulator page does. Enemies are your own ships or reference ships by name (level 60, r0 or fully refitted, no gear); your engineering applies to both sides. Returns win/loss counts, rounds, and each ship's mean damage dealt, taken and healing done." +
        CAVEATS,
    input: simulateBattleInput,
    run: async (board, ctx) => {
        const deadline = performance.now() + SIM_TIME_BUDGET_MS;
        const { input, getGearPiece } = buildBattleInput(board, await loadBoardData(board, ctx));
        const aggregate = withinBudget(() =>
            runSeedSet(input, board.seed, board.runs, getGearPiece, deadline)
        );
        const { wins } = aggregate;

        return {
            runs: aggregate.count,
            seed: board.seed,
            outcome: {
                player_wins: wins.player,
                enemy_wins: wins.enemy,
                draws: wins.draw,
                win_rate: wins.player / aggregate.count,
                mean_rounds: aggregate.meanRounds,
                median_rounds: aggregate.medianRounds,
            },
            ships: aggregate.roster.map((entry) => {
                const totals = aggregate.perActorMean[entry.actorId];
                return {
                    side: entry.side,
                    position: entry.position,
                    name: entry.name,
                    damage_dealt: Math.round(totals?.damageDealt ?? 0),
                    damage_taken: Math.round(totals?.damageTaken ?? 0),
                    healing_done: Math.round(totals?.healingDone ?? 0),
                };
            }),
            unsimulated: unsimulatedEffects(input, board.seed, getGearPiece),
        };
    },
};

const sweepStatInput = z
    .object({
        ...boardInputShape,
        target: z.object({
            side: z.enum(['player', 'enemy']),
            position: boardInputShape.player.element.shape.position,
        }),
        stat: z.enum(OVERRIDABLE_STATS),
        from: z.number(),
        to: z.number(),
        step: z.number().positive(),
        runs_per_step: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .describe('Every step fights the same seeds, so steps are compared fight by fight.'),
    })
    .superRefine(refineBoards);

const delta = ({ mean, se, n, distinguishable }: PairedDelta) => ({ mean, se, n, distinguishable });

export const sweepStat: McpTool<z.output<typeof sweepStatInput>> = {
    name: 'sweep_stat',
    description:
        `Vary one stat on one ship across a range and fight each value, to see where the stat stops mattering. Same boards as simulate_battle. Each point has win rate, mean rounds and team damage; every point but the ship's current value carries a paired delta against it, and \`distinguishable\` says whether the difference is more than noise. At most 25 steps and ${MAX_BATTLES} battles (steps × runs_per_step).` +
        CAVEATS,
    input: sweepStatInput,
    run: async (args, ctx) => {
        const deadline = performance.now() + SIM_TIME_BUDGET_MS;
        const { input, getGearPiece } = buildBattleInput(args, await loadBoardData(args, ctx));
        const { target, stat } = args;
        const team = target.side === 'player' ? input.playerTeam : input.enemyTeam;
        const placement = team.find((candidate) => candidate.position === target.position);
        if (!placement) throw new McpToolError(`No ${target.side} ship at ${target.position}.`);
        const current = placement.statOverrides?.[stat];
        if (current === undefined) throw new Error(`buildTeam resolved no ${stat}`);

        let steps;
        try {
            steps = sweepSteps(stat, args.from, args.to, args.step, current);
        } catch (error) {
            throw new McpToolError(error instanceof Error ? error.message : String(error));
        }
        const battles = steps.length * args.runs_per_step;
        if (battles > MAX_BATTLES) {
            throw new McpToolError(
                `This sweep is ${steps.length} steps × ${args.runs_per_step} runs = ${battles} battles; the limit is ${MAX_BATTLES}. Widen step or lower runs_per_step.`
            );
        }

        const points = analyseSweep(
            withinBudget(() =>
                runStatSweep(
                    input,
                    target,
                    stat,
                    steps,
                    args.seed,
                    args.runs_per_step,
                    getGearPiece,
                    deadline
                )
            )
        );
        return {
            stat,
            target,
            seed: args.seed,
            runs_per_step: args.runs_per_step,
            current_value: current,
            points: points.map((point) => ({
                value: point.value,
                is_reference: point.isReference,
                win_rate: point.winRate,
                mean_rounds: point.meanRounds,
                team_damage: Math.round(point.playerDamage),
                ...(point.deltas && {
                    delta: {
                        win_rate: delta(point.deltas.winRate),
                        mean_rounds: delta(point.deltas.meanRounds),
                        team_damage: delta(point.deltas.playerDamage),
                    },
                }),
            })),
        };
    },
};
