import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import { SQUAD_LEADERS } from '../../constants/squadLeaders';
import { buildBattleInput, boardInputShape, refineBoards, type BoardData } from '../simBoards';
import { McpToolError } from '../types';

const LEADER_NAME = SQUAD_LEADERS.MARAUDERS[0].name;

const schema = z.object(boardInputShape).superRefine(refineBoards);

const KIT = {
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
};

const ship = (id: string, overrides: Partial<Ship> = {}): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        baseStats: { hp: 10000, attack: 1000, defence: 500, crit: 10, critDamage: 50, speed: 100 },
        equipment: {},
        implants: {},
        refits: [],
        ...KIT,
        ...overrides,
    }) as unknown as Ship;

const weapon: GearPiece = {
    id: 'g1',
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 500, type: 'flat' },
    subStats: [],
} as unknown as GearPiece;

const ascension = [
    { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
    { level: 6, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
];

const data = (overrides: Partial<BoardData> = {}): BoardData => ({
    ships: [ship('s1', { equipment: { weapon: 'g1' } }), ship('s2')],
    templates: new Map([
        ['atlas', { ship: ship('tpl-atlas', { name: 'Atlas' }), ascension }],
        ['bare', { ship: ship('tpl-bare', { name: 'Bare' }), ascension: null }],
    ]),
    gearById: new Map([['g1', weapon]]),
    engineering: { stats: [] },
    ...overrides,
});

const board = (raw: Record<string, unknown>) => schema.parse(raw);

describe('board schema', () => {
    const ok = {
        player: [{ position: 'T1', ship_id: 's1' }],
        enemy: [{ position: 'T1', template: 'Atlas', variant: 'r0' }],
    };

    it('bounds the seed so every seed of a run set stays a safe integer', () => {
        expect(schema.safeParse({ ...ok, seed: 0 }).success).toBe(true);
        expect(schema.safeParse({ ...ok, seed: 2_147_483_647 }).success).toBe(true);
        expect(schema.safeParse({ ...ok, seed: 2_147_483_648 }).success).toBe(false);
        expect(schema.safeParse({ ...ok, seed: -1 }).success).toBe(false);
        expect(schema.safeParse({ ...ok, seed: Number.MAX_SAFE_INTEGER }).success).toBe(false);
    });

    it('accepts a minimal board and defaults the seed to 1', () => {
        expect(board(ok).seed).toBe(1);
    });

    it.each([
        ['an empty player board', { ...ok, player: [] }],
        [
            'two ships on one position',
            {
                ...ok,
                player: [
                    { position: 'T1', ship_id: 's1' },
                    { position: 'T1', ship_id: 's2' },
                ],
            },
        ],
        [
            'one ship twice on a board',
            {
                ...ok,
                player: [
                    { position: 'T1', ship_id: 's1' },
                    { position: 'T2', ship_id: 's1' },
                ],
            },
        ],
        ['a template on the player board', { ...ok, player: ok.enemy }],
        [
            'an hp override below 1',
            { ...ok, player: [{ position: 'T1', ship_id: 's1', stat_overrides: { hp: 0 } }] },
        ],
        [
            'a non-integer override',
            { ...ok, player: [{ position: 'T1', ship_id: 's1', stat_overrides: { crit: 0.7 } }] },
        ],
        [
            'an unknown stat key',
            { ...ok, player: [{ position: 'T1', ship_id: 's1', stat_overrides: { luck: 5 } }] },
        ],
        ['an unknown position', { ...ok, player: [{ position: 'X9', ship_id: 's1' }] }],
        [
            'an enemy cell with both a ship id and a template',
            {
                ...ok,
                enemy: [{ position: 'T1', ship_id: 's2', template: 'Atlas', variant: 'r0' }],
            },
        ],
        [
            'an unknown squad-leader faction',
            { ...ok, player_leader: { faction: 'NOBODY', name: LEADER_NAME, stage: 1 } },
        ],
    ])('rejects %s', (_label, raw) => {
        expect(schema.safeParse(raw).success).toBe(false);
    });

    it('bounds a side at the number of board positions', () => {
        // 13 cells has a duplicate position too (only 12 positions exist), so this checks for
        // the array's own too_big issue rather than relying on that duplicate check.
        const player = Array.from({ length: 13 }, (_, i) => ({
            position: 'T1',
            ship_id: `s${i}`,
        }));

        const result = schema.safeParse({ ...ok, player });

        expect(result.success).toBe(false);
        expect(
            !result.success &&
                result.error.issues.some(
                    (issue) => issue.code === 'too_big' && issue.path[0] === 'player'
                )
        ).toBe(true);
    });
});

describe('buildBattleInput', () => {
    const stats = (raw: Record<string, unknown>, side: 'playerTeam' | 'enemyTeam', d = data()) =>
        buildBattleInput(board(raw), d).input[side][0].statOverrides!;

    it('resolves an own ship to its geared final stats', () => {
        const raw = {
            player: [{ position: 'T1', ship_id: 's1' }],
            enemy: [{ position: 'T1', ship_id: 's2' }],
        };
        // s1 carries a +500 attack weapon; s2 is the same ship bare.
        expect(stats(raw, 'playerTeam').attack).toBe(1500);
        expect(stats(raw, 'enemyTeam').attack).toBe(1000);
    });

    it('hands the engine a getGearPiece that resolves equipped gear', () => {
        const { getGearPiece } = buildBattleInput(
            board({
                player: [{ position: 'T1', ship_id: 's1' }],
                enemy: [{ position: 'T1', ship_id: 's2' }],
            }),
            data()
        );
        expect(getGearPiece('g1')).toBe(weapon);
    });

    it('builds a refitted template with 6 refits and its ascension hp; r0 with none', () => {
        const at = (variant: string) =>
            buildBattleInput(
                board({
                    player: [{ position: 'T1', ship_id: 's2' }],
                    enemy: [{ position: 'T1', template: 'atlas', variant }],
                }),
                data()
            ).input.enemyTeam[0];

        expect(at('refitted').ship.refits).toHaveLength(6);
        expect(at('r0').ship.refits).toHaveLength(0);
        expect(at('refitted').statOverrides!.hp).toBeGreaterThan(at('r0').statOverrides!.hp!);
    });

    it("applies the caller's engineering to a template enemy", () => {
        const raw = {
            player: [{ position: 'T1', ship_id: 's2' }],
            enemy: [{ position: 'T1', template: 'Atlas', variant: 'r0' }],
        };
        const engineered = data({
            engineering: {
                stats: [
                    {
                        shipType: 'ATTACKER',
                        stats: [{ name: 'hp', value: 10, type: 'percentage' }],
                    },
                ],
            } as unknown as BoardData['engineering'],
        });

        expect(stats(raw, 'enemyTeam', engineered).hp).toBeGreaterThan(stats(raw, 'enemyTeam').hp!);
    });

    it('puts user overrides on top of the resolved stats', () => {
        const raw = {
            player: [{ position: 'T1', ship_id: 's1', stat_overrides: { speed: 180 } }],
            enemy: [{ position: 'T1', ship_id: 's2' }],
        };
        expect(stats(raw, 'playerTeam')).toMatchObject({ speed: 180, attack: 1500 });
    });

    it('puts overrides on a template enemy', () => {
        const raw = {
            player: [{ position: 'T1', ship_id: 's2' }],
            enemy: [
                {
                    position: 'T1',
                    template: 'Atlas',
                    variant: 'r0',
                    stat_overrides: { speed: 175 },
                },
            ],
        };
        expect(stats(raw, 'enemyTeam')).toMatchObject({ speed: 175, attack: 1000 });
    });

    it('orders a side T1..B4 whatever order the cells came in', () => {
        const { input } = buildBattleInput(
            board({
                player: [
                    { position: 'B2', ship_id: 's2' },
                    { position: 'T3', ship_id: 's1' },
                ],
                enemy: [{ position: 'T1', template: 'Atlas', variant: 'r0' }],
            }),
            data()
        );
        expect(input.playerTeam.map((p) => p.position)).toEqual(['T3', 'B2']);
    });

    it('passes validated squad leaders through', () => {
        const { input } = buildBattleInput(
            board({
                player: [{ position: 'T1', ship_id: 's1' }],
                enemy: [{ position: 'T1', ship_id: 's2' }],
                player_leader: { faction: 'MARAUDERS', name: LEADER_NAME, stage: 2 },
            }),
            data()
        );
        expect(input.playerSquadLeader).toEqual({
            faction: 'MARAUDERS',
            name: LEADER_NAME,
            stage: 2,
        });
    });

    it.each([
        [
            'a ship that is not on the profile',
            {
                player: [{ position: 'T1', ship_id: 'nope' }],
                enemy: [{ position: 'T1', ship_id: 's2' }],
            },
            'nope is not one of your ships on this profile. Use get_my_fleet for ship ids.',
        ],
        [
            'refitted on a template with no refit data',
            {
                player: [{ position: 'T1', ship_id: 's1' }],
                enemy: [{ position: 'T1', template: 'Bare', variant: 'refitted' }],
            },
            'Bare has no refit data, so only variant "r0" is available.',
        ],
        [
            'a template the data does not hold',
            {
                player: [{ position: 'T1', ship_id: 's1' }],
                enemy: [{ position: 'T1', template: 'Nobody', variant: 'r0' }],
            },
            'No ship named "Nobody". Use search_ships to find the exact name.',
        ],
        [
            'an unknown squad leader',
            {
                player: [{ position: 'T1', ship_id: 's1' }],
                enemy: [{ position: 'T1', ship_id: 's2' }],
                enemy_leader: { faction: 'MARAUDERS', name: 'Nobody', stage: 1 },
            },
            'No squad leader "Nobody" in faction MARAUDERS.',
        ],
    ])('rejects %s', (_label, raw, message) => {
        expect(() => buildBattleInput(board(raw), data())).toThrow(new McpToolError(message));
    });
});
