# Autogear Sim Candidate Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player run several candidate gear builds for one ship through the real combat sim over a shared seed set, and read a table of paired outcome deltas against the build the ship currently wears.

**Architecture:** One adapter. A *fight source* yields `{ playerBoard, enemyBoard, leaders }`; a *candidate* is a `Ship` with substituted `equipment`; `buildTeam` resolves stats and `runSeedSetAsync` runs the seed set; `deltaStats.pairedDelta` turns two aggregates into a row. Candidates come from autogear run under several roles — the measured evidence in the spec says one optimizer run only ever explores one basin. Nothing in the combat engine changes.

**Tech Stack:** TypeScript, React, Vitest, TailwindCSS. No new dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-16-autogear-sim-rerank-design.md`. Read it before Task 1; the Measured evidence section is why the design is shaped this way.
- **Never run the Supabase CLI** in any form (Security rule 8). This feature touches no database.
- **UI components:** always use `src/components/ui/` (`Button`, `Select`, `Input`, `Checkbox`, `Modal`, the `ui/tables/` primitives) and the `card` CSS class for boxed content. Never a raw `<button>` for a standard action, never a hand-rolled box or modal.
- **No emojis in UI text.** Plain text plus colour classes.
- **Dev server is `npm start`, port 3000.** Never `npm run dev`.
- **Never run `vitest -u`.** Golden snapshots are audited across the whole `npm test` run.
- **RNG:** pin only via `runSeededBattle` / `runSeedSetAsync`. Never call `setupKeyedRng` directly here; `resetRateGateRng()` un-seeds.
- **Percentage stats are stored as integers** (crit is `70`, not `0.70`).
- **Changelog:** add entries to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` before the commit that makes a user-visible change. An area prefix plus 8–12 words. One entry per user-visible change; split rather than fuse.
- **Comments:** present-tense behaviour contracts only. No change history, no task/phase numbers, no counts or site enumerations, no rule restated at N call sites. Where the spec says "a tripwire, not a comment", write the test.
- **Commit trailers:** end every commit message with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp`.

## File Structure

New, all under `src/utils/autogear/simRerank/`:

| File | Responsibility |
|---|---|
| `candidateShip.ts` | `GearSuggestion[]` + `Ship` → a `Ship` carrying that loadout |
| `gearSteal.ts` | Which board allies a candidate would strip |
| `fightSources.ts` | The three sources → one `FightBoards` shape |
| `practiceBoard.ts` | The generic-combatant fixture the practice source uses |
| `runCandidates.ts` | Candidate + fight → `SeedSetAggregate`, focus resolved by ship id |
| `metricTable.ts` | Aggregates → paired-delta rows, role → suggested primary |
| `comparedRoles.ts` | The default compared-role set for a ship |

Modified:

| File | Change |
|---|---|
| `src/utils/autogear/AutogearStrategy.ts` | Add optional `candidates?: GearSuggestion[][]` |
| `src/utils/autogear/strategies/GeneticStrategy.ts` | Populate it from the final population |
| `src/pages/manager/AutogearPage.tsx` | Use the extracted `applySuggestionsToShip` |
| `src/components/autogear/AutogearSettings.tsx` | The "Simulate candidates" section |
| `src/pages/DocumentationPage.tsx` | In-app docs |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` entries |

New React: `src/hooks/useSimRerank.ts` (orchestration), `src/components/autogear/SimRerankSection.tsx`, `src/components/autogear/SimRerankTable.tsx`.

---

### Task 1: Candidate ship builder

**Files:**
- Create: `src/utils/autogear/simRerank/candidateShip.ts`
- Test: `src/utils/autogear/simRerank/__tests__/candidateShip.test.ts`
- Modify: `src/pages/manager/AutogearPage.tsx:100-119` (replace the two local helpers with this)

**Interfaces:**
- Consumes: `GearSuggestion` from `src/types/autogear.ts`, `Ship` from `src/types/ship.ts`.
- Produces: `applySuggestionsToShip(ship: Ship, suggestions: GearSuggestion[]): Ship`

**Why a `Ship` and not a stat block:** `simulateBattle` derives gear-set abilities from `ship.equipment` via `buildShipAbilitiesWithEquipment`. A baked stat block silently drops every gear ability.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/candidateShip.test.ts
import { describe, it, expect } from 'vitest';
import { applySuggestionsToShip } from '../candidateShip';
import type { Ship } from '../../../../types/ship';
import type { GearSuggestion } from '../../../../types/autogear';

const ship = (): Ship =>
    ({
        id: 'focus',
        name: 'Focus',
        type: 'ATTACKER',
        baseStats: {},
        equipment: { weapon: 'old-weapon', hull: 'old-hull' },
        implants: { implant_alpha: 'old-implant' },
        refits: [],
    }) as unknown as Ship;

const suggestion = (slotName: string, gearId: string): GearSuggestion => ({
    slotName: slotName as GearSuggestion['slotName'],
    gearId,
    score: 1,
});

describe('applySuggestionsToShip', () => {
    it('substitutes suggested gear and leaves untouched slots on their current piece', () => {
        const result = applySuggestionsToShip(ship(), [suggestion('weapon', 'new-weapon')]);
        expect(result.equipment.weapon).toBe('new-weapon');
        expect(result.equipment.hull).toBe('old-hull');
    });

    it('routes implant slots to implants, not equipment', () => {
        const result = applySuggestionsToShip(ship(), [
            suggestion('implant_alpha', 'new-implant'),
        ]);
        expect(result.implants?.implant_alpha).toBe('new-implant');
        expect(result.equipment.implant_alpha).toBeUndefined();
    });

    it('does not mutate the input ship', () => {
        const original = ship();
        applySuggestionsToShip(original, [suggestion('weapon', 'new-weapon')]);
        expect(original.equipment.weapon).toBe('old-weapon');
    });

    it('keeps the ship identity, so the engine still resolves its skills', () => {
        const result = applySuggestionsToShip(ship(), [suggestion('weapon', 'new-weapon')]);
        expect(result.id).toBe('focus');
        expect(result.name).toBe('Focus');
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/candidateShip.test.ts`
Expected: FAIL — `Failed to resolve import "../candidateShip"`.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/candidateShip.ts
import type { Ship } from '../../../types/ship';
import type { GearSuggestion } from '../../../types/autogear';

const isImplantSlot = (slotName: string): boolean => slotName.startsWith('implant_');

/**
 * A ship wearing a candidate loadout.
 *
 * Returns a `Ship`, not a stat block: `simulateBattle` derives gear-set abilities from
 * `ship.equipment` through `buildShipAbilitiesWithEquipment`, so a baked block drops every gear
 * ability while still producing plausible numbers.
 *
 * Slots the suggestions do not name keep the ship's current piece — a partial loadout is a real
 * autogear result, not an error.
 */
export function applySuggestionsToShip(ship: Ship, suggestions: GearSuggestion[]): Ship {
    const equipment = { ...ship.equipment };
    const implants = { ...ship.implants };

    for (const suggestion of suggestions) {
        if (isImplantSlot(suggestion.slotName)) {
            implants[suggestion.slotName] = suggestion.gearId;
        } else {
            equipment[suggestion.slotName] = suggestion.gearId;
        }
    }

    return { ...ship, equipment, implants };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/candidateShip.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use it in the page, so there is one implementation**

In `src/pages/manager/AutogearPage.tsx`, delete the local `getSuggestedEquipment` and
`getSuggestedImplants` (lines ~100–119) and import the new helper. The two are called adjacently
on the same inputs at lines ~807–808, so replace both with ONE call destructured — calling
`applySuggestionsToShip` twice would redo the same work:

```ts
const { equipment: suggestedEquipment, implants: suggestedImplants } =
    applySuggestionsToShip(ship, newSuggestions);
```

Both old helpers returned `{}` for a null ship. `ship` is already non-null at that call site;
confirm that (read the enclosing scope) and keep the guard there rather than pushing
null-handling into the helper. If it turns out `ship` can be null there, guard before the call.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; suite green.

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/simRerank/candidateShip.ts \
        src/utils/autogear/simRerank/__tests__/candidateShip.test.ts \
        src/pages/manager/AutogearPage.tsx
git commit -m "refactor(autogear): extract applySuggestionsToShip

A candidate build must reach the sim as a Ship carrying the loadout, because
gear-set abilities are derived from ship.equipment. The page's two local
helpers become one shared function so there is a single implementation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 2: Gear-steal detection

**Files:**
- Create: `src/utils/autogear/simRerank/gearSteal.ts`
- Test: `src/utils/autogear/simRerank/__tests__/gearSteal.test.ts`

**Interfaces:**
- Consumes: `Ship`, `GearSuggestion`.
- Produces:
  ```ts
  export interface StolenPiece { gearId: string; fromShipId: string; fromShipName: string }
  export function stolenFromBoard(args: {
      suggestions: GearSuggestion[];
      focusShipId: string;
      boardShipIds: string[];
      getShipById: (id: string) => Ship | undefined;
      gearToShipMap: Map<string, string>;
  }): StolenPiece[]
  ```

**Why:** with the default `ignoreEquipped: false`, autogear draws from gear equipped on any unlocked ship (`AutogearPage.tsx:731`). A candidate wearing a board teammate's piece would be an impossible fight — one piece worn twice. Those candidates are excluded, and the exclusion is reported.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/gearSteal.test.ts
import { describe, it, expect } from 'vitest';
import { stolenFromBoard } from '../gearSteal';
import type { Ship } from '../../../../types/ship';
import type { GearSuggestion } from '../../../../types/autogear';

const ships: Record<string, Ship> = {
    focus: { id: 'focus', name: 'Focus' } as Ship,
    ally: { id: 'ally', name: 'Ally' } as Ship,
    bench: { id: 'bench', name: 'Bench' } as Ship,
};
const getShipById = (id: string) => ships[id];

const suggestion = (gearId: string): GearSuggestion => ({
    slotName: 'weapon' as GearSuggestion['slotName'],
    gearId,
    score: 1,
});

const args = (suggestions: GearSuggestion[], gearToShipMap: Map<string, string>) => ({
    suggestions,
    focusShipId: 'focus',
    boardShipIds: ['focus', 'ally'],
    getShipById,
    gearToShipMap,
});

describe('stolenFromBoard', () => {
    it('reports a piece taken from a ship on the board', () => {
        const result = stolenFromBoard(args([suggestion('g1')], new Map([['g1', 'ally']])));
        expect(result).toEqual([{ gearId: 'g1', fromShipId: 'ally', fromShipName: 'Ally' }]);
    });

    it('ignores a piece taken from a ship that is not on the board', () => {
        expect(stolenFromBoard(args([suggestion('g1')], new Map([['g1', 'bench']])))).toEqual([]);
    });

    it('ignores the focus ship wearing its own piece', () => {
        expect(stolenFromBoard(args([suggestion('g1')], new Map([['g1', 'focus']])))).toEqual([]);
    });

    it('ignores unequipped gear', () => {
        expect(stolenFromBoard(args([suggestion('g1')], new Map()))).toEqual([]);
    });

    it('reports each stolen piece once even when several come from one ally', () => {
        const result = stolenFromBoard(
            args(
                [suggestion('g1'), suggestion('g2')],
                new Map([
                    ['g1', 'ally'],
                    ['g2', 'ally'],
                ])
            )
        );
        expect(result.map((p) => p.gearId).sort()).toEqual(['g1', 'g2']);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/gearSteal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/gearSteal.ts
import type { Ship } from '../../../types/ship';
import type { GearSuggestion } from '../../../types/autogear';

export interface StolenPiece {
    gearId: string;
    fromShipId: string;
    fromShipName: string;
}

export interface StolenFromBoardArgs {
    suggestions: GearSuggestion[];
    focusShipId: string;
    /** Ship ids placed on the player side of the fight. */
    boardShipIds: string[];
    getShipById: (id: string) => Ship | undefined;
    /** gear id → the ship id wearing it. */
    gearToShipMap: Map<string, string>;
}

/**
 * The pieces a candidate loadout would take off a ship that is also in the fight.
 *
 * Autogear's pool includes gear worn by any unlocked ship unless `ignoreEquipped` is set, so a
 * candidate can name a piece a board ally is still wearing. Simulating that is simulating one
 * piece worn twice, which no fight can be; such candidates are excluded upstream and the pieces
 * named here are what the exclusion reports.
 */
export function stolenFromBoard(args: StolenFromBoardArgs): StolenPiece[] {
    const { suggestions, focusShipId, boardShipIds, getShipById, gearToShipMap } = args;
    const onBoard = new Set(boardShipIds);

    const stolen: StolenPiece[] = [];
    for (const suggestion of suggestions) {
        const ownerId = gearToShipMap.get(suggestion.gearId);
        if (!ownerId || ownerId === focusShipId || !onBoard.has(ownerId)) continue;
        stolen.push({
            gearId: suggestion.gearId,
            fromShipId: ownerId,
            fromShipName: getShipById(ownerId)?.name ?? ownerId,
        });
    }
    return stolen;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/gearSteal.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/simRerank/gearSteal.ts \
        src/utils/autogear/simRerank/__tests__/gearSteal.test.ts
git commit -m "feat(autogear): detect candidates that strip a board teammate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 3: The practice board

**Files:**
- Create: `src/utils/autogear/simRerank/practiceBoard.ts`
- Test: `src/utils/autogear/simRerank/__tests__/practiceBoard.test.ts`

**Interfaces:**
- Consumes: `Ship`, `Position` (`src/types/encounters.ts`), `BoardState` / `Placement` (`src/components/simulator/PlacementBoard.tsx`), the `DEFAULT_ENEMY_*` constants from `src/utils/calculators/healingDefaultEnemy.ts`.
- Produces: `practiceBoards(focus: Ship): { playerBoard: BoardState; enemyBoard: BoardState }`

**Shape (from the spec):** focus at `M4` plus two generic allies; three generic enemies. One
fixture for every role — the role chooses only the primary metric. A focus-alone board would make
the DEBUFFER primary ("team damage") identical to focus damage.

A generic combatant needs real skill text: `getShipSkillRows` filters empty-text rows, so a ship
with none resolves to zero abilities and every fight is a 0-damage draw.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/practiceBoard.test.ts
import { describe, it, expect } from 'vitest';
import { practiceBoards } from '../practiceBoard';
import { buildTeam } from '../../../simulator/buildTeam';
import { runSeedSet } from '../../../simulator/seededRuns';
import type { Ship } from '../../../../types/ship';

const focus = (): Ship =>
    ({
        id: 'focus',
        name: 'Focus',
        type: 'ATTACKER',
        baseStats: { attack: 5000, crit: 50, critDamage: 150, hp: 50000, defence: 3000, speed: 110 },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const deps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

describe('practiceBoards', () => {
    it('places the focus and gives it allies, so team damage is not focus damage', () => {
        const { playerBoard } = practiceBoards(focus());
        const placed = Object.values(playerBoard).filter(Boolean);
        expect(placed.length).toBeGreaterThan(1);
        expect(placed.some((p) => p!.ship.id === 'focus')).toBe(true);
    });

    it('produces a fight somebody actually loses, so outcomes are non-degenerate', () => {
        const { playerBoard, enemyBoard } = practiceBoards(focus());
        const aggregate = runSeedSet(
            {
                playerTeam: buildTeam(playerBoard, deps),
                enemyTeam: buildTeam(enemyBoard, deps),
                rounds: 30,
            },
            1,
            4
        );
        expect(aggregate.wins.draw).toBeLessThan(4);
    });

    it('gives every combatant skill text, or the engine has nothing to cast', () => {
        const { playerBoard, enemyBoard } = practiceBoards(focus());
        for (const board of [playerBoard, enemyBoard]) {
            for (const placement of Object.values(board)) {
                expect(placement!.ship.activeSkillText ?? '').not.toBe('');
            }
        }
    });

    it('deals damage in the fight, so the fixture is not silently inert', () => {
        const { playerBoard, enemyBoard } = practiceBoards(focus());
        const aggregate = runSeedSet(
            {
                playerTeam: buildTeam(playerBoard, deps),
                enemyTeam: buildTeam(enemyBoard, deps),
                rounds: 30,
            },
            1,
            2
        );
        const total = Object.values(aggregate.perActorMean).reduce(
            (sum, t) => sum + t.damageDealt,
            0
        );
        expect(total).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/practiceBoard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/practiceBoard.ts
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import {
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from '../../calculators/healingDefaultEnemy';

/** A generic combatant needs skill text: `getShipSkillRows` drops empty-text rows, so a ship
 *  without any resolves to zero abilities and every fight is a 0-damage draw. */
const SPARRING_SKILL = 'This Unit deals <unit-damage>120% damage</unit-damage>.';

const sparringPartner = (id: string, attack: number, speed: number): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: {
            attack,
            crit: 50,
            critDamage: 150,
            hacking: 200,
            security: DEFAULT_ENEMY_SECURITY,
            defence: DEFAULT_ENEMY_DEFENCE,
            hp: DEFAULT_ENEMY_HP,
            speed,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: SPARRING_SKILL,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const FOCUS_POSITION: Position = 'M4';
const ALLY_POSITIONS: Position[] = ['T2', 'B2'];
const ENEMY_POSITIONS: Position[] = ['M4', 'T2', 'B2'];

/**
 * The fight used when the player has picked no encounter or saved setup.
 *
 * One fixture for every role: the role selects the primary metric, not the board. The focus gets
 * allies because a focus-alone board would make a team-damage metric identical to focus damage.
 *
 * Enemy stats come from the healing calculator's practice-target constants so the two practice
 * opponents in this app cannot drift into different numbers.
 *
 * This is deliberately NOT a team-aware answer. The board carries no real ally kit and no real
 * opponent, and the UI says so where the source is chosen.
 */
export function practiceBoards(focus: Ship): {
    playerBoard: BoardState;
    enemyBoard: BoardState;
} {
    const playerBoard: BoardState = { [FOCUS_POSITION]: { ship: focus } };
    ALLY_POSITIONS.forEach((position, index) => {
        playerBoard[position] = { ship: sparringPartner(`practice-ally-${index}`, 4_200, 100 - index) };
    });

    const enemyBoard: BoardState = {};
    ENEMY_POSITIONS.forEach((position, index) => {
        enemyBoard[position] = {
            ship: sparringPartner(`practice-enemy-${index}`, 4_400, DEFAULT_ENEMY_SPEED + index),
        };
    });

    return { playerBoard, enemyBoard };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/practiceBoard.test.ts`
Expected: PASS, 4 tests. If the non-degenerate test fails because every fight is a draw at the
round cap, raise the sparring partners' attack until someone dies — do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/simRerank/practiceBoard.ts \
        src/utils/autogear/simRerank/__tests__/practiceBoard.test.ts
git commit -m "feat(autogear): add the practice board for candidate comparison

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 4: Fight sources

**Files:**
- Create: `src/utils/autogear/simRerank/fightSources.ts`
- Test: `src/utils/autogear/simRerank/__tests__/fightSources.test.ts`

**Interfaces:**
- Consumes: `practiceBoards` (Task 3), `deserializeSetup` and `SimulatorSetup` from `src/utils/simulator/simulatorSetup.ts`, `LocalEncounterNote` from `src/types/encounters.ts`, `SquadLeaderSelection` from `src/utils/combat/preFight.ts`.
- Produces:
  ```ts
  export interface FightBoards {
      playerBoard: BoardState;
      enemyBoard: BoardState;
      playerSquadLeader?: SquadLeaderSelection;
      enemySquadLeader?: SquadLeaderSelection;
      /** Ship ids on the player side — what `stolenFromBoard` needs. */
      boardShipIds: string[];
      /** The cell the focus ship fights from. A board cell is unique, so this is how the run
       *  adapter finds the focus in the roster. */
      focusPosition: Position;
      /** True when both sides are real. A practice or encounter fight is not. */
      realOpponent: boolean;
  }
  export type FightSource =
      | { kind: 'practice' }
      | { kind: 'encounter'; note: LocalEncounterNote }
      | { kind: 'setup'; setup: SimulatorSetup };
  export function resolveFight(
      source: FightSource,
      focus: Ship,
      resolveShip: (shipId: string) => Ship | null
  ): FightBoards
  ```

**Rules:** an encounter's `formation` is the *player's own* ships — it feeds the autogear gear
queue via `formationToShipIds` — so it supplies one side and takes the practice enemy. A setup
supplies both. In every source the focus ship must appear on the player board; a source that does
not contain it throws, and the caller only offers sources that do.

**Reject a board holding the focus twice.** `focusPosition` must name one cell. A setup with the
same ship in two positions would make "the focus's own numbers" ambiguous, so `resolveFight`
throws rather than picking one.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/fightSources.test.ts
import { describe, it, expect } from 'vitest';
import { resolveFight } from '../fightSources';
import type { Ship } from '../../../../types/ship';
import type { LocalEncounterNote } from '../../../../types/encounters';
import type { SimulatorSetup } from '../../../simulator/simulatorSetup';
import { SIMULATOR_SETUP_VERSION } from '../../../simulator/simulatorSetup';

const mkShip = (id: string): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: { attack: 4000, hp: 40000, defence: 3000, speed: 100 },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const focus = mkShip('focus');
const fleet: Record<string, Ship> = { focus, mate: mkShip('mate'), foe: mkShip('foe') };
const resolveShip = (id: string) => fleet[id] ?? null;

describe('resolveFight', () => {
    it('practice: places the focus and reports no real opponent', () => {
        const fight = resolveFight({ kind: 'practice' }, focus, resolveShip);
        expect(fight.boardShipIds).toContain('focus');
        expect(fight.realOpponent).toBe(false);
    });

    it('encounter: uses the real player formation and the practice enemy', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'My team',
            createdAt: 0,
            formation: [
                { shipId: 'focus', position: 'M4' },
                { shipId: 'mate', position: 'T2' },
            ],
        };
        const fight = resolveFight({ kind: 'encounter', note }, focus, resolveShip);
        expect(fight.boardShipIds.sort()).toEqual(['focus', 'mate']);
        expect(Object.keys(fight.enemyBoard).length).toBeGreaterThan(0);
        expect(fight.realOpponent).toBe(false);
    });

    it('setup: uses both stored boards and reports a real opponent', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'focus' }, T2: { shipId: 'mate' } },
            enemyBoard: { M4: { shipId: 'foe' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        const fight = resolveFight({ kind: 'setup', setup }, focus, resolveShip);
        expect(fight.boardShipIds.sort()).toEqual(['focus', 'mate']);
        expect(fight.enemyBoard.M4?.ship.id).toBe('foe');
        expect(fight.realOpponent).toBe(true);
    });

    it('names the one cell the focus fights from', () => {
        const fight = resolveFight({ kind: 'practice' }, focus, resolveShip);
        expect(fight.playerBoard[fight.focusPosition]?.ship.id).toBe('focus');
    });

    it('throws when the focus is not on the player side, rather than reporting an ally', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'Other team',
            createdAt: 0,
            formation: [{ shipId: 'mate', position: 'T2' }],
        };
        expect(() => resolveFight({ kind: 'encounter', note }, focus, resolveShip)).toThrow();
    });

    it('throws when a board holds the focus twice, rather than picking one', () => {
        const note: LocalEncounterNote = {
            id: 'e1',
            name: 'Doubled',
            createdAt: 0,
            formation: [
                { shipId: 'focus', position: 'M4' },
                { shipId: 'focus', position: 'T2' },
            ],
        };
        expect(() => resolveFight({ kind: 'encounter', note }, focus, resolveShip)).toThrow();
    });

    it('setup: substitutes the live focus ship, so a re-geared focus is the one that fights', () => {
        const setup: SimulatorSetup = {
            version: SIMULATOR_SETUP_VERSION,
            name: 'saved',
            playerBoard: { M4: { shipId: 'focus' } },
            enemyBoard: { M4: { shipId: 'foe' } },
            seed: 7,
            runCount: 20,
            savedAt: 0,
        };
        const regeared = { ...focus, equipment: { weapon: 'w1' } } as Ship;
        const fight = resolveFight({ kind: 'setup', setup }, regeared, resolveShip);
        expect(fight.playerBoard.M4?.ship.equipment.weapon).toBe('w1');
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/fightSources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/fightSources.ts
import type { Ship } from '../../../types/ship';
import type { LocalEncounterNote, Position } from '../../../types/encounters';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { SquadLeaderSelection } from '../../combat/preFight';
import { deserializeSetup, type SimulatorSetup } from '../../simulator/simulatorSetup';
import { practiceBoards } from './practiceBoard';

export interface FightBoards {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    /** Ship ids on the player side — the input `stolenFromBoard` needs. */
    boardShipIds: string[];
    /** Both sides are real ships the player chose. A practice or encounter fight is not. */
    realOpponent: boolean;
}

export type FightSource =
    | { kind: 'practice' }
    | { kind: 'encounter'; note: LocalEncounterNote }
    | { kind: 'setup'; setup: SimulatorSetup };

const shipIdsOf = (board: BoardState): string[] =>
    Object.values(board)
        .filter((placement): placement is NonNullable<typeof placement> => !!placement)
        .map((placement) => placement.ship.id);

/** The one cell the focus fights from. Throws on absent or doubled: both make "the focus's own
 *  numbers" a question with no single answer, and a guess there is undetectable downstream. */
const findFocusPosition = (board: BoardState, focusShipId: string): Position => {
    const cells = (Object.entries(board) as [Position, BoardState[Position]][]).filter(
        ([, placement]) => placement?.ship.id === focusShipId
    );
    if (cells.length === 0) throw new Error(`focus ship ${focusShipId} is not on the player board`);
    if (cells.length > 1) {
        throw new Error(`focus ship ${focusShipId} occupies ${cells.length} cells on one board`);
    }
    return cells[0][0];
};

/** The focus must fight as the ship the candidate built, not the copy the source stored. */
const substituteFocus = (board: BoardState, focus: Ship): BoardState => {
    const result: BoardState = {};
    for (const [position, placement] of Object.entries(board)) {
        if (!placement) continue;
        result[position as keyof BoardState] =
            placement.ship.id === focus.id ? { ...placement, ship: focus } : placement;
    }
    return result;
};

/**
 * Turn any fight source into the one shape the run adapter consumes.
 *
 * An encounter note's `formation` is the PLAYER's own ships — it is what feeds the autogear gear
 * queue through `formationToShipIds` — so it supplies one side and borrows the practice enemy. A
 * saved simulator setup supplies both sides plus its squad leaders.
 */
export function resolveFight(
    source: FightSource,
    focus: Ship,
    resolveShip: (shipId: string) => Ship | null
): FightBoards {
    if (source.kind === 'practice') {
        const { playerBoard, enemyBoard } = practiceBoards(focus);
        return {
            playerBoard,
            enemyBoard,
            boardShipIds: shipIdsOf(playerBoard),
            focusPosition: findFocusPosition(playerBoard, focus.id),
            realOpponent: false,
        };
    }

    if (source.kind === 'encounter') {
        const playerBoard: BoardState = {};
        for (const entry of source.note.formation) {
            const ship = entry.shipId === focus.id ? focus : resolveShip(entry.shipId);
            if (!ship) continue;
            playerBoard[entry.position] = { ship };
        }
        return {
            playerBoard,
            enemyBoard: practiceBoards(focus).enemyBoard,
            boardShipIds: shipIdsOf(playerBoard),
            focusPosition: findFocusPosition(playerBoard, focus.id),
            realOpponent: false,
        };
    }

    const deserialized = deserializeSetup(source.setup, resolveShip);
    const playerBoard = substituteFocus(deserialized.playerBoard, focus);
    return {
        playerBoard,
        enemyBoard: deserialized.enemyBoard,
        playerSquadLeader: deserialized.playerSquadLeader,
        enemySquadLeader: deserialized.enemySquadLeader,
        boardShipIds: shipIdsOf(playerBoard),
        focusPosition: findFocusPosition(playerBoard, focus.id),
        realOpponent: true,
    };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/fightSources.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/simRerank/fightSources.ts \
        src/utils/autogear/simRerank/__tests__/fightSources.test.ts
git commit -m "feat(autogear): resolve practice, encounter and saved-setup fights to one shape

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 5: The run adapter

**Files:**
- Create: `src/utils/autogear/simRerank/runCandidates.ts`
- Test: `src/utils/autogear/simRerank/__tests__/runCandidates.test.ts`

**Interfaces:**
- Consumes: `FightBoards` (Task 4), `buildTeam` + `CombatStatsDeps`, `runSeedSetAsync` / `SeedSetAggregate`.
- Produces:
  ```ts
  export interface CandidateRun {
      /** Identifies the row: which role produced this build, or 'equipped'. */
      id: string;
      aggregate: SeedSetAggregate;
      /** The engine actorId the focus ship fought under. */
      focusActorId: string;
  }
  export function focusActorId(aggregate: SeedSetAggregate, focusPosition: Position): string
  export async function runCandidate(args: {
      id: string;
      focus: Ship;
      fight: FightBoards;
      deps: CombatStatsDeps;
      seed: number;
      runCount: number;
      signal?: AbortSignal;
      onProgress?: (completed: number, total: number) => void;
  }): Promise<CandidateRun | null>
  ```

**Two rules the tests exist to pin:**
1. The focus is **not** reliably the focus id. `simulateBattle` names player index 0 `'attacker'`
   and every other player actor `p:<shipId>:<i>` (`battleSimulator.ts:1029-1031`), and index 0 is
   whichever ship sits earliest in `buildTeam`'s `POSITION_ORDER` — nothing to do with which ship
   is being geared. Resolve by **board position**: a cell is unique, `RosterEntry` carries
   `position`, and `FightBoards.focusPosition` already names the right one. Matching on ship id
   would have to special-case `'attacker'` and would still be ambiguous if a ship appeared twice.
2. Every candidate runs the **same** `seed` and `runCount`. `deltaStats` presents itself as paired;
   an unpaired comparison under that presentation is the failure it exists to prevent.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/runCandidates.test.ts
import { describe, it, expect } from 'vitest';
import { focusActorId, runCandidate } from '../runCandidates';
import { resolveFight } from '../fightSources';
import type { Ship } from '../../../../types/ship';
import type { SeedSetAggregate } from '../../../simulator/seededRuns';

const mkShip = (id: string, name: string): Ship =>
    ({
        id,
        name,
        type: 'ATTACKER',
        baseStats: { attack: 5000, crit: 50, critDamage: 150, hp: 50000, defence: 3000, speed: 110 },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const deps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

describe('focusActorId', () => {
    it('finds the focus when it is not player index 0', () => {
        // Index 0 is named 'attacker' and here it is the ALLY, because T2 precedes M4 in
        // buildTeam's POSITION_ORDER. Reading 'attacker' would report the ally's damage.
        const aggregate = {
            roster: [
                { actorId: 'attacker', side: 'player', name: 'Ally', position: 'T2' },
                { actorId: 'p:focus:1', side: 'player', name: 'Focus', position: 'M4' },
                { actorId: 'e:foe:0', side: 'enemy', name: 'Foe', position: 'M4' },
            ],
        } as unknown as SeedSetAggregate;
        expect(focusActorId(aggregate, 'M4')).toBe('p:focus:1');
    });

    it('finds the focus when it IS player index 0, where the id carries no ship id', () => {
        const aggregate = {
            roster: [
                { actorId: 'attacker', side: 'player', name: 'Focus', position: 'T1' },
                { actorId: 'p:ally:1', side: 'player', name: 'Ally', position: 'M2' },
            ],
        } as unknown as SeedSetAggregate;
        expect(focusActorId(aggregate, 'T1')).toBe('attacker');
    });

    it('never returns an enemy standing in the same cell', () => {
        const aggregate = {
            roster: [
                { actorId: 'attacker', side: 'player', name: 'Focus', position: 'M4' },
                { actorId: 'e:foe:0', side: 'enemy', name: 'Foe', position: 'M4' },
            ],
        } as unknown as SeedSetAggregate;
        expect(focusActorId(aggregate, 'M4')).toBe('attacker');
    });

    it('throws rather than guessing when no player holds that cell', () => {
        const aggregate = { roster: [] } as unknown as SeedSetAggregate;
        expect(() => focusActorId(aggregate, 'M4')).toThrow();
    });
});

describe('runCandidate', () => {
    it('reports the focus ship totals when the focus is not in the earliest position', async () => {
        const focus = mkShip('focus', 'Focus');
        const fight = resolveFight({ kind: 'practice' }, focus, () => null);
        const run = await runCandidate({
            id: 'equipped',
            fight,
            deps,
            seed: 5,
            runCount: 2,
        });
        expect(run).not.toBeNull();
        expect(run!.aggregate.perActorMean[run!.focusActorId].damageDealt).toBeGreaterThan(0);
    });

    it('runs the seed set it was given, so candidates can be paired', async () => {
        const focus = mkShip('focus', 'Focus');
        const fight = resolveFight({ kind: 'practice' }, focus, () => null);
        const run = await runCandidate({ id: 'a', fight, deps, seed: 11, runCount: 3 });
        expect(run!.aggregate.baseSeed).toBe(11);
        expect(run!.aggregate.count).toBe(3);
    });

    it('resolves null when aborted, never a partial aggregate', async () => {
        const focus = mkShip('focus', 'Focus');
        const fight = resolveFight({ kind: 'practice' }, focus, () => null);
        const controller = new AbortController();
        controller.abort();
        const run = await runCandidate({
            id: 'a',
            fight,
            deps,
            seed: 1,
            runCount: 5,
            signal: controller.signal,
        });
        expect(run).toBeNull();
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/runCandidates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/runCandidates.ts
import type { Position } from '../../../types/encounters';
import type { CombatStatsDeps } from '../../ship/combatStats';
import { buildTeam } from '../../simulator/buildTeam';
import { runSeedSetAsync, type SeedSetAggregate } from '../../simulator/seededRuns';
import type { FightBoards } from './fightSources';

export interface CandidateRun {
    id: string;
    aggregate: SeedSetAggregate;
    focusActorId: string;
}

/**
 * The engine actorId the focus ship fought under, found by the cell it occupies.
 *
 * Player index 0 is named `'attacker'` and carries no ship id; everyone else is `p:<shipId>:<i>`.
 * Index 0 is whichever ship sits earliest in `buildTeam`'s `POSITION_ORDER`, which has nothing to
 * do with which ship is being geared — so reading `'attacker'` reports an ally's damage as the
 * candidate's. A board cell is unique and the roster carries it, which makes position the only
 * identifier that works for both cases.
 *
 * Throws rather than falling back: a wrong actor here produces plausible numbers for the wrong
 * ship, which no reader could catch.
 */
export function focusActorId(aggregate: SeedSetAggregate, focusPosition: Position): string {
    const entry = aggregate.roster.find(
        (r) => r.side === 'player' && r.position === focusPosition
    );
    if (!entry) {
        throw new Error(`no player actor occupies ${focusPosition} in this fight`);
    }
    return entry.actorId;
}

export interface RunCandidateArgs {
    id: string;
    fight: FightBoards;
    deps: CombatStatsDeps;
    seed: number;
    runCount: number;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
}

/**
 * Run one candidate build over a seed set.
 *
 * `seed` and `runCount` are the CALLER's, identical for every candidate in a comparison — the
 * pairing rule `effectiveRunParams` enforces on the simulator page. Resolves null when aborted,
 * never a partial aggregate.
 */
export async function runCandidate(args: RunCandidateArgs): Promise<CandidateRun | null> {
    const { id, fight, deps, seed, runCount, signal, onProgress } = args;

    const aggregate = await runSeedSetAsync(
        {
            playerTeam: buildTeam(fight.playerBoard, deps),
            enemyTeam: buildTeam(fight.enemyBoard, deps),
            playerSquadLeader: fight.playerSquadLeader,
            enemySquadLeader: fight.enemySquadLeader,
        },
        seed,
        runCount,
        { getGearPiece: deps.getGearPiece, signal, onProgress }
    );
    if (!aggregate) return null;

    return { id, aggregate, focusActorId: focusActorId(aggregate, fight.focusPosition) };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/runCandidates.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/utils/autogear/simRerank/runCandidates.ts \
        src/utils/autogear/simRerank/__tests__/runCandidates.test.ts
git commit -m "feat(autogear): run a candidate build over a shared seed set

The focus ship resolves from the roster by ship id: player index 0 is decided
by board position, not by which ship is being geared, so reading FOCUS_ID
reports an ally's numbers as the candidate's.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 6: The metric table

**Files:**
- Create: `src/utils/autogear/simRerank/metricTable.ts`
- Test: `src/utils/autogear/simRerank/__tests__/metricTable.test.ts`

**Interfaces:**
- Consumes: `CandidateRun` (Task 5), `pairedDelta` / `PairedDelta` from `src/utils/simulator/deltaStats.ts`, `ShipTypeName` from `src/constants/shipTypes.ts`.
- Produces:
  ```ts
  export type SimMetric =
      | 'winRate' | 'rounds' | 'focusDamageDealt'
      | 'focusDamageTaken' | 'focusHealingDone' | 'teamDamageDealt';
  export const SIM_METRICS: readonly SimMetric[];
  export const METRIC_LABELS: Record<SimMetric, string>;
  /** Lower is better for this metric. */
  export const METRIC_LOWER_IS_BETTER: Partial<Record<SimMetric, true>>;
  export function metricSeries(run: CandidateRun, metric: SimMetric): number[];
  export function suggestedPrimary(role: ShipTypeName | undefined): SimMetric;
  export interface MetricCell extends PairedDelta { metric: SimMetric }
  export interface CandidateRow { id: string; cells: Record<SimMetric, MetricCell> }
  export function buildMetricTable(baseline: CandidateRun, candidates: CandidateRun[]): CandidateRow[];
  ```

**Rule:** `metricKind` is chosen by what the metric **is**, never by how a sample landed. Win rate
is `'binary'`; everything else is `'continuous'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/metricTable.test.ts
import { describe, it, expect } from 'vitest';
import {
    metricSeries,
    suggestedPrimary,
    buildMetricTable,
    SIM_METRICS,
} from '../metricTable';
import { pairedDelta } from '../../../simulator/deltaStats';
import type { CandidateRun } from '../runCandidates';

const run = (id: string, winners: Array<'player' | 'enemy'>, focusDamage: number[]): CandidateRun =>
    ({
        id,
        focusActorId: 'p:focus:1',
        aggregate: {
            baseSeed: 1,
            count: winners.length,
            roster: [],
            wins: { player: 0, enemy: 0, draw: 0 },
            meanRounds: 0,
            medianRounds: 0,
            perActorMean: {},
            runs: winners.map((winner, i) => ({
                seed: i,
                winner,
                lastRound: 10 + i,
                perActor: {
                    'p:focus:1': { damageDealt: focusDamage[i], damageTaken: 100, healingDone: 0 },
                    'p:ally:0': { damageDealt: 50, damageTaken: 100, healingDone: 0 },
                    'e:foe:0': { damageDealt: 999, damageTaken: 0, healingDone: 0 },
                },
            })),
        },
    }) as unknown as CandidateRun;

describe('metricSeries', () => {
    it('reads win rate as a per-seed 0/1 indicator', () => {
        expect(metricSeries(run('a', ['player', 'enemy', 'player'], [1, 2, 3]), 'winRate')).toEqual([
            1, 0, 1,
        ]);
    });

    it('reads focus damage from the focus actor only', () => {
        expect(
            metricSeries(run('a', ['player', 'player'], [10, 20]), 'focusDamageDealt')
        ).toEqual([10, 20]);
    });

    it('reads team damage as every player actor, focus included', () => {
        expect(metricSeries(run('a', ['player'], [10]), 'teamDamageDealt')).toEqual([60]);
    });
});

describe('suggestedPrimary', () => {
    it('maps each role family to its own metric', () => {
        expect(suggestedPrimary('ATTACKER')).toBe('focusDamageDealt');
        expect(suggestedPrimary('DEFENDER')).toBe('focusDamageTaken');
        expect(suggestedPrimary('DEFENDER_SECURITY')).toBe('focusDamageTaken');
        expect(suggestedPrimary('SUPPORTER')).toBe('focusHealingDone');
        expect(suggestedPrimary('SUPPORTER_SHIELD')).toBe('focusHealingDone');
        expect(suggestedPrimary('DEBUFFER')).toBe('teamDamageDealt');
        expect(suggestedPrimary('DEBUFFER_BOMBER')).toBe('teamDamageDealt');
    });

    it('falls back to team damage for an unknown role', () => {
        expect(suggestedPrimary(undefined)).toBe('teamDamageDealt');
    });
});

describe('buildMetricTable', () => {
    it('scores win rate with the sign test and the rest with the t rule', () => {
        const baseline = run('base', ['enemy', 'enemy', 'enemy', 'enemy'], [10, 10, 10, 10]);
        const candidate = run('cand', ['player', 'player', 'player', 'player'], [20, 21, 19, 20]);
        const [row] = buildMetricTable(baseline, [candidate]);

        expect(row.cells.winRate).toMatchObject(
            pairedDelta(
                metricSeries(baseline, 'winRate'),
                metricSeries(candidate, 'winRate'),
                'binary'
            )
        );
        expect(row.cells.focusDamageDealt).toMatchObject(
            pairedDelta(
                metricSeries(baseline, 'focusDamageDealt'),
                metricSeries(candidate, 'focusDamageDealt'),
                'continuous'
            )
        );
    });

    it('produces a cell for every metric', () => {
        const baseline = run('base', ['player', 'player'], [10, 10]);
        const [row] = buildMetricTable(baseline, [run('cand', ['player', 'player'], [11, 12])]);
        for (const metric of SIM_METRICS) expect(row.cells[metric]).toBeDefined();
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/metricTable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/metricTable.ts
import type { ShipTypeName } from '../../../constants/shipTypes';
import { pairedDelta, type PairedDelta } from '../../simulator/deltaStats';
import type { CandidateRun } from './runCandidates';

export type SimMetric =
    | 'winRate'
    | 'rounds'
    | 'focusDamageDealt'
    | 'focusDamageTaken'
    | 'focusHealingDone'
    | 'teamDamageDealt';

export const SIM_METRICS: readonly SimMetric[] = [
    'winRate',
    'rounds',
    'focusDamageDealt',
    'focusDamageTaken',
    'focusHealingDone',
    'teamDamageDealt',
];

export const METRIC_LABELS: Record<SimMetric, string> = {
    winRate: 'Win rate',
    rounds: 'Rounds',
    focusDamageDealt: 'Damage dealt',
    focusDamageTaken: 'Damage taken',
    focusHealingDone: 'Repairs done',
    teamDamageDealt: 'Team damage',
};

/** Metrics a candidate improves by making SMALLER. Everything else improves by growing. */
export const METRIC_LOWER_IS_BETTER: Partial<Record<SimMetric, true>> = {
    focusDamageTaken: true,
    rounds: true,
};

/** A metric's kind is a property of the METRIC, never of how one sample happened to land. A
 *  win/draw indicator puts most of its mass at zero, which the t rule badly misfits. */
const METRIC_KIND: Record<SimMetric, 'binary' | 'continuous'> = {
    winRate: 'binary',
    rounds: 'continuous',
    focusDamageDealt: 'continuous',
    focusDamageTaken: 'continuous',
    focusHealingDone: 'continuous',
    teamDamageDealt: 'continuous',
};

const isPlayerActor = (actorId: string): boolean => !actorId.startsWith('e:');

export function metricSeries(run: CandidateRun, metric: SimMetric): number[] {
    const { runs } = run.aggregate;
    switch (metric) {
        case 'winRate':
            return runs.map((r) => (r.winner === 'player' ? 1 : 0));
        case 'rounds':
            return runs.map((r) => r.lastRound);
        case 'focusDamageDealt':
            return runs.map((r) => r.perActor[run.focusActorId]?.damageDealt ?? 0);
        case 'focusDamageTaken':
            return runs.map((r) => r.perActor[run.focusActorId]?.damageTaken ?? 0);
        case 'focusHealingDone':
            return runs.map((r) => r.perActor[run.focusActorId]?.healingDone ?? 0);
        case 'teamDamageDealt':
            return runs.map((r) =>
                Object.entries(r.perActor)
                    .filter(([actorId]) => isPlayerActor(actorId))
                    .reduce((sum, [, totals]) => sum + totals.damageDealt, 0)
            );
    }
}

/**
 * The column a role's reader most likely wants sorted first. A suggestion, not a verdict: every
 * metric is shown for every role, because ranking a controller on any one of them is a confident
 * wrong answer.
 */
export function suggestedPrimary(role: ShipTypeName | undefined): SimMetric {
    if (!role) return 'teamDamageDealt';
    if (role === 'ATTACKER') return 'focusDamageDealt';
    if (role.startsWith('DEFENDER')) return 'focusDamageTaken';
    if (role.startsWith('SUPPORTER')) return 'focusHealingDone';
    return 'teamDamageDealt';
}

export interface MetricCell extends PairedDelta {
    metric: SimMetric;
}

export interface CandidateRow {
    id: string;
    cells: Record<SimMetric, MetricCell>;
}

export function buildMetricTable(
    baseline: CandidateRun,
    candidates: CandidateRun[]
): CandidateRow[] {
    return candidates.map((candidate) => {
        const cells = {} as Record<SimMetric, MetricCell>;
        for (const metric of SIM_METRICS) {
            cells[metric] = {
                metric,
                ...pairedDelta(
                    metricSeries(baseline, metric),
                    metricSeries(candidate, metric),
                    METRIC_KIND[metric]
                ),
            };
        }
        return { id: candidate.id, cells };
    });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/metricTable.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/simRerank/metricTable.ts \
        src/utils/autogear/simRerank/__tests__/metricTable.test.ts
git commit -m "feat(autogear): build the paired-delta metric table for candidates

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 7: Expose the GA's runner-up pool

**Files:**
- Modify: `src/utils/autogear/AutogearStrategy.ts` (the `AutogearResult` interface)
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`
- Test: `src/utils/autogear/strategies/__tests__/GeneticStrategy.candidates.test.ts`

**Interfaces:**
- Produces: `AutogearResult.candidates?: GearSuggestion[][]` — distinct runner-up loadouts,
  best-first, excluding the returned best. Populated only by `GeneticStrategy`; absent means the
  strategy exposes no ranked pool.

**Rules:** `violation === 0` only; deduped by equipment ID-set; drawn from the final population of
the attempt that produced the returned best (Genetic runs up to 5 attempts and only that
attempt's population is commensurate with the result).

- [ ] **Step 1: Add the optional field**

In `src/utils/autogear/AutogearStrategy.ts`, extend `AutogearResult`:

```ts
export interface AutogearResult {
    suggestions: GearSuggestion[];
    hardRequirementsMet: boolean;
    /** Only populated when hardRequirementsMet === false. */
    violations?: HardRequirementViolation[];
    /** 1..5 — how many GA passes were run. 1 for strategies without reruns. */
    attempts: number;
    /** Distinct runner-up loadouts, best-first, excluding `suggestions`. Absent means the
     *  strategy exposes no ranked pool — only Genetic keeps one. */
    candidates?: GearSuggestion[][];
}
```

Optional, so `TwoPassStrategy`, `SetFirstStrategy` and every existing caller compile unchanged.

- [ ] **Step 2: Write the failing test**

```ts
// src/utils/autogear/strategies/__tests__/GeneticStrategy.candidates.test.ts
import { describe, it, expect } from 'vitest';
import { dedupeCandidates } from '../GeneticStrategy';
import type { GearSuggestion } from '../../../../types/autogear';

const loadout = (ids: string[]): GearSuggestion[] =>
    ids.map((gearId, i) => ({
        slotName: `slot${i}` as GearSuggestion['slotName'],
        gearId,
        score: 1,
    }));

describe('dedupeCandidates', () => {
    it('collapses loadouts wearing the same pieces, whatever the slot order', () => {
        const result = dedupeCandidates([loadout(['a', 'b']), loadout(['b', 'a'])]);
        expect(result).toHaveLength(1);
    });

    it('keeps loadouts that differ by a single piece', () => {
        expect(dedupeCandidates([loadout(['a', 'b']), loadout(['a', 'c'])])).toHaveLength(2);
    });

    it('preserves best-first order', () => {
        const result = dedupeCandidates([loadout(['a']), loadout(['b']), loadout(['a'])]);
        expect(result.map((l) => l[0].gearId)).toEqual(['a', 'b']);
    });

    it('excludes a loadout matching the one to skip', () => {
        const result = dedupeCandidates([loadout(['a']), loadout(['b'])], loadout(['a']));
        expect(result.map((l) => l[0].gearId)).toEqual(['b']);
    });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/strategies/__tests__/GeneticStrategy.candidates.test.ts`
Expected: FAIL — `dedupeCandidates` is not exported.

- [ ] **Step 4: Implement `dedupeCandidates` in `GeneticStrategy.ts`**

```ts
/** A loadout's identity is the SET of pieces it wears — two individuals that reached the same
 *  gear by different slot order are one candidate, and a converged population holds many. */
const loadoutKey = (loadout: GearSuggestion[]): string =>
    loadout
        .map((s) => s.gearId)
        .sort()
        .join('|');

export function dedupeCandidates(
    loadouts: GearSuggestion[][],
    skip?: GearSuggestion[]
): GearSuggestion[][] {
    const seen = new Set<string>();
    if (skip) seen.add(loadoutKey(skip));

    const result: GearSuggestion[][] = [];
    for (const loadout of loadouts) {
        const key = loadoutKey(loadout);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(loadout);
    }
    return result;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/strategies/__tests__/GeneticStrategy.candidates.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Populate `candidates` on the result**

In `GeneticStrategy.findOptimalGear`, the run that produces the returned best already has its
final sorted `population` in scope. Convert its `violation === 0` members to `GearSuggestion[]`
using the **existing** best-individual conversion (do not write a second converter — find the
function that turns an `Individual`'s `equipment` into suggestions and call it per individual),
then:

```ts
const candidates = dedupeCandidates(
    population.filter((individual) => individual.violation === 0).map(toSuggestions),
    bestSuggestions
).slice(0, MAX_EXPOSED_CANDIDATES);
```

with, at module scope:

```ts
/** How many runner-ups leave the strategy. A converged population holds thousands of near-copies;
 *  past a handful of DISTINCT loadouts the extra rows cost a sim run each and say nothing new. */
const MAX_EXPOSED_CANDIDATES = 8;
```

Return `{ ...existingResult, candidates }`.

- [ ] **Step 7: Add the integration assertion**

Append to the same test file:

```ts
import { GeneticStrategy } from '../GeneticStrategy';
import { clearScoreCache } from '../../scoring';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { StatPriority } from '../../../../types/autogear';
import type { BaseStats, EngineeringStat } from '../../../../types/stats';
import type { ShipTypeName } from '../../../../constants/shipTypes';

// Fixture shape copied from GeneticStrategy.test.ts, which already knows what a runnable
// inventory looks like.
const BASE: BaseStats = {
    hp: 100000,
    attack: 5000,
    defence: 4000,
    speed: 100,
    hacking: 0,
    security: 0,
    crit: 30,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

const makeGear = (id: string, slot: string, stat: keyof BaseStats, amount: number): GearPiece => ({
    id,
    slot,
    level: 16,
    stars: 6,
    rarity: 'legendary',
    setBonus: null,
    mainStat: { name: stat, value: amount, type: 'flat' } as GearPiece['mainStat'],
    subStats: [],
});

const makeShip = (): Ship => ({
    id: 'ship1',
    name: 'Test Ship',
    type: 'ATTACKER',
    rarity: 'legendary',
    faction: 'TERRAN',
    level: 60,
    rank: 5,
    baseStats: { ...BASE },
    equipment: {},
    implants: {},
    refits: [],
});

const key = (loadout: { gearId: string }[]) =>
    loadout
        .map((s) => s.gearId)
        .sort()
        .join('|');

describe('GeneticStrategy candidates field', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('exposes runner-ups, none of them equal to the returned best', async () => {
        const strategy = new GeneticStrategy();
        // Several same-slot pieces, so the population holds genuinely distinct loadouts to
        // expose. With one piece per slot there is only one possible build and `candidates`
        // is legitimately empty — which would make this test vacuous.
        const inventory = [
            makeGear('w1', 'weapon', 'attack', 1000),
            makeGear('w2', 'weapon', 'attack', 900),
            makeGear('w3', 'weapon', 'attack', 800),
            makeGear('h1', 'hull', 'hp', 10000),
            makeGear('h2', 'hull', 'hp', 9000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;
        const priorities: StatPriority[] = [{ stat: 'attack', weight: 1 }];

        const result = await strategy.findOptimalGear(
            makeShip(),
            priorities,
            inventory,
            getGearPiece,
            getEng
        );

        expect(result.candidates).toBeDefined();
        expect(result.candidates!.length).toBeGreaterThan(0);

        const best = key(result.suggestions);
        for (const candidate of result.candidates!) {
            expect(key(candidate)).not.toBe(best);
        }
    });

    it('exposes each distinct loadout once', async () => {
        const strategy = new GeneticStrategy();
        const inventory = [
            makeGear('w1', 'weapon', 'attack', 1000),
            makeGear('w2', 'weapon', 'attack', 900),
            makeGear('h1', 'hull', 'hp', 10000),
            makeGear('h2', 'hull', 'hp', 9000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const result = await strategy.findOptimalGear(
            makeShip(),
            [{ stat: 'attack', weight: 1 }],
            inventory,
            getGearPiece,
            getEng
        );

        const keys = result.candidates!.map(key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
```

- [ ] **Step 8: Run the full suite and commit**

Run: `npx tsc --noEmit && npm test`
Expected: green. Any existing test asserting exact `AutogearResult` equality will now see a new
key — update those assertions to `toMatchObject` rather than deleting the field.

```bash
git add src/utils/autogear/AutogearStrategy.ts \
        src/utils/autogear/strategies/GeneticStrategy.ts \
        src/utils/autogear/strategies/__tests__/GeneticStrategy.candidates.test.ts
git commit -m "feat(autogear): expose the genetic strategy's distinct runner-up loadouts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 8: The compared-role set

**Files:**
- Create: `src/utils/autogear/simRerank/comparedRoles.ts`
- Test: `src/utils/autogear/simRerank/__tests__/comparedRoles.test.ts`

**Interfaces:**
- Produces: `defaultComparedRoles(ownRole: ShipTypeName | undefined): ShipTypeName[]`

**Why picked for the user:** asking them to name an extra role asks them to already know the
answer. The measured evidence (spec) shows every `DEBUFFER*` seed leads with `core('hacking')`, so
none of them reaches Xcellence's other basin — only `DEFENDER` does.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/autogear/simRerank/__tests__/comparedRoles.test.ts
import { describe, it, expect } from 'vitest';
import { defaultComparedRoles } from '../comparedRoles';

describe('defaultComparedRoles', () => {
    it('covers every structurally different objective', () => {
        expect(defaultComparedRoles('ATTACKER').sort()).toEqual(
            ['DEBUFFER', 'DEFENDER', 'SUPPORTER'].sort()
        );
    });

    it('never repeats the ship\'s own role', () => {
        expect(defaultComparedRoles('DEFENDER')).not.toContain('DEFENDER');
    });

    it('treats a role variant as covering its family', () => {
        expect(defaultComparedRoles('DEBUFFER_BOMBER')).not.toContain('DEBUFFER');
    });

    it('offers a defender build to a debuffer, which is the case that motivated this', () => {
        expect(defaultComparedRoles('DEBUFFER')).toContain('DEFENDER');
    });

    it('returns every family when the role is unknown', () => {
        expect(defaultComparedRoles(undefined)).toHaveLength(4);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/comparedRoles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/autogear/simRerank/comparedRoles.ts
import type { ShipTypeName } from '../../../constants/shipTypes';

/** One representative per structurally different objective: damage, survival, control, repair.
 *  Comparing variants within a family is near-pointless — they share the leading term, so they
 *  land in the same basin. */
const FAMILY_REPRESENTATIVES: ShipTypeName[] = [
    'ATTACKER',
    'DEFENDER',
    'DEBUFFER',
    'SUPPORTER',
];

const familyOf = (role: ShipTypeName): string => role.split('_')[0];

/**
 * The roles a ship's builds are compared against by default.
 *
 * Chosen for the user, not asked of them: a player who knew which other role to try would not
 * need this tool. Excludes the family the ship is already in, because a candidate geared under a
 * formula sharing the ship's own leading term explores the same basin.
 */
export function defaultComparedRoles(ownRole: ShipTypeName | undefined): ShipTypeName[] {
    if (!ownRole) return [...FAMILY_REPRESENTATIVES];
    const own = familyOf(ownRole);
    return FAMILY_REPRESENTATIVES.filter((role) => familyOf(role) !== own);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/comparedRoles.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/simRerank/comparedRoles.ts \
        src/utils/autogear/simRerank/__tests__/comparedRoles.test.ts
git commit -m "feat(autogear): pick the compared role set for the user

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 9: The Xcellence end-to-end regression

**Files:**
- Create: `src/utils/autogear/simRerank/__tests__/xcellenceCliff.integration.test.ts`

**Why this test exists:** it is the one test that proves the whole feature works. The design spike
drove `statOverrides` directly and never exercised the candidate → `ship.equipment` →
`combatStatsFromShip` → engine path; this does. It fails if the adapter ever starts baking stats,
and it fails if the practice board goes inert.

**Do not** use `statOverrides` anywhere in this test. Every stat difference must arrive through
gear pieces resolved by `getGearPiece`.

- [ ] **Step 1: Write the test**

```ts
// src/utils/autogear/simRerank/__tests__/xcellenceCliff.integration.test.ts
import { describe, it, expect } from 'vitest';
import { applySuggestionsToShip } from '../candidateShip';
import { resolveFight } from '../fightSources';
import { runCandidate } from '../runCandidates';
import { metricSeries } from '../metricTable';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { GearSuggestion } from '../../../../types/autogear';

// Verbatim from docs/ship-skills.csv. The R2 passive carries the on-resist channel, so the ship
// needs two refits for `getShipSkillRows` to select it.
const XCELLENCE_ACTIVE =
    'This Unit Deals <unit-damage>150% damage</unit-damage> and Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns and Stasis for 2 turn.';
const XCELLENCE_CHARGE =
    'This Unit deals <unit-damage>280% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.';
const XCELLENCE_R2 =
    "This Unit has 20% Shield Penetration.<br /><br />At the start of each turn this Unit gains <unit-damage>Shield equal to 20%</unit-damage> of its Max HP.<br /><br />When an enemy resists a debuff infliction, this Unit deals damage equal to <unit-damage>115%</unit-damage> of this Unit's current shield..";

const xcellence = (): Ship =>
    ({
        id: 'xcellence',
        name: 'Xcellence',
        type: 'DEBUFFER',
        baseStats: {
            attack: 5_000,
            crit: 50,
            critDamage: 150,
            hacking: 140,
            security: 100,
            defence: 3_000,
            hp: 42_000,
            speed: 110,
        },
        equipment: {},
        implants: {},
        refits: [{}, {}],
        activeSkillText: XCELLENCE_ACTIVE,
        chargeSkillText: XCELLENCE_CHARGE,
        chargeSkillCharge: 3,
        secondPassiveSkillText: XCELLENCE_R2,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargeTarget: 'front',
        chargePattern: 'Pattern-Base',
    }) as unknown as Ship;

// Two real pieces. The whole build difference must travel through these, never through
// statOverrides — that is what makes this a test of the adapter.
const HACKING_PIECE: GearPiece = {
    id: 'hacking-piece',
    slot: 'weapon',
    mainStat: { name: 'hacking', value: 400, type: 'flat' },
    subStats: [],
    stars: 6,
    level: 16,
    rarity: 'legendary',
    setBonus: 'CRITICAL',
} as unknown as GearPiece;

const HP_PIECE: GearPiece = {
    id: 'hp-piece',
    slot: 'weapon',
    mainStat: { name: 'hp', value: 40_000, type: 'flat' },
    subStats: [],
    stars: 6,
    level: 16,
    rarity: 'legendary',
    setBonus: 'CRITICAL',
} as unknown as GearPiece;

const pieces: Record<string, GearPiece> = {
    'hacking-piece': HACKING_PIECE,
    'hp-piece': HP_PIECE,
};

const deps = {
    getGearPiece: (id: string) => pieces[id],
    getEngineeringStatsForShipType: () => undefined,
};

const suggestion = (gearId: string): GearSuggestion[] => [
    { slotName: 'weapon' as GearSuggestion['slotName'], gearId, score: 1 },
];

describe('Xcellence cliff, end to end through gear', () => {
    it('a high-hacking build and a high-HP build separate on focus damage', async () => {
        const controller = applySuggestionsToShip(xcellence(), suggestion('hacking-piece'));
        const bruiser = applySuggestionsToShip(xcellence(), suggestion('hp-piece'));

        const runs = await Promise.all(
            [controller, bruiser].map((ship) =>
                runCandidate({
                    id: ship.equipment.weapon!,
                    fight: resolveFight({ kind: 'practice' }, ship, () => null),
                    deps,
                    seed: 1234,
                    runCount: 12,
                })
            )
        );

        const damage = runs.map((run) => {
            const series = metricSeries(run!, 'focusDamageDealt');
            return series.reduce((a, b) => a + b, 0) / series.length;
        });

        // Non-vacuity first: a fixture where nobody deals damage would pass a bare
        // "not equal" assertion.
        expect(damage[0]).toBeGreaterThan(0);
        expect(damage[1]).toBeGreaterThan(0);

        // The finding: the HP build out-damages the hacking build, because below the hacking
        // cliff enemies resist and the R2 passive converts the shield pool into damage.
        expect(damage[1]).toBeGreaterThan(damage[0]);
    });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/utils/autogear/simRerank/__tests__/xcellenceCliff.integration.test.ts`
Expected: PASS.

If the two builds come out **equal**, the adapter is not delivering gear to the engine — that is
the bug this test exists to catch, so debug the adapter rather than adjusting the numbers. If they
differ in the *other* direction, check that the base `hacking` of 140 plus the hacking piece
actually crosses the cliff (the spike put the transition between 140 and 220); adjust the piece's
magnitude, never the assertion's direction.

- [ ] **Step 3: Commit**

```bash
git add src/utils/autogear/simRerank/__tests__/xcellenceCliff.integration.test.ts
git commit -m "test(autogear): pin the Xcellence cliff end to end through real gear

The design spike drove statOverrides and never exercised the candidate ->
ship.equipment -> combatStatsFromShip path. This does, and fails if the
adapter ever starts baking stats.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 10: Orchestration hook

**Files:**
- Create: `src/hooks/useSimRerank.ts`
- Test: `src/hooks/__tests__/useSimRerank.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces:
  ```ts
  export interface SimRerankRow { id: string; label: string; sourceRole?: ShipTypeName; run: CandidateRun }
  export interface ExcludedCandidate { label: string; stripped: StolenPiece[] }
  export interface SimRerankState {
      status: 'idle' | 'gearing' | 'simulating' | 'done' | 'cancelled';
      progress: { completed: number; total: number };
      baseline?: CandidateRun;
      rows: SimRerankRow[];
      table: CandidateRow[];
      excluded: ExcludedCandidate[];
      /** True when autogear's own best was excluded — stated, not buried in a count. */
      ownBestExcluded: boolean;
      error?: string;
  }
  export interface SimRerankRunArgs {
      focus: Ship;
      source: FightSource;
      comparedRoles: ShipTypeName[];
      seed: number;
      runCount: number;
      deps: CombatStatsDeps;
      getShipById: (id: string) => Ship | undefined;
      gearToShipMap: Map<string, string>;
      resolveShip: (shipId: string) => Ship | null;
      /** Runs the configured autogear strategy under one role. INJECTED, not imported: the
       *  optimizer is CPU-bound and main-thread, and the page already owns every input it needs
       *  (inventory, priorities, settings). Passing it keeps this hook testable without one. */
      runAutogearFor: (role: ShipTypeName) => Promise<AutogearResult>;
  }
  export function useSimRerank(): {
      state: SimRerankState;
      run: (args: SimRerankRunArgs) => Promise<void>;
      cancel: () => void;
      reset: () => void;
  }
  ```

**Sequence:** for each compared role (the ship's own first, then `defaultComparedRoles`), run the
configured autogear strategy → take `suggestions` and `candidates` → build ships → drop any whose
`stolenFromBoard` is non-empty → run each through `runCandidate` with the *same* seed and count →
`buildMetricTable` against the equipped baseline.

The optimizer runs dominate the wall clock; report progress across the whole job and make
`cancel()` abort both phases (the same `AbortController` feeds `runSeedSetAsync`; for the
optimizer phase, check `signal.aborted` between roles).

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/__tests__/useSimRerank.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSimRerank } from '../useSimRerank';
import type { Ship } from '../../types/ship';
import type { GearSuggestion } from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';

const mkShip = (id: string, name: string, type: ShipTypeName = 'DEBUFFER'): Ship =>
    ({
        id,
        name,
        type,
        baseStats: {
            attack: 5000,
            crit: 50,
            critDamage: 150,
            hacking: 200,
            security: 100,
            defence: 3000,
            hp: 50000,
            speed: 110,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>150% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const focus = mkShip('focus', 'Focus');
const ally = mkShip('ally', 'Ally', 'ATTACKER');

const suggestion = (gearId: string): GearSuggestion[] => [
    { slotName: 'weapon' as GearSuggestion['slotName'], gearId, score: 1 },
];

// One deterministic loadout per role, so a row can be traced back to the role that produced it
// without running the real optimizer (which is CPU-bound and not under test here).
const runAutogearFor = vi.fn(async (role: ShipTypeName) => ({
    suggestions: suggestion(`gear-${role}`),
    hardRequirementsMet: true,
    attempts: 1,
    candidates: [],
}));

const baseArgs = () => ({
    focus,
    source: { kind: 'practice' as const },
    comparedRoles: ['DEFENDER'] as ShipTypeName[],
    seed: 1234,
    runCount: 2,
    deps: {
        getGearPiece: () => undefined,
        getEngineeringStatsForShipType: () => undefined,
    },
    getShipById: (id: string) => ({ focus, ally })[id as 'focus' | 'ally'],
    gearToShipMap: new Map<string, string>(),
    resolveShip: () => null,
    runAutogearFor,
});

describe('useSimRerank', () => {
    it('starts idle with no rows', () => {
        const { result } = renderHook(() => useSimRerank());
        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.rows).toEqual([]);
    });

    it('labels each row with the role that produced it', async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run(baseArgs());
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));
        expect(result.current.state.rows.map((r) => r.sourceRole)).toContain('DEFENDER');
    });

    it('runs every candidate on the same seed set, so the deltas are paired', async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run(baseArgs());
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        const seeds = new Set(result.current.state.rows.map((r) => r.run.aggregate.baseSeed));
        const counts = new Set(result.current.state.rows.map((r) => r.run.aggregate.count));
        expect(result.current.state.rows.length).toBeGreaterThan(1);
        expect(seeds).toEqual(new Set([1234]));
        expect(counts).toEqual(new Set([2]));
    });

    it('excludes a candidate that strips a board ally, and names what it took', async () => {
        const { result } = renderHook(() => useSimRerank());
        await act(async () => {
            await result.current.run({
                ...baseArgs(),
                // The encounter puts the ally on the board; the DEFENDER candidate wears
                // a piece the ally is still wearing.
                source: {
                    kind: 'encounter' as const,
                    note: {
                        id: 'e1',
                        name: 'Team',
                        createdAt: 0,
                        formation: [
                            { shipId: 'focus', position: 'M4' as const },
                            { shipId: 'ally', position: 'T2' as const },
                        ],
                    },
                },
                resolveShip: (id: string) => ({ focus, ally })[id as 'focus' | 'ally'] ?? null,
                gearToShipMap: new Map([['gear-DEFENDER', 'ally']]),
            });
        });
        await waitFor(() => expect(result.current.state.status).toBe('done'));

        expect(result.current.state.excluded).toHaveLength(1);
        expect(result.current.state.excluded[0].stripped[0].fromShipName).toBe('Ally');
        expect(result.current.state.rows.map((r) => r.sourceRole)).not.toContain('DEFENDER');
    });

    it('leaves no partial table when cancelled', async () => {
        const { result } = renderHook(() => useSimRerank());
        act(() => {
            void result.current.run({ ...baseArgs(), runCount: 200 });
        });
        act(() => result.current.cancel());
        await waitFor(() => expect(result.current.state.status).toBe('cancelled'));
        expect(result.current.state.table).toEqual([]);
    });
});
```

`runAutogearFor` is injected rather than imported so the test never runs the real optimizer — it
is CPU-bound, main-thread, and not what these assertions are about. The hook takes it as an
argument for exactly that reason; production passes the page's existing strategy runner.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/hooks/__tests__/useSimRerank.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Structure it so the pure sequencing is a plain exported function the hook calls, and the hook owns
only React state and the `AbortController`. That keeps the interesting logic testable without a
renderer:

```ts
export async function collectCandidateRuns(args: CollectArgs): Promise<CollectResult>
```

The hook's `run()` becomes: create the controller, set status, `await collectCandidateRuns(...)`,
set the result.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/hooks/__tests__/useSimRerank.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npx tsc --noEmit && npm test
git add src/hooks/useSimRerank.ts src/hooks/__tests__/useSimRerank.test.ts
git commit -m "feat(autogear): orchestrate the candidate comparison run

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 11: UI

**Files:**
- Create: `src/components/autogear/SimRerankSection.tsx`
- Create: `src/components/autogear/SimRerankTable.tsx`
- Create: `src/components/autogear/__tests__/SimRerankSection.test.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx` (mount the section under Strategy)

**Interfaces:**
- Consumes: `useSimRerank` (Task 10), `METRIC_LABELS` / `SIM_METRICS` / `suggestedPrimary` /
  `METRIC_LOWER_IS_BETTER` (Task 6), `defaultComparedRoles` (Task 8).

**Layout:** a collapsed **Simulate candidates** section, off by default.
1. Fight-source `Select` — "Practice fight" plus every encounter and saved setup whose player side
   contains this ship. A practice or encounter fight shows a plain-text note that it is not a
   team-aware answer (`realOpponent === false`).
2. Compared roles — pre-filled from `defaultComparedRoles`, editable via `Checkbox`es.
3. An **Advanced** disclosure holding seed and run count. Defaults: run count 20, seed page-picked.
4. `Button` to run; while running, progress plus a Cancel `Button`.
5. `SimRerankTable`.

**Table:** one row per candidate, columns from `SIM_METRICS`. The suggested primary is marked and
sorted on; clicking another header re-sorts **without re-simulating**. A cell whose
`distinguishable` is false renders as "no clear difference" rather than a number the reader will
over-trust. Each row names its source role and carries an Apply `Button`. Above the table, when
`ownBestExcluded`, a plain-text line saying autogear's own pick was not evaluated and why.

**Component rules:** `Button`, `Select`, `Checkbox`, `Input` from `src/components/ui/`; the `card`
class for the section box; `ui/tables/` primitives for the table. No raw `<button>` except the
collapsible header (an allowed exception). No emojis.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/autogear/__tests__/SimRerankSection.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { SimRerankSection } from '../SimRerankSection';
import type { Ship } from '../../../types/ship';
import type { SimRerankState } from '../../../hooks/useSimRerank';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports '/favicon.ico?url' —
// unresolvable under Vitest. Same workaround as the other component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const hookState = vi.hoisted(() => ({
    current: {
        status: 'idle',
        progress: { completed: 0, total: 0 },
        rows: [],
        table: [],
        excluded: [],
        ownBestExcluded: false,
    } as SimRerankState,
}));
const run = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useSimRerank', () => ({
    useSimRerank: () => ({
        state: hookState.current,
        run,
        cancel: vi.fn(),
        reset: vi.fn(),
    }),
}));

const ship = {
    id: 'focus',
    name: 'Focus',
    type: 'DEBUFFER',
    equipment: {},
} as unknown as Ship;

const props = () => ({
    ship,
    encounters: [],
    savedSetups: [],
    deps: { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined },
    getShipById: () => undefined,
    gearToShipMap: new Map<string, string>(),
    resolveShip: () => null,
    runAutogearFor: vi.fn(),
});

const open = () => fireEvent.click(screen.getByText(/simulate candidates/i));

describe('SimRerankSection', () => {
    it('is collapsed until opened', () => {
        render(<SimRerankSection {...props()} />);
        expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    });

    it('says a practice fight is not a team-aware answer', () => {
        render(<SimRerankSection {...props()} />);
        open();
        expect(screen.getByText(/not a real team/i)).toBeInTheDocument();
    });

    it("pre-fills compared roles without the ship's own family", () => {
        render(<SimRerankSection {...props()} />);
        open();
        expect(screen.getByLabelText('Defender')).toBeChecked();
        expect(screen.queryByLabelText('Debuffer')).not.toBeInTheDocument();
    });

    it('keeps seed and run count behind the advanced disclosure', () => {
        render(<SimRerankSection {...props()} />);
        open();
        expect(screen.queryByLabelText(/seed/i)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText(/advanced/i));
        expect(screen.getByLabelText(/seed/i)).toBeInTheDocument();
    });

    // The last two cases both need a rendered table, so the fixture is shared here rather than
    // left as state the fifth test mutates for the sixth — an order-dependent fixture passes or
    // fails on test ordering, which is not what either case is about.
    const withTable = () => {
        hookState.current = {
            ...hookState.current,
            status: 'done',
            rows: [
                {
                    id: 'DEFENDER',
                    label: 'Defender build',
                    sourceRole: 'DEFENDER',
                    run: { id: 'DEFENDER', focusActorId: 'attacker', aggregate: {} },
                },
            ],
            table: [
                {
                    id: 'DEFENDER',
                    cells: {
                        winRate: { metric: 'winRate', mean: 0.2, se: 0.05, n: 20, distinguishable: true },
                        rounds: { metric: 'rounds', mean: -2, se: 0.4, n: 20, distinguishable: true },
                        focusDamageDealt: { metric: 'focusDamageDealt', mean: 1200, se: 200, n: 20, distinguishable: true },
                        focusDamageTaken: { metric: 'focusDamageTaken', mean: 0, se: 0, n: 20, distinguishable: false },
                        focusHealingDone: { metric: 'focusHealingDone', mean: 0, se: 0, n: 20, distinguishable: false },
                        teamDamageDealt: { metric: 'teamDamageDealt', mean: 800, se: 150, n: 20, distinguishable: true },
                    },
                },
            ],
        } as unknown as SimRerankState;
    };

    it('re-sorts on a header click without running the sim again', () => {
        withTable();
        render(<SimRerankSection {...props()} />);
        open();
        run.mockClear();
        fireEvent.click(screen.getByText('Damage taken'));
        expect(run).not.toHaveBeenCalled();
    });

    it('says a cell is not distinguishable rather than showing a delta', () => {
        withTable();
        render(<SimRerankSection {...props()} />);
        open();
        // focusDamageTaken and focusHealingDone both carry distinguishable: false.
        expect(screen.getAllByText(/no clear difference/i).length).toBe(2);
    });
});
```

The `vi.hoisted` state object is how the other component tests in this project drive a mocked
hook — call `withTable()` before `render` to put the component in the state under test.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/autogear/__tests__/SimRerankSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both components and mount the section**

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/autogear/__tests__/SimRerankSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: See it in the real app**

Run: `npm start` (port 3000). Open Autogear, pick a ship, expand Strategy → Simulate candidates,
run it. Confirm: progress advances, Cancel stops it, the table renders, Apply equips a row.

- [ ] **Step 6: Lint, typecheck, full suite, commit**

```bash
npx tsc --noEmit && npx eslint src/components/autogear src/hooks/useSimRerank.ts && npm test
git add src/components/autogear/SimRerankSection.tsx \
        src/components/autogear/SimRerankTable.tsx \
        src/components/autogear/__tests__/SimRerankSection.test.tsx \
        src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): add the candidate comparison UI

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 12: Docs and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Document the feature in-app**

Add a section under the Autogear documentation covering: what the comparison does, that the
formula finds candidates and the sim compares them, that a practice fight is not a team-aware
answer, what "no clear difference" means, and that the compared roles are chosen automatically.

Follow the surrounding prose style. No emojis.

- [ ] **Step 2: Add the changelog entries**

In `UNRELEASED_CHANGES`, an area prefix plus 8–12 words each. One entry per user-visible change —
split rather than fuse:

```ts
export const UNRELEASED_CHANGES: string[] = [
    'Autogear: compare candidate builds by simulating them against a real fight.',
    'Autogear: builds can now be compared against other roles automatically.',
];
```

Do not add a worked example, the before state, knock-on consequences, scope caveats, or mechanism.

- [ ] **Step 3: Typecheck, full suite, commit**

```bash
npx tsc --noEmit && npm test
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs(autogear): document the candidate comparison

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

## Suggested PR grouping

Build minutes and CodeRabbit slots are per-PR, so these batch rather than shipping twelve PRs:

| PR | Tasks | Why it stands alone |
|---|---|---|
| 1 | 1, 2, 3, 4 | Pure utilities with no UI — candidate ships, steal detection, boards, fight sources |
| 2 | 5, 6, 7, 8 | The run adapter, metric table, GA pool and role set |
| 3 | 9, 10 | The regression test and the orchestration it validates |
| 4 | 11, 12 | UI, docs and changelog |

PR 1 and 2 are the ones worth a destructive-path re-review; PR 4 is UI and can take a lighter pass.
