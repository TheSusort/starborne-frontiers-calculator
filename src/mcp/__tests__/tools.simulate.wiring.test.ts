import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeGearStats } from '../../utils/gear/statsCodec';
import * as seededRuns from '../../utils/simulator/seededRuns';
import { simulateBattle, sweepStat } from '../tools/simulate';
import { McpToolError } from '../types';
import { AUTH_USER, call, ctxOver, templateRow } from './fixtures';

vi.mock('../../utils/simulator/seededRuns', async (importOriginal) => {
    const actual = await importOriginal<typeof seededRuns>();
    return { ...actual, runSeedSet: vi.fn(actual.runSeedSet) };
});

const GEAR_ID = '00000000-0000-4000-8000-000000000001';

const tables = () => ({
    users: [{ id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null }],
    ships: [
        {
            id: 's1',
            name: 'Geared',
            user_id: AUTH_USER,
            rarity: 'legendary',
            faction: 'ATLAS_SYNDICATE',
            type: 'ATTACKER',
            level: 60,
            rank: 6,
            ship_base_stats: { hp: 20000, attack: 2000, speed: 120 },
            ship_equipment: [{ slot: 'weapon', gear_id: GEAR_ID }],
            ship_implants: [],
            ship_refits: [],
            ship_templates: {
                image_key: '',
                active_skill_text: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                active_target: 'front',
                active_pattern: 'Pattern-Base',
            },
        },
    ],
    inventory_items: [
        {
            id: GEAR_ID,
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
    ship_templates: [templateRow({ active_target: 'front', active_pattern: 'Pattern-Base' })],
});

const raw = {
    player: [{ position: 'T1', ship_id: 's1' }],
    enemy: [{ position: 'T1', template: 'Atlas', variant: 'r0' }],
};

// The arrow body must not be an expression: `mockClear()` returns the mock itself (for
// chaining), and a hook that returns a function has Vitest treat it as a teardown callback —
// which would invoke `runSeedSet()` with no arguments after every test.
beforeEach(() => {
    vi.mocked(seededRuns.runSeedSet).mockClear();
});

describe('simulator tool wiring', () => {
    it('simulate_battle hands runSeedSet a getGearPiece that resolves the equipped gear', async () => {
        const { ctx } = ctxOver(tables());

        await call(simulateBattle, raw, ctx);

        const getGearPiece = vi.mocked(seededRuns.runSeedSet).mock.calls[0][3];
        expect(getGearPiece?.(GEAR_ID)?.id).toBe(GEAR_ID);
    });

    it('sweep_stat hands every step the same getGearPiece', async () => {
        const { ctx } = ctxOver(tables());

        await call(
            sweepStat,
            {
                ...raw,
                target: { side: 'player', position: 'T1' },
                stat: 'speed',
                from: 100,
                to: 140,
                step: 20,
                runs_per_step: 1,
            },
            ctx
        );

        const calls = vi.mocked(seededRuns.runSeedSet).mock.calls;
        expect(calls.length).toBeGreaterThan(1);
        for (const args of calls) expect(args[3]?.(GEAR_ID)?.id).toBe(GEAR_ID);
    });

    it('sweep_stat refuses a sweep over the battle cap before running a single battle', async () => {
        const { ctx } = ctxOver(tables());

        await expect(
            call(
                sweepStat,
                {
                    ...raw,
                    target: { side: 'player', position: 'T1' },
                    stat: 'speed',
                    from: 100,
                    to: 340,
                    step: 10,
                    runs_per_step: 100,
                },
                ctx
            )
        ).rejects.toBeInstanceOf(McpToolError);
        expect(seededRuns.runSeedSet).not.toHaveBeenCalled();
    });
});
