import { describe, it, expect } from 'vitest';
import { encodeGearStats } from '../../utils/gear/statsCodec';
import { simulateBattle, sweepStat } from '../tools/simulate';
import { McpToolError } from '../types';
import { AUTH_USER, STRANGER, call, ctxOver, templateRow } from './fixtures';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const KIT = {
    image_key: '',
    active_skill_text: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    active_target: 'front',
    active_pattern: 'Pattern-Base',
};

const shipRow = (id: string, name: string, overrides = {}) => ({
    id,
    name,
    user_id: AUTH_USER,
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    affinity: 'thermal',
    level: 60,
    rank: 6,
    ship_base_stats: {
        hp: 20000,
        attack: 2000,
        defence: 500,
        crit: 50,
        crit_damage: 150,
        speed: 120,
    },
    ship_equipment: [],
    ship_implants: [],
    ship_refits: [],
    ship_templates: KIT,
    ...overrides,
});

const tables = () => ({
    users: [{ id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null }],
    ships: [
        shipRow('s1', 'Geared', { ship_equipment: [{ slot: 'weapon', gear_id: uuid(1) }] }),
        shipRow('s2', 'Bare'),
    ],
    inventory_items: [
        {
            id: uuid(1),
            user_id: AUTH_USER,
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            set_bonus: null,
            calibration_ship_id: null,
            stats: encodeGearStats({
                mainStat: { name: 'attack', value: 3000, type: 'flat' },
                subStats: [],
            }),
        },
    ],
    engineering_stats: [],
    ship_templates: [
        templateRow({
            id: 't1',
            name: 'Atlas',
            active_target: 'front',
            active_pattern: 'Pattern-Base',
            ascension_stats: [
                { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
            ],
        }),
    ],
});

const vsAtlas = (shipId: string, extra = {}) => ({
    player: [{ position: 'T1', ship_id: shipId }],
    enemy: [{ position: 'T1', template: 'Atlas', variant: 'r0' }],
    ...extra,
});

interface BattleOut {
    runs: number;
    outcome: { player_wins: number; enemy_wins: number; draws: number; win_rate: number };
    ships: { side: string; position: string; name: string; damage_dealt: number }[];
    unsimulated: unknown[];
}

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

    it('reads gear: a geared ship out-damages the same ship bare', async () => {
        const { ctx } = ctxOver(tables());

        // A single fight's total damage is bounded near the target's HP (whoever wins still
        // only need deal ~that much), so at n=3 which ship "wins" the comparison is overkill
        // noise, not a read of gear. n=10 gives the higher-attack ship room to pull ahead.
        const geared = (await call(simulateBattle, vsAtlas('s1', { runs: 10 }), ctx)) as BattleOut;
        const bare = (await call(simulateBattle, vsAtlas('s2', { runs: 10 }), ctx)) as BattleOut;

        expect(geared.ships[0].damage_dealt).toBeGreaterThan(bare.ships[0].damage_dealt);
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
