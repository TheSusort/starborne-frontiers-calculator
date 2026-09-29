import { describe, it, expect } from 'vitest';
import { simulateBattle, sweepStat } from '../tools/simulate';
import { McpToolError } from '../types';
import { STRANGER, call, ctxOver } from './fixtures';
import { simTables as tables, vsAtlas } from './simFixtures';

interface BattleOut {
    runs: number;
    outcome: { player_wins: number; enemy_wins: number; draws: number; win_rate: number };
    ships: { side: string; position: string; name: string; damage_dealt: number }[];
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
});
