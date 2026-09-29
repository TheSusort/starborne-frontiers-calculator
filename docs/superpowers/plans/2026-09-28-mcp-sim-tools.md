# MCP `simulate_battle` / `sweep_stat` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two MCP tools that run the combat simulator on boards of the caller's own ships and/or reference ships, and sweep one stat on one ship, returning the same numbers the Simulator page shows.

**Architecture:** In-process in the existing `/mcp` Netlify function, synchronous. A pure board builder (`src/mcp/simBoards.ts`) turns validated input plus fetched rows into a `BattleSimulationInput` using the page's own `buildTeam` / `referenceShip`; the tools (`src/mcp/tools/simulate.ts`) fetch, build, run `runSeedSet` / a new synchronous `runStatSweep`, and summarise.

**Tech Stack:** TypeScript, zod 4 (`z.partialRecord`, refinements stay on `ZodObject`), `@modelcontextprotocol/sdk` 1.30, vitest, the `stubDb` Supabase stand-in.

**Spec:** `docs/superpowers/specs/2026-09-28-mcp-sim-tools-design.md`

## Global Constraints

- Work in the worktree `.claude/worktrees/mcp-sim` on branch `feat/mcp-sim-tools`. It already has `.env`, `docs/` reference data, a `node_modules` symlink and `.husky/_`.
- **Node 22.** Every shell: `source ~/.nvm/nvm.sh && nvm use 22`. On Node 20 the pre-commit `nodeLoad` test fails on a supabase-js deprecation warning — that is the Node version, not your diff.
- The husky pre-commit hook runs lint-staged, `tsc --noEmit` and the full vitest suite. Never `--no-verify`. Never `vitest -u`.
- **Never run the Supabase CLI** in any form (CLAUDE.md Security rule 8).
- `docs/` is gitignored: add the spec/plan with `git add -f`.
- Battle cap: **500 battles per call** (`MAX_BATTLES`). `simulate_battle` `runs` 1–200, default **1**. `sweep_stat` `runs_per_step` 1–100, default **20**. Default `seed` **1**.
- `stat_overrides` are integers in `get_my_fleet`'s units (crit `70`, not `0.7`), floored at `OVERRIDE_MIN` (hp ≥ 1, others ≥ 0).
- The caller's engineering applies to every ship on both boards, template enemies included.
- Every user-facing failure is an `McpToolError` (message shown verbatim to the assistant).
- Code comments follow CLAUDE.md "Code Comments": present-tense contracts only, no task numbers, no counts.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/simulator/statSweep.ts` (modify) | add `runStatSweep`, the synchronous twin of `runStatSweepAsync` |
| `src/mcp/tools/ships.ts` (modify) | add `findShipTemplates`: templates by name with parsed `ascension_stats` |
| `src/mcp/simBoards.ts` (create) | shared zod board schema, `MAX_BATTLES`, pure `buildBattleInput` |
| `src/mcp/tools/simulate.ts` (create) | `loadBoardData` + the `simulateBattle` and `sweepStat` tools |
| `src/mcp/registry.ts` (modify) | register both tools |
| `src/mcp/__tests__/nodeLoad.test.ts` (modify) | add the new modules to `ENTRIES` |
| `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts` (modify) | docs + changelog |

---

### Task 1: `runStatSweep` — synchronous sweep

**Files:**
- Modify: `src/utils/simulator/statSweep.ts`
- Test: `src/utils/simulator/__tests__/statSweepRun.test.ts`

**Interfaces:**
- Produces: `runStatSweep(input: BattleSimulationInput, target: SweepTarget, stat: OverridableStat, steps: SweepStep[], baseSeed: number, count: number, getGearPiece?: (id: string) => GearPiece | undefined): SweepResult`

- [ ] **Step 1: Write the failing test** — append to `statSweepRun.test.ts` (add `runStatSweep` and `sweepSteps` to the existing `../statSweep` import):

```ts
describe('runStatSweep', () => {
    it('returns exactly what runStatSweepAsync returns for the same input', async () => {
        const input = sweepBoardInput();
        const target = { side: 'player', position: 'T1' } as const;
        const steps = sweepSteps('attack', 3000, 5000, 1000, 4000);

        const sync = runStatSweep(input, target, 'attack', steps, 7, 3);
        const async = await runStatSweepAsync(input, target, 'attack', steps, 7, 3);

        expect(sync).toEqual(async);
    });

    it('is not vacuous: the steps differ from each other', () => {
        const input = sweepBoardInput();
        const target = { side: 'player', position: 'T1' } as const;
        const steps = sweepSteps('attack', 1000, 8000, 7000, 4000);

        const result = runStatSweep(input, target, 'attack', steps, 7, 3);

        const damage = result.steps.map((s) =>
            Object.values(s.aggregate.perActorMean).reduce((t, a) => t + a.damageDealt, 0)
        );
        expect(new Set(damage).size).toBeGreaterThan(1);
    });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`runStatSweep` is not exported)

Run: `npx vitest run src/utils/simulator/__tests__/statSweepRun.test.ts`

- [ ] **Step 3: Implement** — in `statSweep.ts` change the import to `import { runSeedSet, runSeedSetAsync, type SeedSetAggregate } from './seededRuns';` and add after `runStatSweepAsync`:

```ts
/**
 * `runStatSweepAsync` without the yields: every step runs on the calling task. For a caller with
 * no page to keep responsive (the MCP server). Same seed set per step, so steps stay paired.
 */
export function runStatSweep(
    input: BattleSimulationInput,
    target: SweepTarget,
    stat: OverridableStat,
    steps: SweepStep[],
    baseSeed: number,
    count: number,
    getGearPiece?: (id: string) => GearPiece | undefined
): SweepResult {
    return {
        stat,
        target,
        baseSeed,
        count,
        steps: steps.map((step) => ({
            value: step.value,
            isReference: step.isReference,
            aggregate: runSeedSet(
                stepInput(input, target, stat, step.value),
                baseSeed,
                count,
                getGearPiece
            ),
        })),
    };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/utils/simulator/__tests__/statSweepRun.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/utils/simulator/statSweep.ts src/utils/simulator/__tests__/statSweepRun.test.ts
git commit -m "feat(simulator): synchronous runStatSweep for the MCP server (#562)"
```

---

### Task 2: `findShipTemplates` — templates with ascension rows

**Files:**
- Modify: `src/mcp/tools/ships.ts`
- Test: `src/mcp/__tests__/tools.ships.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TemplateWithAscension { ship: Ship; ascension: AscensionStat[] | null }
  export async function findShipTemplates(db: SupabaseClient, names: readonly string[]): Promise<Map<string, TemplateWithAscension>>
  // keyed by name.toLowerCase(); throws McpToolError for the first unknown name
  ```

- [ ] **Step 1: Write the failing tests** — append to `tools.ships.test.ts` (import `findShipTemplates` from `../tools/ships`):

```ts
describe('findShipTemplates', () => {
    const ascension = [{ level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 }];

    it('returns each named template with its parsed ascension rows, keyed by lower-case name', async () => {
        const { ctx } = ctxOver({
            ship_templates: [
                templateRow({ id: 't1', name: 'Atlas', ascension_stats: ascension }),
                templateRow({ id: 't2', name: 'Zeta' }),
            ],
        });

        const found = await findShipTemplates(ctx.db, ['ATLAS', 'zeta']);

        expect(found.get('atlas')).toMatchObject({ ship: { name: 'Atlas' }, ascension });
        expect(found.get('zeta')).toMatchObject({ ship: { name: 'Zeta' }, ascension: null });
    });

    it('rejects an unknown name with the search_ships hint', async () => {
        const { ctx } = ctxOver({ ship_templates: [templateRow()] });

        await expect(findShipTemplates(ctx.db, ['Nobody'])).rejects.toEqual(
            new McpToolError('No ship named "Nobody". Use search_ships to find the exact name.')
        );
    });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/mcp/__tests__/tools.ships.test.ts`

- [ ] **Step 3: Implement** — in `ships.ts`, add imports `import { parseAscensionStats, type AscensionStat } from '../../utils/ship/referenceShip';`, and replace `fetchShipTemplates` / `findShipTemplate` with:

```ts
async function fetchTemplateRows(db: SupabaseClient): Promise<ShipTemplate[]> {
    const { data, error } = await db.from('ship_templates').select('*');
    if (error) throw error;
    return data as ShipTemplate[];
}

/** Every ship template, as the website's ship database builds them. */
async function fetchShipTemplates(db: SupabaseClient): Promise<Ship[]> {
    return (await fetchTemplateRows(db))
        .map(transformShipTemplate)
        .filter((ship): ship is Ship => ship !== null);
}

const unknownShip = (name: string) =>
    new McpToolError(`No ship named "${name}". Use search_ships to find the exact name.`);

/** The one template named `name`, case-insensitively. */
export async function findShipTemplate(db: SupabaseClient, name: string): Promise<Ship> {
    const wanted = name.toLowerCase();
    const ship = (await fetchShipTemplates(db)).find((t) => t.name.toLowerCase() === wanted);
    if (!ship) throw unknownShip(name);
    return ship;
}

/** A template and the ascension rows `referenceShip` builds its refits and innate stats from.
 *  `transformShipTemplate` drops `ascension_stats`, so it is read off the raw row here, as
 *  `useShipsData` does. */
export interface TemplateWithAscension {
    ship: Ship;
    ascension: AscensionStat[] | null;
}

/** Each of `names`, case-insensitively, keyed by its lower-cased name. One read of the table. */
export async function findShipTemplates(
    db: SupabaseClient,
    names: readonly string[]
): Promise<Map<string, TemplateWithAscension>> {
    const byName = new Map<string, TemplateWithAscension>();
    for (const row of await fetchTemplateRows(db)) {
        const ship = transformShipTemplate(row);
        if (ship) {
            byName.set(ship.name.toLowerCase(), {
                ship,
                ascension: parseAscensionStats(row.ascension_stats),
            });
        }
    }
    const found = new Map<string, TemplateWithAscension>();
    for (const name of names) {
        const template = byName.get(name.toLowerCase());
        if (!template) throw unknownShip(name);
        found.set(name.toLowerCase(), template);
    }
    return found;
}
```

- [ ] **Step 4: Run — expect PASS** (the whole file, so `search_ships` / `get_ship` still pass). `npx vitest run src/mcp/__tests__/tools.ships.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/ships.ts src/mcp/__tests__/tools.ships.test.ts
git commit -m "feat(mcp): read ship templates with their ascension rows (#562)"
```

---

### Task 3: `simBoards.ts` — board schema and pure builder

**Files:**
- Create: `src/mcp/simBoards.ts`
- Test: `src/mcp/__tests__/simBoards.test.ts`

**Interfaces:**
- Consumes: `TemplateWithAscension` (Task 2).
- Produces:
  ```ts
  export const MAX_BATTLES = 500;
  export const boardInputShape: { profile_id, player, enemy, player_leader, enemy_leader, seed }  // zod shape
  export const refineBoards: (value: BoardInput, ctx: z.RefinementCtx) => void
  export type BoardInput = { profile_id?: string; player: Cell[]; enemy: Cell[]; player_leader?: Leader; enemy_leader?: Leader; seed: number }
  export interface BoardData { ships: Ship[]; templates: Map<string, TemplateWithAscension>; gearById: Map<string, GearPiece>; engineering: EngineeringStats }
  export interface BuiltBattle { input: BattleSimulationInput; getGearPiece: (id: string) => GearPiece | undefined }
  export function buildBattleInput(board: BoardInput, data: BoardData): BuiltBattle
  ```

- [ ] **Step 1: Write the failing tests** — create `src/mcp/__tests__/simBoards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import { buildBattleInput, boardInputShape, refineBoards, type BoardData } from '../simBoards';
import { McpToolError } from '../types';

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
    ])('rejects %s', (_label, raw) => {
        expect(schema.safeParse(raw).success).toBe(false);
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
                stats: [{ shipType: 'ATTACKER', stats: [{ name: 'hp', value: 10, type: 'percentage' }] }],
            } as unknown as BoardData['engineering'],
        });

        expect(stats(raw, 'enemyTeam', engineered).hp).toBeGreaterThan(
            stats(raw, 'enemyTeam').hp!
        );
    });

    it('puts user overrides on top of the resolved stats', () => {
        const raw = {
            player: [{ position: 'T1', ship_id: 's1', stat_overrides: { speed: 180 } }],
            enemy: [{ position: 'T1', ship_id: 's2' }],
        };
        expect(stats(raw, 'playerTeam')).toMatchObject({ speed: 180, attack: 1500 });
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
            { player: [{ position: 'T1', ship_id: 'nope' }], enemy: [{ position: 'T1', ship_id: 's2' }] },
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
```

Also add near the top of the test file, so the leader name is real data rather than a guess:

```ts
import { SQUAD_LEADERS } from '../../constants/squadLeaders';
const LEADER_NAME = SQUAD_LEADERS.MARAUDERS[0].name;
```

If `MARAUDERS` is not a `FactionName` key, open `src/constants/factions.ts`, pick the key `SQUAD_LEADERS` is filled for (the file header names Marauders as the worked reference) and use it in both the import line and the tests.

- [ ] **Step 2: Run — expect FAIL** (module missing). `npx vitest run src/mcp/__tests__/simBoards.test.ts`

- [ ] **Step 3: Implement** — create `src/mcp/simBoards.ts`:

```ts
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
    'T1', 'T2', 'T3', 'T4', 'M1', 'M2', 'M3', 'M4', 'B1', 'B2', 'B3', 'B4',
] as const satisfies readonly Position[];

const statOverrides = z
    .partialRecord(z.enum(OVERRIDABLE_STATS), z.number().int())
    .superRefine((overrides, ctx) => {
        for (const [stat, value] of Object.entries(overrides)) {
            const floor = OVERRIDE_MIN[stat as keyof typeof OVERRIDE_MIN] ?? 0;
            if (value !== undefined && value < floor) {
                ctx.addIssue({ code: 'custom', path: [stat], message: `${stat} must be at least ${floor}` });
            }
        }
    })
    .describe(
        "Replace a stat after gear, refits, implants and engineering. Units as get_my_fleet reports them (crit 70, not 0.7)."
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
    player: z.array(ownCell).min(1).describe('Your ships. Board positions T1-T4 front, M middle, B back.'),
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
            ctx.addIssue({ code: 'custom', path: [side], message: 'a ship placed twice on one board' });
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
        throw new McpToolError(`No ship named "${cell.template}". Use search_ships to find the exact name.`);
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
```

Notes for the implementer:
- `Ship['type']` must be `ShipTypeName` (what `engineeringStatForShipType` takes). If `Ship.type` is wider or optional, type the lambda as `(type: ShipTypeName)` from `../constants/shipTypes` — that is `CombatStatsDeps`' own signature.
- If `z.partialRecord` does not reject an unknown key (the `luck` test), add `.strict()`-equivalent behaviour by checking `Object.keys` inside the `superRefine` against `OVERRIDABLE_STATS`.
- Prettier will reflow `POSITIONS`; let lint-staged do it.

- [ ] **Step 4: Run — expect PASS.** `npx vitest run src/mcp/__tests__/simBoards.test.ts` then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/simBoards.ts src/mcp/__tests__/simBoards.test.ts
git commit -m "feat(mcp): board schema and builder for the simulator tools (#562)"
```

---

### Task 4: the `simulate_battle` and `sweep_stat` tools

**Files:**
- Create: `src/mcp/tools/simulate.ts`
- Modify: `src/mcp/registry.ts`, `src/mcp/__tests__/nodeLoad.test.ts`
- Test: `src/mcp/__tests__/tools.simulate.test.ts`, `src/mcp/__tests__/tools.simulate.wiring.test.ts`

**Interfaces:**
- Consumes: `runStatSweep` (Task 1), `findShipTemplates` (Task 2), `boardInputShape`, `refineBoards`, `buildBattleInput`, `MAX_BATTLES`, `BoardInput`, `BoardData` (Task 3); `runSeedSet`, `runSeededBattle` (`src/utils/simulator/seededRuns.ts`); `sweepSteps` (`statSweep.ts`); `analyseSweep` (`sweepAnalysis.ts`).
- Produces: `export const simulateBattle: McpTool<...>` (name `simulate_battle`), `export const sweepStat: McpTool<...>` (name `sweep_stat`).

- [ ] **Step 1: Write the failing tool tests** — create `src/mcp/__tests__/tools.simulate.test.ts`:

```ts
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
    ship_base_stats: { hp: 20000, attack: 2000, defence: 500, crit: 50, crit_damage: 150, speed: 120 },
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
            ascension_stats: [{ level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 }],
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

        const geared = (await call(simulateBattle, vsAtlas('s1', { runs: 3 }), ctx)) as BattleOut;
        const bare = (await call(simulateBattle, vsAtlas('s2', { runs: 3 }), ctx)) as BattleOut;

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

        await expect(
            call(sweepStat, sweep({ from: 1, to: 100, step: 1 }), ctx)
        ).rejects.toEqual(new McpToolError('a sweep runs at most 25 steps'));
    });

    it('defaults to 20 runs per step', () => {
        const { runs_per_step: _omitted, ...rest } = sweep();
        expect(sweepStat.input.parse(rest).runs_per_step).toBe(20);
    });
});
```

- [ ] **Step 2: Write the failing wiring tests** — create `src/mcp/__tests__/tools.simulate.wiring.test.ts`. A separate file because it mocks `seededRuns` for the whole module graph:

```ts
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

beforeEach(() => vi.mocked(seededRuns.runSeedSet).mockClear());

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
            { ...raw, target: { side: 'player', position: 'T1' }, stat: 'speed', from: 100, to: 140, step: 20, runs_per_step: 1 },
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
                { ...raw, target: { side: 'player', position: 'T1' }, stat: 'speed', from: 100, to: 340, step: 10, runs_per_step: 100 },
                ctx
            )
        ).rejects.toBeInstanceOf(McpToolError);
        expect(seededRuns.runSeedSet).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run both — expect FAIL** (module missing).

Run: `npx vitest run src/mcp/__tests__/tools.simulate.test.ts src/mcp/__tests__/tools.simulate.wiring.test.ts`

- [ ] **Step 4: Implement** — create `src/mcp/tools/simulate.ts`:

```ts
import { z } from 'zod';
import { fetchEngineeringStats, fetchGearByIds, fetchShips } from '../../services/fleetReads';
import type { BattleSimulationInput } from '../../utils/calculators/battleSimulator';
import type { GearPiece } from '../../types/gear';
import { clearGearStatsCache } from '../../utils/ship/statsCalculator';
import { runSeedSet, runSeededBattle } from '../../utils/simulator/seededRuns';
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

/** Reads everything `buildBattleInput` needs, as the caller (RLS applies). */
async function loadBoardData(board: BoardInput, ctx: McpToolContext): Promise<BoardData> {
    const profileId = board.profile_id ?? ctx.authUserId;
    const profiles = await fetchProfiles(ctx);
    if (!profiles.some((profile) => profile.id === profileId)) {
        throw new McpToolError('not one of your profiles');
    }

    const templateNames = board.enemy.flatMap((cell) => ('template' in cell ? [cell.template] : []));
    const [ships, engineering, templates] = await Promise.all([
        fetchShips(ctx.db, profileId),
        fetchEngineeringStats(ctx.db, profileId),
        templateNames.length > 0
            ? findShipTemplates(ctx.db, templateNames)
            : Promise.resolve(new Map()),
    ]);

    const placedIds = new Set(
        [...board.player, ...board.enemy].flatMap((cell) => ('ship_id' in cell ? [cell.ship_id] : []))
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
            .describe('Seeds seed .. seed+runs-1. One run replays one fight; compare configurations over 20 or more.'),
    })
    .superRefine(refineBoards);

export const simulateBattle: McpTool<z.output<typeof simulateBattleInput>> = {
    name: 'simulate_battle',
    description:
        "Fight your ships against enemies in the planner's combat simulator, with gear, implants, refits and engineering applied as the Simulator page does. Enemies are your own ships or reference ships by name (level 60, r0 or fully refitted, no gear); your engineering applies to both sides. Returns win/loss counts, rounds, and each ship's mean damage dealt, taken and healing done." +
        CAVEATS,
    input: simulateBattleInput,
    run: async (board, ctx) => {
        const { input, getGearPiece } = buildBattleInput(board, await loadBoardData(board, ctx));
        const aggregate = runSeedSet(input, board.seed, board.runs, getGearPiece);
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
            runStatSweep(input, target, stat, steps, args.seed, args.runs_per_step, getGearPiece)
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
```

Notes for the implementer:
- `boardInputShape.player.element.shape.position` reuses the position enum; if zod 4's typing fights it, export `POSITIONS` from `simBoards.ts` and use `z.enum(POSITIONS)` instead.
- `buildBattleInput(args, …)` receives the sweep input, which is a superset of `BoardInput`; that is fine structurally.
- If `PairedDelta` is not exported from `deltaStats.ts` under that name, import whatever type `SweepPoint['deltas']` values use.

- [ ] **Step 5: Register and tripwire** — in `src/mcp/registry.ts` add `import { simulateBattle, sweepStat } from './tools/simulate';` and append `defineTool(simulateBattle), defineTool(sweepStat),` to `TOOLS`. Change the `TOOLS` doc comment to `/** Every tool the MCP server offers. None of them writes. */`. In `src/mcp/__tests__/nodeLoad.test.ts` append to `ENTRIES`:

```ts
    'src/mcp/simBoards.ts',
    'src/mcp/tools/simulate.ts',
    'src/utils/simulator/seededRuns.ts',
```

If `src/mcp/__tests__/registry.test.ts` pins the tool-name list, add `'simulate_battle'` and `'sweep_stat'` there.

- [ ] **Step 6: Run — expect PASS.**

Run: `npx vitest run src/mcp` then `npx tsc --noEmit` then `npx eslint src/mcp`.

- [ ] **Step 7: Commit**

```bash
git add src/mcp
git commit -m "feat(mcp): simulate_battle and sweep_stat tools (#562)"
```

---

### Task 5: docs, changelog, and the timing check

**Files:**
- Modify: `src/pages/DocumentationPage.tsx` (the `ai-assistants` section, "What the Assistant Can Read" list), `src/constants/changelog.ts`
- Scratch (not committed): `<scratchpad>/benchMcpSim.ts`

- [ ] **Step 1: Docs** — in `DocumentationPage.tsx`, rename the `<h4>` "What the Assistant Can Read" to "What the Assistant Can Do" and append to its `<ul>`:

```tsx
<li>
    Run your ships through the combat simulator against your own ships or reference ships,
    and sweep one stat to see where it stops mattering
</li>
```

- [ ] **Step 2: Changelog** — in `src/constants/changelog.ts` append to `UNRELEASED_CHANGES`:

```ts
    'AI assistants: your assistant can now run battles and stat sweeps.',
```

- [ ] **Step 3: Timing measurement.** Write `benchMcpSim.ts` in the session scratchpad directory (not the repo). It builds the worst case the tools allow and times it:
  - 12 real ships per side from `buildTraceShip(name, { refitLevel: 4 })` (`scripts/lib/traceShipFactory.ts`, reads the local `docs/` data), picking the first 24 names from `docs/ship-skills.csv` that return non-null, one per position `T1`…`B4`.
  - `statOverrides` from each ship's `baseStats` via `combatStatsFromShip(shipFinalStats(ship, { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined }))`.
  - Time `runSeedSet(input, 1, 500)` with `performance.now()`; also time a 5v5 board the same way.
  - Run: `npx tsx <scratchpad>/benchMcpSim.ts`. Record `total ms` and `ms/battle` for both boards.
  - If the 12v12 × 500 figure exceeds **15 000 ms**, lower `MAX_BATTLES` in `src/mcp/simBoards.ts` to `floor(15000 / msPerBattle12v12 / 50) * 50` and update the sweep description text (it interpolates `MAX_BATTLES`, so only the doc comment's "about 7 s" needs editing).

- [ ] **Step 4: Full suite + commit**

Run: `npx tsc --noEmit && npx vitest run src/mcp src/utils/simulator`

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts src/mcp/simBoards.ts
git commit -m "docs(mcp): simulator tools in the in-app docs and changelog (#562)"
```

Report the timing numbers in your final message; they go in the PR body.
