import { describe, it, expect } from 'vitest';
import { fetchEngineeringStats, fetchGearByIds, fetchShips } from '../../services/fleetReads';
import { runSeedSet } from '../../utils/simulator/seededRuns';
import { runStatSweep, sweepSteps } from '../../utils/simulator/statSweep';
import { analyseSweep } from '../../utils/simulator/sweepAnalysis';
import type { PairedDelta } from '../../utils/simulator/deltaStats';
import { buildBattleInput, type BoardData, type BoardInput } from '../simBoards';
import { simulateBattle, sweepStat } from '../tools/simulate';
import { findShipTemplates } from '../tools/ships';
import { McpToolError, type McpToolContext } from '../types';
import { AUTH_USER, STRANGER, call, ctxOver } from './fixtures';
import { simTables as tables, vsAtlas } from './simFixtures';

/** Everything `buildBattleInput` needs, read the same way the tool's own `loadBoardData` does —
 *  reused here rather than exported from `tools/simulate.ts` only for this test. */
async function loadBoardDataForTest(board: BoardInput, ctx: McpToolContext): Promise<BoardData> {
    const templateNames = board.enemy.flatMap((cell) =>
        'template' in cell ? [cell.template] : []
    );
    const [ships, engineering, templates] = await Promise.all([
        fetchShips(ctx.db, AUTH_USER),
        fetchEngineeringStats(ctx.db, AUTH_USER),
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
    const gear = await fetchGearByIds(ctx.db, AUTH_USER, gearIds);
    return {
        ships,
        templates,
        gearById: new Map(gear.map((piece) => [piece.id, piece])),
        engineering: engineering ?? { stats: [] },
    };
}

const pairedDelta = ({ mean, se, n, distinguishable }: PairedDelta) => ({
    mean,
    se,
    n,
    distinguishable,
});

interface BattleOut {
    runs: number;
    outcome: { player_wins: number; enemy_wins: number; draws: number; win_rate: number };
    ships: {
        side: string;
        position: string;
        name: string;
        damage_dealt: number;
        damage_taken: number;
        healing_done: number;
    }[];
    unsimulated: unknown[];
}

/** A battle's output with the ship names removed, to compare two boards that differ only in
 *  which of your ships sits at a position. */
const withoutNames = (out: unknown) => {
    const battle = out as BattleOut;
    return { ...battle, ships: battle.ships.map(({ name: _name, ...rest }) => rest) };
};

/** A Marauders leader whose stage-2 effect the simulator does not model. */
const BRANDISHER = { faction: 'MARAUDERS', name: 'Brandisher', stage: 2 };
const BRANDISHER_UNSIMULATED = '+25% direct damage to secondary targets';

describe('simulate_battle', () => {
    it('runs one battle by default and reports both sides', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(simulateBattle, vsAtlas('s1'), ctx)) as BattleOut;

        expect(out.runs).toBe(1);
        const { player_wins, enemy_wins, draws } = out.outcome;
        expect(player_wins + enemy_wins + draws).toBe(1);
        expect(out.ships.map((s) => [s.side, s.position, s.name])).toEqual([
            ['player', 'T1', 'Geared'],
            ['enemy', 'T1', 'Atlas'],
        ]);
        expect(out.ships[0].damage_dealt).toBeGreaterThan(0);
        expect(out.unsimulated).toEqual([]);
    });

    it('is reproducible for the same seed', async () => {
        const { ctx } = ctxOver(tables());
        const raw = vsAtlas('s1', { runs: 5, seed: 42 });

        expect(await call(simulateBattle, raw, ctx)).toEqual(await call(simulateBattle, raw, ctx));
    });

    it('reads gear: a geared ship fights exactly as a bare ship with the same final attack', async () => {
        const { ctx } = ctxOver(tables());

        // 2000 base + the 3000 weapon, against a bare 5000.
        const geared = await call(simulateBattle, vsAtlas('s1'), ctx);
        const base5000 = await call(simulateBattle, vsAtlas('s3'), ctx);
        const bare = await call(simulateBattle, vsAtlas('s2'), ctx);

        expect(withoutNames(geared)).toEqual(withoutNames(base5000));
        expect(withoutNames(bare)).not.toEqual(withoutNames(geared));
    });

    it('reads gear stats afresh on every call', async () => {
        const first = ctxOver(tables({ weaponAttack: 3000 }));
        const second = ctxOver(tables({ weaponAttack: 500 }));

        const before = await call(simulateBattle, vsAtlas('s1'), first.ctx);
        const after = await call(simulateBattle, vsAtlas('s1'), second.ctx);

        expect(withoutNames(before)).toEqual(
            withoutNames(await call(simulateBattle, vsAtlas('s3'), first.ctx))
        );
        expect(withoutNames(after)).not.toEqual(withoutNames(before));
    });

    it('lists the effects of your squad leader the simulator does not model', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(
            simulateBattle,
            vsAtlas('m1', { player_leader: BRANDISHER }),
            ctx
        )) as BattleOut;

        expect(out.unsimulated).toEqual([{ ship: 'Marauder', texts: [BRANDISHER_UNSIMULATED] }]);
    });

    it("lists the effects of the enemy's squad leader the simulator does not model", async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(
            simulateBattle,
            {
                player: [{ position: 'T1', ship_id: 's2' }],
                enemy: [{ position: 'T1', ship_id: 'm2' }],
                enemy_leader: BRANDISHER,
            },
            ctx
        )) as BattleOut;

        expect(out.unsimulated).toEqual([
            { ship: 'Other Marauder', texts: [BRANDISHER_UNSIMULATED] },
        ]);
    });

    it('refuses a profile that is not one of yours', async () => {
        const { ctx } = ctxOver(tables());

        await expect(
            call(simulateBattle, vsAtlas('s1', { profile_id: STRANGER }), ctx)
        ).rejects.toEqual(new McpToolError('not one of your profiles'));
    });

    it('rejects more than 200 runs', () => {
        expect(simulateBattle.input.safeParse(vsAtlas('s1', { runs: 201 })).success).toBe(false);
    });

    it('reports the same figures the engine itself produces for this input', async () => {
        const { ctx } = ctxOver(tables());
        const raw = vsAtlas('s1', { runs: 3, seed: 42 });
        const board = simulateBattle.input.parse(raw);

        const { input, getGearPiece } = buildBattleInput(
            board,
            await loadBoardDataForTest(board, ctx)
        );
        const aggregate = runSeedSet(input, board.seed, board.runs, getGearPiece);

        const out = (await call(simulateBattle, raw, ctx)) as BattleOut;

        // The geared ship (~5000 attack) and the Atlas template (3000 attack, 180% hit) deal
        // different damage to each other, so this board actually exercises damage_taken.
        expect(out.ships[0].damage_dealt).not.toBe(out.ships[0].damage_taken);
        expect(out.ships.some((ship) => ship.damage_taken > 0)).toBe(true);

        expect(out.runs).toBe(aggregate.count);
        expect(out.outcome).toEqual({
            player_wins: aggregate.wins.player,
            enemy_wins: aggregate.wins.enemy,
            draws: aggregate.wins.draw,
            win_rate: aggregate.wins.player / aggregate.count,
            mean_rounds: aggregate.meanRounds,
            median_rounds: aggregate.medianRounds,
        });
        const correctShips = aggregate.roster.map((entry) => {
            const totals = aggregate.perActorMean[entry.actorId];
            return {
                side: entry.side,
                position: entry.position,
                name: entry.name,
                damage_dealt: Math.round(totals?.damageDealt ?? 0),
                damage_taken: Math.round(totals?.damageTaken ?? 0),
                healing_done: Math.round(totals?.healingDone ?? 0),
            };
        });
        expect(out.ships).toEqual(correctShips);

        // Mutation check for the mapping above: a build that reported damage_taken from
        // totals.damageDealt (dealt and taken differ on this board, asserted earlier) would
        // produce this shape, and this assertion is what would have gone red against it.
        const mutantShips = aggregate.roster.map((entry) => {
            const totals = aggregate.perActorMean[entry.actorId];
            return {
                side: entry.side,
                position: entry.position,
                name: entry.name,
                damage_dealt: Math.round(totals?.damageDealt ?? 0),
                damage_taken: Math.round(totals?.damageDealt ?? 0),
                healing_done: Math.round(totals?.healingDone ?? 0),
            };
        });
        expect(mutantShips).not.toEqual(correctShips);
        expect(out.ships).not.toEqual(mutantShips);
    });
});

interface SweepOut {
    current_value: number;
    unsimulated: unknown[];
    points: {
        value: number;
        is_reference: boolean;
        team_damage: number;
        delta?: { team_damage: { distinguishable: boolean } };
    }[];
}

const sweep = (extra = {}) => ({
    ...vsAtlas('s1'),
    target: { side: 'player', position: 'T1' },
    stat: 'attack',
    from: 1000,
    to: 9000,
    step: 4000,
    runs_per_step: 3,
    ...extra,
});

describe('sweep_stat', () => {
    it("measures from the target's current value, which is one of the points", async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(sweepStat, sweep(), ctx)) as SweepOut;

        // 2000 base + 3000 weapon.
        expect(out.current_value).toBe(5000);
        const reference = out.points.filter((p) => p.is_reference);
        expect(reference.map((p) => p.value)).toEqual([5000]);
        expect(out.points.filter((p) => !p.is_reference).every((p) => p.delta)).toBe(true);
    });

    it('is not vacuous: team damage moves across the steps', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(sweepStat, sweep(), ctx)) as SweepOut;

        expect(new Set(out.points.map((p) => p.team_damage)).size).toBeGreaterThan(1);
    });

    it('sweeps a stat on an enemy ship', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(
            sweepStat,
            sweep({ target: { side: 'enemy', position: 'T1' } }),
            ctx
        )) as SweepOut;

        // The Atlas template's attack, not the player ship's 5000.
        expect(out.current_value).toBe(3000);
        expect(out.points.filter((p) => p.is_reference).map((p) => p.value)).toEqual([3000]);
        expect(out.points.map((p) => p.value)).toEqual([1000, 3000, 5000, 9000]);
    });

    it('lists squad-leader effects the simulator does not model', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(
            sweepStat,
            sweep({ player: [{ position: 'T1', ship_id: 'm1' }], player_leader: BRANDISHER }),
            ctx
        )) as SweepOut;

        expect(out.unsimulated).toEqual([{ ship: 'Marauder', texts: [BRANDISHER_UNSIMULATED] }]);
    });

    it('reports no unsimulated effects without a squad leader', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(sweepStat, sweep(), ctx)) as SweepOut;

        expect(out.unsimulated).toEqual([]);
    });

    it('rejects a target position with no ship', async () => {
        const { ctx } = ctxOver(tables());

        await expect(
            call(sweepStat, sweep({ target: { side: 'player', position: 'B4' } }), ctx)
        ).rejects.toEqual(new McpToolError('No player ship at B4.'));
    });

    it('passes on the step limit as a tool error', async () => {
        const { ctx } = ctxOver(tables());

        await expect(call(sweepStat, sweep({ from: 1, to: 100, step: 1 }), ctx)).rejects.toEqual(
            new McpToolError('a sweep runs at most 25 steps')
        );
    });

    it('defaults to 20 runs per step', () => {
        const { runs_per_step: _omitted, ...rest } = sweep();
        expect(sweepStat.input.parse(rest).runs_per_step).toBe(20);
    });

    it('reports the same points the engine itself produces for this input', async () => {
        const { ctx } = ctxOver(tables());
        const raw = sweep({ runs_per_step: 3 });
        const board = sweepStat.input.parse(raw);

        const { input, getGearPiece } = buildBattleInput(
            board,
            await loadBoardDataForTest(board, ctx)
        );
        const team = board.target.side === 'player' ? input.playerTeam : input.enemyTeam;
        const placement = team.find((candidate) => candidate.position === board.target.position)!;
        const current = placement.statOverrides![board.stat]!;
        const steps = sweepSteps(board.stat, board.from, board.to, board.step, current);
        const sweepResult = runStatSweep(
            input,
            board.target,
            board.stat,
            steps,
            board.seed,
            board.runs_per_step,
            getGearPiece
        );
        const points = analyseSweep(sweepResult);

        const out = (await call(sweepStat, raw, ctx)) as SweepOut;

        expect(out.current_value).toBe(current);
        expect(out.points).toEqual(
            points.map((point) => ({
                value: point.value,
                is_reference: point.isReference,
                win_rate: point.winRate,
                mean_rounds: point.meanRounds,
                team_damage: Math.round(point.playerDamage),
                ...(point.deltas && {
                    delta: {
                        win_rate: pairedDelta(point.deltas.winRate),
                        mean_rounds: pairedDelta(point.deltas.meanRounds),
                        team_damage: pairedDelta(point.deltas.playerDamage),
                    },
                }),
            }))
        );
        // At least one non-reference point carries a full delta series.
        expect(points.some((point) => point.deltas)).toBe(true);
    });
});
