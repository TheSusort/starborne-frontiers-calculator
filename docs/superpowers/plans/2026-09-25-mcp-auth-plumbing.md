# MCP Auth Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin connects Claude to `https://starborneplanner.com/mcp`, signs in through Supabase OAuth, approves on `/oauth/consent`, and calls seven read-only tools over their fleet and the game data.

**Architecture:** The fleet read code moves out of the React contexts into `src/services/fleetReads.ts` (pure functions taking a `SupabaseClient`), so a Netlify Function can reuse it with a per-request client built from the caller's OAuth token. Transport-agnostic tools live in `src/mcp/`; `src/mcp/http.ts` is a web-standard `Request → Response` handler (token verification via JWKS, admin gate, stateless MCP server per request); `netlify/functions/mcp.ts` is a thin adapter. The SPA gains an OAuth consent page.

**Tech Stack:** TypeScript, React 18, Supabase JS 2.116, `@modelcontextprotocol/sdk` 1.30.1 (`McpServer`, `WebStandardStreamableHTTPServerTransport`), `jose` 6, Zod 4, Vitest 3, Netlify Functions (v2, web-standard `Request`).

**Spec:** `docs/superpowers/specs/2026-09-25-mcp-auth-plumbing-design.md` (background: `docs/superpowers/specs/2026-09-25-mcp-oauth-read-only-tokens-design.md`).

## Global Constraints

- `@modelcontextprotocol/sdk` pinned at `1.30.1` and `jose` go in **`dependencies`** (shipped runtime, so `npm run audit` covers them). Zod stays the repo's `zod` 4.6.5 (SDK peer `zod ^3.25 || ^4.0`).
- Transport: `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` — a fresh server **and** transport per request (the SDK throws "Stateless transport cannot be reused across requests").
- The function reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `process.env` (via `node:process`), **never** `import.meta.env`. No service-role key, no JWT secret.
- Nothing under `src/mcp/`, `netlify/functions/` or `src/services/fleetReads.ts` imports `src/config/supabase.ts`; tools import `src/constants/gearSets.ts`, `implants.ts` etc. directly, never the `src/constants/index.tsx` barrel. `src/mcp/__tests__/nodeLoad.test.ts` is the tripwire.
- Every MCP read is a `GET` (`.select()`); an RPC, if ever needed, uses `{ get: true }`. The admin gate is `select is_admin from users where id = <sub>` with the caller's client — never the `is_user_admin` RPC (a POST, which the database refuses for OAuth tokens).
- Tokens: ES256 only, verified against `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, `iss` = `<SUPABASE_URL>/auth/v1`, `exp` required, `client_id` required.
- Errors follow the spec's table exactly: 401 + `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`; 403 JSON-RPC error "MCP access is currently limited to admins"; 405 for non-POST on `/mcp`; tool failures are tool results with `isError: true` ("this tool cannot change your data" for `PT403`, "not one of your profiles" for an unknown profile, no stack/SQL for Supabase errors).
- `hpRegen` is planner-internal and is never returned by a tool (`src/mcp/playerStats.ts`).
- **Never run the Supabase CLI** in any form (`supabase`, `npx supabase`, a package script). This plan needs no migration.
- UI: `Button`, the `card` class and existing layout components (`PageLayout`, `Loader`) only — no raw `<button>`, no hand-rolled boxes.
- Code comments follow CLAUDE.md "Code Comments": present-tense contracts and pointers only — no task numbers, no change history.
- No changelog entry and no `DocumentationPage` section (admins only; the rollout PR adds them).
- Node 22 (`node -v` must print v22.x; `package.json` engines is `>=22`). Tests that load `jose` or the MCP SDK start with `// @vitest-environment node` (the global test environment is jsdom).
- The pre-commit hook runs `lint-staged`, `tsc --noEmit` and the full vitest suite (several minutes). Every commit step checks the exit code. Never `git stash`; never `vitest -u`.
- The worktree's `node_modules` must be a real directory, not a symlink to the main checkout (`ls -ld node_modules` must not show `->`), so installing packages never touches the main checkout.

## File Structure

| File | Responsibility |
|---|---|
| `src/services/fleetReads.ts` (create) | `fetchShips`, `fetchInventory`, `fetchEngineeringStats`, `transformGearData`, `engineeringStatForShipType` — the signed-in read path, client passed in |
| `src/contexts/ShipsContext.tsx`, `InventoryProvider.tsx`, `EngineeringStatsProvider.tsx` (modify) | Call `fleetReads` with the global client; state/storage/migration handling unchanged |
| `src/__tests__/services/stubDb.ts` (create) | Minimal chainable `SupabaseClient` stand-in that evaluates `eq`/`or`/`gt`/`order`/`limit` |
| `src/utils/ship/shipTemplate.ts` (create) | `ShipTemplate` row type + `transformShipTemplate`, moved out of `useShipsData.ts` so the MCP tools can build template ships |
| `src/mcp/types.ts` | `McpToolContext`, `McpTool<I>`, `RegisteredMcpTool`, `defineTool`, `McpToolError` |
| `src/mcp/auth.ts` | `verifyAccessToken` + `AuthError` |
| `src/mcp/errors.ts` | `toolErrorMessage` — what an agent sees when a tool throws |
| `src/mcp/playerStats.ts` | Drops `hpRegen` from any stat block a tool returns |
| `src/mcp/registry.ts` | `TOOLS` + `registerTools(server, ctx, tools?)` |
| `src/mcp/tools/{gear,ships,skills,profiles,fleet}.ts` | The seven tools |
| `src/mcp/http.ts` | `createMcpHandler` — metadata, 401/403/405, per-request server + transport |
| `netlify/functions/mcp.ts` | Netlify adapter: env, remote JWKS, `config.path` |
| `src/pages/OAuthConsentPage.tsx` + route | Consent screen at `/oauth/consent` |
| `src/services/auth/*`, `src/contexts/AuthProvider.tsx` (modify) | `signInWithGoogle(redirectTo?)` |
| `scripts/oauth-probe.ts` | Manual Auth API probe (not in CI) |
| `tsconfig.json`, `package.json` (lint, lint-staged, deps), `knip.json`, `scripts/netlify-ignore.sh` (comment) | Gates widened to `netlify/functions` |

---
### Task 1: `fetchShips` — extract the ships read

Behaviour-preserving refactor. The tripwire is the existing `src/contexts/__tests__/rawShipUnionGuards.test.tsx`, `localShipGuards.test.tsx` and `equipMultipleGear.test.tsx` staying green **unchanged**, plus the new `fleetReads.test.ts`. The code moved here is copied verbatim from `ShipsContext.tsx` (`RawShip*` interfaces, `isValidShip`, `transformShipData`, the nested select string); only the `fetchShips` wrapper is new.

**Files:**
- Create: `src/services/fleetReads.ts`
- Create: `src/__tests__/services/stubDb.ts`
- Create: `src/__tests__/services/fleetReads.test.ts`
- Modify: `src/contexts/ShipsContext.tsx` (imports; delete the `RawShip*` interfaces through `transformShipData`; `loadShips` query block)

**Interfaces:**
- Produces: `fetchShips(db: SupabaseClient, profileId: string): Promise<Ship[]>` — throws the Supabase error; drops rows that fail `isValidShip`.
- Produces: `stubDb(tables: Record<string, Row[]>, options?: { errors?: Record<string, StubDbError>; failTimes?: Record<string, number> }): { db: SupabaseClient; calls: StubCall[] }` with `StubCall = { table; method; args }`, `StubDbError = { message: string; code?: string }`. Used by every later task's tests.

- [ ] **Step 1: Create the `stubDb` test helper**

`src/__tests__/services/stubDb.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/** One chained call, in the order the code under test made it. */
interface StubCall {
    table: string;
    method: string;
    args: unknown[];
}

export interface StubDbError {
    message: string;
    code?: string;
}

interface StubDbOptions {
    /** Every query on the table resolves with this error. */
    errors?: Record<string, StubDbError>;
    /** The first N queries on the table resolve with an error, later ones succeed. */
    failTimes?: Record<string, number>;
}

/**
 * A minimal chainable stand-in for a `SupabaseClient` handed to code as an argument — the
 * `db` of `src/services/fleetReads.ts` and the MCP tools' `ctx.db`. Unlike `fakeSupabase` it
 * is not wired to the global client, and it EVALUATES the predicates that read path uses —
 * `eq`, `or` over `column.eq.value` terms, `gt`, `order`, `limit` — so a test sees the page a
 * real query returns. The column list passed to `select` is recorded, not projected.
 */
export const stubDb = (tables: Record<string, Row[]>, options: StubDbOptions = {}) => {
    const calls: StubCall[] = [];
    const remainingFailures: Record<string, number> = { ...(options.failTimes ?? {}) };

    const chainFor = (table: string) => {
        let rows: Row[] = [...(tables[table] ?? [])];
        let limit: number | undefined;
        const record = (method: string, args: unknown[]) => calls.push({ table, method, args });

        const failure = (): StubDbError | null => {
            if (options.errors?.[table]) return options.errors[table];
            if ((remainingFailures[table] ?? 0) > 0) {
                remainingFailures[table] -= 1;
                return { message: `${table} is unavailable` };
            }
            return null;
        };

        const settle = () => {
            const error = failure();
            if (error) return { data: null, error };
            return { data: limit === undefined ? rows : rows.slice(0, limit), error: null };
        };

        const chain = {
            select: (...args: unknown[]) => {
                record('select', args);
                return chain;
            },
            eq: (column: string, value: unknown) => {
                record('eq', [column, value]);
                rows = rows.filter((row) => row[column] === value);
                return chain;
            },
            or: (filter: string) => {
                record('or', [filter]);
                const terms = filter.split(',').map((term) => {
                    const [column, operator, ...value] = term.split('.');
                    if (operator !== 'eq') throw new Error(`stubDb: unsupported or() term ${term}`);
                    return { column, value: value.join('.') };
                });
                rows = rows.filter((row) =>
                    terms.some(({ column, value }) => String(row[column]) === value)
                );
                return chain;
            },
            gt: (column: string, value: string) => {
                record('gt', [column, value]);
                rows = rows.filter((row) => String(row[column]) > value);
                return chain;
            },
            order: (column: string) => {
                record('order', [column]);
                rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
                return chain;
            },
            limit: (count: number) => {
                record('limit', [count]);
                limit = count;
                return chain;
            },
            maybeSingle: () => {
                record('maybeSingle', []);
                const result = settle();
                return Promise.resolve(
                    result.error ? result : { data: result.data[0] ?? null, error: null }
                );
            },
            then: <T>(resolve: (result: ReturnType<typeof settle>) => T) =>
                Promise.resolve(settle()).then(resolve),
        };
        return chain;
    };

    const db = {
        from: (table: string) => {
            calls.push({ table, method: 'from', args: [table] });
            return chainFor(table);
        },
    } as unknown as SupabaseClient;

    return { db, calls };
};
```

- [ ] **Step 2: Write the failing test**

`src/__tests__/services/fleetReads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../config/supabase';
import { fetchShips } from '../../services/fleetReads';
import { fakeSupabase } from './fakeSupabase';
import { stubDb } from './stubDb';

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));

const USER = '55555555-5555-4555-8555-555555555555';

/** The same joined `ships` row shape `rawShipUnionGuards.test.tsx` mounts `ShipsProvider` over. */
const rawShipRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER',
    affinity: null,
    user_id: USER,
    ship_base_stats: {},
    ship_equipment: [],
    ship_implants: [],
    ship_refits: [],
    ship_templates: { image_key: '', active_skill_text: 'x', active_target: 'enemy' },
    ...overrides,
});

describe('fetchShips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds the Ship the provider stores, from the joined row', async () => {
        fakeSupabase({
            ships: [
                rawShipRow({
                    affinity: 'chemical',
                    level: 60,
                    rank: 6,
                    ship_base_stats: { hp: 1000, attack: 200, crit: 10, crit_damage: 50 },
                    ship_equipment: [{ slot: 'weapon', gear_id: 'g1' }],
                    ship_implants: [{ id: 'imp-row', slot: 'implant_major', description: 'g9' }],
                    ship_refits: [
                        {
                            id: 'r1',
                            ship_refit_stats: [
                                { id: 's1', name: 'attack', value: 5, type: 'percentage' },
                            ],
                        },
                    ],
                }),
            ],
        });

        const ships = await fetchShips(supabase, USER);

        expect(ships).toEqual([
            {
                id: 'ship-1',
                name: 'Test Ship',
                rarity: 'legendary',
                faction: 'ATLAS_SYNDICATE',
                type: 'SUPPORTER',
                affinity: 'chemical',
                copies: 1,
                rank: 6,
                level: 60,
                baseStats: {
                    hp: 1000,
                    attack: 200,
                    defence: 0,
                    hacking: 0,
                    security: 0,
                    crit: 10,
                    critDamage: 50,
                    speed: 0,
                    healModifier: 0,
                    hpRegen: 0,
                    shield: 0,
                    defensePenetration: 0,
                    damageReduction: 0,
                },
                equipment: { weapon: 'g1' },
                equipmentLocked: false,
                starred: false,
                refits: [
                    {
                        id: 'r1',
                        stats: [{ id: 's1', name: 'attack', value: 5, type: 'percentage' }],
                    },
                ],
                implants: { implant_major: 'g9' },
                imageKey: '',
                activeSkillText: 'x',
                chargeSkillText: undefined,
                chargeSkillCharge: undefined,
                firstPassiveSkillText: undefined,
                secondPassiveSkillText: undefined,
                thirdPassiveSkillText: undefined,
                activeTarget: 'enemy',
                activePattern: undefined,
                chargedTarget: undefined,
                chargedPattern: undefined,
            },
        ]);
    });

    it('keeps a null affinity as undefined and falls an unknown type back to ATTACKER', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fakeSupabase({ ships: [rawShipRow({ type: 'RETIRED_ROLE' })] });

        const [ship] = await fetchShips(supabase, USER);

        expect(ship.affinity).toBeUndefined();
        expect(ship.type).toBe('ATTACKER');
        warn.mockRestore();
    });

    it('reads only the given profile', async () => {
        const { db, calls } = stubDb({ ships: [rawShipRow()] });

        await fetchShips(db, USER);

        expect(calls).toContainEqual({ table: 'ships', method: 'eq', args: ['user_id', USER] });
    });

    it('throws the Supabase error', async () => {
        const { db } = stubDb({}, { errors: { ships: { message: 'boom' } } });

        await expect(fetchShips(db, USER)).rejects.toEqual({ message: 'boom' });
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/__tests__/services/fleetReads.test.ts`
Expected: FAIL — `Failed to resolve import "../../services/fleetReads"`.

- [ ] **Step 4: Create `src/services/fleetReads.ts` with the ships read**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GearSlotName, ImplantSlotName } from '../constants/gearTypes';
import type { Ship } from '../types/ship';
import type { FlexibleStats, Stat, StatName, StatType } from '../types/stats';
import { normaliseShipIdentity } from '../utils/ship/normaliseShipFields';

/**
 * The signed-in fleet read path: one profile's fleet data as the domain objects the app works
 * with. Every function takes the Supabase client it reads through, so the website passes its
 * global client and the MCP function passes a per-request client built from the caller's OAuth
 * token.
 *
 * Nothing here may import `src/config/supabase.ts` or anything else that reads `import.meta.env`:
 * this module runs inside a Netlify Function. `src/mcp/__tests__/nodeLoad.test.ts` is the
 * tripwire.
 */

interface RawShipStat {
    name: StatName;
    value: number;
    type: StatType;
    id: string;
}

interface RawShipEquipment {
    slot: GearSlotName;
    gear_id: string;
}

interface RawShipRefit {
    id: string;
    ship_refit_stats: RawShipStat[];
}

interface RawShipImplant {
    id: string;
    slot: ImplantSlotName;
    description?: string;
}

interface RawShipBaseStats {
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    crit: number;
    crit_damage: number;
    speed: number;
    heal_modifier: number;
    hp_regen: number;
    shield: number;
    defense_penetration: number;
}

interface RawShipData {
    id: string;
    name: string;
    // Raw Supabase columns, typed as what the database actually holds and narrowed by
    // `transformShipData` via the shared `normaliseShipIdentity`. `faction` stays `string` — the
    // honest type of `Ship.faction` — and is narrowed through `asFactionName` / `getFaction` at
    // read time rather than here, so an unrecognised faction is never dropped.
    rarity: string;
    faction: string;
    type: string;
    affinity: string | null;
    copies: number;
    rank: number;
    level: number;
    ship_base_stats: RawShipBaseStats;
    ship_equipment: RawShipEquipment[];
    equipment_locked: boolean;
    starred: boolean;
    ship_refits: RawShipRefit[];
    ship_implants: RawShipImplant[];
    ship_templates: {
        image_key: string;
        active_skill_text: string | null;
        charge_skill_text: string | null;
        charge_skill_charge: number | null;
        first_passive_skill_text: string | null;
        second_passive_skill_text: string | null;
        third_passive_skill_text: string | null;
        active_target: string | null;
        active_pattern: string | null;
        charged_target: string | null;
        charged_pattern: string | null;
    };
}

/** The nested select `fetchShips` reads: the ship row, its child tables, and the template's
 *  skill columns (inner join, so a ship whose template row is missing is not returned). */
const SHIPS_SELECT = `
    *,
    ship_base_stats (*),
    ship_equipment (*),
    ship_refits (
        *,
        ship_refit_stats (*)
    ),
    ship_implants (*),
    ship_templates!inner (
        image_key,
        active_skill_text,
        charge_skill_text,
        charge_skill_charge,
        first_passive_skill_text,
        second_passive_skill_text,
        third_passive_skill_text,
        active_target,
        active_pattern,
        charged_target,
        charged_pattern
    )
`;

// Type guard for valid ship data
const isValidShip = (ship: unknown): ship is Ship => {
    if (!ship || typeof ship !== 'object') {
        console.error('Invalid ship: Not an object or is null/undefined');
        return false;
    }

    const shipData = ship as Partial<Ship>;

    // Check required string properties
    const requiredStringProps = ['id', 'name', 'type', 'faction', 'rarity'] as const;
    const missingStringProps = requiredStringProps.filter(
        (prop) => typeof shipData[prop] !== 'string'
    );
    if (missingStringProps.length > 0) {
        console.error('Invalid ship: Missing or invalid string properties:', missingStringProps);
        return false;
    }

    // Check equipment object
    if (!shipData.equipment || typeof shipData.equipment !== 'object') {
        console.error('Invalid ship: Missing or invalid equipment object');
        return false;
    }

    // Check baseStats object
    const requiredBaseStats = [
        'hp',
        'attack',
        'defence',
        'speed',
        'hacking',
        'security',
        'crit',
        'critDamage',
        'healModifier',
    ] as const;
    if (!shipData.baseStats || typeof shipData.baseStats !== 'object') {
        console.error('Invalid ship: Missing or invalid baseStats object');
        return false;
    }

    const missingBaseStats = requiredBaseStats.filter(
        (stat) => typeof shipData.baseStats?.[stat] !== 'number'
    );
    if (missingBaseStats.length > 0) {
        console.error('Invalid ship: Missing or invalid base stats:', missingBaseStats);
        return false;
    }

    // Check arrays
    if (!Array.isArray(shipData.refits)) {
        console.error('Invalid ship: refits is not an array');
        return false;
    }

    // Check equipmentLocked boolean
    if (shipData.equipmentLocked !== undefined && typeof shipData.equipmentLocked !== 'boolean') {
        console.error('Invalid ship: equipmentLocked is not a boolean');
        return false;
    }

    // Check optional properties
    if (shipData.affinity !== undefined && typeof shipData.affinity !== 'string') {
        console.error('Invalid ship: affinity is not a string');
        return false;
    }

    return true;
};

// Helper function to transform Supabase data into Ship format
const transformShipData = (data: RawShipData): Ship | null => {
    try {
        const createStat = (stat: RawShipStat): Stat => {
            if (stat.type === 'percentage') {
                return {
                    name: stat.name,
                    value: stat.value,
                    type: 'percentage',
                    id: stat.id,
                };
            } else {
                return {
                    name: stat.name as FlexibleStats,
                    value: stat.value,
                    type: 'flat',
                    id: stat.id,
                };
            }
        };

        // See `normaliseShipIdentity` — the one place rarity/type/affinity get coerced (#568).
        const normalised = normaliseShipIdentity(data);

        const ship: Ship = {
            id: data.id,
            name: data.name,
            rarity: normalised.rarity,
            faction: data.faction,
            type: normalised.type,
            affinity: normalised.affinity,
            copies: data.copies || 1,
            rank: data.rank,
            level: data.level,
            baseStats: {
                hp: data.ship_base_stats?.hp || 0,
                attack: data.ship_base_stats?.attack || 0,
                defence: data.ship_base_stats?.defence || 0,
                hacking: data.ship_base_stats?.hacking || 0,
                security: data.ship_base_stats?.security || 0,
                crit: data.ship_base_stats?.crit || 0,
                critDamage: data.ship_base_stats?.crit_damage || 0,
                speed: data.ship_base_stats?.speed || 0,
                healModifier: data.ship_base_stats?.heal_modifier || 0,
                hpRegen: data.ship_base_stats?.hp_regen || 0,
                shield: data.ship_base_stats?.shield || 0,
                defensePenetration: data.ship_base_stats?.defense_penetration || 0,
                // Iridium's 35% damage reduction passive requires refit 2+
                damageReduction: data.name === 'Iridium' && data.ship_refits.length >= 2 ? 35 : 0,
            },
            equipment: data.ship_equipment.reduce(
                (acc: Partial<Record<GearSlotName, string>>, eq) => {
                    acc[eq.slot] = eq.gear_id;
                    return acc;
                },
                {} as Partial<Record<GearSlotName, string>>
            ),
            equipmentLocked: data.equipment_locked || false,
            starred: data.starred || false,
            refits: data.ship_refits.map((refit) => ({
                id: refit.id,
                stats: refit.ship_refit_stats.map(createStat),
            })),
            implants: data.ship_implants.reduce(
                (acc: Partial<Record<ImplantSlotName, string>>, implant) => {
                    acc[implant.slot] = implant.description || implant.id;
                    return acc;
                },
                {} as Partial<Record<ImplantSlotName, string>>
            ),
            imageKey: data.ship_templates.image_key,
            activeSkillText: data.ship_templates.active_skill_text ?? undefined,
            chargeSkillText: data.ship_templates.charge_skill_text ?? undefined,
            chargeSkillCharge: data.ship_templates.charge_skill_charge ?? undefined,
            firstPassiveSkillText: data.ship_templates.first_passive_skill_text ?? undefined,
            secondPassiveSkillText: data.ship_templates.second_passive_skill_text ?? undefined,
            thirdPassiveSkillText: data.ship_templates.third_passive_skill_text ?? undefined,
            activeTarget: data.ship_templates.active_target ?? undefined,
            activePattern: data.ship_templates.active_pattern ?? undefined,
            chargedTarget: data.ship_templates.charged_target ?? undefined,
            chargedPattern: data.ship_templates.charged_pattern ?? undefined,
        };
        return isValidShip(ship) ? ship : null;
    } catch (error) {
        console.error('Error transforming ship data:', error);
        return null;
    }
};

/** Every ship of `profileId`, transformed and guarded. A row that fails the guard is dropped
 *  (logged); a Supabase error is thrown for the caller to report. */
export async function fetchShips(db: SupabaseClient, profileId: string): Promise<Ship[]> {
    const { data, error } = await db.from('ships').select(SHIPS_SELECT).eq('user_id', profileId);

    if (error) throw error;

    return (data as RawShipData[])
        .map(transformShipData)
        .filter((ship): ship is Ship => ship !== null)
        .map((ship) => ({
            ...ship,
            equipment: ship.equipment || {},
        }));
}
```

- [ ] **Step 5: Point `ShipsContext` at it**

In `src/contexts/ShipsContext.tsx`:

1. Replace the three import lines

```ts
import { Ship } from '../types/ship';
import { Stat, StatName, StatType, FlexibleStats } from '../types/stats';
import { normaliseShipFields, normaliseShipIdentity } from '../utils/ship/normaliseShipFields';
```

   with

```ts
import { Ship } from '../types/ship';
import { normaliseShipFields } from '../utils/ship/normaliseShipFields';
import { fetchShips } from '../services/fleetReads';
```

2. Delete everything from the line `interface RawShipStat {` up to, but not including, the line `const ShipsContext = createContext<ShipsContextType | undefined>(undefined);` (the `RawShipStat`, `RawShipEquipment`, `RawShipRefit`, `RawShipImplant`, `RawShipBaseStats`, `RawShipData` interfaces, `isValidShip` and `transformShipData` — they now live in `fleetReads.ts`). Keep `interface ShipsContextType` above them.

3. In `loadShips`, replace this block

```ts
                const { data, error } = await supabase
                    .from('ships')
                    .select(
                        `
                    *,
                    ship_base_stats (*),
                    ship_equipment (*),
                    ship_refits (
                        *,
                        ship_refit_stats (*)
                    ),
                    ship_implants (*),
                    ship_templates!inner (
                        image_key,
                        active_skill_text,
                        charge_skill_text,
                        charge_skill_charge,
                        first_passive_skill_text,
                        second_passive_skill_text,
                        third_passive_skill_text,
                        active_target,
                        active_pattern,
                        charged_target,
                        charged_pattern
                    )
                `
                    )
                    .eq('user_id', activeProfileId);

                if (error) throw error;

                const transformedShips = data
                    .map(transformShipData)
                    .filter((ship): ship is Ship => ship !== null)
                    .map((ship) => ({
                        ...ship,
                        equipment: ship.equipment || {},
                    }));
```

   with

```ts
                const transformedShips = await fetchShips(supabase, activeProfileId);
```

   (the following `setShips(transformedShips);` line stays). `supabase` is still imported — the writers use it.

- [ ] **Step 6: Run the new test and the ship context tests**

Run: `npx vitest run src/__tests__/services/fleetReads.test.ts src/contexts/__tests__`
Expected: PASS — all of `fleetReads.test.ts`, and `rawShipUnionGuards`, `localShipGuards`, `equipMultipleGear`, `engineeringStatsSave` unchanged and green.

Run: `npx tsc --noEmit && npx eslint src/services/fleetReads.ts src/contexts/ShipsContext.tsx src/__tests__/services --max-warnings 0`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/services/fleetReads.ts \
    src/__tests__/services/stubDb.ts \
    src/__tests__/services/fleetReads.test.ts \
    src/contexts/ShipsContext.tsx
git commit -m "$(cat <<'EOF'
refactor(ships): read ships through fleetReads.fetchShips (#562)

Moves the nested ships select, RawShipData, isValidShip and transformShipData out of
ShipsContext into src/services/fleetReads.ts so a Netlify Function can reuse them with
a per-request client. Behaviour unchanged; the ship context tests are untouched.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 2: `fetchInventory` — extract the inventory read

Behaviour-preserving refactor of `InventoryProvider.loadBatch` + the batch loop. The loop's semantics are kept exactly, including "stop at the first page with fewer than `INVENTORY_BATCH_SIZE` *valid* pieces" and the retry (3 retries, 1 s apart). The provider keeps the count query, progress, `tempInventory` and the sign-out bail — the latter two through `onBatch` / `isCancelled`. `addGear` still transforms its insert result, so `transformGearData` and `RawGearData` are exported.

`statsCodecCallSites.test.ts` names every file that routes `inventory_items.stats` through the codec; `fleetReads.ts` now calls `decodeGearStats`, so it joins that list (the test exists to make this a visible diff). `InventoryProvider.tsx` stays in the list — it still calls `encodeGearStats`.

**Files:**
- Modify: `src/services/fleetReads.ts` (imports; append the inventory section)
- Modify: `src/contexts/InventoryProvider.tsx`
- Modify: `src/__tests__/services/fleetReads.test.ts`
- Modify: `src/utils/gear/__tests__/statsCodecCallSites.test.ts:81-88`

**Interfaces:**
- Consumes: `stubDb` (Task 1).
- Produces: `INVENTORY_BATCH_SIZE = 5000`; `interface RawGearData`; `transformGearData(data: RawGearData): GearPiece | null`; `interface FetchInventoryOptions { onBatch?: (itemsSoFar: GearPiece[]) => void; isCancelled?: () => boolean; retryDelayMs?: number }`; `fetchInventory(db: SupabaseClient, profileId: string, options?: FetchInventoryOptions): Promise<GearPiece[] | null>` (`null` only when cancelled).

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/services/fleetReads.test.ts`, replace the import block (everything above `vi.mock(`) with

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../config/supabase';
import {
    INVENTORY_BATCH_SIZE,
    fetchInventory,
    fetchShips,
    transformGearData,
} from '../../services/fleetReads';
import { encodeGearStats } from '../../utils/gear/statsCodec';
import { fakeSupabase } from './fakeSupabase';
import { stubDb } from './stubDb';
```

insert these helpers directly after the `rawShipRow` helper

```ts
const gearRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    user_id: USER,
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    set_bonus: 'ATTACK',
    calibration_ship_id: null,
    stats: encodeGearStats({
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [{ name: 'crit', value: 5, type: 'percentage' }],
    }),
    ...overrides,
});

/** Zero-padded so string order is numeric order, the way keyset paging on uuids is. */
const gearId = (n: number) => `gear-${String(n).padStart(6, '0')}`;
```

and append at the end of the file

```ts
describe('fetchInventory', () => {
    it('walks past one page, keyset on the last id', async () => {
        const rows = Array.from({ length: INVENTORY_BATCH_SIZE + 1 }, (_, i) => gearRow(gearId(i)));
        const { db, calls } = stubDb({ inventory_items: rows });

        const items = await fetchInventory(db, USER);

        expect(items).toHaveLength(INVENTORY_BATCH_SIZE + 1);
        expect(calls.filter((call) => call.method === 'gt')).toEqual([
            {
                table: 'inventory_items',
                method: 'gt',
                args: ['id', gearId(INVENTORY_BATCH_SIZE - 1)],
            },
        ]);
    });

    it('reports every page to onBatch with the items read so far', async () => {
        const rows = Array.from({ length: INVENTORY_BATCH_SIZE + 1 }, (_, i) => gearRow(gearId(i)));
        const { db } = stubDb({ inventory_items: rows });
        const seen: number[] = [];

        await fetchInventory(db, USER, { onBatch: (itemsSoFar) => seen.push(itemsSoFar.length) });

        expect(seen).toEqual([INVENTORY_BATCH_SIZE, INVENTORY_BATCH_SIZE + 1]);
    });

    it('resolves to null when cancelled before a page', async () => {
        const { db, calls } = stubDb({ inventory_items: [gearRow(gearId(0))] });

        const items = await fetchInventory(db, USER, { isCancelled: () => true });

        expect(items).toBeNull();
        expect(calls).toEqual([]);
    });

    it('retries a failed page, then succeeds', async () => {
        const { db } = stubDb(
            { inventory_items: [gearRow(gearId(0))] },
            { failTimes: { inventory_items: 2 } }
        );

        const items = await fetchInventory(db, USER, { retryDelayMs: 0 });

        expect(items).toHaveLength(1);
    });

    it('throws once the retries are spent', async () => {
        const { db } = stubDb(
            { inventory_items: [gearRow(gearId(0))] },
            { failTimes: { inventory_items: 4 } }
        );

        await expect(fetchInventory(db, USER, { retryDelayMs: 0 })).rejects.toEqual({
            message: 'inventory_items is unavailable',
        });
    });
});

describe('transformGearData', () => {
    it('decodes the stats column and keeps the calibration', () => {
        const piece = transformGearData(gearRow('g1', { calibration_ship_id: 'ship-1' }));

        expect(piece).toEqual({
            id: 'g1',
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            setBonus: 'ATTACK',
            mainStat: { name: 'attack', value: 100, type: 'flat' },
            subStats: [{ name: 'crit', value: 5, type: 'percentage' }],
            calibration: { shipId: 'ship-1' },
        });
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/services/fleetReads.test.ts`
Expected: FAIL — `fetchInventory` / `transformGearData` / `INVENTORY_BATCH_SIZE` are not exported.

- [ ] **Step 3: Add the inventory read to `fleetReads.ts`**

Replace the import block of `src/services/fleetReads.ts` with

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GearSlotName, ImplantSlotName } from '../constants/gearTypes';
import type { GearPiece } from '../types/gear';
import type { Ship } from '../types/ship';
import type { FlexibleStats, Stat, StatName, StatType } from '../types/stats';
import { decodeGearStats } from '../utils/gear/statsCodec';
import { normaliseGearFields } from '../utils/gear/normaliseGearFields';
import { normaliseShipIdentity } from '../utils/ship/normaliseShipFields';
```

and append at the end of the file (the interface, guard and transform are copied verbatim from `InventoryProvider.tsx`; the walk is `loadBatch` + the provider's loop):

```ts
/** The raw `inventory_items` row. Exported for `InventoryProvider.addGear`, which transforms the
 *  row its insert returns. */
export interface RawGearData {
    id: string;
    // Raw Supabase columns; see `normaliseGearFields` for what each may carry.
    slot: string;
    level: number;
    stars: number;
    rarity: string;
    set_bonus: string | null;
    calibration_ship_id?: string | null;
    stats: unknown;
}

/** Rows per keyset page of `inventory_items`. */
export const INVENTORY_BATCH_SIZE = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Type guard for valid gear piece
const isValidGearPiece = (gear: unknown): gear is GearPiece => {
    if (!gear || typeof gear !== 'object') return false;

    const gearData = gear as Partial<GearPiece>;

    // Check required string properties
    const requiredStringProps = ['id', 'slot', 'rarity'] as const;
    if (!requiredStringProps.every((prop) => typeof gearData[prop] === 'string')) return false;
    if (gearData.setBonus !== null && typeof gearData.setBonus !== 'string') return false;

    // Check required number properties
    const requiredNumberProps = ['level', 'stars'] as const;
    if (!requiredNumberProps.every((prop) => typeof gearData[prop] === 'number')) return false;

    // Check mainStat object
    if (!gearData.mainStat || typeof gearData.mainStat !== 'object') return false;
    if (typeof gearData.mainStat.name !== 'string' || typeof gearData.mainStat.value !== 'number') {
        return false;
    }

    // Check subStats array
    if (!Array.isArray(gearData.subStats)) return false;
    if (
        !gearData.subStats.every(
            (stat) => typeof stat.name === 'string' && typeof stat.value === 'number'
        )
    ) {
        return false;
    }

    return true;
};

// Helper function to transform Supabase data into GearPiece format
export const transformGearData = (data: RawGearData): GearPiece | null => {
    try {
        const { mainStat, subStats } = decodeGearStats(data.stats);

        const gear: GearPiece = normaliseGearFields({
            id: data.id,
            slot: data.slot,
            level: data.level,
            stars: data.stars,
            rarity: data.rarity,
            setBonus: data.set_bonus,
            // A piece with no main stat reads as hp 0 here, unlike the other
            // decode sites which keep it null. `isValidGearPiece` below rejects
            // a null mainStat, so the fallback is what keeps such rows loadable.
            mainStat: mainStat ?? { name: 'hp', value: 0, type: 'flat' },
            subStats,
            // Include calibration if calibration_ship_id exists
            ...(data.calibration_ship_id && {
                calibration: {
                    shipId: data.calibration_ship_id,
                },
            }),
        });

        return isValidGearPiece(gear) ? gear : null;
    } catch (error) {
        console.error('Error transforming gear data:', error);
        return null;
    }
};

/** One keyset page: the pieces with `id` after `lastId`, in `id` order. A failed page is retried
 *  `MAX_RETRIES` times, `retryDelayMs` apart, before its error is thrown. */
async function fetchInventoryBatch(
    db: SupabaseClient,
    profileId: string,
    lastId: string | null,
    retryDelayMs: number,
    retryCount = 0
): Promise<{ items: GearPiece[]; lastId: string | null }> {
    try {
        let query = db
            .from('inventory_items')
            .select('*')
            .eq('user_id', profileId)
            .order('id')
            .limit(INVENTORY_BATCH_SIZE);

        // Only add gt condition if we have a lastId
        if (lastId) {
            query = query.gt('id', lastId);
        }

        const { data, error } = await query;

        if (error) throw error;

        const rows = data as RawGearData[];
        const transformedGear = rows
            .map(transformGearData)
            .filter((gear): gear is GearPiece => gear !== null)
            .map((gear) => ({
                ...gear,
                subStats: gear.subStats || [],
            }));

        return {
            items: transformedGear,
            lastId: rows[rows.length - 1]?.id || null,
        };
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            return fetchInventoryBatch(db, profileId, lastId, retryDelayMs, retryCount + 1);
        }
        throw error;
    }
}

export interface FetchInventoryOptions {
    /** Called after each page with every piece read so far. */
    onBatch?: (itemsSoFar: GearPiece[]) => void;
    /** Checked before each page; returning true stops the walk and makes `fetchInventory`
     *  resolve to `null`. */
    isCancelled?: () => boolean;
    /** Wait between retries of a failed page. */
    retryDelayMs?: number;
}

/** Every gear piece and implant of `profileId`, walked page by page. Resolves to `null` when
 *  `isCancelled` stopped the walk. The walk ends at the first page holding fewer than
 *  `INVENTORY_BATCH_SIZE` valid pieces. */
export async function fetchInventory(
    db: SupabaseClient,
    profileId: string,
    options: FetchInventoryOptions = {}
): Promise<GearPiece[] | null> {
    const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    let allItems: GearPiece[] = [];
    let lastId: string | null = null;

    while (true) {
        if (options.isCancelled?.()) return null;
        const batch = await fetchInventoryBatch(db, profileId, lastId, retryDelayMs);

        if (batch.items.length === 0) break;

        allItems = [...allItems, ...batch.items];
        lastId = batch.lastId;
        options.onBatch?.(allItems);

        if (batch.items.length < INVENTORY_BATCH_SIZE) break;
    }

    return allItems;
}
```

- [ ] **Step 4: Point `InventoryProvider` at it**

In `src/contexts/InventoryProvider.tsx`:

1. Imports: replace `import { decodeGearStats, encodeGearStats } from '../utils/gear/statsCodec';` with `import { encodeGearStats } from '../utils/gear/statsCodec';`, and add after the `normaliseGearFields` import:

```ts
import { fetchInventory, transformGearData, type RawGearData } from '../services/fleetReads';
```

2. Delete the three constants `const BATCH_SIZE = 5000;`, `const MAX_RETRIES = 3;`, `const RETRY_DELAY = 1000; // 1 second`.
3. Delete everything from `interface RawGearData {` up to, but not including, `export const InventoryProvider` (`RawGearData`, `isValidGearPiece`, `transformGearData`).
4. Delete the whole `loadBatch` callback:

```ts
    const loadBatch = useCallback(
        async (
            lastId: string | null,
            retryCount = 0
        ): Promise<{ items: GearPiece[]; lastId: string | null }> => {
            if (!activeProfileId) return { items: [], lastId: null };

            try {
                let query = supabase
                    .from('inventory_items')
                    .select('*')
                    .eq('user_id', activeProfileId)
                    .order('id')
                    .limit(BATCH_SIZE);

                // Only add gt condition if we have a lastId
                if (lastId) {
                    query = query.gt('id', lastId);
                }

                const { data, error } = await query;

                if (error) throw error;

                const transformedGear = data
                    .map(transformGearData)
                    .filter((gear): gear is GearPiece => gear !== null)
                    .map((gear) => ({
                        ...gear,
                        subStats: gear.subStats || [],
                    }));

                return {
                    items: transformedGear,
                    lastId: data[data.length - 1]?.id || null,
                };
            } catch (error) {
                if (retryCount < MAX_RETRIES) {
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
                    return loadBatch(lastId, retryCount + 1);
                }
                throw error;
            }
        },
        [activeProfileId]
    );
```

5. In `loadInventory`, replace

```ts
            let allItems: GearPiece[] = [];
            let lastId: string | null = null;
            let totalLoaded = 0;

            // First, get the total count
            const { count, error: countError } = await supabase
                .from('inventory_items')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', activeProfileId);

            if (countError) throw countError;
            const totalItems = count || 0;

            // Load all batches
            while (true) {
                // Bail if the user signed out while we were awaiting a batch.
                // activeProfileIdRef.current is set to null synchronously in handleSignOut
                // (before React re-renders), so this check is reliable mid-loop.
                if (activeProfileIdRef.current !== activeProfileId) return;
                const { items, lastId: newLastId } = await loadBatch(lastId);

                if (items.length === 0) break;

                allItems = [...allItems, ...items];
                lastId = newLastId;
                totalLoaded += items.length;

                // Update progress
                setLoadingProgress(Math.round((totalLoaded / totalItems) * 100));

                // Update temporary inventory with the latest batch (only when not syncing)
                if (!hasCachedData) {
                    setTempInventory(allItems);
                }

                if (items.length < BATCH_SIZE) break;
            }
```

   with

```ts
            // First, get the total count
            const { count, error: countError } = await supabase
                .from('inventory_items')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', activeProfileId);

            if (countError) throw countError;
            const totalItems = count || 0;

            const allItems = await fetchInventory(supabase, activeProfileId, {
                // Bail if the user signed out while we were awaiting a batch.
                // activeProfileIdRef.current is set to null synchronously in handleSignOut
                // (before React re-renders), so this check is reliable mid-loop.
                isCancelled: () => activeProfileIdRef.current !== activeProfileId,
                onBatch: (itemsSoFar) => {
                    setLoadingProgress(Math.round((itemsSoFar.length / totalItems) * 100));
                    // Update temporary inventory with the latest batch (only when not syncing)
                    if (!hasCachedData) {
                        setTempInventory(itemsSoFar);
                    }
                },
            });
            if (allItems === null) return;
```

6. In `loadInventory`'s dependency array, delete the line `        loadBatch,`.

`addGear`'s `return transformGearData(gearData as RawGearData) as GearPiece;` is unchanged and now uses the import.

- [ ] **Step 5: Add `fleetReads.ts` to the codec's routed list**

In `src/utils/gear/__tests__/statsCodecCallSites.test.ts`, in the `toEqual([...])` of "names the files that are routed", insert `'services/fleetReads.ts',` between `'pages/database/LeaderboardPage.tsx',` and `'services/userDataService.ts',`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/__tests__/services src/contexts src/utils/gear/__tests__ src/utils/__tests__/inventoryStorageKey.test.ts`
Expected: PASS (including `inventoryWriterSet.test.ts`, whose writer list is unchanged: `fleetReads.ts` never inserts).

Run: `npx tsc --noEmit && npx eslint src/services src/contexts/InventoryProvider.tsx src/__tests__/services --max-warnings 0`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/services/fleetReads.ts \
    src/contexts/InventoryProvider.tsx \
    src/__tests__/services/fleetReads.test.ts \
    src/utils/gear/__tests__/statsCodecCallSites.test.ts
git commit -m "$(cat <<'EOF'
refactor(gear): read inventory through fleetReads.fetchInventory (#562)

Moves loadBatch, the keyset walk, retry and transformGearData into fleetReads. The
provider keeps the count query, progress and sign-out bail via onBatch/isCancelled.
statsCodecCallSites gains services/fleetReads.ts (it now calls decodeGearStats).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 3: `fetchEngineeringStats` + `engineeringStatForShipType`

Behaviour-preserving. `SUPPORTER_BUFFER → SUPPORTER` lived only inside the provider's `getEngineeringStatsForShipType`; `get_my_fleet` needs the same rule, so it moves to one pure function both call. Tripwire: `src/contexts/__tests__/engineeringStatsSave.test.tsx` unchanged and green.

**Files:**
- Modify: `src/services/fleetReads.ts` (imports; append the engineering section)
- Modify: `src/contexts/EngineeringStatsProvider.tsx`
- Modify: `src/__tests__/services/fleetReads.test.ts`

**Interfaces:**
- Produces: `fetchEngineeringStats(db: SupabaseClient, profileId: string): Promise<EngineeringStats | null>` (`null` when the read returned no data and no error); `engineeringStatForShipType(stats: EngineeringStats, shipType: ShipTypeName): EngineeringStat | undefined`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/services/fleetReads.test.ts`, replace the import block with

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../config/supabase';
import {
    INVENTORY_BATCH_SIZE,
    engineeringStatForShipType,
    fetchEngineeringStats,
    fetchInventory,
    fetchShips,
    transformGearData,
} from '../../services/fleetReads';
import { encodeGearStats } from '../../utils/gear/statsCodec';
import { fakeSupabase } from './fakeSupabase';
import { stubDb } from './stubDb';
```

and append

```ts
describe('fetchEngineeringStats', () => {
    it('groups rows by ship type and skips an unknown type', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { db } = stubDb({
            engineering_stats: [
                {
                    user_id: USER,
                    ship_type: 'ATTACKER',
                    stat_name: 'attack',
                    value: 10,
                    type: 'percentage',
                },
                {
                    user_id: USER,
                    ship_type: 'ATTACKER',
                    stat_name: 'crit',
                    value: 5,
                    type: 'percentage',
                },
                { user_id: USER, ship_type: 'RETIRED', stat_name: 'hp', value: 1, type: 'flat' },
            ],
        });

        const stats = await fetchEngineeringStats(db, USER);

        expect(stats).toEqual({
            stats: [
                {
                    shipType: 'ATTACKER',
                    stats: [
                        { name: 'attack', value: 10, type: 'percentage' },
                        { name: 'crit', value: 5, type: 'percentage' },
                    ],
                },
            ],
        });
        warn.mockRestore();
    });

    it('throws the Supabase error', async () => {
        const { db } = stubDb({}, { errors: { engineering_stats: { message: 'boom' } } });

        await expect(fetchEngineeringStats(db, USER)).rejects.toEqual({ message: 'boom' });
    });
});

describe('engineeringStatForShipType', () => {
    const stats = {
        stats: [
            {
                shipType: 'SUPPORTER' as const,
                stats: [{ name: 'hp' as const, value: 5, type: 'percentage' as const }],
            },
        ],
    };

    it('gives SUPPORTER_BUFFER the SUPPORTER tree', () => {
        expect(engineeringStatForShipType(stats, 'SUPPORTER_BUFFER')).toBe(stats.stats[0]);
    });

    it('is undefined for a type with no entry', () => {
        expect(engineeringStatForShipType(stats, 'ATTACKER')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/services/fleetReads.test.ts`
Expected: FAIL — `fetchEngineeringStats` / `engineeringStatForShipType` are not exported.

- [ ] **Step 3: Add the engineering read**

Replace the import block of `src/services/fleetReads.ts` with

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GearSlotName, ImplantSlotName } from '../constants/gearTypes';
import { isShipTypeName, type ShipTypeName } from '../constants/shipTypes';
import type { GearPiece } from '../types/gear';
import type { Ship } from '../types/ship';
import type {
    EngineeringStat,
    EngineeringStats,
    FlexibleStats,
    Stat,
    StatName,
    StatType,
} from '../types/stats';
import { decodeGearStats } from '../utils/gear/statsCodec';
import { normaliseGearFields } from '../utils/gear/normaliseGearFields';
import { normaliseShipIdentity } from '../utils/ship/normaliseShipFields';
```

and append (the interface and transform are copied verbatim from `EngineeringStatsProvider.tsx`):

```ts
interface RawEngineeringStat {
    user_id: string;
    ship_type: string;
    stat_name: StatName;
    value: number;
    type: StatType;
}

const transformEngineeringStats = (data: RawEngineeringStat[]): EngineeringStats => {
    const statsByShipType = data.reduce(
        (acc, stat) => {
            // A row's `ship_type` crosses the Supabase trust boundary — skip a row whose value
            // fell out of the `ShipTypeName` union (a retired/renamed role) rather than crash.
            if (!isShipTypeName(stat.ship_type)) {
                console.warn(
                    `Unrecognised ship type "${stat.ship_type}" — skipping engineering stat`
                );
                return acc;
            }
            const shipType = stat.ship_type;
            if (!acc[shipType]) {
                acc[shipType] = {
                    shipType,
                    stats: [],
                };
            }
            acc[shipType].stats.push({
                name: stat.stat_name,
                value: stat.value,
                type: stat.type,
            } as Stat);
            return acc;
        },
        {} as Partial<Record<ShipTypeName, EngineeringStat>>
    );

    return {
        stats: Object.values(statsByShipType),
    };
};

/** The engineering stats of `profileId`, grouped by ship type; `null` when the read returned no
 *  data and no error. */
export async function fetchEngineeringStats(
    db: SupabaseClient,
    profileId: string
): Promise<EngineeringStats | null> {
    const { data, error } = await db.from('engineering_stats').select('*').eq('user_id', profileId);

    if (error) throw error;

    return data ? transformEngineeringStats(data as RawEngineeringStat[]) : null;
}

/** The engineering entry a ship of `shipType` uses. `SUPPORTER_BUFFER` has no engineering tree
 *  of its own in game; it uses `SUPPORTER`'s. */
export const engineeringStatForShipType = (
    stats: EngineeringStats,
    shipType: ShipTypeName
): EngineeringStat | undefined => {
    const engineeringType = shipType === 'SUPPORTER_BUFFER' ? 'SUPPORTER' : shipType;
    return stats.stats.find((stat) => stat.shipType === engineeringType);
};
```

- [ ] **Step 4: Point `EngineeringStatsProvider` at it**

In `src/contexts/EngineeringStatsProvider.tsx`:

1. Imports: `import { EngineeringStats, EngineeringStat, StatName, StatType, Stat } from '../types/stats';` becomes `import { EngineeringStats, StatName, StatType } from '../types/stats';`; `import { ShipTypeName, isShipTypeName } from '../constants/shipTypes';` becomes `import { ShipTypeName } from '../constants/shipTypes';`; add after the `isSupabaseSyncEnabled` import:

```ts
import { engineeringStatForShipType, fetchEngineeringStats } from '../services/fleetReads';
```

2. Delete `interface RawEngineeringStat` and `const transformEngineeringStats` (everything from `interface RawEngineeringStat {` up to, but not including, `export const EngineeringStatsProvider`).
3. In `loadEngineeringStats`, replace

```ts
                const { data, error } = await supabase
                    .from('engineering_stats')
                    .select('*')
                    .eq('user_id', activeProfileId);

                if (error) {
                    throw error;
                }

                if (data) {
                    void setEngineeringStats(
                        transformEngineeringStats(data as RawEngineeringStat[])
                    );
                }
```

   with

```ts
                const loaded = await fetchEngineeringStats(supabase, activeProfileId);
                if (loaded) {
                    void setEngineeringStats(loaded);
                }
```

4. In `getEngineeringStatsForShipType`, replace the body

```ts
            if (shipType === 'SUPPORTER_BUFFER') {
                return engineeringStats.stats.find((stat) => stat.shipType === 'SUPPORTER');
            }
            return engineeringStats.stats.find((stat) => stat.shipType === shipType);
```

   with `            return engineeringStatForShipType(engineeringStats, shipType);`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/__tests__/services/fleetReads.test.ts src/contexts/__tests__`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/services src/contexts/EngineeringStatsProvider.tsx src/__tests__/services --max-warnings 0`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/services/fleetReads.ts \
    src/contexts/EngineeringStatsProvider.tsx \
    src/__tests__/services/fleetReads.test.ts
git commit -m "$(cat <<'EOF'
refactor(engineering): read engineering stats through fleetReads (#562)

Moves the engineering_stats read and transform into fleetReads, and the
SUPPORTER_BUFFER -> SUPPORTER lookup into engineeringStatForShipType so get_my_fleet
uses the same rule as the provider.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 4: Dependencies, type-check scope and the node-load tripwire

**Files:**
- Modify: `package.json` (dependencies via npm; `//dependencies` comment), `package-lock.json`
- Modify: `tsconfig.json:21`
- Modify: `scripts/netlify-ignore.sh:11` (comment only)
- Create: `src/mcp/__tests__/nodeLoad.test.ts`

The `lint` script, `lint-staged` glob and `knip.json` are widened in Task 10, together with the first file under `netlify/functions/`: `eslint src netlify/functions` fails with "No files matching the pattern" while the directory does not exist.

**Interfaces:**
- Produces: `ENTRIES` in `nodeLoad.test.ts` — later tasks append the modules the function loads.

- [ ] **Step 1: Make sure `node_modules` is the worktree's own**

Run: `ls -ld node_modules`
If the output shows `node_modules -> /…/starborne-frontiers-calculator/node_modules` (a symlink into the main checkout), replace it with a real install so the main checkout is never modified:

```bash
rm node_modules   # removes the symlink only — no trailing slash
npm ci --no-audit --no-fund
```

- [ ] **Step 2: Install the runtime packages**

```bash
npm install --save-exact @modelcontextprotocol/sdk@1.30.1 --no-audit --no-fund
npm install jose --no-audit --no-fund
grep -n '"@modelcontextprotocol/sdk"\|"jose"' package.json
```
Expected: both under `"dependencies"` — `"@modelcontextprotocol/sdk": "1.30.1"` (exact) and `"jose": "^6.x"`. Then check the SDK's zod peer is satisfied by the repo's zod 4: `npm ls zod` must show no `invalid` / `UNMET PEER`.

- [ ] **Step 3: Rewrite the `//dependencies` comment**

In `package.json` replace

```json
"//dependencies": "Runtime only — packages that end up in the browser bundle. Build tooling, type-only packages and node-side script deps belong in devDependencies: `npm run audit` scans production deps only, so anything listed here widens the security gate to code we never ship.",
```

with

```json
"//dependencies": "Runtime only — shipped runtime: the browser bundle or a Netlify function. Build tooling, type-only packages and node-side script deps belong in devDependencies: `npm run audit` scans production deps only, so anything listed here widens the security gate to code we never ship.",
```

- [ ] **Step 4: Widen `tsconfig.json`**

`"include": ["src"]` becomes `"include": ["src", "netlify/functions"]` — not `netlify/`: `netlify/edge-functions/` is Deno.

- [ ] **Step 5: Keep the netlify-ignore comment true**

In `scripts/netlify-ignore.sh` replace the line

```bash
#   e2e/       — its own package; the root tsconfig's `include` is ["src"], so
```

with

```bash
#   e2e/       — its own package; the root tsconfig's `include` is ["src", "netlify/functions"], so
```

(The script's behaviour is unchanged: `netlify/functions/` is outside the inert set, so a function change builds.)

- [ ] **Step 6: Write the node-load tripwire**

`src/mcp/__tests__/nodeLoad.test.ts` (Node 20's `tsx -e "await import(…)"` fails on top-level await in CJS eval, so the child is `node --import tsx -e "import(…).then(…)"`; the first case is the positive control proving the instrument can fail):

```ts
// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire: the MCP function's module graph loads in plain Node.
 *
 * vitest defines `import.meta.env`, so a suite cannot see a transitive import of
 * `src/config/supabase.ts` (or anything else reading `import.meta.env`, or touching a browser
 * global at load) from the function — which would crash every cold start in production. Each
 * entry is imported in a child `node --import tsx` with every `VITE_*` and git variable removed.
 */

const ROOT = resolve(__dirname, '../../..');

const ENTRIES = ['src/services/fleetReads.ts'];

/** Loads `file` in a clean Node child; resolves to its exit status and stderr. */
const loadInNode = (file: string) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith('VITE_') && !key.startsWith('GIT_')) env[key] = value;
    }
    const url = `file://${resolve(ROOT, file)}`;
    const script = `import(${JSON.stringify(url)}).then(() => process.exit(0), (e) => { console.error(e && e.message); process.exit(1); })`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        timeout: 60_000,
    });
    return { status: child.status, stderr: child.stderr };
};

describe('the MCP function loads outside Vite', () => {
    it('fails for a module that reads import.meta.env, so a pass below means something', () => {
        const { status, stderr } = loadInNode('src/config/supabase.ts');

        expect(status).not.toBe(0);
        expect(stderr).toContain('VITE_SUPABASE_URL');
    });

    it.each(ENTRIES)('%s loads with VITE_* unset', (file) => {
        const { status, stderr } = loadInNode(file);

        expect(stderr).toBe('');
        expect(status).toBe(0);
    });
});
```

- [ ] **Step 7: Run it**

Run: `npx vitest run src/mcp/__tests__/nodeLoad.test.ts`
Expected: PASS, 2 tests — the control reports `Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')` from `src/config/supabase.ts`, and `src/services/fleetReads.ts` loads.

Mutation check (do not commit): add `import '../config/supabase';` as the first line of `src/services/fleetReads.ts`, re-run — the `fleetReads.ts` case must FAIL. Remove the line.

Run: `npx tsc --noEmit && npx eslint src/mcp --max-warnings 0`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add package.json \
    package-lock.json \
    tsconfig.json \
    scripts/netlify-ignore.sh \
    src/mcp/__tests__/nodeLoad.test.ts
git commit -m "$(cat <<'EOF'
build(mcp): add MCP SDK and jose, type-check netlify/functions, node-load tripwire (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 5: Tool types and token verification

**Files:**
- Create: `src/mcp/types.ts`
- Create: `src/mcp/auth.ts`
- Create: `src/mcp/__tests__/testTokens.ts`
- Create: `src/mcp/__tests__/auth.test.ts`

**Interfaces:**
- Produces (`types.ts`): `interface McpToolContext { db: SupabaseClient; authUserId: string }`; `interface McpTool<I> { name; description; input: z.ZodType<I>; run(input: I, ctx: McpToolContext): Promise<unknown> }`; `interface RegisteredMcpTool` (input erased to `unknown`); `defineTool<I>(tool: McpTool<I>): RegisteredMcpTool`; `class McpToolError extends Error` (message safe to show the agent).
- Produces (`auth.ts`): `type AuthErrorReason = 'unauthenticated' | 'not_oauth'`; `class AuthError extends Error { reason }`; `verifyAccessToken(token: string, { jwks: JWTVerifyGetKey; issuer: string }): Promise<{ sub: string; clientId: string }>`.
- Produces (`testTokens.ts`): `ISSUER = 'https://project.supabase.co/auth/v1'`; `makeSigner(): Promise<{ jwks; sign(claims?, { issuer?, expiresIn?, sub? }?) => Promise<string> }>` (default `sub` is `'user-1'`).

- [ ] **Step 1: Write the test helper and the failing test**

`src/mcp/__tests__/testTokens.ts`:

```ts
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';

export const ISSUER = 'https://project.supabase.co/auth/v1';

interface SignOptions {
    issuer?: string;
    /** A `jose` time span ('1h') or an absolute epoch-seconds expiry. */
    expiresIn?: string | number;
    sub?: string;
}

/** A local ES256 key set standing in for the project's JWKS, and a signer for tokens under it. */
export const makeSigner = async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256' };
    const jwks = createLocalJWKSet({ keys: [jwk] });

    const sign = (
        claims: JWTPayload = {},
        { issuer = ISSUER, expiresIn = '1h', sub = 'user-1' }: SignOptions = {}
    ) =>
        new SignJWT({ role: 'authenticated', ...claims })
            .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
            .setSubject(sub)
            .setIssuer(issuer)
            .setIssuedAt()
            .setExpirationTime(expiresIn)
            .sign(privateKey);

    return { jwks, sign };
};
```

`src/mcp/__tests__/auth.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { AuthError, verifyAccessToken, type VerifyAccessTokenOptions } from '../auth';
import { ISSUER, makeSigner } from './testTokens';

let signer: Awaited<ReturnType<typeof makeSigner>>;
let options: VerifyAccessTokenOptions;

beforeAll(async () => {
    signer = await makeSigner();
    options = { jwks: signer.jwks, issuer: ISSUER };
});

/** The reason `verifyAccessToken` refused `token` with; fails the test if it accepted it. */
const refusal = async (token: string) => {
    const error: unknown = await verifyAccessToken(token, options).then(
        () => null,
        (e: unknown) => e
    );
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).reason;
};

describe('verifyAccessToken', () => {
    it('accepts an OAuth token and returns its subject and client', async () => {
        const token = await signer.sign({ client_id: 'client-1' });

        await expect(verifyAccessToken(token, options)).resolves.toEqual({
            sub: 'user-1',
            clientId: 'client-1',
        });
    });

    it('refuses an expired token as unauthenticated', async () => {
        const token = await signer.sign(
            { client_id: 'client-1' },
            { expiresIn: Math.floor(Date.now() / 1000) - 60 }
        );

        expect(await refusal(token)).toBe('unauthenticated');
    });

    it('refuses a token from another issuer as unauthenticated', async () => {
        const token = await signer.sign(
            { client_id: 'client-1' },
            { issuer: 'https://other.supabase.co/auth/v1' }
        );

        expect(await refusal(token)).toBe('unauthenticated');
    });

    it('refuses a token signed by a key outside the set as unauthenticated', async () => {
        const stranger = await makeSigner();
        const token = await stranger.sign({ client_id: 'client-1' });

        expect(await refusal(token)).toBe('unauthenticated');
    });

    it('refuses a malformed token as unauthenticated', async () => {
        expect(await refusal('not-a-jwt')).toBe('unauthenticated');
    });

    it('refuses a website session token (no client_id) as not_oauth', async () => {
        const token = await signer.sign();

        expect(await refusal(token)).toBe('not_oauth');
    });

    it('refuses an empty client_id as not_oauth', async () => {
        const token = await signer.sign({ client_id: '' });

        expect(await refusal(token)).toBe('not_oauth');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/mcp/__tests__/auth.test.ts`
Expected: FAIL — `Failed to resolve import "../auth"`.

- [ ] **Step 3: Implement `types.ts` and `auth.ts`**

`src/mcp/types.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

/** What every tool runs with: a Supabase client that reads as the caller (their OAuth token, so
 *  RLS applies), and the caller's auth user id. */
export interface McpToolContext {
    db: SupabaseClient;
    authUserId: string;
}

export interface McpTool<I> {
    name: string;
    description: string;
    input: z.ZodType<I>;
    run(input: I, ctx: McpToolContext): Promise<unknown>;
}

/** A tool with its input type erased, so tools of different inputs share one list. */
export interface RegisteredMcpTool {
    name: string;
    description: string;
    input: z.ZodType<unknown>;
    run(input: unknown, ctx: McpToolContext): Promise<unknown>;
}

/** Erases a tool's input type. Sound because the SDK parses a call's arguments with `input`
 *  before `registerTools` hands them to `run`. */
export const defineTool = <I>(tool: McpTool<I>): RegisteredMcpTool => ({
    name: tool.name,
    description: tool.description,
    input: tool.input,
    run: (input, ctx) => tool.run(input as I, ctx),
});

/** A failure whose message is written for the agent and is safe to show it verbatim. */
export class McpToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'McpToolError';
    }
}
```

`src/mcp/auth.ts`:

```ts
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** `unauthenticated`: no usable token — missing, malformed, bad signature, wrong issuer, expired.
 *  `not_oauth`: a valid Supabase token that no OAuth client was issued (a website session). */
export type AuthErrorReason = 'unauthenticated' | 'not_oauth';

export class AuthError extends Error {
    constructor(
        readonly reason: AuthErrorReason,
        message: string
    ) {
        super(message);
        this.name = 'AuthError';
    }
}

export interface VerifiedToken {
    sub: string;
    clientId: string;
}

export interface VerifyAccessTokenOptions {
    /** The project's signing keys: `createRemoteJWKSet` in production, `createLocalJWKSet` in
     *  tests. */
    jwks: JWTVerifyGetKey;
    /** `<SUPABASE_URL>/auth/v1`. */
    issuer: string;
}

/**
 * Verifies a Supabase access token and requires it to be OAuth-issued. The project signs with
 * ES256, so no other algorithm is accepted. A token carries `client_id` only when Supabase issued
 * it to an OAuth client, and the database treats such tokens as read-only
 * (`supabase/migrations/20260925000001_oauth_clients_read_only.sql`, #562). That is the guarantee
 * the MCP server relies on, so a website session token is refused here.
 */
export async function verifyAccessToken(
    token: string,
    { jwks, issuer }: VerifyAccessTokenOptions
): Promise<VerifiedToken> {
    let payload;
    try {
        ({ payload } = await jwtVerify(token, jwks, {
            issuer,
            algorithms: ['ES256'],
            requiredClaims: ['sub', 'exp'],
        }));
    } catch (error) {
        throw new AuthError(
            'unauthenticated',
            error instanceof errors.JOSEError ? error.code : 'invalid token'
        );
    }

    const clientId = payload.client_id;
    if (typeof clientId !== 'string' || clientId === '') {
        throw new AuthError('not_oauth', 'token was not issued to an OAuth client');
    }
    return { sub: payload.sub as string, clientId };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp/__tests__/auth.test.ts`
Expected: PASS, 7 tests.

Run: `npx tsc --noEmit && npx eslint src/mcp --max-warnings 0`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/types.ts \
    src/mcp/auth.ts \
    src/mcp/__tests__/testTokens.ts \
    src/mcp/__tests__/auth.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): tool types and OAuth access-token verification (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 6: Registry, error mapping and the gear tools

The SDK validates arguments against `inputSchema` itself and answers a failure as `isError: true` ("MCP error -32602: Input validation error: …") — `registerTools` does not re-validate. It wraps `run` so a thrown error becomes `isError: true` with `toolErrorMessage`.

**Files:**
- Create: `src/mcp/errors.ts`
- Create: `src/mcp/registry.ts`
- Create: `src/mcp/tools/gear.ts`
- Create: `src/mcp/__tests__/fixtures.ts`
- Create: `src/mcp/__tests__/registry.test.ts`
- Create: `src/mcp/__tests__/tools.gear.test.ts`
- Modify: `src/mcp/__tests__/nodeLoad.test.ts` (`ENTRIES`)

**Interfaces:**
- Consumes: `defineTool`, `McpToolError`, `McpTool`, `McpToolContext` (Task 5); `stubDb` (Task 1).
- Produces: `toolErrorMessage(error: unknown): string`; `TOOLS: readonly RegisteredMcpTool[]`; `registerTools(server: McpServer, ctx: McpToolContext, tools?: readonly RegisteredMcpTool[]): void`; `listGearSets`, `listImplants`; test fixtures `AUTH_USER`, `ALT_PROFILE`, `STRANGER`, `ctxOver(tables, options?) → { ctx, calls }`, `call(tool, raw, ctx)` (parses `raw` with `tool.input`, then runs).

- [ ] **Step 1: Write fixtures and failing tests**

`src/mcp/__tests__/fixtures.ts`:

```ts
import type { McpToolContext, McpTool } from '../types';
import { stubDb } from '../../__tests__/services/stubDb';

export const AUTH_USER = '11111111-1111-4111-8111-111111111111';
export const ALT_PROFILE = '22222222-2222-4222-8222-222222222222';
export const STRANGER = '33333333-3333-4333-8333-333333333333';

/** A context over `tables`, reading as `AUTH_USER`. */
export const ctxOver = (tables: Record<string, Record<string, unknown>[]>, options = {}) => {
    const { db, calls } = stubDb(tables, options);
    const ctx: McpToolContext = { db, authUserId: AUTH_USER };
    return { ctx, calls };
};

/** Runs `tool` the way the SDK does: parse the raw arguments with its `input`, then `run`. */
export const call = <I>(tool: McpTool<I>, raw: unknown, ctx: McpToolContext) =>
    tool.run(tool.input.parse(raw), ctx);
```

`src/mcp/__tests__/tools.gear.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GEAR_SETS } from '../../constants/gearSets';
import { listGearSets, listImplants } from '../tools/gear';
import { call, ctxOver } from './fixtures';

const { ctx } = ctxOver({});

describe('list_gear_sets', () => {
    it('lists every set under its gear id', async () => {
        const result = (await call(listGearSets, {}, ctx)) as { gearSets: { id: string }[] };

        expect(result.gearSets.map((set) => set.id)).toEqual(Object.keys(GEAR_SETS));
        expect(result.gearSets.find((set) => set.id === 'ATTACK')).toEqual({
            id: 'ATTACK',
            name: 'Attack',
            stats: [{ name: 'attack', value: 15, type: 'percentage' }],
        });
    });
});

describe('list_implants', () => {
    it('filters by part of the name, any case', async () => {
        const result = (await call(listImplants, { query: 'martyr' }, ctx)) as {
            implants: { id: string; type: string; variants: unknown[] }[];
        };

        expect(result.implants).toHaveLength(1);
        expect(result.implants[0]).toMatchObject({ id: 'MARTYRDOM', type: 'ultimate' });
        expect(result.implants[0].variants).toContainEqual({
            rarity: 'legendary',
            stats: [],
            description: 'Applies Disable for 2 turns on the enemy that killed this Unit.',
        });
    });

    it('lists every implant with no query', async () => {
        const result = (await call(listImplants, {}, ctx)) as { implants: unknown[] };

        expect(result.implants.length).toBeGreaterThan(10);
    });
});
```

`src/mcp/__tests__/registry.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, registerTools } from '../registry';
import { McpToolError, defineTool, type RegisteredMcpTool } from '../types';
import { ctxOver } from './fixtures';

const probe = (run: () => Promise<unknown>): RegisteredMcpTool =>
    defineTool({
        name: 'probe',
        description: 'test tool',
        input: z.object({ n: z.number().int().max(5).default(1) }),
        run: async () => run(),
    });

/** Registers `tools` on a fresh server and returns a connected in-memory client. */
const connect = async (tools: readonly RegisteredMcpTool[]) => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTools(server, ctxOver({}).ctx, tools);
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientSide);
    return client;
};

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { type: string; text: string }[])[0].text;

describe('registerTools', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers every tool, all marked read-only', async () => {
        const client = await connect(TOOLS);

        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'list_gear_sets',
            'list_implants',
        ]);
        expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    });

    it('returns a tool result as JSON text', async () => {
        const client = await connect([probe(async () => ({ ok: 1 }))]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(textOf(result))).toEqual({ ok: 1 });
    });

    it('answers invalid arguments with isError and the validation message', async () => {
        const client = await connect([probe(async () => ({ ok: 1 }))]);

        const result = await client.callTool({ name: 'probe', arguments: { n: 9 } });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('Input validation error');
    });

    it('passes an McpToolError message through', async () => {
        const client = await connect([
            probe(async () => {
                throw new McpToolError('not one of your profiles');
            }),
        ]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('not one of your profiles');
    });

    it('maps the read-only hook error to "this tool cannot change your data"', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = await connect([
            probe(async () => {
                throw Object.assign(new Error('OAuth client tokens are read-only'), {
                    code: 'PT403',
                });
            }),
        ]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('this tool cannot change your data');
    });

    it('reduces any other Supabase error to its code, with no message or SQL', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = await connect([
            probe(async () => {
                throw Object.assign(new Error('relation "secret_table" does not exist'), {
                    code: '42P01',
                });
            }),
        ]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('The planner database request failed (42P01).');
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/mcp/__tests__/tools.gear.test.ts src/mcp/__tests__/registry.test.ts`
Expected: FAIL — `../tools/gear` and `../registry` do not resolve.

- [ ] **Step 3: Implement**

`src/mcp/errors.ts`:

```ts
import { McpToolError } from './types';

/** The Postgres/PostgREST error code the read-only hook raises for a write by an OAuth token
 *  (`supabase/migrations/20260925000001_oauth_clients_read_only.sql`). */
const READ_ONLY_CODE = 'PT403';

const errorCode = (error: unknown): string | undefined =>
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;

/**
 * The text an agent sees when a tool fails. Only an `McpToolError` passes its own message
 * through; anything else — a Supabase error, a bug — is reduced to a short line with at most its
 * error code, so no stack, SQL or row data reaches the agent.
 */
export const toolErrorMessage = (error: unknown): string => {
    if (error instanceof McpToolError) return error.message;
    const code = errorCode(error);
    if (code === READ_ONLY_CODE) return 'this tool cannot change your data';
    return code ? `The planner database request failed (${code}).` : 'The tool failed.';
};
```

`src/mcp/tools/gear.ts`:

```ts
import { z } from 'zod';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS, type ImplantData } from '../../constants/implants';
import type { GearSetBonus } from '../../types/gear';
import type { McpTool } from '../types';

const listGearSetsInput = z.object({});

export const listGearSets: McpTool<z.output<typeof listGearSetsInput>> = {
    name: 'list_gear_sets',
    description:
        'Every gear set: its id (the value gear carries), name, the stats it grants, pieces needed and any special effect.',
    input: listGearSetsInput,
    run: async () => ({
        gearSets: Object.entries(GEAR_SETS).map(([id, set]: [string, GearSetBonus]) => ({
            id,
            name: set.name,
            stats: set.stats,
            ...(set.minPieces !== undefined && { minPieces: set.minPieces }),
            ...(set.description !== undefined && { description: set.description }),
        })),
    }),
};

const listImplantsInput = z.object({
    query: z.string().trim().min(1).optional().describe('Part of the implant name, any case.'),
});

export const listImplants: McpTool<z.output<typeof listImplantsInput>> = {
    name: 'list_implants',
    description:
        'Implants, optionally filtered by name: type (major, minor slot, ultimate) and each rarity variant’s stats and effect text.',
    input: listImplantsInput,
    run: async ({ query }) => {
        const q = query?.toLowerCase();
        return {
            implants: Object.entries(IMPLANTS)
                .filter(([, implant]) => !q || implant.name.toLowerCase().includes(q))
                .map(([id, implant]: [string, ImplantData]) => ({
                    id,
                    name: implant.name,
                    type: implant.type,
                    variants: implant.variants.map((variant) => ({
                        rarity: variant.rarity,
                        stats: variant.stats ?? [],
                        ...(variant.description !== undefined && {
                            description: variant.description,
                        }),
                    })),
                })),
        };
    },
};
```

`src/mcp/registry.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolErrorMessage } from './errors';
import { listGearSets, listImplants } from './tools/gear';
import { McpToolError, defineTool, type McpToolContext, type RegisteredMcpTool } from './types';

/** Every tool the MCP server offers. All of them only read. */
export const TOOLS: readonly RegisteredMcpTool[] = [
    defineTool(listGearSets),
    defineTool(listImplants),
];

/**
 * Registers `tools` on `server`, each bound to `ctx`. The SDK validates a call's arguments against
 * the tool's `input` and answers a failure itself (`isError: true`). A tool that throws is
 * answered with `toolErrorMessage`; anything but an `McpToolError` is also logged in full, to the
 * function log only.
 */
export function registerTools(
    server: McpServer,
    ctx: McpToolContext,
    tools: readonly RegisteredMcpTool[] = TOOLS
): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.input,
                annotations: { readOnlyHint: true },
            },
            async (input) => {
                try {
                    const result = await tool.run(input, ctx);
                    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                } catch (error) {
                    if (!(error instanceof McpToolError)) {
                        console.error(`MCP tool ${tool.name} failed:`, error);
                    }
                    return {
                        content: [{ type: 'text', text: toolErrorMessage(error) }],
                        isError: true,
                    };
                }
            }
        );
    }
}
```

In `src/mcp/__tests__/nodeLoad.test.ts` replace `const ENTRIES = ['src/services/fleetReads.ts'];` with

```ts
const ENTRIES = ['src/mcp/registry.ts', 'src/services/fleetReads.ts'];
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/mcp --max-warnings 0`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/errors.ts \
    src/mcp/registry.ts \
    src/mcp/tools/gear.ts \
    src/mcp/__tests__/fixtures.ts \
    src/mcp/__tests__/registry.test.ts \
    src/mcp/__tests__/tools.gear.test.ts \
    src/mcp/__tests__/nodeLoad.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): tool registry, error mapping, list_gear_sets and list_implants (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 7: `search_ships` and `get_ship`

`transformShipTemplate` (and its `ShipTemplate` row type) moves verbatim from `src/hooks/useShipsData.ts` to `src/utils/ship/shipTemplate.ts` — the hook imports `config/supabase`, so the tools cannot import it. Templates are filtered in memory after the same transform the website uses (case-insensitive name, `factionMatchesSearch` for faction so old spellings match).

**Files:**
- Create: `src/utils/ship/shipTemplate.ts`
- Modify: `src/hooks/useShipsData.ts` (imports; delete the moved block)
- Create: `src/mcp/playerStats.ts`
- Create: `src/mcp/tools/ships.ts`
- Create: `src/mcp/__tests__/tools.ships.test.ts`
- Modify: `src/mcp/__tests__/fixtures.ts` (add `templateRow`)
- Modify: `src/mcp/registry.ts`, `src/mcp/__tests__/registry.test.ts`

**Interfaces:**
- Produces: `interface ShipTemplate`, `transformShipTemplate(template: ShipTemplate): Ship | null`; `playerStats(stats: BaseStats): Omit<BaseStats, 'hpRegen'>`; `findShipTemplate(db: SupabaseClient, name: string): Promise<Ship>` (throws `McpToolError` naming `search_ships` when absent); `searchShips`, `getShip`.

- [ ] **Step 1: Move `transformShipTemplate`**

Create `src/utils/ship/shipTemplate.ts`:

```ts
import { toAffinityName } from '../../constants/affinities';
import { isRarityName } from '../../constants/rarities';
import { isShipTypeName } from '../../constants/shipTypes';
import type { Ship } from '../../types/ship';

/** A `ship_templates` row as `select('*')` returns it. */
export interface ShipTemplate {
    id: string;
    name: string;
    rarity: string;
    faction: string;
    type: string;
    // `ship_templates.affinity` is nullable; coerced by `toAffinityName` below.
    affinity: string | null;
    image_key: string;
    active_skill_text?: string;
    charge_skill_text?: string;
    charge_skill_charge?: number;
    first_passive_skill_text?: string;
    second_passive_skill_text?: string;
    third_passive_skill_text?: string;
    active_target?: string | null;
    active_pattern?: string | null;
    charged_target?: string | null;
    charged_pattern?: string | null;
    bio?: string;
    quote?: string;
    quote_author?: string;
    ascension_stats?: unknown;
    base_stats: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit_rate: number;
        crit_damage: number;
        speed: number;
        shield: number;
        shield_penetration: number;
        defense_penetration: number;
    };
}

// `ship_templates` is a Supabase system table (`CLAUDE.md`) — a row's `type` crosses that trust
// boundary, so a row whose value fell out of the `ShipTypeName` union is dropped rather than
// carried into a `Ship` with a role the rest of the app can't classify.
export const transformShipTemplate = (template: ShipTemplate): Ship | null => {
    if (!isShipTypeName(template.type)) {
        console.warn(
            `Unrecognised ship type "${template.type}" — skipping template ${template.id}`
        );
        return null;
    }

    const rarity = template.rarity.toLowerCase();
    if (!isRarityName(rarity)) {
        console.warn(
            `Unrecognised ship rarity "${template.rarity}" — skipping template ${template.id}`
        );
        return null;
    }

    return {
        id: template.id,
        name: template.name,
        rarity,
        faction: template.faction,
        type: template.type,
        baseStats: {
            hp: template.base_stats.hp,
            attack: template.base_stats.attack,
            defence: template.base_stats.defence,
            hacking: template.base_stats.hacking,
            security: template.base_stats.security,
            crit: template.base_stats.crit_rate,
            critDamage: template.base_stats.crit_damage,
            speed: template.base_stats.speed,
            healModifier: 0,
            hpRegen: 0,
            shield: template.base_stats.shield,
            shieldPenetration: template.base_stats.shield_penetration,
            defensePenetration: template.base_stats.defense_penetration,
        },
        equipment: {},
        refits: [],
        implants: {},
        affinity: toAffinityName(template.affinity),
        imageKey: template.image_key,
        activeSkillText: template.active_skill_text,
        chargeSkillText: template.charge_skill_text,
        chargeSkillCharge: template.charge_skill_charge,
        firstPassiveSkillText: template.first_passive_skill_text,
        secondPassiveSkillText: template.second_passive_skill_text,
        thirdPassiveSkillText: template.third_passive_skill_text,
        activeTarget: template.active_target ?? undefined,
        activePattern: template.active_pattern ?? undefined,
        chargedTarget: template.charged_target ?? undefined,
        chargedPattern: template.charged_pattern ?? undefined,
        bio: template.bio,
        quote: template.quote,
        quoteAuthor: template.quote_author,
    };
};
```

In `src/hooks/useShipsData.ts`, delete everything from `interface ShipTemplate {` up to, but not including, `// Module-level cache` (the block now in `shipTemplate.ts`), and replace the three imports

```ts
import { isShipTypeName } from '../constants/shipTypes';
import { isRarityName } from '../constants/rarities';
import { toAffinityName } from '../constants/affinities';
```

with

```ts
import { transformShipTemplate, type ShipTemplate } from '../utils/ship/shipTemplate';
```

Run: `npx tsc --noEmit && npx vitest run src/hooks src/components/simulator src/pages/database`
Expected: no type errors; PASS.

- [ ] **Step 2: Write the failing tests**

In `src/mcp/__tests__/fixtures.ts`, insert after the `STRANGER` constant:

```ts
/** A `ship_templates` row as `select('*')` returns it. */
export const templateRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'tpl-1',
    name: 'Atlas',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    affinity: 'thermal',
    image_key: 'atlas',
    active_skill_text: 'This Unit deals <unit-damage>180% damage</unit-damage>',
    charge_skill_text: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
    charge_skill_charge: 3,
    first_passive_skill_text: 'This Unit gains <unit-skill>Attack Up I</unit-skill> for 1 turn',
    second_passive_skill_text: 'This Unit gains <unit-skill>Attack Up II</unit-skill> for 1 turn',
    third_passive_skill_text: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
    base_stats: {
        hp: 10000,
        attack: 3000,
        defence: 1500,
        hacking: 100,
        security: 50,
        crit_rate: 10,
        crit_damage: 50,
        speed: 100,
        shield: 0,
        shield_penetration: 0,
        defense_penetration: 0,
    },
    ...overrides,
});
```

`src/mcp/__tests__/tools.ships.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { McpToolError } from '../types';
import { getShip, searchShips } from '../tools/ships';
import { call, ctxOver, templateRow } from './fixtures';

const templates = [
    templateRow({ id: 't1', name: 'Atlas' }),
    templateRow({ id: 't2', name: 'Atlantis', type: 'DEFENDER', rarity: 'EPIC' }),
    templateRow({ id: 't3', name: 'Zeta', faction: 'BINDERBURG' }),
];

describe('search_ships', () => {
    it('matches part of the name in any case, sorted by name', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        const result = await call(searchShips, { query: 'ATL' }, ctx);

        expect(result).toMatchObject({
            total: 2,
            ships: [{ name: 'Atlantis' }, { name: 'Atlas' }],
        });
    });

    it('filters by type, rarity and faction', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        expect(await call(searchShips, { type: 'DEFENDER' }, ctx)).toMatchObject({
            total: 1,
            ships: [{ name: 'Atlantis' }],
        });
        expect(await call(searchShips, { rarity: 'epic' }, ctx)).toMatchObject({ total: 1 });
        expect(await call(searchShips, { faction: 'binder' }, ctx)).toMatchObject({
            ships: [{ name: 'Zeta' }],
        });
    });

    it('caps the list at limit and reports the full total', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        const result = (await call(searchShips, { limit: 1 }, ctx)) as {
            total: number;
            ships: unknown[];
        };

        expect(result.total).toBe(3);
        expect(result.ships).toHaveLength(1);
    });

    it('rejects a limit above 50 and an unknown type', () => {
        expect(searchShips.input.safeParse({ limit: 51 }).success).toBe(false);
        expect(searchShips.input.safeParse({ type: 'PILOT' }).success).toBe(false);
    });

    it('throws the Supabase error for the registry to map', async () => {
        const { ctx } = ctxOver(
            {},
            { errors: { ship_templates: { message: 'boom', code: '500' } } }
        );

        await expect(call(searchShips, {}, ctx)).rejects.toEqual({ message: 'boom', code: '500' });
    });
});

describe('get_ship', () => {
    it('returns the template by name, any case, without the planner-internal hpRegen', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        const ship = (await call(getShip, { name: 'atlas' }, ctx)) as {
            baseStats: Record<string, number>;
        };

        expect(ship).toMatchObject({
            name: 'Atlas',
            type: 'ATTACKER',
            rarity: 'legendary',
            faction: 'ATLAS_SYNDICATE',
            affinity: 'thermal',
            baseStats: { hp: 10000, attack: 3000, crit: 10, critDamage: 50 },
        });
        expect(ship.baseStats).not.toHaveProperty('hpRegen');
    });

    it('names search_ships when the ship does not exist', async () => {
        const { ctx } = ctxOver({ ship_templates: templates });

        await expect(call(getShip, { name: 'Nope' }, ctx)).rejects.toBeInstanceOf(McpToolError);
    });
});
```

In `src/mcp/__tests__/registry.test.ts`, the expected tool list becomes

```ts
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'get_ship',
            'list_gear_sets',
            'list_implants',
            'search_ships',
        ]);
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/mcp/__tests__/tools.ships.test.ts src/mcp/__tests__/registry.test.ts`
Expected: FAIL — `../tools/ships` does not resolve.

- [ ] **Step 4: Implement**

`src/mcp/playerStats.ts`:

```ts
import type { BaseStats } from '../types/stats';

/** A ship's stats as a player reads them. `hpRegen` is dropped: it is the planner's model of
 *  hit-triggered self-repair, not a stat the game has, so it is never shown to a player. */
export const playerStats = (stats: BaseStats): Omit<BaseStats, 'hpRegen'> => {
    const { hpRegen: _plannerInternal, ...shown } = stats;
    return shown;
};
```

`src/mcp/tools/ships.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { factionMatchesSearch } from '../../constants/factions';
import { RARITIES, type RarityName } from '../../constants/rarities';
import { SHIP_TYPE_NAMES, type ShipTypeName } from '../../constants/shipTypes';
import type { Ship } from '../../types/ship';
import { transformShipTemplate, type ShipTemplate } from '../../utils/ship/shipTemplate';
import { playerStats } from '../playerStats';
import { McpToolError, type McpTool } from '../types';

const RARITY_NAMES = Object.keys(RARITIES) as [RarityName, ...RarityName[]];
const TYPE_NAMES = SHIP_TYPE_NAMES as [ShipTypeName, ...ShipTypeName[]];

/** Every ship template, as the website's ship database builds them. */
async function fetchShipTemplates(db: SupabaseClient): Promise<Ship[]> {
    const { data, error } = await db.from('ship_templates').select('*');
    if (error) throw error;
    return (data as ShipTemplate[])
        .map(transformShipTemplate)
        .filter((ship): ship is Ship => ship !== null);
}

/** The one template named `name`, case-insensitively. */
export async function findShipTemplate(db: SupabaseClient, name: string): Promise<Ship> {
    const wanted = name.toLowerCase();
    const ship = (await fetchShipTemplates(db)).find((t) => t.name.toLowerCase() === wanted);
    if (!ship) {
        throw new McpToolError(`No ship named "${name}". Use search_ships to find the exact name.`);
    }
    return ship;
}

const shipSummary = (ship: Ship) => ({
    name: ship.name,
    type: ship.type,
    rarity: ship.rarity,
    faction: ship.faction,
    affinity: ship.affinity ?? null,
    baseStats: playerStats(ship.baseStats),
});

const searchShipsInput = z.object({
    query: z.string().trim().min(1).optional().describe('Part of the ship name, any case.'),
    type: z.enum(TYPE_NAMES).optional(),
    rarity: z.enum(RARITY_NAMES).optional(),
    faction: z.string().trim().min(1).optional().describe('Faction name or part of it.'),
    limit: z.number().int().min(1).max(50).default(20),
});

export const searchShips: McpTool<z.output<typeof searchShipsInput>> = {
    name: 'search_ships',
    description:
        'Search the Starborne Frontiers ship database by name, role, rarity and faction. Returns level-60 base stats; `total` counts every match before `limit`.',
    input: searchShipsInput,
    run: async ({ query, type, rarity, faction, limit }, { db }) => {
        const q = query?.toLowerCase();
        const matches = (await fetchShipTemplates(db))
            .filter((ship) => !q || ship.name.toLowerCase().includes(q))
            .filter((ship) => !type || ship.type === type)
            .filter((ship) => !rarity || ship.rarity === rarity)
            .filter((ship) => !faction || factionMatchesSearch(ship.faction, faction))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { total: matches.length, ships: matches.slice(0, limit).map(shipSummary) };
    },
};

const getShipInput = z.object({
    name: z.string().trim().min(1).describe('The exact ship name, any case.'),
});

export const getShip: McpTool<z.output<typeof getShipInput>> = {
    name: 'get_ship',
    description:
        'One ship from the Starborne Frontiers ship database: role, rarity, faction, affinity and level-60 base stats.',
    input: getShipInput,
    run: async ({ name }, { db }) => shipSummary(await findShipTemplate(db, name)),
};
```

`src/mcp/registry.ts` becomes:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolErrorMessage } from './errors';
import { listGearSets, listImplants } from './tools/gear';
import { getShip, searchShips } from './tools/ships';
import { McpToolError, defineTool, type McpToolContext, type RegisteredMcpTool } from './types';

/** Every tool the MCP server offers. All of them only read. */
export const TOOLS: readonly RegisteredMcpTool[] = [
    defineTool(searchShips),
    defineTool(getShip),
    defineTool(listGearSets),
    defineTool(listImplants),
];

/**
 * Registers `tools` on `server`, each bound to `ctx`. The SDK validates a call's arguments against
 * the tool's `input` and answers a failure itself (`isError: true`). A tool that throws is
 * answered with `toolErrorMessage`; anything but an `McpToolError` is also logged in full, to the
 * function log only.
 */
export function registerTools(
    server: McpServer,
    ctx: McpToolContext,
    tools: readonly RegisteredMcpTool[] = TOOLS
): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.input,
                annotations: { readOnlyHint: true },
            },
            async (input) => {
                try {
                    const result = await tool.run(input, ctx);
                    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                } catch (error) {
                    if (!(error instanceof McpToolError)) {
                        console.error(`MCP tool ${tool.name} failed:`, error);
                    }
                    return {
                        content: [{ type: 'text', text: toolErrorMessage(error) }],
                        isError: true,
                    };
                }
            }
        );
    }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/mcp src/hooks`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/mcp src/hooks/useShipsData.ts src/utils/ship/shipTemplate.ts --max-warnings 0`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/utils/ship/shipTemplate.ts \
    src/hooks/useShipsData.ts \
    src/mcp/playerStats.ts \
    src/mcp/tools/ships.ts \
    src/mcp/__tests__/tools.ships.test.ts \
    src/mcp/__tests__/fixtures.ts \
    src/mcp/registry.ts \
    src/mcp/__tests__/registry.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): search_ships and get_ship over ship_templates (#562)

Moves transformShipTemplate out of useShipsData (which imports config/supabase) so
the tools build template ships with the transform the website uses.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 8: `get_ship_skills`

Reads `ship_templates` (what the website renders); `docs/ship-skills.csv` stays the parser's dev-side reference, not a runtime input. The passive shown is the refit-active one via `getShipSkillRows()` on a template ship carrying `refits` empty refits; effects are `parseAllSkillEffects` reduced to `buffName`, `target`, `duration`, `source`, and `stacks` / `application` when present.

**Files:**
- Create: `src/mcp/tools/skills.ts`
- Create: `src/mcp/__tests__/tools.skills.test.ts`
- Modify: `src/mcp/registry.ts`, `src/mcp/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `findShipTemplate` (Task 7), `templateRow` fixture (Task 7).
- Produces: `getShipSkills` — input `{ name: string; refits: 0 | 2 | 4 }` (default 0).

- [ ] **Step 1: Write the failing test**

`src/mcp/__tests__/tools.skills.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getShipSkills } from '../tools/skills';
import { call, ctxOver, templateRow } from './fixtures';

describe('get_ship_skills', () => {
    const { ctx } = ctxOver({ ship_templates: [templateRow()] });

    it('shows the base passive at refits 0 (the default)', async () => {
        const result = (await call(getShipSkills, { name: 'Atlas' }, ctx)) as {
            refits: number;
            skills: { label: string }[];
        };

        expect(result.refits).toBe(0);
        expect(result.skills.map((row) => row.label)).toEqual(['Active', 'Charge', 'Passive R0']);
    });

    it('shows only the refit-active passive', async () => {
        const r2 = (await call(getShipSkills, { name: 'Atlas', refits: 2 }, ctx)) as {
            skills: { label: string }[];
        };
        const r4 = (await call(getShipSkills, { name: 'Atlas', refits: 4 }, ctx)) as {
            skills: { label: string }[];
        };

        expect(r2.skills.map((row) => row.label)).toEqual(['Active', 'Charge', 'Passive R2']);
        expect(r4.skills.map((row) => row.label)).toEqual(['Active', 'Charge', 'Passive R4']);
    });

    it('carries the charge count and the parsed effects of the active rows', async () => {
        const result = (await call(getShipSkills, { name: 'Atlas', refits: 4 }, ctx)) as {
            skills: { label: string; charge?: number }[];
            effects: { buffName: string }[];
        };

        expect(result.skills.find((row) => row.label === 'Charge')?.charge).toBe(3);
        expect(result.effects).toEqual([
            {
                buffName: 'Defense Down II',
                target: 'enemy',
                duration: 2,
                source: 'charge',
                application: 'inflict',
            },
            { buffName: 'Attack Up III', target: 'self', duration: 1, source: 'passive3' },
        ]);
    });

    it('accepts only 0, 2 or 4 refits', () => {
        expect(getShipSkills.input.safeParse({ name: 'Atlas', refits: 3 }).success).toBe(false);
    });
});
```

In `src/mcp/__tests__/registry.test.ts`, the expected tool list becomes

```ts
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'get_ship',
            'get_ship_skills',
            'list_gear_sets',
            'list_implants',
            'search_ships',
        ]);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/mcp/__tests__/tools.skills.test.ts`
Expected: FAIL — `../tools/skills` does not resolve.

- [ ] **Step 3: Implement**

`src/mcp/tools/skills.ts`:

```ts
import { z } from 'zod';
import type { Ship } from '../../types/ship';
import { getShipSkillRows } from '../../utils/ship/skillRows';
import { parseAllSkillEffects } from '../../utils/skillTextParser';
import type { McpTool } from '../types';
import { findShipTemplate } from './ships';

const getShipSkillsInput = z.object({
    name: z.string().trim().min(1).describe('The exact ship name, any case.'),
    refits: z
        .union([z.literal(0), z.literal(2), z.literal(4)])
        .default(0)
        .describe('Refit count; picks which passive is active (0 = base, 2 = R2, 4 = R4).'),
});

/** A template ship carrying `count` refits, so `getShipSkillRows` resolves the passive a ship at
 *  that refit level has. Refit stats do not affect skill resolution, so the refits are empty. */
const withRefits = (ship: Ship, count: number): Ship => ({
    ...ship,
    refits: Array.from({ length: count }, (_, i) => ({ id: `refit-${i + 1}`, stats: [] })),
});

export const getShipSkills: McpTool<z.output<typeof getShipSkillsInput>> = {
    name: 'get_ship_skills',
    description:
        'Skill text for a ship: active, charged, and the passive active at the given refit count, plus the buffs and debuffs the planner parses from that text.',
    input: getShipSkillsInput,
    run: async ({ name, refits }, { db }) => {
        const ship = withRefits(await findShipTemplate(db, name), refits);
        return {
            name: ship.name,
            refits,
            skills: getShipSkillRows(ship).map(({ label, text, charge }) => ({
                label,
                text,
                ...(charge !== undefined && { charge }),
            })),
            effects: parseAllSkillEffects(ship).map((effect) => ({
                buffName: effect.buffName,
                target: effect.target,
                duration: effect.duration,
                source: effect.source,
                ...(effect.stacks !== undefined && { stacks: effect.stacks }),
                ...(effect.application !== undefined && { application: effect.application }),
            })),
        };
    },
};
```

`src/mcp/registry.ts` becomes:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolErrorMessage } from './errors';
import { listGearSets, listImplants } from './tools/gear';
import { getShip, searchShips } from './tools/ships';
import { getShipSkills } from './tools/skills';
import { McpToolError, defineTool, type McpToolContext, type RegisteredMcpTool } from './types';

/** Every tool the MCP server offers. All of them only read. */
export const TOOLS: readonly RegisteredMcpTool[] = [
    defineTool(searchShips),
    defineTool(getShip),
    defineTool(getShipSkills),
    defineTool(listGearSets),
    defineTool(listImplants),
];

/**
 * Registers `tools` on `server`, each bound to `ctx`. The SDK validates a call's arguments against
 * the tool's `input` and answers a failure itself (`isError: true`). A tool that throws is
 * answered with `toolErrorMessage`; anything but an `McpToolError` is also logged in full, to the
 * function log only.
 */
export function registerTools(
    server: McpServer,
    ctx: McpToolContext,
    tools: readonly RegisteredMcpTool[] = TOOLS
): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.input,
                annotations: { readOnlyHint: true },
            },
            async (input) => {
                try {
                    const result = await tool.run(input, ctx);
                    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                } catch (error) {
                    if (!(error instanceof McpToolError)) {
                        console.error(`MCP tool ${tool.name} failed:`, error);
                    }
                    return {
                        content: [{ type: 'text', text: toolErrorMessage(error) }],
                        isError: true,
                    };
                }
            }
        );
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/mcp --max-warnings 0`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/skills.ts \
    src/mcp/__tests__/tools.skills.test.ts \
    src/mcp/registry.ts \
    src/mcp/__tests__/registry.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): get_ship_skills with the refit-active passive and parsed effects (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 9: `list_profiles` and `get_my_fleet`

`get_my_fleet` returns final stats from `calculateTotalStats(...).final` — gear, implants, refits and the ship type's engineering (via `engineeringStatForShipType`, so `SUPPORTER_BUFFER` gets `SUPPORTER`'s tree) — with `hpRegen` dropped. It calls `clearGearStatsCache()` per run: `calculateTotalStats` caches gear stats by gear id in module scope, and a warm function instance serves many requests. An unknown `profile_id` is refused before any fleet read ("not one of your profiles"); RLS enforces the same thing underneath.

**Files:**
- Create: `src/mcp/tools/profiles.ts`
- Create: `src/mcp/tools/fleet.ts`
- Create: `src/mcp/__tests__/tools.profiles.test.ts`
- Create: `src/mcp/__tests__/tools.fleet.test.ts`
- Modify: `src/mcp/registry.ts`, `src/mcp/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `fetchShips`, `fetchInventory`, `fetchEngineeringStats`, `engineeringStatForShipType` (Tasks 1-3); `playerStats` (Task 7).
- Produces: `interface McpProfile { id; username; in_game_id; is_main }`; `fetchProfiles(ctx: McpToolContext): Promise<McpProfile[]>` (main first); `listProfiles`; `getMyFleet` — input `{ profile_id?, name?, type?, limit ≤ 100 (default 50) }`, output `{ total, ships: { id, name, type, rarity, level, refits, stats }[] }`.

- [ ] **Step 1: Write the failing tests**

`src/mcp/__tests__/tools.profiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listProfiles } from '../tools/profiles';
import { ALT_PROFILE, AUTH_USER, STRANGER, call, ctxOver } from './fixtures';

const users = [
    { id: ALT_PROFILE, username: 'alt', in_game_id: '2', owner_auth_user_id: AUTH_USER },
    { id: STRANGER, username: 'other', in_game_id: '3', owner_auth_user_id: null },
    { id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null },
];

describe('list_profiles', () => {
    it('lists the main account first, then its alts, and nobody else', async () => {
        const { ctx } = ctxOver({ users });

        expect(await call(listProfiles, {}, ctx)).toEqual({
            profiles: [
                { id: AUTH_USER, username: 'main', in_game_id: '1', is_main: true },
                { id: ALT_PROFILE, username: 'alt', in_game_id: '2', is_main: false },
            ],
        });
    });

    it('uses the altAccountService predicate', async () => {
        const { ctx, calls } = ctxOver({ users });

        await call(listProfiles, {}, ctx);

        expect(calls).toContainEqual({
            table: 'users',
            method: 'or',
            args: [`id.eq.${AUTH_USER},owner_auth_user_id.eq.${AUTH_USER}`],
        });
    });
});
```

`src/mcp/__tests__/tools.fleet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeGearStats } from '../../utils/gear/statsCodec';
import { getMyFleet } from '../tools/fleet';
import { McpToolError } from '../types';
import { ALT_PROFILE, AUTH_USER, STRANGER, call, ctxOver } from './fixtures';

const users = [
    { id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null },
    { id: ALT_PROFILE, username: 'alt', in_game_id: '2', owner_auth_user_id: AUTH_USER },
];

const shipRow = (id: string, name: string, userId: string, overrides = {}) => ({
    id,
    name,
    user_id: userId,
    rarity: 'legendary',
    faction: 'ATLAS_SYNDICATE',
    type: 'SUPPORTER_BUFFER',
    affinity: 'thermal',
    level: 60,
    rank: 6,
    ship_base_stats: { hp: 1000, attack: 100, crit: 10, crit_damage: 50, hp_regen: 5 },
    ship_equipment: [{ slot: 'weapon', gear_id: 'gear-1' }],
    ship_implants: [],
    ship_refits: [{ id: 'r1', ship_refit_stats: [] }],
    ship_templates: { image_key: '', active_skill_text: 'x' },
    ...overrides,
});

const tables = () => ({
    users,
    ships: [
        shipRow('s1', 'Zeta', AUTH_USER),
        shipRow('s2', 'Alpha', AUTH_USER),
        shipRow('s3', 'Altfleet', ALT_PROFILE),
    ],
    inventory_items: [
        {
            id: 'gear-1',
            user_id: AUTH_USER,
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            set_bonus: null,
            calibration_ship_id: null,
            stats: encodeGearStats({
                mainStat: { name: 'attack', value: 50, type: 'flat' },
                subStats: [],
            }),
        },
    ],
    engineering_stats: [
        {
            user_id: AUTH_USER,
            ship_type: 'SUPPORTER',
            stat_name: 'hp',
            value: 10,
            type: 'percentage',
        },
    ],
});

interface FleetResult {
    total: number;
    ships: { id: string; name: string; refits: number; stats: Record<string, number> }[];
}

describe('get_my_fleet', () => {
    it("defaults to the main account's ships, sorted by name", async () => {
        const { ctx } = ctxOver(tables());

        const result = (await call(getMyFleet, {}, ctx)) as FleetResult;

        expect(result.total).toBe(2);
        expect(result.ships.map((ship) => ship.name)).toEqual(['Alpha', 'Zeta']);
    });

    it('returns final stats: gear, refits and the SUPPORTER engineering tree applied', async () => {
        const { ctx } = ctxOver(tables());

        const [ship] = ((await call(getMyFleet, { name: 'alpha' }, ctx)) as FleetResult).ships;

        expect(ship).toMatchObject({ id: 's2', refits: 1 });
        // 1000 hp +10% engineering; 100 attack +50 flat from the weapon.
        expect(ship.stats).toMatchObject({ hp: 1100, attack: 150, crit: 10, critDamage: 50 });
        expect(ship.stats).not.toHaveProperty('hpRegen');
    });

    it('reads an alt profile when asked', async () => {
        const { ctx } = ctxOver(tables());

        const result = (await call(getMyFleet, { profile_id: ALT_PROFILE }, ctx)) as FleetResult;

        expect(result.ships.map((ship) => ship.name)).toEqual(['Altfleet']);
    });

    it('refuses a profile that is not one of yours', async () => {
        const { ctx } = ctxOver(tables());

        await expect(call(getMyFleet, { profile_id: STRANGER }, ctx)).rejects.toEqual(
            new McpToolError('not one of your profiles')
        );
    });

    it('caps at limit and keeps the full total', async () => {
        const { ctx } = ctxOver(tables());

        const result = (await call(getMyFleet, { limit: 1 }, ctx)) as FleetResult;

        expect(result.total).toBe(2);
        expect(result.ships).toHaveLength(1);
    });

    it('rejects a limit above 100', () => {
        expect(getMyFleet.input.safeParse({ limit: 101 }).success).toBe(false);
    });
});
```

In `src/mcp/__tests__/registry.test.ts`, the expected tool list becomes the full seven:

```ts
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'get_my_fleet',
            'get_ship',
            'get_ship_skills',
            'list_gear_sets',
            'list_implants',
            'list_profiles',
            'search_ships',
        ]);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/mcp/__tests__/tools.profiles.test.ts src/mcp/__tests__/tools.fleet.test.ts`
Expected: FAIL — `../tools/profiles` and `../tools/fleet` do not resolve.

- [ ] **Step 3: Implement**

`src/mcp/tools/profiles.ts`:

```ts
import { z } from 'zod';
import type { McpTool, McpToolContext } from '../types';

export interface McpProfile {
    id: string;
    username: string | null;
    in_game_id: string | null;
    is_main: boolean;
}

interface ProfileRow {
    id: string;
    username: string | null;
    in_game_id: string | null;
}

/** The caller's main account and its alts — the same predicate as `altAccountService`'s
 *  profile list. Main account first. */
export async function fetchProfiles({ db, authUserId }: McpToolContext): Promise<McpProfile[]> {
    const { data, error } = await db
        .from('users')
        .select('id, username, in_game_id')
        .or(`id.eq.${authUserId},owner_auth_user_id.eq.${authUserId}`);
    if (error) throw error;
    return (data as ProfileRow[])
        .map((row) => ({
            id: row.id,
            username: row.username,
            in_game_id: row.in_game_id,
            is_main: row.id === authUserId,
        }))
        .sort((a, b) => Number(b.is_main) - Number(a.is_main));
}

const listProfilesInput = z.object({});

export const listProfiles: McpTool<z.output<typeof listProfilesInput>> = {
    name: 'list_profiles',
    description:
        'Your planner profiles: your main account and any alt accounts. Pass an id to get_my_fleet as profile_id.',
    input: listProfilesInput,
    run: async (_input, ctx) => ({ profiles: await fetchProfiles(ctx) }),
};
```

`src/mcp/tools/fleet.ts`:

```ts
import { z } from 'zod';
import { SHIP_TYPE_NAMES, type ShipTypeName } from '../../constants/shipTypes';
import {
    engineeringStatForShipType,
    fetchEngineeringStats,
    fetchInventory,
    fetchShips,
} from '../../services/fleetReads';
import { calculateTotalStats, clearGearStatsCache } from '../../utils/ship/statsCalculator';
import { playerStats } from '../playerStats';
import { McpToolError, type McpTool } from '../types';
import { fetchProfiles } from './profiles';

const TYPE_NAMES = SHIP_TYPE_NAMES as [ShipTypeName, ...ShipTypeName[]];

const getMyFleetInput = z.object({
    profile_id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('A profile id from list_profiles. Defaults to your main account.'),
    name: z.string().trim().min(1).optional().describe('Part of the ship name, any case.'),
    type: z.enum(TYPE_NAMES).optional(),
    limit: z.number().int().min(1).max(100).default(50),
});

export const getMyFleet: McpTool<z.output<typeof getMyFleetInput>> = {
    name: 'get_my_fleet',
    description:
        'Your ships with their final stats — gear, implants, refits and engineering applied, as the planner shows them. `total` counts every match before `limit`.',
    input: getMyFleetInput,
    run: async ({ profile_id, name, type, limit }, ctx) => {
        const profileId = profile_id ?? ctx.authUserId;
        const profiles = await fetchProfiles(ctx);
        if (!profiles.some((profile) => profile.id === profileId)) {
            throw new McpToolError('not one of your profiles');
        }

        const [ships, inventory, engineering] = await Promise.all([
            fetchShips(ctx.db, profileId),
            fetchInventory(ctx.db, profileId),
            fetchEngineeringStats(ctx.db, profileId),
        ]);
        const gearById = new Map((inventory ?? []).map((piece) => [piece.id, piece]));
        const engineeringStats = engineering ?? { stats: [] };
        // `calculateTotalStats` caches gear stats by gear id in module scope; a warm function
        // instance serves many requests, so the cache must not outlive this one.
        clearGearStatsCache();

        const q = name?.toLowerCase();
        const matches = ships
            .filter((ship) => !q || ship.name.toLowerCase().includes(q))
            .filter((ship) => !type || ship.type === type)
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            total: matches.length,
            ships: matches.slice(0, limit).map((ship) => ({
                id: ship.id,
                name: ship.name,
                type: ship.type,
                rarity: ship.rarity,
                level: ship.level ?? null,
                refits: ship.refits.length,
                stats: playerStats(
                    calculateTotalStats(
                        ship.baseStats,
                        ship.equipment,
                        (id) => gearById.get(id),
                        ship.refits,
                        ship.implants,
                        engineeringStatForShipType(engineeringStats, ship.type),
                        ship.id
                    ).final
                ),
            })),
        };
    },
};
```

`src/mcp/registry.ts` becomes (final):

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolErrorMessage } from './errors';
import { getMyFleet } from './tools/fleet';
import { listGearSets, listImplants } from './tools/gear';
import { listProfiles } from './tools/profiles';
import { getShip, searchShips } from './tools/ships';
import { getShipSkills } from './tools/skills';
import { McpToolError, defineTool, type McpToolContext, type RegisteredMcpTool } from './types';

/** Every tool the MCP server offers. All of them only read. */
export const TOOLS: readonly RegisteredMcpTool[] = [
    defineTool(searchShips),
    defineTool(getShip),
    defineTool(getShipSkills),
    defineTool(listGearSets),
    defineTool(listImplants),
    defineTool(listProfiles),
    defineTool(getMyFleet),
];

/**
 * Registers `tools` on `server`, each bound to `ctx`. The SDK validates a call's arguments against
 * the tool's `input` and answers a failure itself (`isError: true`). A tool that throws is
 * answered with `toolErrorMessage`; anything but an `McpToolError` is also logged in full, to the
 * function log only.
 */
export function registerTools(
    server: McpServer,
    ctx: McpToolContext,
    tools: readonly RegisteredMcpTool[] = TOOLS
): void {
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: tool.input,
                annotations: { readOnlyHint: true },
            },
            async (input) => {
                try {
                    const result = await tool.run(input, ctx);
                    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                } catch (error) {
                    if (!(error instanceof McpToolError)) {
                        console.error(`MCP tool ${tool.name} failed:`, error);
                    }
                    return {
                        content: [{ type: 'text', text: toolErrorMessage(error) }],
                        isError: true,
                    };
                }
            }
        );
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp`
Expected: PASS. The fleet test's `hp: 1100, attack: 150` proves engineering (+10% hp from the SUPPORTER tree on a SUPPORTER_BUFFER) and gear (+50 attack) both apply.

Run: `npx tsc --noEmit && npx eslint src/mcp --max-warnings 0`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/profiles.ts \
    src/mcp/tools/fleet.ts \
    src/mcp/__tests__/tools.profiles.test.ts \
    src/mcp/__tests__/tools.fleet.test.ts \
    src/mcp/registry.ts \
    src/mcp/__tests__/registry.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): list_profiles and get_my_fleet with final stats (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 10: HTTP handler and the Netlify adapter

`src/mcp/http.ts` holds the request handling so vitest (which only covers the repo's test globs, and cannot reach a Netlify runtime) tests it directly; `netlify/functions/mcp.ts` only reads env, builds the remote JWKS on first request, and declares `config.path`. Netlify parses `config` statically, so the paths are literals; a test pins them to the handler's constants. The resource URL and metadata URL derive from the request origin, which is `https://starborneplanner.com` in production.

**Files:**
- Create: `src/mcp/http.ts`
- Create: `netlify/functions/mcp.ts`
- Create: `src/mcp/__tests__/http.test.ts`
- Modify: `src/mcp/__tests__/nodeLoad.test.ts` (`ENTRIES`)
- Modify: `package.json` (`lint`, `lint:fix`, `lint-staged`)
- Modify: `knip.json`

**Interfaces:**
- Consumes: `verifyAccessToken`, `AuthError` (Task 5); `registerTools` (Task 6); `stubDb` (Task 1); `makeSigner`, `ISSUER` (Task 5); `AUTH_USER` (Task 6).
- Produces: `MCP_PATH = '/mcp'`; `PROTECTED_RESOURCE_PATHS`; `ADMIN_ONLY_MESSAGE`; `interface McpHandlerConfig { supabaseUrl; supabaseAnonKey; jwks: JWTVerifyGetKey; createDb?: (accessToken: string) => SupabaseClient }`; `createMcpHandler(config): (request: Request) => Promise<Response>`; the Netlify default export and `config`.

- [ ] **Step 1: Write the failing test**

`src/mcp/__tests__/http.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { config } from '../../../netlify/functions/mcp';
import { stubDb, type StubDbError } from '../../__tests__/services/stubDb';
import { ADMIN_ONLY_MESSAGE, MCP_PATH, PROTECTED_RESOURCE_PATHS, createMcpHandler } from '../http';
import { AUTH_USER } from './fixtures';
import { ISSUER, makeSigner } from './testTokens';

const SUPABASE_URL = 'https://project.supabase.co';
const ORIGIN = 'https://starborneplanner.com';
const METADATA_HEADER = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;

let signer: Awaited<ReturnType<typeof makeSigner>>;

beforeAll(async () => {
    signer = await makeSigner();
    expect(ISSUER).toBe(`${SUPABASE_URL}/auth/v1`);
});

/** A handler whose database holds one `users` row for `AUTH_USER`. */
const handlerFor = ({
    isAdmin = true,
    usersError,
}: { isAdmin?: boolean; usersError?: StubDbError } = {}) => {
    const createDb = vi.fn(
        () =>
            stubDb(
                { users: [{ id: AUTH_USER, is_admin: isAdmin }] },
                usersError ? { errors: { users: usersError } } : {}
            ).db
    );
    const handler = createMcpHandler({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: 'anon',
        jwks: signer.jwks,
        createDb,
    });
    return { handler, createDb };
};

const rpc = (body: unknown, token?: string) =>
    new Request(`${ORIGIN}${MCP_PATH}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(token && { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(body),
    });

const oauthToken = () => signer.sign({ client_id: 'client-1' }, { sub: AUTH_USER });

describe('protected-resource metadata', () => {
    it.each(PROTECTED_RESOURCE_PATHS)('serves %s pointing at Supabase Auth', async (path) => {
        const { handler } = handlerFor();

        const response = await handler(new Request(`${ORIGIN}${path}`));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            resource: `${ORIGIN}/mcp`,
            authorization_servers: [`${SUPABASE_URL}/auth/v1`],
            bearer_methods_supported: ['header'],
        });
    });
});

describe('POST /mcp', () => {
    it('answers a missing token with 401 and the metadata pointer', async () => {
        const { handler } = handlerFor();

        const response = await handler(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(METADATA_HEADER);
    });

    it('answers a bad token with 401', async () => {
        const { handler } = handlerFor();

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'nope')
        );

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(METADATA_HEADER);
    });

    it('answers a website session token (no client_id) with 401', async () => {
        const { handler, createDb } = handlerFor();
        const session = await signer.sign({}, { sub: AUTH_USER });

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, session)
        );

        expect(response.status).toBe(401);
        expect(createDb).not.toHaveBeenCalled();
    });

    it('answers a non-admin with 403 and a JSON-RPC error for the same id', async () => {
        const { handler } = handlerFor({ isAdmin: false });

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, await oauthToken())
        );

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            jsonrpc: '2.0',
            id: 7,
            error: { code: -32001, message: ADMIN_ONLY_MESSAGE },
        });
    });

    it('answers a failed admin check with 503', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { handler } = handlerFor({ usersError: { message: 'down' } });

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, await oauthToken())
        );

        expect(response.status).toBe(503);
    });

    it("runs an admin's call with a client built from their token", async () => {
        const { handler, createDb } = handlerFor();
        const token = await oauthToken();

        const response = await handler(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, token));

        expect(response.status).toBe(200);
        const body = (await response.json()) as { result: { tools: { name: string }[] } };
        expect(body.result.tools.map((tool) => tool.name)).toContain('get_my_fleet');
        expect(createDb).toHaveBeenCalledWith(token);
    });

    it('serves consecutive calls, each on its own transport', async () => {
        const { handler } = handlerFor();
        const token = await oauthToken();

        const first = await handler(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, token));
        const second = await handler(
            rpc(
                {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/call',
                    params: { name: 'list_gear_sets', arguments: {} },
                },
                token
            )
        );

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const body = (await second.json()) as { result: { isError?: boolean } };
        expect(body.result.isError).toBeFalsy();
    });
});

describe('other methods on /mcp', () => {
    it.each(['GET', 'DELETE'])('answers %s with 405', async (method) => {
        const { handler } = handlerFor();

        const response = await handler(new Request(`${ORIGIN}${MCP_PATH}`, { method }));

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
    });
});

describe('the Netlify adapter', () => {
    it('routes exactly the paths the handler serves', () => {
        expect(config.path).toEqual([MCP_PATH, ...PROTECTED_RESOURCE_PATHS]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/mcp/__tests__/http.test.ts`
Expected: FAIL — `../../../netlify/functions/mcp` and `../http` do not resolve.

- [ ] **Step 3: Implement the handler**

`src/mcp/http.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { JWTVerifyGetKey } from 'jose';
import { AuthError, verifyAccessToken } from './auth';
import { registerTools } from './registry';

export const MCP_PATH = '/mcp';
/** RFC 9728 protected-resource metadata, at the root and path-suffixed for `/mcp`. */
export const PROTECTED_RESOURCE_PATHS = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
];
export const ADMIN_ONLY_MESSAGE = 'MCP access is currently limited to admins';

export interface McpHandlerConfig {
    /** The project URL, `https://<ref>.supabase.co`. */
    supabaseUrl: string;
    supabaseAnonKey: string;
    /** The project's token signing keys. */
    jwks: JWTVerifyGetKey;
    /** Builds the client a request reads through. Defaults to a supabase-js client carrying the
     *  caller's token, so every read runs under the caller's RLS. */
    createDb?: (accessToken: string) => SupabaseClient;
}

const callerClient =
    (supabaseUrl: string, supabaseAnonKey: string) =>
    (accessToken: string): SupabaseClient =>
        createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false },
        });

const bearerToken = (request: Request): string | null => {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    return match ? match[1] : null;
};

/** The JSON-RPC id of the request, so an error answers the call it refuses. */
const requestId = async (request: Request): Promise<string | number | null> => {
    try {
        const body: unknown = await request.json();
        if (body && typeof body === 'object' && 'id' in body) {
            const { id } = body;
            if (typeof id === 'string' || typeof id === 'number') return id;
        }
    } catch {
        // Not JSON: answer with a null id.
    }
    return null;
};

const jsonRpcError = (status: number, id: string | number | null, message: string) =>
    Response.json({ jsonrpc: '2.0', id, error: { code: -32001, message } }, { status });

const methodNotAllowed = (allow: string) =>
    new Response(null, { status: 405, headers: { Allow: allow } });

/**
 * The MCP endpoint as a web-standard `Request → Response` handler.
 *
 * - `GET` on a `PROTECTED_RESOURCE_PATHS` path: the metadata pointing clients at Supabase Auth.
 * - `POST /mcp`: 401 (with `WWW-Authenticate` naming the metadata) unless the bearer token is a
 *   valid OAuth-issued Supabase token; 403 unless the caller is an admin; otherwise the call runs
 *   on a fresh stateless server and transport. The transport cannot be reused across requests,
 *   and answers a POST whose `Accept` lacks `application/json, text/event-stream` with 406.
 * - Any other method on `/mcp`: 405. The server is stateless, so there is no SSE stream to GET
 *   and no session to DELETE.
 */
export const createMcpHandler = ({
    supabaseUrl,
    supabaseAnonKey,
    jwks,
    createDb = callerClient(supabaseUrl, supabaseAnonKey),
}: McpHandlerConfig) => {
    const issuer = `${supabaseUrl}/auth/v1`;

    return async (request: Request): Promise<Response> => {
        const { origin, pathname } = new URL(request.url);
        const metadataUrl = `${origin}${PROTECTED_RESOURCE_PATHS[0]}`;

        if (PROTECTED_RESOURCE_PATHS.includes(pathname)) {
            if (request.method !== 'GET') return methodNotAllowed('GET');
            return Response.json({
                resource: `${origin}${MCP_PATH}`,
                authorization_servers: [issuer],
                bearer_methods_supported: ['header'],
            });
        }

        if (request.method !== 'POST') return methodNotAllowed('POST');

        const unauthorized = () =>
            Response.json(
                { error: 'unauthorized' },
                {
                    status: 401,
                    headers: {
                        'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
                    },
                }
            );

        const token = bearerToken(request);
        if (!token) return unauthorized();

        let sub: string;
        try {
            ({ sub } = await verifyAccessToken(token, { jwks, issuer }));
        } catch (error) {
            if (error instanceof AuthError) return unauthorized();
            throw error;
        }

        const db = createDb(token);
        // A table read, never the `is_user_admin` RPC: an RPC is a POST, which the database
        // refuses for an OAuth token.
        const { data: profile, error } = await db
            .from('users')
            .select('is_admin')
            .eq('id', sub)
            .maybeSingle();
        if (error) {
            console.error('MCP admin check failed:', error);
            return jsonRpcError(
                503,
                await requestId(request),
                'Could not check MCP access. Try again.'
            );
        }
        if ((profile as { is_admin?: boolean } | null)?.is_admin !== true) {
            return jsonRpcError(403, await requestId(request), ADMIN_ONLY_MESSAGE);
        }

        const server = new McpServer({ name: 'starborne-planner', version: '1.0.0' });
        registerTools(server, { db, authUserId: sub });
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
            return await transport.handleRequest(request);
        } finally {
            await server.close();
        }
    };
};
```

- [ ] **Step 4: Implement the adapter**

`netlify/functions/mcp.ts`:

```ts
import { env } from 'node:process';
import { createRemoteJWKSet } from 'jose';
import { createMcpHandler } from '../../src/mcp/http';

const requireEnv = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set for Netlify Functions`);
    return value;
};

let handler: ((request: Request) => Promise<Response>) | undefined;

/**
 * Netlify adapter for `src/mcp/http.ts`. The handler — and with it the remote JWKS — is built on
 * the first request and reused while the instance stays warm. Building it at module load would
 * read env that the node-load tripwire (`src/mcp/__tests__/nodeLoad.test.ts`) scrubs.
 */
export default async (request: Request): Promise<Response> => {
    if (!handler) {
        const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
        handler = createMcpHandler({
            supabaseUrl,
            supabaseAnonKey: requireEnv('VITE_SUPABASE_ANON_KEY'),
            jwks: createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)),
        });
    }
    return handler(request);
};

// Netlify reads this statically, so the paths are literals; `src/mcp/__tests__/http.test.ts`
// pins them to `MCP_PATH` and `PROTECTED_RESOURCE_PATHS`.
export const config = {
    path: [
        '/mcp',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
    ],
};
```

- [ ] **Step 5: Extend the tripwire and widen lint/knip**

In `src/mcp/__tests__/nodeLoad.test.ts`, `ENTRIES` becomes

```ts
const ENTRIES = [
    'netlify/functions/mcp.ts',
    'src/mcp/http.ts',
    'src/mcp/registry.ts',
    'src/services/fleetReads.ts',
];
```

In `package.json`:
- `"lint": "eslint src --report-unused-disable-directives --max-warnings 0",` → `"lint": "eslint src netlify/functions --report-unused-disable-directives --max-warnings 0",`
- `"lint:fix": "eslint src --fix",` → `"lint:fix": "eslint src netlify/functions --fix",`
- in `"lint-staged"`, the key `"src/**/*.{ts,tsx}"` → `"{src,netlify/functions}/**/*.{ts,tsx}"` (same `eslint --fix` / `prettier --write` commands), so the pre-commit hook formats and lints the function too.

In `knip.json`:
- `"entry": ["src/index.tsx", "src/App.tsx"],` → `"entry": ["src/index.tsx", "src/App.tsx", "netlify/functions/mcp.ts"],`
- `"project": ["src/**/*.{ts,tsx}"],` → `"project": ["src/**/*.{ts,tsx}", "netlify/functions/**/*.ts"],`

- [ ] **Step 6: Run everything this task touches**

Run: `npx vitest run src/mcp`
Expected: PASS, including all four `nodeLoad` entries.

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (tsc now checks `netlify/functions/mcp.ts`).

Run: `npx knip 2>&1 | grep -n "src/mcp\|netlify/functions\|fleetReads\|utils/ship/shipTemplate.ts\|stubDb\|@modelcontextprotocol\|jose"`
Expected: no output (knip reports pre-existing findings elsewhere; none may name these files or packages).

- [ ] **Step 7: Commit**

```bash
git add src/mcp/http.ts \
    netlify/functions/mcp.ts \
    src/mcp/__tests__/http.test.ts \
    src/mcp/__tests__/nodeLoad.test.ts \
    package.json \
    knip.json
git commit -m "$(cat <<'EOF'
feat(mcp): /mcp Netlify function with JWKS auth and admin gate (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 11: `signInWithGoogle(redirectTo?)`

Today `redirectTo` is hard-coded to `window.location.origin`, which drops `authorization_id` when the consent page sends a signed-out player through Google. The argument is optional at all three layers and defaults to the current behaviour.

**Files:**
- Modify: `src/services/auth/types.ts:11`
- Modify: `src/services/auth/supabaseAuth.ts:24-32`
- Modify: `src/contexts/AuthProvider.tsx:14,115-117`
- Create: `src/services/auth/__tests__/supabaseAuth.test.ts`

**Interfaces:**
- Produces: `AuthService.signInWithGoogle(redirectTo?: string): Promise<void>`; `useAuth().signInWithGoogle(redirectTo?: string)`.

- [ ] **Step 1: Write the failing test**

`src/services/auth/__tests__/supabaseAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../../config/supabase';
import { SupabaseAuthService } from '../supabaseAuth';

vi.mock('../../../config/supabase', () => ({
    supabase: { auth: { signInWithOAuth: vi.fn() } },
}));

const signInWithOAuth = supabase.auth.signInWithOAuth as unknown as ReturnType<typeof vi.fn>;

describe('SupabaseAuthService.signInWithGoogle', () => {
    beforeEach(() => {
        signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
    });

    it('returns to the site root by default', async () => {
        await new SupabaseAuthService().signInWithGoogle();

        expect(signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: window.location.origin },
        });
    });

    it('returns to the given URL, query string included', async () => {
        const consent = 'https://starborneplanner.com/oauth/consent?authorization_id=abc';

        await new SupabaseAuthService().signInWithGoogle(consent);

        expect(signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: consent },
        });
    });

    it('throws the Supabase error', async () => {
        signInWithOAuth.mockResolvedValue({ data: {}, error: new Error('denied') });

        await expect(new SupabaseAuthService().signInWithGoogle()).rejects.toThrow('denied');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/auth`
Expected: FAIL — "returns to the given URL" gets `redirectTo: window.location.origin`.

- [ ] **Step 3: Implement**

`src/services/auth/types.ts` — `    signInWithGoogle: () => Promise<void>;` becomes

```ts
    /** `redirectTo` is where Google sign-in returns; defaults to the site root. */
    signInWithGoogle: (redirectTo?: string) => Promise<void>;
```

`src/services/auth/supabaseAuth.ts` — `signInWithGoogle` becomes

```ts
    async signInWithGoogle(redirectTo: string = window.location.origin): Promise<void> {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo,
            },
        });
        if (error) throw error;
    }
```

`src/contexts/AuthProvider.tsx` — in `interface AuthContextType`, `    signInWithGoogle: () => Promise<void>;` becomes the same two lines as in `types.ts`; and

```ts
    const signInWithGoogle = async () => {
        try {
            await authService.signInWithGoogle();
```

becomes

```ts
    const signInWithGoogle = async (redirectTo?: string) => {
        try {
            await authService.signInWithGoogle(redirectTo);
```

`AuthModal` keeps calling `signInWithGoogle()` with no argument — unchanged behaviour.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/services/auth src/components/auth`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/services/auth src/contexts/AuthProvider.tsx --max-warnings 0`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/services/auth/types.ts \
    src/services/auth/supabaseAuth.ts \
    src/contexts/AuthProvider.tsx \
    src/services/auth/__tests__/supabaseAuth.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): signInWithGoogle takes an optional redirectTo (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 12: OAuth consent page at `/oauth/consent`

States: no `authorization_id` → error card, no buttons; auth loading → `Loader`; signed out → Google sign-in returning to `window.location.href`; signed in, not admin (`adminService.isAdmin`, fine on a website session) → gate text + Deny only; admin → `getAuthorizationDetails`: an `OAuthRedirect` (already approved) is followed with `window.location.assign`, details show client name, redirect host, signed-in email and the read-only line, with Approve / Deny (default redirect); any API error → error card, no buttons. The page's admin check is UX; the function enforces.

**Files:**
- Create: `src/pages/OAuthConsentPage.tsx`
- Create: `src/pages/__tests__/OAuthConsentPage.test.tsx`
- Modify: `src/App.tsx` (lazy import after `ClassifiedPage`; route before `path="*"`)

**Interfaces:**
- Consumes: `useAuth().signInWithGoogle(redirectTo?)` (Task 11); `isAdmin(userId)` from `src/services/adminService.ts`; `supabase.auth.oauth.{getAuthorizationDetails, approveAuthorization, denyAuthorization}`.

- [ ] **Step 1: Write the failing test**

`src/pages/__tests__/OAuthConsentPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OAuthConsentPage } from '../OAuthConsentPage';

const { auth, oauth, isAdmin } = vi.hoisted(() => ({
    auth: {
        user: null as { id: string } | null,
        loading: false,
        signInWithGoogle: vi.fn(),
    },
    oauth: {
        getAuthorizationDetails: vi.fn(),
        approveAuthorization: vi.fn(),
        denyAuthorization: vi.fn(),
    },
    isAdmin: vi.fn(),
}));

vi.mock('../../config/supabase', () => ({ supabase: { auth: { oauth } } }));
vi.mock('../../contexts/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../services/adminService', () => ({ isAdmin }));

const DETAILS = {
    authorization_id: 'auth-1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    client: { id: 'c1', name: 'Claude', uri: '', logo_uri: '' },
    user: { id: 'u1', email: 'admin@example.com' },
    scope: 'openid',
};

const renderAt = (url: string) =>
    render(
        <MemoryRouter initialEntries={[url]}>
            <OAuthConsentPage />
        </MemoryRouter>
    );

describe('OAuthConsentPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.user = { id: 'u1' };
        auth.loading = false;
        oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
        oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'x' }, error: null });
        oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'x' }, error: null });
    });

    it('shows an admin the request and approves it', async () => {
        isAdmin.mockResolvedValue(true);
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(await screen.findByText('Claude')).toBeInTheDocument();
        expect(screen.getByText('claude.ai')).toBeInTheDocument();
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(
            screen.getByText('Read-only access to your ships, gear and engineering stats')
        ).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(oauth.approveAuthorization).toHaveBeenCalledWith('auth-1');
    });

    it('lets an admin deny', async () => {
        isAdmin.mockResolvedValue(true);
        renderAt('/oauth/consent?authorization_id=auth-1');

        await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

        expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1');
        expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    });

    it('shows a non-admin the gate and only Deny', async () => {
        isAdmin.mockResolvedValue(false);
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(
            await screen.findByText('MCP access is currently limited to admins.')
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

        expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1');
    });

    it('shows an error card and no buttons without authorization_id', () => {
        renderAt('/oauth/consent');

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows an error card and no buttons when Supabase rejects the request', async () => {
        isAdmin.mockResolvedValue(true);
        oauth.getAuthorizationDetails.mockResolvedValue({
            data: null,
            error: { message: 'authorization not found' },
        });
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(await screen.findByRole('alert')).toHaveTextContent('authorization not found');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('asks a signed-out visitor to sign in, returning to this exact URL', async () => {
        auth.user = null;
        renderAt('/oauth/consent?authorization_id=auth-1');

        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

        expect(auth.signInWithGoogle).toHaveBeenCalledWith(window.location.href);
        expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    });

    it('still reads authorization_id after the sign-in round-trip adds ?code=', async () => {
        isAdmin.mockResolvedValue(true);
        renderAt('/oauth/consent?authorization_id=auth-1&code=returned-code');

        await screen.findByText('Claude');

        expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith('auth-1');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/__tests__/OAuthConsentPage.test.tsx`
Expected: FAIL — `../OAuthConsentPage` does not resolve.

- [ ] **Step 3: Implement the page**

`src/pages/OAuthConsentPage.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { Button } from '../components/ui/Button';
import { Loader } from '../components/ui/Loader';
import { PageLayout } from '../components/ui/layout/PageLayout';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthProvider';
import { isAdmin } from '../services/adminService';

type ConsentState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'not-admin' }
    | { kind: 'consent'; details: OAuthAuthorizationDetails };

const hostOf = (uri: string): string => {
    try {
        return new URL(uri).host;
    } catch {
        return uri;
    }
};

const ErrorCard: React.FC<{ message: string }> = ({ message }) => (
    <div className="card space-y-2" role="alert">
        <h2 className="text-lg font-semibold">This connection request cannot continue</h2>
        <p className="text-theme-text-secondary">{message}</p>
    </div>
);

/**
 * Supabase Auth's OAuth consent screen (Authorization Path `/oauth/consent`). An app connecting to
 * the planner's MCP server sends the player here with `authorization_id`; approving lets that app
 * read the player's fleet. The admin check here is the UX half of the gate — the MCP function
 * enforces it (`src/mcp/http.ts`).
 */
export const OAuthConsentPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const authorizationId = searchParams.get('authorization_id');
    const { user, loading: authLoading, signInWithGoogle } = useAuth();
    const [state, setState] = useState<ConsentState>({ kind: 'loading' });
    const [deciding, setDeciding] = useState(false);

    useEffect(() => {
        if (!authorizationId || !user) return;
        let cancelled = false;

        const load = async () => {
            if (!(await isAdmin(user.id))) {
                if (!cancelled) setState({ kind: 'not-admin' });
                return;
            }
            const { data, error } =
                await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
            if (cancelled) return;
            if (error || !data) {
                setState({
                    kind: 'error',
                    message: error?.message ?? 'The request was not found.',
                });
                return;
            }
            if ('redirect_url' in data) {
                // Already approved earlier: Supabase hands back the client's redirect directly.
                window.location.assign(data.redirect_url);
                return;
            }
            setState({ kind: 'consent', details: data });
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [authorizationId, user]);

    const decide = async (approve: boolean) => {
        if (!authorizationId) return;
        setDeciding(true);
        const { error } = approve
            ? await supabase.auth.oauth.approveAuthorization(authorizationId)
            : await supabase.auth.oauth.denyAuthorization(authorizationId);
        if (error) {
            setState({ kind: 'error', message: error.message });
            setDeciding(false);
        }
    };

    const body = (() => {
        if (!authorizationId) {
            return (
                <ErrorCard message="The link is missing its authorization request. Start connecting again from your app." />
            );
        }
        if (authLoading) return <Loader />;
        if (!user) {
            return (
                <div className="card space-y-4">
                    <p>Sign in to choose whether this app may read your planner data.</p>
                    <Button onClick={() => void signInWithGoogle(window.location.href)}>
                        Sign in with Google
                    </Button>
                </div>
            );
        }
        if (state.kind === 'loading') return <Loader />;
        if (state.kind === 'error') return <ErrorCard message={state.message} />;
        if (state.kind === 'not-admin') {
            return (
                <div className="card space-y-4">
                    <p>MCP access is currently limited to admins.</p>
                    <Button
                        variant="secondary"
                        disabled={deciding}
                        onClick={() => void decide(false)}
                    >
                        Deny
                    </Button>
                </div>
            );
        }
        const { details } = state;
        return (
            <div className="card space-y-4">
                <dl className="space-y-2">
                    <div>
                        <dt className="text-theme-text-secondary text-sm">App</dt>
                        <dd className="font-semibold">{details.client.name}</dd>
                    </div>
                    <div>
                        <dt className="text-theme-text-secondary text-sm">Returns to</dt>
                        <dd>{hostOf(details.redirect_uri)}</dd>
                    </div>
                    <div>
                        <dt className="text-theme-text-secondary text-sm">Signed in as</dt>
                        <dd>{details.user.email}</dd>
                    </div>
                    <div>
                        <dt className="text-theme-text-secondary text-sm">Access</dt>
                        <dd>Read-only access to your ships, gear and engineering stats</dd>
                    </div>
                </dl>
                <div className="flex gap-2">
                    <Button disabled={deciding} onClick={() => void decide(true)}>
                        Approve
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={deciding}
                        onClick={() => void decide(false)}
                    >
                        Deny
                    </Button>
                </div>
            </div>
        );
    })();

    return (
        <PageLayout
            title="Connect an app"
            description="An app is asking to read your planner data."
        >
            {body}
        </PageLayout>
    );
};

export default OAuthConsentPage;
```

- [ ] **Step 4: Add the route**

In `src/App.tsx`, after `const ClassifiedPage = lazy(() => import('./pages/ClassifiedPage'));` add

```tsx
const OAuthConsentPage = lazy(() => import('./pages/OAuthConsentPage'));
```

and insert, immediately before the `<Route path="*" …>` element (same indentation as its siblings):

```tsx
<Route
    path="/oauth/consent"
    element={
        <OAuthConsentPage />
    }
/>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/pages/__tests__/OAuthConsentPage.test.tsx`
Expected: PASS, 7 tests.

Run: `npx tsc --noEmit && npx eslint src/pages/OAuthConsentPage.tsx src/pages/__tests__/OAuthConsentPage.test.tsx src/App.tsx --max-warnings 0 && npx prettier --check src/App.tsx`
Expected: no errors.

Manual check (`npm start`, port 3000): `http://localhost:3000/oauth/consent` shows the error card; `http://localhost:3000/oauth/consent?authorization_id=x` signed out shows "Sign in with Google".

- [ ] **Step 6: Commit**

```bash
git add src/pages/OAuthConsentPage.tsx \
    src/pages/__tests__/OAuthConsentPage.test.tsx \
    src/App.tsx
git commit -m "$(cat <<'EOF'
feat(mcp): OAuth consent page at /oauth/consent, admin-only (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 13: `scripts/oauth-probe.ts` — the Auth API probe

Manual, not in CI. It answers whether an OAuth token can reach the Auth API (which spec 1's database hook does not cover): a user-metadata write and an **email change** (hard requirement: an MCP token must not be able to change the account email), plus a Data API write that the read-only hook must refuse (a `DELETE` on `inventory_items` for the nil uuid: 403 with the hook, a zero-row 204 without it — `rpc/check_request` would be vacuous, since that function raises from its own body on any POST whether or not the hook is installed). It never confirms the email change. Output ends with exactly three verdict lines: `metadata-update: BLOCKED|ALLOWED`, `email-change: BLOCKED|ALLOWED`, `data-api-write: BLOCKED|ALLOWED`. `scripts/` is not type-checked by `tsc --noEmit`, so the pure helpers are exported and tested, and Step 4 type-checks the file on its own.

**Files:**
- Create: `scripts/oauth-probe.ts`
- Create: `src/__tests__/scripts/oauthProbe.test.ts`

**Interfaces:**
- Produces: `parseArgs(argv: string[]): { probeEmail: string }` (throws a usage error without a valid `--probe-email`); `pkcePair(): { verifier; challenge }`; `authApiVerdict(status: number): 'BLOCKED' | 'ALLOWED'` (ALLOWED iff 2xx); `dataApiVerdict(status: number, body: string)` (BLOCKED iff 403 with the hook's "OAuth client tokens are read-only").

- [ ] **Step 1: Write the failing test**

`src/__tests__/scripts/oauthProbe.test.ts`:

```ts
// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { authApiVerdict, dataApiVerdict, parseArgs, pkcePair } from '../../../scripts/oauth-probe';

describe('parseArgs', () => {
    it('reads --probe-email', () => {
        expect(parseArgs(['--probe-email', 'me@example.com'])).toEqual({
            probeEmail: 'me@example.com',
        });
    });

    it.each([
        [[]],
        [['--probe-email']],
        [['--probe-email', '--other']],
        [['--probe-email', 'nope']],
    ])('refuses %j', (argv) => {
        expect(() => parseArgs(argv)).toThrow(/--probe-email/);
    });
});

describe('pkcePair', () => {
    it('makes an S256 challenge of the verifier', () => {
        const { verifier, challenge } = pkcePair();

        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    });
});

describe('verdicts', () => {
    it('calls an Auth API check ALLOWED only on 2xx', () => {
        expect(authApiVerdict(200)).toBe('ALLOWED');
        expect(authApiVerdict(403)).toBe('BLOCKED');
        expect(authApiVerdict(401)).toBe('BLOCKED');
    });

    it("calls a Data API write BLOCKED only on the read-only hook's own 403", () => {
        const hook = '{"code":"PT403","message":"OAuth client tokens are read-only"}';

        expect(dataApiVerdict(403, hook)).toBe('BLOCKED');
        expect(dataApiVerdict(403, '{"message":"permission denied"}')).toBe('ALLOWED');
        expect(dataApiVerdict(204, '')).toBe('ALLOWED');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/scripts/oauthProbe.test.ts`
Expected: FAIL — `../../../scripts/oauth-probe` does not resolve.

- [ ] **Step 3: Implement the script**

`scripts/oauth-probe.ts`:

```ts
/**
 * Manual probe: what can a Supabase OAuth access token do outside the Data API?
 *
 *   npx tsx scripts/oauth-probe.ts --probe-email <address>     (Node 22, .env with VITE_SUPABASE_*)
 *
 * Claude never exposes the token it holds, so this runs its own OAuth 2.1 flow the way an MCP
 * client does: dynamic client registration with a `http://127.0.0.1:<port>/callback` redirect,
 * the authorize URL in the browser (sign in and approve on the planner's consent page, as an
 * admin), the code caught by a one-shot local server, and a PKCE code exchange. With the token it
 * makes three checks and prints one verdict line each:
 *
 *   metadata-update  PUT /auth/v1/user { data: { mcp_probe } }
 *   email-change     PUT /auth/v1/user { email: --probe-email } — never confirmed by this script
 *   data-api-write   DELETE /rest/v1/inventory_items?id=eq.<nil uuid> — the read-only hook must
 *                    answer 403; without the hook it is a 204 that matches no row
 *
 * A check is ALLOWED when the server answered 2xx; data-api-write is BLOCKED only on the hook's
 * own 403. The registered client stays in Supabase (Authentication → OAuth Apps) until deleted.
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Verdict = 'BLOCKED' | 'ALLOWED';

/** No inventory row has this id, so the Data API probe deletes nothing even if it is allowed. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface ProbeArgs {
    probeEmail: string;
}

/** Parses `--probe-email <address>`; the address is required. */
export function parseArgs(argv: string[]): ProbeArgs {
    const at = argv.indexOf('--probe-email');
    const probeEmail = at >= 0 ? argv[at + 1] : undefined;
    if (!probeEmail || probeEmail.startsWith('--') || !probeEmail.includes('@')) {
        throw new Error(
            'usage: npx tsx scripts/oauth-probe.ts --probe-email <address> ' +
                '(an address you control, different from the account email)'
        );
    }
    return { probeEmail };
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** An RFC 7636 S256 verifier/challenge pair. */
export function pkcePair(): { verifier: string; challenge: string } {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

/** An Auth API check is ALLOWED when the server accepted the request. */
export const authApiVerdict = (status: number): Verdict =>
    status >= 200 && status < 300 ? 'ALLOWED' : 'BLOCKED';

/** A Data API write is BLOCKED only when the read-only hook refused it; any other answer means the
 *  request reached the database. */
export const dataApiVerdict = (status: number, body: string): Verdict =>
    status === 403 && body.includes('OAuth client tokens are read-only') ? 'BLOCKED' : 'ALLOWED';

const requireEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set (.env)`);
    return value;
};

interface AuthServerMetadata {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
}

async function discover(supabaseUrl: string): Promise<AuthServerMetadata> {
    const candidates = [
        `${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`,
        `${supabaseUrl}/auth/v1/.well-known/oauth-authorization-server`,
    ];
    for (const url of candidates) {
        const response = await fetch(url);
        if (response.ok) return (await response.json()) as AuthServerMetadata;
    }
    throw new Error('Authorization-server metadata not found. Is the OAuth server enabled?');
}

/** Listens on an ephemeral 127.0.0.1 port and resolves with the first `/callback` query. */
async function oneShotCallback(): Promise<{ port: number; params: Promise<URLSearchParams> }> {
    let deliver: (params: URLSearchParams) => void = () => {};
    const params = new Promise<URLSearchParams>((resolve) => {
        deliver = resolve;
    });
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' }).end(
            'Probe received the code. You can close this tab.'
        );
        server.close();
        deliver(url.searchParams);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as AddressInfo).port, params };
}

async function report(
    label: string,
    response: Response
): Promise<{ status: number; body: string }> {
    const body = await response.text();
    console.log(`\n${label}: HTTP ${response.status}\n${body}`);
    return { status: response.status, body };
}

async function main(): Promise<void> {
    const { probeEmail } = parseArgs(process.argv.slice(2));
    const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
    const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');

    const metadata = await discover(supabaseUrl);
    const callback = await oneShotCallback();
    const redirectUri = `http://127.0.0.1:${callback.port}/callback`;

    const registration = await fetch(metadata.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Starborne Planner OAuth probe',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    });
    if (!registration.ok) {
        throw new Error(
            `Client registration failed: HTTP ${registration.status} ${await registration.text()}`
        );
    }
    const { client_id: clientId } = (await registration.json()) as { client_id: string };

    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(16));
    const authorize = new URL(metadata.authorization_endpoint);
    authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    }).toString();

    console.log(`Open this URL, sign in as an admin and approve:\n\n${authorize.toString()}\n`);
    if (process.platform === 'darwin') spawn('open', [authorize.toString()], { stdio: 'ignore' });

    const params = await callback.params;
    if (params.get('state') !== state) throw new Error('State mismatch on the callback.');
    const code = params.get('code');
    if (!code) throw new Error(`No code on the callback: ${params.toString()}`);

    const tokenResponse = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
        }),
    });
    if (!tokenResponse.ok) {
        throw new Error(
            `Token exchange failed: HTTP ${tokenResponse.status} ${await tokenResponse.text()}`
        );
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const asCaller = { apikey: anonKey, authorization: `Bearer ${accessToken}` };
    const json = { ...asCaller, 'content-type': 'application/json' };

    const metadataCheck = await report(
        'metadata-update',
        await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'PUT',
            headers: json,
            body: JSON.stringify({ data: { mcp_probe: new Date().toISOString() } }),
        })
    );

    const emailCheck = await report(
        'email-change',
        await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'PUT',
            headers: json,
            body: JSON.stringify({ email: probeEmail }),
        })
    );
    if (authApiVerdict(emailCheck.status) === 'ALLOWED') {
        console.warn(
            '\nWARNING: the email change was accepted and is pending. Do NOT click the ' +
                'confirmation links; ignore the confirmation mail and the change never completes.'
        );
    }

    const dataCheck = await report(
        'data-api-write',
        // A real-table write only the pre-request hook stops. Not `rpc/check_request`: that
        // function raises from its own body on any POST, hook or no hook, so it cannot tell.
        await fetch(`${supabaseUrl}/rest/v1/inventory_items?id=eq.${NIL_UUID}`, {
            method: 'DELETE',
            headers: { ...asCaller, prefer: 'return=minimal' },
        })
    );

    console.log(`\nmetadata-update: ${authApiVerdict(metadataCheck.status)}`);
    console.log(`email-change: ${authApiVerdict(emailCheck.status)}`);
    console.log(`data-api-write: ${dataApiVerdict(dataCheck.status, dataCheck.body)}`);
}

// Importing this file for its pure helpers must not start a flow.
if (process.argv[1] && process.argv[1].endsWith('oauth-probe.ts')) {
    main().catch((error: unknown) => {
        console.error(`oauth-probe: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/__tests__/scripts/oauthProbe.test.ts`
Expected: PASS, 8 tests.

Run: `npx tsc --noEmit --strict --module esnext --moduleResolution node --target esnext --types node --skipLibCheck scripts/oauth-probe.ts`
Expected: no output.

Run: `npx tsx scripts/oauth-probe.ts; echo "exit $?"`
Expected: `oauth-probe: usage: npx tsx scripts/oauth-probe.ts --probe-email <address> …` and `exit 1` — no network call is made without the flag.

- [ ] **Step 5: Commit**

```bash
git add scripts/oauth-probe.ts \
    src/__tests__/scripts/oauthProbe.test.ts
git commit -m "$(cat <<'EOF'
chore(mcp): OAuth probe for the Auth API (metadata, email change, Data API write) (#562)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
EOF
)"
echo "commit exit: $?"
```

---

### Task 14: Whole-branch verification

- [ ] **Step 1: Run every gate**

```bash
node -v                     # v22.x
npx tsc --noEmit
npm run lint
npx vitest run
npm run audit
git status --short          # clean
```
Expected: tsc and lint silent; vitest all green; `npm run audit` passes (the SDK and jose are now in the production-deps scan — if it reports a high/critical advisory in either, stop and report it; do not add an ALLOWLIST entry).

- [ ] **Step 2: Grep for the forbidden imports**

```bash
grep -rn "config/supabase\|constants'\|constants/index\|import.meta.env" src/mcp src/services/fleetReads.ts netlify/functions | grep -v __tests__
```
Expected: no output.

- [ ] **Step 3: Local smoke of the page**

`npm start` and open `http://localhost:3000/oauth/consent` — the error card renders inside the app shell. (The function itself is verified on production in rollout step 3; `/mcp` is not served by `npm start`.)

---

## After merge (the user)

1. PR merges to `main`.
2. Netlify → Environment variables: confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` include the **Functions** scope. Cut a release (`npm run release`, then `git push origin main:production`). With the OAuth server still off, nobody can get a token.
3. Routing check on prod: `curl -i -X POST https://starborneplanner.com/mcp` → 401 with `WWW-Authenticate: Bearer resource_metadata="https://starborneplanner.com/.well-known/oauth-protected-resource"`; `curl https://starborneplanner.com/.well-known/oauth-protected-resource` → JSON, **not** `index.html`. If HTML comes back, add `force = true` rewrites for `/mcp` and both `/.well-known/oauth-protected-resource*` paths to `/.netlify/functions/mcp` above the `/* → /index.html` rule in `netlify.toml`.
4. Supabase dashboard → Authentication → URL Configuration: Site URL `https://starborneplanner.com`; Redirect URLs include `https://starborneplanner.com/oauth/consent**`. Authentication → OAuth Server: enable, Authorization Path `/oauth/consent`, Allow Dynamic OAuth Apps on.
5. Connect from Claude, approve on the consent page, exercise each of the seven tools.
6. Auth API probe: `npx tsx scripts/oauth-probe.ts --probe-email <an address you control, not the account's>` (Node 22, `.env` with `VITE_SUPABASE_*`). Read the three verdict lines. If `email-change: ALLOWED`, ignore the confirmation mail so the change never completes. Delete the probe client afterwards (Authentication → OAuth Apps).
   - `metadata-update: BLOCKED` → the Auth API is closed to OAuth tokens for writes.
   - `data-api-write` must be `BLOCKED` (spec 1 end to end: a `DELETE` of a non-existent inventory row, refused by the pre-request hook); `ALLOWED` (a 204) means the hook is not active — disable the OAuth server until fixed.
7. **Lifting the admin gate is blocked unless `email-change: BLOCKED`.** (An `ALLOWED` `metadata-update` blocks it too, per the spec.)

## Decisions this plan makes beyond the spec

- Request handling lives in `src/mcp/http.ts` (`createMcpHandler`), not in `netlify/functions/mcp.ts`, so it is unit-tested; the Netlify file is env + JWKS + `config`.
- The remote JWKS and handler are built on the first request, not at module load, so the node-load tripwire can load the function with env scrubbed; a warm instance still reuses them.
- The resource and metadata URLs are derived from the request origin (production: `https://starborneplanner.com`).
- The admin-check query failing is answered 503 (JSON-RPC error, "Could not check MCP access. Try again.") — not in the spec's table.
- The 403 body echoes the request's JSON-RPC `id` (or `null`), code `-32001`.
- A Supabase error other than `PT403` is shown as "The planner database request failed (<code>)." — code only.
- `get_ship_skills` defaults `refits` to 0.
- `get_my_fleet` defaults `limit` to 50; `search_ships` to 20. `total` counts matches before `limit`.
- `hpRegen` is dropped from every stat block (`playerStats`); `shield`, `damageReduction` and the penetrations stay (they are real game stats).
- `fleetReads.test.ts` sits in `src/__tests__/services/` (next to `fakeSupabase.ts`, the repo's convention) rather than `src/services/__tests__/`.
- `statsCodecCallSites.test.ts` changes (one added path) — that tripwire exists to make a new codec caller a visible diff.
