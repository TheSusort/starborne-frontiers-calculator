import { z } from 'zod';
import { fetchEngineeringStats, fetchGearByIds, fetchShips } from '../../services/fleetReads';
import { formatCombatLogText } from '../../utils/combat/log/formatText';
import type { BattleResult, BattleSimulationInput } from '../../utils/calculators/battleSimulator';
import type { GearPiece } from '../../types/gear';
import {
    runSeedSet,
    runSeededBattle,
    summarizeRun,
    SimulationDeadlineError,
    type ActorTotals,
} from '../../utils/simulator/seededRuns';
import { OVERRIDABLE_STATS } from '../../utils/simulator/statOverrides';
import { plannedSweepSteps, runStatSweep, sweepSteps } from '../../utils/simulator/statSweep';
import { analyseSweep } from '../../utils/simulator/sweepAnalysis';
import type { PairedDelta } from '../../utils/simulator/deltaStats';
import {
    DEFAULT_RUNS_PER_STEP,
    MAX_BATTLES,
    MAX_RUNS,
    MAX_RUNS_PER_STEP,
    MAX_SWEEP_POINTS,
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

    return {
        ships,
        templates,
        gearById: new Map(gear.map((piece) => [piece.id, piece])),
        engineering: engineering ?? { stats: [] },
    };
}

/** Maps a pre-fight pass's `unsimulated` list to the tool output shape, `[]` when the pass did
 *  not run (no squad leader on either side). */
const toUnsimulated = (preFight: BattleResult['preFight']) =>
    (preFight?.unsimulated ?? []).map(({ name, texts }) => ({ ship: name, texts }));

/** Squad-leader effect texts the engine does not model. They are found in the pre-fight pass,
 *  which runs only when a leader is set, so a leaderless board costs no extra battle. */
const unsimulatedEffects = (
    input: BattleSimulationInput,
    seed: number,
    getGearPiece: (id: string) => GearPiece | undefined
) => {
    if (!input.playerSquadLeader && !input.enemySquadLeader) return [];
    const { preFight } = runSeededBattle(input, seed, getGearPiece);
    return toUnsimulated(preFight);
};

/** Per-ship figures in roster order, as every sim tool reports them. */
const shipTotals = (roster: BattleResult['roster'], totalsById: Record<string, ActorTotals>) =>
    roster.map((entry) => {
        const totals = totalsById[entry.actorId];
        return {
            side: entry.side,
            position: entry.position,
            name: entry.name,
            damage_dealt: Math.round(totals?.damageDealt ?? 0),
            damage_taken: Math.round(totals?.damageTaken ?? 0),
            healing_done: Math.round(totals?.healingDone ?? 0),
        };
    });

const DATA_CAVEATS = ` An implant stored by its description rather than an id is not read (#578). \`unsimulated\` lists squad-leader effects the simulator does not model; figures are less reliable when it is not empty.`;

const CAVEATS =
    ` One call has about ${SIM_TIME_BUDGET_MS / 1000} seconds; long fights fit fewer battles, and a call that runs out stops with an error saying how many battles finished.` +
    DATA_CAVEATS;

const simulateBattleInput = z
    .object({
        ...boardInputShape,
        runs: z
            .number()
            .int()
            .min(1)
            .max(MAX_RUNS)
            .default(20)
            .describe(
                'Seeds seed .. seed+runs-1. One run replays one fight; compare configurations over 20 or more.'
            ),
    })
    .superRefine(refineBoards);

export const simulateBattle: McpTool<z.output<typeof simulateBattleInput>> = {
    name: 'simulate_battle',
    description:
        "Fight your ships against enemies in the planner's combat simulator, with gear, implants, refits and engineering applied as the Simulator page does. Enemies are your own ships or reference ships by name (level 60, r0 or fully refitted, no gear); your engineering applies to both sides. Returns win/loss counts (every fight has a winner: one still going at the round limit, or with both teams wiped in the same round, is an enemy win), rounds, and each ship's mean damage dealt, taken and healing done, plus each individual fight's seed, winner and length — pick one from there to replay in full with battle_log." +
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
                win_rate: wins.player / aggregate.count,
                mean_rounds: aggregate.meanRounds,
                median_rounds: aggregate.medianRounds,
            },
            seeds: aggregate.runs.map((r) => ({
                seed: r.seed,
                winner: r.winner,
                rounds: r.lastRound,
            })),
            ships: shipTotals(aggregate.roster, aggregate.perActorMean),
            unsimulated: unsimulatedEffects(input, board.seed, getGearPiece),
        };
    },
};

const battleLogInput = z.object(boardInputShape).strict().superRefine(refineBoards);

export const battleLog: McpTool<z.output<typeof battleLogInput>> = {
    name: 'battle_log',
    description:
        "Replay one simulated fight and return its full turn-by-turn log: every turn, attack, heal, shield, buff, debuff, resist, charge change and death, with each reaction indented under the latest action of the turn it fired in (nesting is positional, not necessarily the entry that caused it). Ships are labelled P.<name>@<position> (yours) and E.<name>@<position> (enemy). Pick a seed from simulate_battle's per-seed seeds list and replay it here with the same board — the same board and seed always give the same fight. Legend: a target's number is what actually landed (damage, repair or shield), crit/miss is the hit result, overheal/overshield is what was wasted, [N%] is that target's HP right after the entry, and a death line names the killer (for a Bomb, the ship that planted it) unless a DoT tick dealt the blow (those deaths name no one). No cap on size: expect roughly 1-4k tokens per round, and a long fight can pass 20k tokens. Also returns the outcome and each ship's damage dealt, taken and healing done in this fight." +
        DATA_CAVEATS,
    input: battleLogInput,
    run: async (board, ctx) => {
        const { input, getGearPiece } = buildBattleInput(board, await loadBoardData(board, ctx));
        const result = runSeededBattle(input, board.seed, getGearPiece);
        return {
            seed: board.seed,
            outcome: { winner: result.outcome.winner, rounds: result.outcome.lastRound },
            ships: shipTotals(result.roster, summarizeRun(result, board.seed).perActor),
            unsimulated: toUnsimulated(result.preFight),
            log: formatCombatLogText(result.combatLog, result.roster),
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
            .max(MAX_RUNS_PER_STEP)
            .default(DEFAULT_RUNS_PER_STEP)
            .describe('Every step fights the same seeds, so steps are compared fight by fight.'),
    })
    .superRefine(refineBoards);

const delta = ({ mean, se, n, distinguishable }: PairedDelta) => ({ mean, se, n, distinguishable });

export const sweepStat: McpTool<z.output<typeof sweepStatInput>> = {
    name: 'sweep_stat',
    description:
        `Vary one stat on one ship across a range and fight each value, to see where the stat stops mattering. Same boards as simulate_battle. Each point has win rate, mean rounds and team damage; every point but the ship's current value carries a paired delta against it, and \`distinguishable\` says whether the difference is more than noise. At most ${MAX_SWEEP_POINTS} steps, not counting the current value, and ${MAX_BATTLES} battles (steps × runs_per_step).` +
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

        if (plannedSweepSteps(args.from, args.to, args.step) > MAX_SWEEP_POINTS) {
            throw new McpToolError(
                `a sweep runs at most ${MAX_SWEEP_POINTS} steps, not counting the current value`
            );
        }
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
            unsimulated: unsimulatedEffects(input, args.seed, getGearPiece),
        };
    },
};
