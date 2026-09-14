# Simulator Setup Save/Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a simulator setup — both boards, every stat override, both squad leaders, the seed and the run count — survive a page reload and be saved under a name, loaded and deleted.

**Architecture:** A `SimulatorSetup` is a serializable value holding ship *ids* (owned uuid or `template:` reference id) plus overrides, not baked stats. One shared id→Ship resolver, lifted out of `PlacementBoard`, turns those ids back into ships on load and drops cells whose id no longer resolves. Persistence is plain localStorage with Zod-validated reads, the same tier as the existing squad-leader keys — deliberately NOT the `useStorage` IndexedDB/Supabase pipeline.

**Tech Stack:** React 19 + TypeScript, Zod 4, Vitest + Testing Library, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-09-14-simulator-setup-save-load-design.md`

## Global Constraints

- **Read the spec before Task 1.** It states the rulings this plan implements.
- **UI components:** never raw `<button>`, never a hand-rolled card/modal/input. Use `Button`, `Input`, `Select`, `Modal`, `ConfirmModal` from `src/components/ui/` and the `card` CSS class. (CLAUDE.md → UI Components.)
- **No emojis in UI text.** Plain text plus colour classes.
- **Comments:** present-tense behaviour contracts only. No change history, no task/PR numbers, no counts or site enumerations, no rule restated at N call sites. A comment that would need this PR to parse belongs in the commit body.
- **Changelog:** an area prefix plus 8-12 words, added to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` before the commit that ships the user-visible change. One entry per user-visible change.
- **`docs/` is gitignored.** The spec and this plan must be added with `git add -f`.
- **Tests:** `npm test -- --run <path>` for one file. The full `npm test` run includes a golden audit and takes a while; run it once before opening the PR, not per task.
- **Never run the Supabase CLI** in any form. This PR touches no database.

---

### Task 1: Shared ship-id resolver

`PlacementBoard` has a private `resolveSavedShip` that is the only code knowing a `template:` id must be rebuilt from the unit catalogue rather than looked up among owned ships. The setup loader needs the same rule. Lift it so the two cannot drift.

**Files:**
- Create: `src/utils/ship/resolveShipId.ts`
- Create: `src/hooks/useShipIdResolver.ts`
- Modify: `src/components/simulator/PlacementBoard.tsx` (delete `resolveSavedShip`, consume the hook)
- Test: `src/utils/ship/__tests__/resolveShipId.test.ts`

**Interfaces:**
- Consumes: `parseReferenceShipId`, `referenceShip` from `src/utils/ship/referenceShip.ts`.
- Produces:
  ```ts
  export interface ShipIdResolverDeps {
      getShipById: (id: string) => Ship | undefined;
      units: Ship[];
      getAscensionStats: (templateId: string) => AscensionStat[] | null;
  }
  export function resolveShipId(shipId: string, deps: ShipIdResolverDeps): Ship | null;
  // hook: () => (shipId: string) => Ship | null
  export function useShipIdResolver(): (shipId: string) => Ship | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/utils/ship/__tests__/resolveShipId.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveShipId, type ShipIdResolverDeps } from '../resolveShipId';
import { referenceShipId } from '../referenceShip';
import type { Ship } from '../../../types/ship';

const template = {
    id: 'tmpl-1',
    name: 'Test Unit',
    type: 'ATTACKER',
    faction: 'TERRAN',
    rarity: 'legendary',
    baseStats: { hp: 1000, attack: 100, defence: 50, speed: 100, crit: 10, critDamage: 50 },
    equipment: {},
    implants: {},
    refits: [],
    level: 60,
    rank: 0,
} as unknown as Ship;

const owned = { ...template, id: 'owned-uuid-1', name: 'Owned Copy' } as Ship;

const deps: ShipIdResolverDeps = {
    getShipById: (id) => (id === owned.id ? owned : undefined),
    units: [template],
    getAscensionStats: () => null,
};

describe('resolveShipId', () => {
    it('resolves an owned ship id from the owned roster', () => {
        expect(resolveShipId('owned-uuid-1', deps)).toBe(owned);
    });

    it('rebuilds a reference id from the unit catalogue instead of the owned roster', () => {
        const id = referenceShipId(template, 'r0');
        const resolved = resolveShipId(id, deps);
        expect(resolved).not.toBeNull();
        expect(resolved?.id).toBe(id);
        expect(resolved?.name).toBe('Test Unit');
    });

    it('returns null for an unknown owned id', () => {
        expect(resolveShipId('missing-uuid', deps)).toBeNull();
    });

    it('returns null for a reference id whose template is not in the catalogue', () => {
        expect(resolveShipId('template:gone:r0', deps)).toBeNull();
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/utils/ship/__tests__/resolveShipId.test.ts`
Expected: FAIL — `Failed to resolve import "../resolveShipId"`.

- [ ] **Step 3: Implement the resolver**

Create `src/utils/ship/resolveShipId.ts`:

```ts
import type { Ship } from '../../types/ship';
import { parseReferenceShipId, referenceShip, type AscensionStat } from './referenceShip';

export interface ShipIdResolverDeps {
    getShipById: (id: string) => Ship | undefined;
    units: Ship[];
    getAscensionStats: (templateId: string) => AscensionStat[] | null;
}

/**
 * Turn a stored ship id back into a Ship.
 *
 * A reference id (`template:<templateId>:<variant>`) names a unit nobody owns, so it is rebuilt
 * from the unit catalogue; looking one up among owned ships finds nothing and silently drops the
 * cell. Anything else is an owned ship's id.
 *
 * `null` means the id no longer resolves — a deleted ship, a re-imported roster, or a different
 * profile. Callers report that; it is not an error.
 */
export function resolveShipId(shipId: string, deps: ShipIdResolverDeps): Ship | null {
    const reference = parseReferenceShipId(shipId);
    if (!reference) return deps.getShipById(shipId) ?? null;
    const template = deps.units.find((unit) => unit.id === reference.templateId);
    if (!template) return null;
    return referenceShip(template, reference.variant, deps.getAscensionStats(template.id));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/utils/ship/__tests__/resolveShipId.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the hook**

Create `src/hooks/useShipIdResolver.ts`:

```ts
import { useCallback } from 'react';
import type { Ship } from '../types/ship';
import { useShips } from '../contexts/ShipsContext';
import { useShipsData } from '../hooks/useShipsData';
import { resolveShipId } from '../utils/ship/resolveShipId';

/** The app-wired form of `resolveShipId`: owned ships from ShipsContext, reference units from the
 *  unit catalogue. */
export function useShipIdResolver(): (shipId: string) => Ship | null {
    const { getShipById } = useShips();
    const { ships: units, getAscensionStats } = useShipsData();
    return useCallback(
        (shipId: string) => resolveShipId(shipId, { getShipById, units, getAscensionStats }),
        [getShipById, units, getAscensionStats]
    );
}
```

- [ ] **Step 6: Replace `resolveSavedShip` in `PlacementBoard`**

In `src/components/simulator/PlacementBoard.tsx`:
- Delete the `resolveSavedShip` function and its doc comment.
- Replace its call site in `handleLoadEncounter` with the hook's resolver: `const resolveStoredShip = useShipIdResolver();`
- Remove the now-unused `parseReferenceShipId` / `referenceShip` imports **only if nothing else in the file uses them** — check with `grep -n "parseReferenceShipId\|referenceShip" src/components/simulator/PlacementBoard.tsx` before deleting. `useShips` / `useShipsData` may still be needed for other things in the file; check the same way.

- [ ] **Step 7: Verify the existing board tests still pass**

Run: `npm test -- --run src/components/simulator/__tests__/PlacementBoard.test.tsx src/utils/ship/__tests__/resolveShipId.test.ts`
Expected: PASS. If a `PlacementBoard` test fails, the refactor changed behaviour — fix the code, not the test.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/utils/ship/resolveShipId.ts src/hooks/useShipIdResolver.ts \
        src/utils/ship/__tests__/resolveShipId.test.ts src/components/simulator/PlacementBoard.tsx
git commit -m "refactor(simulator): share the stored-ship-id resolver between board loaders"
```

---

### Task 2: The `SimulatorSetup` value

**Files:**
- Create: `src/utils/simulator/simulatorSetup.ts`
- Test: `src/utils/simulator/__tests__/simulatorSetup.test.ts`

**Interfaces:**
- Consumes: `resolveShipId` (Task 1) — via the injected `resolve` callback, not imported directly, so the pure module stays free of context.
- Produces:
  ```ts
  export const SIMULATOR_SETUP_VERSION = 1;
  export interface SerializedPlacement { shipId: string; overrides?: StatOverrides }
  export type SerializedBoard = Partial<Record<Position, SerializedPlacement>>;
  export interface SimulatorSetup {
      version: number; name: string;
      playerBoard: SerializedBoard; enemyBoard: SerializedBoard;
      playerSquadLeader?: SquadLeaderSelection; enemySquadLeader?: SquadLeaderSelection;
      seed: number; runCount: number; savedAt: number;
  }
  export interface SerializeSetupArgs {
      name: string; playerBoard: BoardState; enemyBoard: BoardState;
      playerSquadLeader?: SquadLeaderSelection; enemySquadLeader?: SquadLeaderSelection;
      seed: number; runCount: number; savedAt: number;
  }
  export function serializeSetup(args: SerializeSetupArgs): SimulatorSetup;
  export interface DroppedCell { side: 'player' | 'enemy'; position: Position }
  export interface DeserializedSetup {
      playerBoard: BoardState; enemyBoard: BoardState;
      playerSquadLeader?: SquadLeaderSelection; enemySquadLeader?: SquadLeaderSelection;
      seed: number; runCount: number; dropped: DroppedCell[];
  }
  export function deserializeSetup(
      setup: SimulatorSetup,
      resolve: (shipId: string) => Ship | null
  ): DeserializedSetup;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/utils/simulator/__tests__/simulatorSetup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeSetup, deserializeSetup, SIMULATOR_SETUP_VERSION } from '../simulatorSetup';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';

const ship = (id: string, name: string) => ({ id, name }) as unknown as Ship;
const owned = ship('owned-1', 'Owned');
const reference = ship('template:tmpl-1:refitted', 'Reference');

const playerBoard: BoardState = {
    T1: { ship: owned, overrides: { speed: 150 } },
    M2: { ship: reference },
    // An empty override object is the alternate spelling of "no overrides"; it must not survive.
    B3: { ship: owned, overrides: {} },
};
const enemyBoard: BoardState = { T4: { ship: reference, overrides: { hp: 9000 } } };

const args = {
    name: 'My Setup',
    playerBoard,
    enemyBoard,
    playerSquadLeader: { faction: 'TERRAN', name: 'Someone', stage: 2 } as const,
    enemySquadLeader: undefined,
    seed: 424242,
    runCount: 20,
    savedAt: 1_700_000_000_000,
};

const resolveAll = (id: string) => (id === owned.id ? owned : id === reference.id ? reference : null);

describe('serializeSetup', () => {
    it('carries ship ids, overrides, leaders, seed and run count', () => {
        const setup = serializeSetup(args);
        expect(setup.version).toBe(SIMULATOR_SETUP_VERSION);
        expect(setup.name).toBe('My Setup');
        expect(setup.seed).toBe(424242);
        expect(setup.runCount).toBe(20);
        expect(setup.savedAt).toBe(1_700_000_000_000);
        expect(setup.playerBoard.T1).toEqual({ shipId: 'owned-1', overrides: { speed: 150 } });
        expect(setup.enemyBoard.T4).toEqual({
            shipId: 'template:tmpl-1:refitted',
            overrides: { hp: 9000 },
        });
        expect(setup.playerSquadLeader).toEqual({ faction: 'TERRAN', name: 'Someone', stage: 2 });
        expect(setup.enemySquadLeader).toBeUndefined();
    });

    it('omits overrides entirely for a placement that carries none', () => {
        const setup = serializeSetup(args);
        expect(setup.playerBoard.M2).toEqual({ shipId: 'template:tmpl-1:refitted' });
        expect('overrides' in setup.playerBoard.M2!).toBe(false);
        expect('overrides' in setup.playerBoard.B3!).toBe(false);
    });
});

describe('deserializeSetup', () => {
    it('round-trips a setup back to equivalent boards', () => {
        const result = deserializeSetup(serializeSetup(args), resolveAll);
        expect(result.dropped).toEqual([]);
        expect(result.playerBoard.T1).toEqual({ ship: owned, overrides: { speed: 150 } });
        expect(result.playerBoard.M2).toEqual({ ship: reference, overrides: undefined });
        expect(result.enemyBoard.T4).toEqual({ ship: reference, overrides: { hp: 9000 } });
        expect(result.seed).toBe(424242);
        expect(result.runCount).toBe(20);
        expect(result.playerSquadLeader).toEqual({ faction: 'TERRAN', name: 'Someone', stage: 2 });
    });

    it('drops a cell whose ship id no longer resolves and reports it, keeping the rest', () => {
        const resolveOnlyReference = (id: string) => (id === reference.id ? reference : null);
        const result = deserializeSetup(serializeSetup(args), resolveOnlyReference);
        expect(result.playerBoard.T1).toBeUndefined();
        expect(result.playerBoard.B3).toBeUndefined();
        expect(result.playerBoard.M2).toBeDefined();
        expect(result.enemyBoard.T4).toBeDefined();
        expect(result.dropped).toEqual([
            { side: 'player', position: 'T1' },
            { side: 'player', position: 'B3' },
        ]);
    });

    it('does not throw when every ship id dangles', () => {
        const result = deserializeSetup(serializeSetup(args), () => null);
        expect(result.playerBoard).toEqual({});
        expect(result.enemyBoard).toEqual({});
        expect(result.dropped).toHaveLength(4);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/utils/simulator/__tests__/simulatorSetup.test.ts`
Expected: FAIL — `Failed to resolve import "../simulatorSetup"`.

- [ ] **Step 3: Implement the module**

Create `src/utils/simulator/simulatorSetup.ts`:

```ts
import type { Position } from '../../types/encounters';
import type { Ship } from '../../types/ship';
import type { BoardState } from '../../components/simulator/PlacementBoard';
import type { SquadLeaderSelection } from '../combat/preFight';
import { hasAnyOverride, type StatOverrides } from './statOverrides';

/** Discriminator for future migrations. A stored value carrying any other version is discarded,
 *  not upgraded. */
export const SIMULATOR_SETUP_VERSION = 1;

export interface SerializedPlacement {
    /** An owned ship's id, or a reference id (`template:<templateId>:<variant>`). */
    shipId: string;
    overrides?: StatOverrides;
}

export type SerializedBoard = Partial<Record<Position, SerializedPlacement>>;

export interface SimulatorSetup {
    version: number;
    name: string;
    playerBoard: SerializedBoard;
    enemyBoard: SerializedBoard;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    /** Epoch ms; orders the saved list. */
    savedAt: number;
}

export interface SerializeSetupArgs {
    name: string;
    playerBoard: BoardState;
    enemyBoard: BoardState;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    savedAt: number;
}

/** A setup stores ship IDS, not resolved stats, so re-gearing a ship updates every setup that
 *  names it. */
const serializeBoard = (board: BoardState): SerializedBoard => {
    const serialized: SerializedBoard = {};
    for (const [position, placement] of Object.entries(board) as [
        Position,
        BoardState[Position],
    ][]) {
        if (!placement) continue;
        serialized[position] = hasAnyOverride(placement.overrides)
            ? { shipId: placement.ship.id, overrides: { ...placement.overrides } }
            : { shipId: placement.ship.id };
    }
    return serialized;
};

export function serializeSetup(args: SerializeSetupArgs): SimulatorSetup {
    return {
        version: SIMULATOR_SETUP_VERSION,
        name: args.name,
        playerBoard: serializeBoard(args.playerBoard),
        enemyBoard: serializeBoard(args.enemyBoard),
        playerSquadLeader: args.playerSquadLeader,
        enemySquadLeader: args.enemySquadLeader,
        seed: args.seed,
        runCount: args.runCount,
        savedAt: args.savedAt,
    };
}

export interface DroppedCell {
    side: 'player' | 'enemy';
    position: Position;
}

export interface DeserializedSetup {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    /** Cells whose ship id no longer resolves. Reported to the user; never thrown. */
    dropped: DroppedCell[];
}

const deserializeBoard = (
    board: SerializedBoard,
    side: 'player' | 'enemy',
    resolve: (shipId: string) => Ship | null,
    dropped: DroppedCell[]
): BoardState => {
    const result: BoardState = {};
    for (const [position, placement] of Object.entries(board) as [
        Position,
        SerializedPlacement | undefined,
    ][]) {
        if (!placement) continue;
        const ship = resolve(placement.shipId);
        if (!ship) {
            dropped.push({ side, position });
            continue;
        }
        result[position] = {
            ship,
            overrides: hasAnyOverride(placement.overrides) ? { ...placement.overrides } : undefined,
        };
    }
    return result;
};

/**
 * Rebuild boards from a stored setup.
 *
 * An unresolvable ship id is normal, not corruption: an alt-account switch dangles every owned id
 * at once, and import dedupes ships by level/rank/stats/refit count so an id need not survive a
 * re-import. Those cells are dropped and reported; the rest of the setup loads.
 */
export function deserializeSetup(
    setup: SimulatorSetup,
    resolve: (shipId: string) => Ship | null
): DeserializedSetup {
    const dropped: DroppedCell[] = [];
    return {
        playerBoard: deserializeBoard(setup.playerBoard, 'player', resolve, dropped),
        enemyBoard: deserializeBoard(setup.enemyBoard, 'enemy', resolve, dropped),
        playerSquadLeader: setup.playerSquadLeader,
        enemySquadLeader: setup.enemySquadLeader,
        seed: setup.seed,
        runCount: setup.runCount,
        dropped,
    };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/utils/simulator/__tests__/simulatorSetup.test.ts`
Expected: PASS, 5 tests.

Note on the `dropped` ordering assertion: `Object.entries` on a string-keyed object returns insertion order, and the fixture inserts `T1` before `B3`. If the assertion is brittle in practice, change it to `expect(result.dropped).toEqual(expect.arrayContaining([...]))` plus a length check — do not change the implementation to satisfy an ordering nobody depends on.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/utils/simulator/simulatorSetup.ts src/utils/simulator/__tests__/simulatorSetup.test.ts
git commit -m "feat(simulator): serialize a setup to ship ids, overrides, leaders and seed"
```

---

### Task 3: Zod schema for a stored setup

localStorage is user-editable and survives data updates, so a stored setup crosses a trust boundary on read (CLAUDE.md security rule 5).

**Files:**
- Create: `src/schemas/simulatorSetup.ts`
- Test: `src/schemas/simulatorSetup.test.ts`

**Interfaces:**
- Consumes: `SimulatorSetup`, `SIMULATOR_SETUP_VERSION` (Task 2); `OVERRIDABLE_STATS` from `src/utils/simulator/statOverrides.ts`; `SQUAD_LEADERS` from `src/constants/squadLeaders.ts`.
- Produces:
  ```ts
  export function parseSimulatorSetup(value: unknown): SimulatorSetup | null;
  export function parseSimulatorSetupList(value: unknown): SimulatorSetup[];
  ```

Note the existing schema style in `src/schemas/sharedAutogearBuild.ts`: closed vocabularies are validated with a `.refine` over an own-property check (`Object.prototype.hasOwnProperty.call`), because `key in record` would admit `toString`.

- [ ] **Step 1: Write the failing test**

Create `src/schemas/simulatorSetup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSimulatorSetup, parseSimulatorSetupList } from './simulatorSetup';

const valid = {
    version: 1,
    name: 'Setup',
    playerBoard: { T1: { shipId: 'owned-1', overrides: { speed: 150 } } },
    enemyBoard: { B4: { shipId: 'template:t:r0' } },
    seed: 42,
    runCount: 20,
    savedAt: 1_700_000_000_000,
};

describe('parseSimulatorSetup', () => {
    it('accepts a well-formed setup', () => {
        expect(parseSimulatorSetup(valid)).not.toBeNull();
    });

    it('rejects a wrong version rather than upgrading it', () => {
        expect(parseSimulatorSetup({ ...valid, version: 2 })).toBeNull();
    });

    it('rejects an unknown board position', () => {
        expect(parseSimulatorSetup({ ...valid, playerBoard: { Z9: { shipId: 'x' } } })).toBeNull();
    });

    it('rejects an unknown override stat', () => {
        expect(
            parseSimulatorSetup({
                ...valid,
                playerBoard: { T1: { shipId: 'x', overrides: { luck: 5 } } },
            })
        ).toBeNull();
    });

    it('rejects a non-finite override value', () => {
        expect(
            parseSimulatorSetup({
                ...valid,
                playerBoard: { T1: { shipId: 'x', overrides: { speed: Infinity } } },
            })
        ).toBeNull();
    });

    it('rejects a squad leader with a bad stage', () => {
        expect(
            parseSimulatorSetup({ ...valid, playerSquadLeader: { faction: 'TERRAN', name: 'X', stage: 9 } })
        ).toBeNull();
    });

    it('rejects a non-object', () => {
        expect(parseSimulatorSetup('nope')).toBeNull();
        expect(parseSimulatorSetup(null)).toBeNull();
    });
});

describe('parseSimulatorSetupList', () => {
    it('keeps the valid entries and drops only the invalid ones', () => {
        const list = parseSimulatorSetupList([valid, { ...valid, version: 99 }, { ...valid, name: 'B' }]);
        expect(list.map((s) => s.name)).toEqual(['Setup', 'B']);
    });

    it('returns an empty list for a non-array', () => {
        expect(parseSimulatorSetupList({})).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/schemas/simulatorSetup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

Create `src/schemas/simulatorSetup.ts`:

```ts
import { z } from 'zod';
import { SQUAD_LEADERS } from '../constants/squadLeaders';
import { OVERRIDABLE_STATS } from '../utils/simulator/statOverrides';
import {
    SIMULATOR_SETUP_VERSION,
    type SimulatorSetup,
} from '../utils/simulator/simulatorSetup';

const POSITIONS = [
    'T1', 'T2', 'T3', 'T4',
    'M1', 'M2', 'M3', 'M4',
    'B1', 'B2', 'B3', 'B4',
] as const;

// `z.record` in Zod 4 is EXHAUSTIVE over an enum key: it requires every key present. A board
// and an override set are both sparse by design, so both take `partialRecord`.
const overridesSchema = z
    .partialRecord(z.enum(OVERRIDABLE_STATS), z.number().finite())
    .optional();

const placementSchema = z.object({
    shipId: z.string().min(1).max(200),
    overrides: overridesSchema,
});

const boardSchema = z.partialRecord(z.enum(POSITIONS), placementSchema);

// `key in SQUAD_LEADERS` would admit 'toString'; own-property only, matching
// sharedAutogearBuild.ts.
const isKeyOf = (record: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key);

const squadLeaderSchema = z
    .object({
        faction: z.string(),
        name: z.string(),
        stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .refine(
        (value) =>
            isKeyOf(SQUAD_LEADERS, value.faction) &&
            !!SQUAD_LEADERS[value.faction]?.some((leader) => leader.name === value.name),
        { message: 'Unknown squad leader' }
    )
    .optional();

const setupSchema = z.object({
    version: z.literal(SIMULATOR_SETUP_VERSION),
    name: z.string().min(1).max(120),
    playerBoard: boardSchema,
    enemyBoard: boardSchema,
    playerSquadLeader: squadLeaderSchema,
    enemySquadLeader: squadLeaderSchema,
    seed: z.number().int().finite(),
    runCount: z.number().int().finite(),
    savedAt: z.number().finite(),
});

/** `null` for anything a stored setup must not become: a wrong version, an unknown position or
 *  override stat, a leader this build no longer ships. A rejected value is discarded, never
 *  repaired — a partially-valid setup would load a board that looks complete and is not. */
export function parseSimulatorSetup(value: unknown): SimulatorSetup | null {
    const result = setupSchema.safeParse(value);
    return result.success ? (result.data as SimulatorSetup) : null;
}

/** One bad entry drops only itself; the rest of a saved list survives. */
export function parseSimulatorSetupList(value: unknown): SimulatorSetup[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        const parsed = parseSimulatorSetup(entry);
        return parsed ? [parsed] : [];
    });
}
```

`partialRecord` must still **reject** an unknown key rather than stripping it — the `Z9` test is the tripwire, so confirm it fails before the schema exists and passes after. If it turns out to strip instead of reject, add `.check()`/`.superRefine` asserting every key is a known position, or fall back to `z.object({...})` with each position optional and `.strict()`. The requirement is rejection, not a particular spelling.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/schemas/simulatorSetup.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/schemas/simulatorSetup.ts src/schemas/simulatorSetup.test.ts
git commit -m "feat(simulator): validate a stored setup before it reaches the boards"
```

---

### Task 4: localStorage persistence

**Files:**
- Create: `src/utils/simulator/setupStorage.ts`
- Test: `src/utils/simulator/__tests__/setupStorage.test.ts`

**Interfaces:**
- Consumes: `parseSimulatorSetup`, `parseSimulatorSetupList` (Task 3); `SimulatorSetup` (Task 2).
- Produces:
  ```ts
  export const SETUP_STORAGE_KEYS: { autosave: string; saved: string };
  export function readAutosavedSetup(): SimulatorSetup | null;
  export function writeAutosavedSetup(setup: SimulatorSetup): void;
  export function readSavedSetups(): SimulatorSetup[];
  export function writeSavedSetups(setups: SimulatorSetup[]): void;
  export const MAX_SAVED_SETUPS = 50;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/utils/simulator/__tests__/setupStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    SETUP_STORAGE_KEYS,
    readAutosavedSetup,
    writeAutosavedSetup,
    readSavedSetups,
    writeSavedSetups,
} from '../setupStorage';
import type { SimulatorSetup } from '../simulatorSetup';

const setup = (name: string): SimulatorSetup => ({
    version: 1,
    name,
    playerBoard: { T1: { shipId: 'owned-1' } },
    enemyBoard: { B4: { shipId: 'template:t:r0' } },
    seed: 7,
    runCount: 20,
    savedAt: 1,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('autosave', () => {
    it('round-trips a setup', () => {
        writeAutosavedSetup(setup('auto'));
        expect(readAutosavedSetup()?.name).toBe('auto');
    });

    it('returns null when nothing is stored', () => {
        expect(readAutosavedSetup()).toBeNull();
    });

    it('returns null for non-JSON', () => {
        localStorage.setItem(SETUP_STORAGE_KEYS.autosave, '{{{');
        expect(readAutosavedSetup()).toBeNull();
    });

    it('returns null for JSON of the wrong shape', () => {
        localStorage.setItem(SETUP_STORAGE_KEYS.autosave, JSON.stringify({ version: 1 }));
        expect(readAutosavedSetup()).toBeNull();
    });

    it('returns null when reading storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readAutosavedSetup()).toBeNull();
    });

    it('does not throw when writing storage throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(() => writeAutosavedSetup(setup('auto'))).not.toThrow();
    });
});

describe('saved list', () => {
    it('round-trips a list', () => {
        writeSavedSetups([setup('a'), setup('b')]);
        expect(readSavedSetups().map((s) => s.name)).toEqual(['a', 'b']);
    });

    it('drops only the invalid entries', () => {
        localStorage.setItem(
            SETUP_STORAGE_KEYS.saved,
            JSON.stringify([setup('a'), { version: 99 }, setup('b')])
        );
        expect(readSavedSetups().map((s) => s.name)).toEqual(['a', 'b']);
    });

    it('returns an empty list for a non-array', () => {
        localStorage.setItem(SETUP_STORAGE_KEYS.saved, JSON.stringify({ a: 1 }));
        expect(readSavedSetups()).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --run src/utils/simulator/__tests__/setupStorage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/utils/simulator/setupStorage.ts`:

```ts
import { parseSimulatorSetup, parseSimulatorSetupList } from '../../schemas/simulatorSetup';
import type { SimulatorSetup } from './simulatorSetup';

/**
 * Simulator setups are throwaway per-device UI state — the same tier as view modes, filters and
 * the squad-leader selections in `squadLeaderSelection.ts` — deliberately NOT the `useStorage`
 * IndexedDB/Supabase pipeline.
 */
export const SETUP_STORAGE_KEYS = {
    autosave: 'simulator-setup-autosave',
    saved: 'simulator-setup-saved',
} as const;

/** Bounds how much a page can accumulate in a storage area shared with everything else on the
 *  origin. A save past the cap drops the oldest entry. */
export const MAX_SAVED_SETUPS = 50;

/** Reads never throw: storage can be unavailable (private mode, blocked third-party contexts) and
 *  the stored value is user-editable. */
const readRaw = (key: string): unknown => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

/** Writes never throw either (quota, private mode): the value stays in memory for the session. */
const writeRaw = (key: string, value: unknown): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage unavailable.
    }
};

export function readAutosavedSetup(): SimulatorSetup | null {
    return parseSimulatorSetup(readRaw(SETUP_STORAGE_KEYS.autosave));
}

export function writeAutosavedSetup(setup: SimulatorSetup): void {
    writeRaw(SETUP_STORAGE_KEYS.autosave, setup);
}

export function readSavedSetups(): SimulatorSetup[] {
    return parseSimulatorSetupList(readRaw(SETUP_STORAGE_KEYS.saved));
}

export function writeSavedSetups(setups: SimulatorSetup[]): void {
    writeRaw(SETUP_STORAGE_KEYS.saved, setups.slice(-MAX_SAVED_SETUPS));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run src/utils/simulator/__tests__/setupStorage.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add src/utils/simulator/setupStorage.ts src/utils/simulator/__tests__/setupStorage.test.ts
git commit -m "feat(simulator): persist setups to localStorage with validated reads"
```

---

### Task 5: The setup bar and page wiring

**Files:**
- Create: `src/components/simulator/SimulatorSetupBar.tsx`
- Create: `src/components/simulator/__tests__/SimulatorSetupBar.test.tsx`
- Modify: `src/pages/SimulatorPage.tsx`
- Modify: `src/hooks/useSimulatorRuns.ts` (add `handleClearRunState`)
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: no exports other consumers rely on.

- [ ] **Step 1: Add a run-state reset to `useSimulatorRuns`**

`battleResult`, `aggregate`, `baseline`, `divergence` and `provenance` describe the boards that produced them. A load replaces the boards, so they must go — `RunProvenance` exists precisely so a displayed result is never re-derived from live boards, and leaving a result on screen after a load captions it with a setup that did not produce it.

In `src/hooks/useSimulatorRuns.ts`, add to the returned object and to `UseSimulatorRunsResult`:

```ts
    /** Discards every displayed result and the pinned baseline. Call when the boards are
     *  replaced wholesale: a result describes the boards that produced it, and nothing
     *  re-derives it from live state. */
    handleClearRunState: () => void;
```

Implementation, placed with the other handlers:

```ts
    const handleClearRunState = useCallback(() => {
        abortRef.current?.abort();
        generationRef.current++;
        setIsRunning(false);
        setProgress(null);
        setBattleResult(null);
        setAggregate(null);
        setProvenance(null);
        setBaseline(null);
        setDivergence(null);
        setRunError(null);
    }, []);
```

Aborting and bumping the generation is what stops a run that is already in flight from landing its result onto the newly loaded boards.

- [ ] **Step 2: Write the failing component test**

Create `src/components/simulator/__tests__/SimulatorSetupBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SimulatorSetupBar from '../SimulatorSetupBar';
import type { SimulatorSetup } from '../../../utils/simulator/simulatorSetup';

const setup = (name: string): SimulatorSetup => ({
    version: 1,
    name,
    playerBoard: {},
    enemyBoard: {},
    seed: 1,
    runCount: 1,
    savedAt: 1,
});

const props = {
    saved: [setup('Alpha'), setup('Beta')],
    onSave: vi.fn(),
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    canSave: true,
};

describe('SimulatorSetupBar', () => {
    it('saves under a typed name', () => {
        const onSave = vi.fn();
        render(<SimulatorSetupBar {...props} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText(/setup name/i), { target: { value: 'Gamma' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(onSave).toHaveBeenCalledWith('Gamma');
    });

    it('does not save an empty or whitespace-only name', () => {
        const onSave = vi.fn();
        render(<SimulatorSetupBar {...props} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText(/setup name/i), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(onSave).not.toHaveBeenCalled();
    });

    it('loads the selected setup', () => {
        const onLoad = vi.fn();
        render(<SimulatorSetupBar {...props} onLoad={onLoad} />);
        fireEvent.change(screen.getByLabelText(/saved setups/i), { target: { value: 'Beta' } });
        fireEvent.click(screen.getByRole('button', { name: /load/i }));
        expect(onLoad).toHaveBeenCalledWith('Beta');
    });

    it('asks before deleting', () => {
        const onDelete = vi.fn();
        render(<SimulatorSetupBar {...props} onDelete={onDelete} />);
        fireEvent.change(screen.getByLabelText(/saved setups/i), { target: { value: 'Alpha' } });
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
        expect(onDelete).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /confirm|delete setup/i }));
        expect(onDelete).toHaveBeenCalledWith('Alpha');
    });
});
```

Look at `src/components/simulator/__tests__/SquadLeaderPicker.test.tsx` first — match how it drives the shared `Select` (it is a custom portal component, not a native `<select>`, so `fireEvent.change` on a label may not be the right driver). Adjust the three `Select`-driving lines to whatever that test does; do **not** change the assertions.

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- --run src/components/simulator/__tests__/SimulatorSetupBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Build the component**

Create `src/components/simulator/SimulatorSetupBar.tsx`. Requirements:

- Wrapped in the `card` class (the boxed-content primitive — a class, not a component).
- An `Input` labelled "Setup name", a primary `Button` "Save", a `Select` labelled "Saved setups" whose options are the saved names, and secondary `Button`s "Load" and "Delete".
- Save trims the name and no-ops on an empty result; Save is disabled when `canSave` is false.
- Saving under a name already in `saved` opens a `ConfirmModal` ("Overwrite <name>?") before calling `onSave`.
- Delete always goes through a `ConfirmModal`.
- Load and Delete are disabled while no setup is selected.
- No emojis.

Props:

```tsx
interface Props {
    saved: SimulatorSetup[];
    /** Name is already trimmed and non-empty. Overwrites an existing entry of the same name. */
    onSave: (name: string) => void;
    onLoad: (name: string) => void;
    onDelete: (name: string) => void;
    /** False when there is nothing worth saving (both boards empty). */
    canSave: boolean;
}
```

- [ ] **Step 5: Run the component test to confirm it passes**

Run: `npm test -- --run src/components/simulator/__tests__/SimulatorSetupBar.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire it into `SimulatorPage`**

In `src/pages/SimulatorPage.tsx`:

1. `const resolveStoredShip = useShipIdResolver();`
2. `const [savedSetups, setSavedSetups] = useState<SimulatorSetup[]>(() => readSavedSetups());`
3. `const [loadNotice, setLoadNotice] = useState<string | null>(null);`
4. **Restore the autosave on mount**, before anything can run a battle:

```tsx
    // Strict mode mounts effects twice; restoring is idempotent (it only writes state from
    // storage), so no guard ref is needed here.
    useEffect(() => {
        const stored = readAutosavedSetup();
        if (!stored) return;
        applySetup(stored);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
```

5. **Autosave on change**, debounced:

```tsx
    useEffect(() => {
        const timer = setTimeout(() => {
            writeAutosavedSetup(
                serializeSetup({
                    name: AUTOSAVE_SETUP_NAME,
                    playerBoard,
                    enemyBoard,
                    playerSquadLeader,
                    enemySquadLeader,
                    seed,
                    runCount,
                    savedAt: Date.now(),
                })
            );
        }, 250);
        return () => clearTimeout(timer);
    }, [playerBoard, enemyBoard, playerSquadLeader, enemySquadLeader, seed, runCount]);
```

**The autosave's name is `AUTOSAVE_SETUP_NAME`, not `''`.** An empty name fails the schema's `z.string().min(1)`, so an autosave written with one would silently fail validation on every read and the feature would appear to do nothing. Add to `src/utils/simulator/simulatorSetup.ts`:

```ts
/** The name an autosaved setup carries. A setup name is non-empty (the schema enforces it), and
 *  the autosave is not a named save the user chose — this is the placeholder that keeps it valid
 *  without colliding with the saved list, which is keyed by user-typed names. */
export const AUTOSAVE_SETUP_NAME = '(autosave)';
```

Use it for the `name` field above, and extend Task 4's autosave round-trip test to assert the stored autosave reads back rather than validating to `null`.

6. **`applySetup`** — the one place a setup becomes live state:

```tsx
    const applySetup = (stored: SimulatorSetup) => {
        const result = deserializeSetup(stored, resolveStoredShip);
        setPlayerBoard(result.playerBoard);
        setEnemyBoard(result.enemyBoard);
        setPlayerSelected(undefined);
        setEnemySelected(undefined);
        setSeed(result.seed);
        setRunCount(result.runCount);
        // Route leaders through the change handler: it is what write-throughs to
        // SQUAD_LEADER_STORAGE_KEYS, so the live selection and the stored one cannot diverge.
        handleSquadLeaderChange('player', result.playerSquadLeader);
        handleSquadLeaderChange('enemy', result.enemySquadLeader);
        handleClearRunState();
        setLoadNotice(
            result.dropped.length > 0
                ? `${result.dropped.length} ship${result.dropped.length === 1 ? '' : 's'} in this setup could no longer be found and were left out.`
                : null
        );
    };
```

7. Render `<SimulatorSetupBar>` above the boards, with handlers that save/load/delete against `savedSetups` and persist via `writeSavedSetups`. A save replaces any entry of the same name and appends otherwise.
8. Render `loadNotice` when set, in `text-amber-400` (the colour the page already uses for a soft warning), inside an `aria-live="polite"` region.

- [ ] **Step 7: Verify the page still works**

Run: `npm test -- --run src/pages src/components/simulator src/utils/simulator src/schemas/simulatorSetup.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run `npm start` (port 3000, not `run dev`), open the simulator, place ships on both sides, set an override, reload the page, and confirm the boards come back. Then save under a name, change the boards, load it back.

- [ ] **Step 8: Documentation and changelog**

In `src/pages/DocumentationPage.tsx`, add to the simulator section: setups autosave and can be saved by name; a saved setup stores ships by reference, so re-gearing a ship changes what it does; ships you no longer own are left out when a setup loads.

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` — an area prefix plus 8-12 words, one entry per user-visible change:

```
'Combat simulator: your boards, overrides, leaders and seed now survive a reload.',
'Combat simulator: save a setup under a name, then load or delete it later.',
```

- [ ] **Step 9: Full test run and commit**

Run: `npm test -- --run`
Expected: PASS. The suite includes a golden audit and is slow; run it once here rather than per task.

```bash
git add src/components/simulator/SimulatorSetupBar.tsx \
        src/components/simulator/__tests__/SimulatorSetupBar.test.tsx \
        src/pages/SimulatorPage.tsx src/hooks/useSimulatorRuns.ts \
        src/pages/DocumentationPage.tsx src/constants/changelog.ts
git add -f docs/superpowers/specs/2026-09-14-simulator-setup-save-load-design.md \
           docs/superpowers/plans/2026-09-14-simulator-setup-save-load.md
git commit -m "feat(simulator): save, load and autosave a setup"
```

---

## Definition of done

- `npm test -- --run`, `npx tsc --noEmit` and `npm run lint` all clean.
- A reload restores the boards, overrides, leaders, seed and run count.
- A setup naming a ship you no longer own loads the rest and says how many cells it left out.
- Loading a setup clears any displayed result and unpins the baseline.
- Corrupt or hand-edited storage never throws and never produces a half-built board.
