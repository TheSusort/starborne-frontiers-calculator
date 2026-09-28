import { z } from 'zod';
import type { BoardState } from '../components/simulator/PlacementBoard';
import { engineeringStatForShipType } from '../services/fleetReads';
import type { GearPiece } from '../types/gear';
import type { Position } from '../types/encounters';
import type { Ship } from '../types/ship';
import type { EngineeringStats } from '../types/stats';
import type { BattleSimulationInput } from '../utils/calculators/battleSimulator';
import type { SquadLeaderSelection } from '../utils/combat/preFight';
import { canBeFullyRefitted, referenceShip } from '../utils/ship/referenceShip';
import { buildTeam } from '../utils/simulator/buildTeam';
import { parseSquadLeaderSelection } from '../utils/simulator/squadLeaderSelection';
import { OVERRIDABLE_STATS, OVERRIDE_MIN } from '../utils/simulator/statOverrides';
import type { TemplateWithAscension } from './tools/ships';
import { McpToolError } from './types';

/** Battles one tool call may run: about 7 s at the measured ~14 ms a battle, inside the
 *  function's time limit with room for the database reads and a cold start. */
export const MAX_BATTLES = 500;

const POSITIONS = [
    'T1',
    'T2',
    'T3',
    'T4',
    'M1',
    'M2',
    'M3',
    'M4',
    'B1',
    'B2',
    'B3',
    'B4',
] as const satisfies readonly Position[];

const statOverrides = z
    .partialRecord(z.enum(OVERRIDABLE_STATS), z.number().int())
    .superRefine((overrides, ctx) => {
        for (const [stat, value] of Object.entries(overrides)) {
            const floor = OVERRIDE_MIN[stat as keyof typeof OVERRIDE_MIN] ?? 0;
            if (value !== undefined && value < floor) {
                ctx.addIssue({
                    code: 'custom',
                    path: [stat],
                    message: `${stat} must be at least ${floor}`,
                });
            }
        }
    })
    .describe(
        'Replace a stat after gear, refits, implants and engineering. Units as get_my_fleet reports them (crit 70, not 0.7).'
    );

const ownCell = z.object({
    position: z.enum(POSITIONS),
    ship_id: z.string().trim().min(1).describe('A ship id from get_my_fleet.'),
    stat_overrides: statOverrides.optional(),
});

const templateCell = z.object({
    position: z.enum(POSITIONS),
    template: z.string().trim().min(1).describe('A ship name from search_ships.'),
    variant: z
        .enum(['r0', 'refitted'])
        .describe('Level 60 with no gear: r0 has no refits, refitted has all 6.'),
    stat_overrides: statOverrides.optional(),
});

const leader = z.object({
    faction: z.string().trim().min(1),
    name: z.string().trim().min(1),
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

type Cell = z.output<typeof ownCell> | z.output<typeof templateCell>;

/** The input both simulator tools share. Combine with `refineBoards` via `superRefine`. */
export const boardInputShape = {
    profile_id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('A profile id from list_profiles. Defaults to your main account.'),
    player: z
        .array(ownCell)
        .min(1)
        .describe('Your ships. Board positions T1-T4 front, M middle, B back.'),
    enemy: z
        .array(z.union([ownCell, templateCell]))
        .min(1)
        .describe('Your own ships, or reference ships by name.'),
    player_leader: leader.optional(),
    enemy_leader: leader.optional(),
    seed: z.number().int().default(1).describe('Same seed and input, same result.'),
};

export type BoardInput = {
    profile_id?: string;
    player: z.output<typeof ownCell>[];
    enemy: Cell[];
    player_leader?: z.output<typeof leader>;
    enemy_leader?: z.output<typeof leader>;
    seed: number;
};

/** One ship per position, and each own ship at most once, per board. */
export const refineBoards = (value: BoardInput, ctx: z.RefinementCtx): void => {
    for (const side of ['player', 'enemy'] as const) {
        const cells: Cell[] = value[side];
        const positions = cells.map((cell) => cell.position);
        if (new Set(positions).size !== positions.length) {
            ctx.addIssue({ code: 'custom', path: [side], message: 'two ships on one position' });
        }
        const ids = cells.flatMap((cell) => ('ship_id' in cell ? [cell.ship_id] : []));
        if (new Set(ids).size !== ids.length) {
            ctx.addIssue({
                code: 'custom',
                path: [side],
                message: 'a ship placed twice on one board',
            });
        }
    }
};

/** Everything `buildBattleInput` reads, fetched by the caller. */
export interface BoardData {
    ships: Ship[];
    /** Keyed by lower-cased template name (`findShipTemplates`). */
    templates: Map<string, TemplateWithAscension>;
    gearById: Map<string, GearPiece>;
    engineering: EngineeringStats;
}

export interface BuiltBattle {
    input: BattleSimulationInput;
    /** Must reach `simulateBattle`: without it gear-set and implant abilities are dropped. */
    getGearPiece: (id: string) => GearPiece | undefined;
}

const resolveShip = (cell: Cell, data: BoardData): Ship => {
    if ('ship_id' in cell) {
        const ship = data.ships.find((candidate) => candidate.id === cell.ship_id);
        if (!ship) {
            throw new McpToolError(
                `${cell.ship_id} is not one of your ships on this profile. Use get_my_fleet for ship ids.`
            );
        }
        return ship;
    }
    const template = data.templates.get(cell.template.toLowerCase());
    if (!template) {
        throw new McpToolError(
            `No ship named "${cell.template}". Use search_ships to find the exact name.`
        );
    }
    if (cell.variant === 'refitted' && !canBeFullyRefitted(template.ascension)) {
        throw new McpToolError(
            `${template.ship.name} has no refit data, so only variant "r0" is available.`
        );
    }
    return referenceShip(template.ship, cell.variant, template.ascension);
};

const resolveLeader = (
    selection: BoardInput['player_leader']
): SquadLeaderSelection | undefined => {
    if (!selection) return undefined;
    const parsed = parseSquadLeaderSelection(JSON.stringify(selection));
    if (!parsed) {
        throw new McpToolError(
            `No squad leader "${selection.name}" in faction ${selection.faction}.`
        );
    }
    return parsed;
};

/**
 * The engine input the Simulator page would build for these boards. Each side goes through the
 * page's `buildTeam`, so cell order (T1..B4, first occupied is the focus actor) and resolved
 * stats match the page; one set of deps serves both sides, so the caller's engineering reaches
 * enemies too, as it does on the page.
 */
export function buildBattleInput(board: BoardInput, data: BoardData): BuiltBattle {
    const getGearPiece = (id: string) => data.gearById.get(id);
    const deps = {
        getGearPiece,
        getEngineeringStatsForShipType: (type: Ship['type']) =>
            engineeringStatForShipType(data.engineering, type),
    };
    const side = (cells: Cell[]): BoardState =>
        Object.fromEntries(
            cells.map((cell) => [
                cell.position,
                { ship: resolveShip(cell, data), overrides: cell.stat_overrides },
            ])
        );

    return {
        input: {
            playerTeam: buildTeam(side(board.player), deps),
            enemyTeam: buildTeam(side(board.enemy), deps),
            playerSquadLeader: resolveLeader(board.player_leader),
            enemySquadLeader: resolveLeader(board.enemy_leader),
        },
        getGearPiece,
    };
}
