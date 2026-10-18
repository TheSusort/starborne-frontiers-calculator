# Arcade Hangar: Fighter Select + Checkpoint Duels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player fly a ship from their own fleet in the Synthwave Arcade, and duel two other fleet ships (via the combat simulator) at random checkpoints with random stakes.

**Spec:** `docs/superpowers/specs/2026-10-18-arcade-hangar-duels-design.md`

**Architecture:** The pure seeded engine (`src/utils/arcade/`) learns checkpoints, a `'duel'` status and `resolveDuel`; it knows nothing about ships. `FlightGame` gains a `'select'` phase (fighter select), maps each spawned checkpoint to two opponent ships, and on a gate hit lazy-loads `runDuel` (combat simulator), shows `DuelSummary`, and resumes. Ship art resolves fleet ship → template (by name) → portrait / `definition_id` → official 3D visual key. 3D models (three.js, lazy chunk) load only when `VITE_ARCADE_SHIP_MODELS === '1'`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Canvas 2D, three.js `0.186.1` (exact pin, lazy chunk only), Supabase (read-only `ship_templates`).

## Decision recorded for the owner

The spec is ambiguous for **flag off** in the run: the Rollout-gate section says "the run draws the neon fighter tinted with the ship's faction colour", the Sprites section says a portrait sprite is drawn and tilted. **This plan follows the Rollout-gate reading:** flag off → the player is the neon fighter with a faction-tinted hull outline; portraits appear on the select screen, the duel gates on the track, and the duel summary. Flag on → rendered 3D sprites everywhere.

## Global Constraints

- Every shell command that runs tests, lint, tsc or `git commit` is prefixed with `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null &&` (Bash starts on Node 20; the pre-commit hook fails on it).
- Work in `/Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator/.worktrees/arcade-hangar` only. Never create another worktree, never `git stash`, never `vitest -u`.
- Husky pre-commit (lint-staged + tests) is the only gate; let it run, never `--no-verify`.
- Build-time flag `VITE_ARCADE_SHIP_MODELS` (`'1'` = on). Off by default. Do **not** set it in `netlify.toml` or any committed `.env`. Do **not** touch the CSP in `netlify.toml`.
- 3D models are loaded live from `https://starborne.com/ship-renders/<key>/…` — never copied into the repo or a CDN.
- three.js and `FBXLoader` must only be reachable through `import()` from code that already checked the flag; a flag-off build must not request the three chunk.
- Pin `three` at `0.186.1` and `@types/three` at `0.186.0` exactly (no `^`). Run `npm run audit` after installing.
- UI: use `Button`, `Input`/`SearchInput`, `Select`, `ProgressBar`, the `card` class. No emojis in UI text. No `dangerouslySetInnerHTML`.
- Duel checkpoint spacing: uniformly **600–1400 m** (metres, not engine units; `METERS_PER_UNIT = 0.25`).
- Stakes table (exact): win-or-die win `bonus += 500`, lose → game over unless shield (shield consumed); bonus-or-penalty win `credits += 25`, lose `credits -= floor(credits × 0.25)`; power-up win shield or magnet (seeded 50/50), lose nothing; `'skipped'` applies nothing.
- Score = metres + credits × 10 + `bonus`.
- Changelog entries, verbatim: `Arcade: choose a ship from your fleet to fly.` and `Arcade: duel ships from your hangar at random checkpoints.`
- Comments follow `CLAUDE.md` → Code Comments (present-tense contracts only; no task numbers, no counts).

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/arcade/types.ts` (modify) | `Checkpoint`, `DuelStakes`, `PendingDuel`, `DuelOutcome`, `DuelEffect`; `GameState` fields `bonus`, `checkpoints`, `rowsUntilCheckpoint`, `pendingDuel`; status `'duel'` |
| `src/utils/arcade/constants.ts` (modify) | checkpoint + stakes constants |
| `src/utils/arcade/checkpoints.ts` (create) | row scheduling (`drawCheckpointRows`, `spawnTrackRow`), `resolveDuel` |
| `src/utils/arcade/spawner.ts` (modify) | export `shuffledLanes` |
| `src/utils/arcade/engine.ts` (modify) | `createGame(seed, options)`, checkpoint movement + gate crossing, `'duel'` halts `step` |
| `src/utils/arcade/scoring.ts` (modify) | score adds `bonus` |
| `src/components/arcade/duel/pickOpponents.ts` (create) | pure opponent pick |
| `src/components/arcade/duel/runDuel.ts` (create) | build 1v1, run sim, `duelOutcome` |
| `src/components/arcade/duel/DuelSummary.tsx` (create) | animated duel result overlay |
| `src/components/arcade/duel/stakesText.ts` (create) | stakes banner + effect labels |
| `scripts/lib/catalogueSchema.ts` (modify) | accept `unit.shipVisualKey` |
| `scripts/fetch-ship-visual-keys.ts` (create) | writes `shipVisualKeys.ts` |
| `src/components/arcade/ships/shipVisualKeys.ts` (generated) | `Record<definitionId, visualKey>` |
| `src/hooks/useShipsData.ts` + `src/utils/ship/shipTemplate.ts` (modify) | expose `getDefinitionId(templateId)` |
| `src/components/arcade/ships/shipVisuals.ts` (create) | pure `resolveShipVisual` |
| `src/components/arcade/ships/useShipVisuals.ts` (create) | hook wiring templates into `resolveShipVisual` |
| `src/components/arcade/ships/arcadeFlags.ts` (create) | `shipModelsEnabled()` |
| `src/components/arcade/ships/factionTint.ts` (create) | faction → neon accent colours |
| `src/components/arcade/ships/portraitSprite.ts` (create) | cached `HTMLImageElement` loader |
| `src/components/arcade/ships/fleetOrder.ts` (create) | sort/filter + last-choice storage |
| `src/components/arcade/FighterSelect.tsx` (create) | carousel select screen |
| `src/components/arcade/neonFighter.ts` (modify) | optional accent colours in the pose |
| `src/components/arcade/flightRenderer.ts` (modify) | player art, checkpoint gates + banners |
| `src/components/arcade/FlightGame.tsx` (modify) | select phase, duel flow |
| `src/components/arcade/ships/shipModelLoader.ts` (create, flag on) | FBX + textures, session cache, 10 s timeout |
| `src/components/arcade/ships/shipSprites.ts` (create, flag on) | 5 bank frames from the model |
| `src/components/arcade/ships/ShipModelView.tsx` (create, flag on) | rotating model on the select screen |
| `src/pages/DocumentationPage.tsx`, `src/pages/ArcadePage.tsx`, `src/constants/changelog.ts` (modify) | docs + changelog |

---

### Task 1: Engine — checkpoints, duel status, stakes

**Files:**
- Modify: `src/utils/arcade/types.ts`, `src/utils/arcade/constants.ts`, `src/utils/arcade/spawner.ts`, `src/utils/arcade/engine.ts`, `src/utils/arcade/scoring.ts`
- Create: `src/utils/arcade/checkpoints.ts`
- Test: `src/utils/arcade/__tests__/checkpoints.test.ts`

**Interfaces:**
- Produces:
  - `type DuelStakes = 'win-or-die' | 'bonus-or-penalty' | 'power-up'`
  - `interface Checkpoint { id: number; z: number; gates: [Lane, Lane]; stakes: DuelStakes; resolved: boolean }`
  - `interface PendingDuel { checkpointId: number; slot: 0 | 1; stakes: DuelStakes }`
  - `type DuelOutcome = 'win' | 'lose' | 'skipped'`
  - `type DuelEffect = { kind: 'bonus'; amount: number } | { kind: 'credits'; delta: number } | { kind: 'shield' } | { kind: 'magnet' } | { kind: 'shield-absorbed' } | { kind: 'game-over' } | { kind: 'none' }`
  - `GameState` gains `bonus: number; checkpoints: Checkpoint[]; rowsUntilCheckpoint: number | null; pendingDuel: PendingDuel | null; status: 'running' | 'duel' | 'over'`
  - `createGame(seed: number, options?: { duels?: boolean }): GameState` — duels default **off** (keeps every existing seeded test stable).
  - `resolveDuel(state: GameState, outcome: DuelOutcome): DuelEffect` (mutates `state`)
  - `drawCheckpointRows(state): number`, `spawnTrackRow(state, z): void`

**Design (rows, not distance):** rows spawn every `ROW_GAP` = 22 units = 5.5 m. The 600–1400 m draw becomes a uniform integer row count in `[ceil(600/5.5), floor(1400/5.5)]` = `[110, 254]`, so spacing is exactly inside the range. `rowsUntilCheckpoint` counts down per spawned row: at `1` the row is left empty (row before), at `0` the checkpoint row spawns, at `-1` the row is left empty (row after) and the next draw is stored as `draw - 2` so the next checkpoint row is exactly `draw` rows after this one. `null` = duels disabled.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/arcade/__tests__/checkpoints.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGame, step } from '../engine';
import { drawCheckpointRows, resolveDuel, spawnTrackRow } from '../checkpoints';
import { computeScore } from '../scoring';
import {
    CHECKPOINT_MAX_METERS,
    CHECKPOINT_MIN_METERS,
    MAGNET_SECONDS,
    METERS_PER_UNIT,
    ROW_GAP,
    STEP_SECONDS,
} from '../constants';
import type { DuelStakes, GameState, Lane } from '../types';

const ROW_METERS = ROW_GAP * METERS_PER_UNIT;

/** Spawns `rows` rows through the real scheduler and reports what each row index got. */
function spawnRows(state: GameState, rows: number) {
    const log: { index: number; obstacles: number; pickups: number; checkpoint: boolean }[] = [];
    for (let i = 0; i < rows; i++) {
        const o = state.obstacles.length;
        const p = state.pickups.length;
        const c = state.checkpoints.length;
        spawnTrackRow(state, 80);
        log.push({
            index: i,
            obstacles: state.obstacles.length - o,
            pickups: state.pickups.length - p,
            checkpoint: state.checkpoints.length > c,
        });
    }
    return log;
}

function gameAtDuel(stakes: DuelStakes): GameState {
    const g = createGame(7, { duels: true });
    g.status = 'duel';
    g.pendingDuel = { checkpointId: 1, slot: 0, stakes };
    return g;
}

describe('checkpoint scheduling', () => {
    it('spaces checkpoints 600–1400 m apart, measured in metres', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const g = createGame(seed, { duels: true });
            const log = spawnRows(g, 2000);
            const at = log.filter((r) => r.checkpoint).map((r) => r.index);
            expect(at.length).toBeGreaterThan(3);
            // First checkpoint is drawn from the start of the track.
            expect(at[0] * ROW_METERS).toBeGreaterThanOrEqual(CHECKPOINT_MIN_METERS);
            for (let i = 1; i < at.length; i++) {
                const metres = (at[i] - at[i - 1]) * ROW_METERS;
                expect(metres).toBeGreaterThanOrEqual(CHECKPOINT_MIN_METERS);
                expect(metres).toBeLessThanOrEqual(CHECKPOINT_MAX_METERS);
            }
        }
    });

    it('draws row counts across the whole range', () => {
        const g = createGame(3, { duels: true });
        const draws = Array.from({ length: 2000 }, () => drawCheckpointRows(g));
        expect(Math.min(...draws)).toBe(Math.ceil(CHECKPOINT_MIN_METERS / ROW_METERS));
        expect(Math.max(...draws)).toBe(Math.floor(CHECKPOINT_MAX_METERS / ROW_METERS));
    });

    it('leaves the rows before and after a checkpoint empty', () => {
        const g = createGame(11, { duels: true });
        const log = spawnRows(g, 1500);
        for (const row of log.filter((r) => r.checkpoint)) {
            const before = log[row.index - 1];
            const after = log[row.index + 1];
            expect(before.obstacles + before.pickups).toBe(0);
            expect(after.obstacles + after.pickups).toBe(0);
            expect(row.obstacles + row.pickups).toBe(0);
        }
    });

    it('puts two gates in distinct lanes and leaves one lane free', () => {
        const g = createGame(5, { duels: true });
        spawnRows(g, 3000);
        expect(g.checkpoints.length).toBeGreaterThan(5);
        for (const c of g.checkpoints) {
            expect(c.gates[0]).not.toBe(c.gates[1]);
        }
    });

    it('draws every stakes kind', () => {
        const g = createGame(9, { duels: true });
        spawnRows(g, 20000);
        const kinds = new Set(g.checkpoints.map((c) => c.stakes));
        expect(kinds).toEqual(new Set(['win-or-die', 'bonus-or-penalty', 'power-up']));
    });

    it('schedules nothing when duels are off', () => {
        const g = createGame(5);
        expect(g.rowsUntilCheckpoint).toBeNull();
        spawnRows(g, 3000);
        expect(g.checkpoints).toHaveLength(0);
        expect(createGame(5, { duels: false }).rowsUntilCheckpoint).toBeNull();
    });

    it('is deterministic by seed', () => {
        const a = createGame(42, { duels: true });
        const b = createGame(42, { duels: true });
        spawnRows(a, 1000);
        spawnRows(b, 1000);
        expect(a.checkpoints).toEqual(b.checkpoints);
        expect(a.obstacles).toEqual(b.obstacles);
    });
});

describe('crossing a checkpoint', () => {
    function crossing(gates: [Lane, Lane], lane: Lane, action: 'run' | 'jump' | 'duck' = 'run') {
        const g = createGame(1, { duels: true });
        g.untilNextRow = Number.POSITIVE_INFINITY;
        g.player.lane = lane;
        g.player.action = action;
        g.player.actionTime = action === 'run' ? 0 : 10;
        g.checkpoints.push({ id: 50, z: 0.01, gates, stakes: 'power-up', resolved: false });
        return step(g, [], STEP_SECONDS);
    }

    it('requests a duel when the player is in a gate lane', () => {
        const g = crossing([0, 2], 2);
        expect(g.status).toBe('duel');
        expect(g.pendingDuel).toEqual({ checkpointId: 50, slot: 1, stakes: 'power-up' });
    });

    it('requests a duel whether jumping or ducking', () => {
        expect(crossing([0, 1], 0, 'jump').status).toBe('duel');
        expect(crossing([0, 1], 1, 'duck').status).toBe('duel');
    });

    it('does nothing in the empty lane', () => {
        const g = crossing([0, 2], 1);
        expect(g.status).toBe('running');
        expect(g.pendingDuel).toBeNull();
    });

    it('freezes the game while a duel is pending', () => {
        const g = crossing([0, 2], 0);
        const distance = g.distance;
        step(g, ['left'], STEP_SECONDS);
        expect(g.distance).toBe(distance);
    });
});

describe('resolveDuel', () => {
    it('win-or-die: a win adds 500 bonus', () => {
        const g = gameAtDuel('win-or-die');
        expect(resolveDuel(g, 'win')).toEqual({ kind: 'bonus', amount: 500 });
        expect(g.bonus).toBe(500);
        expect(g.status).toBe('running');
        expect(g.pendingDuel).toBeNull();
    });

    it('win-or-die: a loss ends the run', () => {
        const g = gameAtDuel('win-or-die');
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'game-over' });
        expect(g.status).toBe('over');
    });

    it('win-or-die: a shield absorbs the loss and is consumed', () => {
        const g = gameAtDuel('win-or-die');
        g.player.shield = true;
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'shield-absorbed' });
        expect(g.player.shield).toBe(false);
        expect(g.shieldBreakTime).toBeGreaterThan(0);
        expect(g.status).toBe('running');
    });

    it('bonus-or-penalty: a win adds 25 credits', () => {
        const g = gameAtDuel('bonus-or-penalty');
        g.credits = 10;
        expect(resolveDuel(g, 'win')).toEqual({ kind: 'credits', delta: 25 });
        expect(g.credits).toBe(35);
    });

    it('bonus-or-penalty: a loss takes a quarter of the credits, rounded down', () => {
        const g = gameAtDuel('bonus-or-penalty');
        g.credits = 49;
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'credits', delta: -12 });
        expect(g.credits).toBe(37);
    });

    it('power-up: a win grants a shield or a magnet, both reachable', () => {
        const kinds = new Set<string>();
        for (let seed = 1; seed <= 30; seed++) {
            const g = gameAtDuel('power-up');
            g.rngState = seed;
            const effect = resolveDuel(g, 'win');
            kinds.add(effect.kind);
            if (effect.kind === 'shield') expect(g.player.shield).toBe(true);
            else expect(g.player.magnetTime).toBe(MAGNET_SECONDS);
        }
        expect(kinds).toEqual(new Set(['shield', 'magnet']));
    });

    it('power-up: a loss does nothing', () => {
        const g = gameAtDuel('power-up');
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'none' });
        expect(g.player.shield).toBe(false);
        expect(g.player.magnetTime).toBe(0);
    });

    it('skipped applies nothing for every stakes kind', () => {
        for (const stakes of ['win-or-die', 'bonus-or-penalty', 'power-up'] as const) {
            const g = gameAtDuel(stakes);
            g.credits = 40;
            expect(resolveDuel(g, 'skipped')).toEqual({ kind: 'none' });
            expect(g.credits).toBe(40);
            expect(g.bonus).toBe(0);
            expect(g.status).toBe('running');
        }
    });

    it('does nothing without a pending duel', () => {
        const g = createGame(1, { duels: true });
        expect(resolveDuel(g, 'win')).toEqual({ kind: 'none' });
        expect(g.bonus).toBe(0);
    });
});

describe('score', () => {
    it('includes the duel bonus', () => {
        const g = createGame(1);
        g.credits = 3;
        g.bonus = 500;
        expect(computeScore(g)).toBe(30 + 500);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/utils/arcade`
Expected: `checkpoints.test.ts` FAILS (module `../checkpoints` not found); existing arcade tests pass.

- [ ] **Step 3: Add types**

In `src/utils/arcade/types.ts` add after `PickupKind`:

```ts
export type DuelStakes = 'win-or-die' | 'bonus-or-penalty' | 'power-up';
export type DuelOutcome = 'win' | 'lose' | 'skipped';

/** A row of two duel gates; the lane in neither gate is free. `gates[slot]` is opponent `slot`. */
export interface Checkpoint {
    id: number;
    z: number;
    gates: [Lane, Lane];
    stakes: DuelStakes;
    resolved: boolean;
}

export interface PendingDuel {
    checkpointId: number;
    slot: 0 | 1;
    stakes: DuelStakes;
}

/** What `resolveDuel` did, for the duel summary to show. */
export type DuelEffect =
    | { kind: 'bonus'; amount: number }
    | { kind: 'credits'; delta: number }
    | { kind: 'shield' }
    | { kind: 'magnet' }
    | { kind: 'shield-absorbed' }
    | { kind: 'game-over' }
    | { kind: 'none' };
```

In `GameState`, add after `credits: number;`:

```ts
    /** Points from duels, added to the score as-is. */
    bonus: number;
```

after `pickups: Pickup[];`:

```ts
    checkpoints: Checkpoint[];
    /** Rows left until the next checkpoint row; `null` when duels are off. See `spawnTrackRow`. */
    rowsUntilCheckpoint: number | null;
    pendingDuel: PendingDuel | null;
```

and change `status: 'running' | 'over';` to:

```ts
    /** `'duel'` halts `step` until `resolveDuel` is called. */
    status: 'running' | 'duel' | 'over';
```

- [ ] **Step 4: Add constants**

Append to `src/utils/arcade/constants.ts`:

```ts
export const CHECKPOINT_MIN_METERS = 600;
export const CHECKPOINT_MAX_METERS = 1400;
export const DUEL_WIN_BONUS = 500;
export const DUEL_CREDIT_REWARD = 25;
/** Share of credits a lost bonus-or-penalty duel takes, rounded down. */
export const DUEL_CREDIT_PENALTY = 0.25;
```

- [ ] **Step 5: Export `shuffledLanes` from the spawner**

In `src/utils/arcade/spawner.ts` change `function shuffledLanes(` to `export function shuffledLanes(`.

- [ ] **Step 6: Create `src/utils/arcade/checkpoints.ts`**

```ts
import {
    CHECKPOINT_MAX_METERS,
    CHECKPOINT_MIN_METERS,
    DUEL_CREDIT_PENALTY,
    DUEL_CREDIT_REWARD,
    DUEL_WIN_BONUS,
    MAGNET_SECONDS,
    METERS_PER_UNIT,
    ROW_GAP,
    SHIELD_BREAK_FLASH,
} from './constants';
import { nextRandom } from './rng';
import { shuffledLanes, spawnRow } from './spawner';
import type { DuelEffect, DuelOutcome, DuelStakes, GameState } from './types';

const ROW_METERS = ROW_GAP * METERS_PER_UNIT;
const MIN_ROWS = Math.ceil(CHECKPOINT_MIN_METERS / ROW_METERS);
const MAX_ROWS = Math.floor(CHECKPOINT_MAX_METERS / ROW_METERS);
const STAKES: readonly DuelStakes[] = ['win-or-die', 'bonus-or-penalty', 'power-up'];

/** Rows from one checkpoint row to the next: uniform over the rows that keep the spacing
 *  inside CHECKPOINT_MIN_METERS..CHECKPOINT_MAX_METERS. */
export function drawCheckpointRows(state: GameState): number {
    return MIN_ROWS + Math.floor(nextRandom(state) * (MAX_ROWS - MIN_ROWS + 1));
}

function spawnCheckpoint(state: GameState, z: number): void {
    const lanes = shuffledLanes(state);
    state.checkpoints.push({
        id: state.nextId++,
        z,
        gates: [lanes[0], lanes[1]],
        stakes: STAKES[Math.floor(nextRandom(state) * STAKES.length)],
        resolved: false,
    });
}

/**
 * Spawns the next track row at depth `z`. With duels on, the rows immediately before and after
 * a checkpoint row stay empty, and the next checkpoint row lands exactly `drawCheckpointRows`
 * rows after the current one.
 */
export function spawnTrackRow(state: GameState, z: number): void {
    if (state.rowsUntilCheckpoint === null) {
        spawnRow(state, z);
        return;
    }
    const rows = state.rowsUntilCheckpoint--;
    if (rows === 1) return;
    if (rows === 0) {
        spawnCheckpoint(state, z);
        return;
    }
    if (rows === -1) {
        state.rowsUntilCheckpoint = drawCheckpointRows(state) - 2;
        return;
    }
    spawnRow(state, z);
}

function applyStakes(state: GameState, stakes: DuelStakes, won: boolean): DuelEffect {
    const player = state.player;
    switch (stakes) {
        case 'win-or-die':
            if (won) {
                state.bonus += DUEL_WIN_BONUS;
                return { kind: 'bonus', amount: DUEL_WIN_BONUS };
            }
            if (player.shield) {
                player.shield = false;
                state.shieldBreakTime = SHIELD_BREAK_FLASH;
                return { kind: 'shield-absorbed' };
            }
            state.status = 'over';
            return { kind: 'game-over' };
        case 'bonus-or-penalty': {
            const delta = won
                ? DUEL_CREDIT_REWARD
                : -Math.floor(state.credits * DUEL_CREDIT_PENALTY);
            state.credits += delta;
            return { kind: 'credits', delta };
        }
        case 'power-up':
            if (!won) return { kind: 'none' };
            if (nextRandom(state) < 0.5) {
                player.shield = true;
                return { kind: 'shield' };
            }
            player.magnetTime = MAGNET_SECONDS;
            return { kind: 'magnet' };
    }
}

/** Applies the pending duel's stakes and returns the game to `'running'` (or `'over'`). */
export function resolveDuel(state: GameState, outcome: DuelOutcome): DuelEffect {
    const pending = state.pendingDuel;
    if (!pending) return { kind: 'none' };
    state.pendingDuel = null;
    state.status = 'running';
    if (outcome === 'skipped') return { kind: 'none' };
    return applyStakes(state, pending.stakes, outcome === 'win');
}
```

- [ ] **Step 7: Wire the engine**

In `src/utils/arcade/engine.ts`:

Replace the `import { spawnRow } from './spawner';` line with `import { drawCheckpointRows, spawnTrackRow } from './checkpoints';`.

Replace `createGame` with:

```ts
export interface GameOptions {
    /** Schedules duel checkpoints. Off unless the caller has two opponents to offer. */
    duels?: boolean;
}

export function createGame(seed: number, options: GameOptions = {}): GameState {
    const state: GameState = {
        rngState: seed >>> 0,
        time: 0,
        speed: START_SPEED,
        distance: 0,
        credits: 0,
        bonus: 0,
        player: { lane: 1, action: 'run', actionTime: 0, shield: false, magnetTime: 0 },
        obstacles: [],
        pickups: [],
        checkpoints: [],
        rowsUntilCheckpoint: null,
        pendingDuel: null,
        untilNextRow: FIRST_ROW_DELAY,
        nextId: 1,
        status: 'running',
        shieldBreakTime: 0,
    };
    if (options.duels) state.rowsUntilCheckpoint = drawCheckpointRows(state);
    return state;
}
```

In `step`: change `if (state.status === 'over') return state;` (first line) to `if (state.status !== 'running') return state;`. Add `for (const c of state.checkpoints) c.z -= travel;` after the pickups' `p.z -= travel` line. Replace `spawnRow(state, SPAWN_Z + state.untilNextRow);` with `spawnTrackRow(state, SPAWN_Z + state.untilNextRow);`. After the pickups loop (before the filters) add:

```ts
    for (const c of state.checkpoints) {
        if (c.resolved || c.z > 0) continue;
        c.resolved = true;
        const slot = c.gates.indexOf(player.lane);
        if (slot === -1) continue;
        state.status = 'duel';
        state.pendingDuel = { checkpointId: c.id, slot: slot as 0 | 1, stakes: c.stakes };
    }
```

and add to the filters: `state.checkpoints = state.checkpoints.filter((c) => c.z > DESPAWN_Z);`

- [ ] **Step 8: Score includes the bonus**

In `src/utils/arcade/scoring.ts` `computeScore` returns `metersTravelled(state.distance) + state.credits * CREDIT_POINTS + state.bonus;`.

- [ ] **Step 9: Run tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/utils/arcade && npx tsc --noEmit`
Expected: all arcade tests PASS (including the existing `engine.test.ts`/`spawner.test.ts`); tsc may report errors only in `FlightGame.tsx`/`flightRenderer.ts` if they switch on status — fix any by treating `'duel'` like a halted state (no behaviour yet). tsc must end clean.

- [ ] **Step 10: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add src/utils/arcade && git commit -m "feat(arcade): engine checkpoints, duel status and stakes"
```

---

### Task 2: Opponents and running a duel

**Files:**
- Create: `src/components/arcade/duel/pickOpponents.ts`, `src/components/arcade/duel/runDuel.ts`
- Test: `src/components/arcade/duel/__tests__/pickOpponents.test.ts`, `src/components/arcade/duel/__tests__/runDuel.test.ts`

**Interfaces:**
- Consumes: `DuelOutcome` from Task 1; `buildTeam(board, deps)` (`src/utils/simulator/buildTeam.ts`), `runSeededBattle(input, seed, getGearPiece)` (`src/utils/simulator/seededRuns.ts`), `CombatStatsDeps` (`src/utils/ship/combatStats.ts`), `BattleResult` (`src/utils/calculators/battleSimulator.ts`).
- Produces:
  - `pickOpponents(fleet: readonly Ship[], flownId: string, random: () => number): [Ship, Ship] | null`
  - `canDuel(fleet: readonly Ship[], flownId: string | null): boolean`
  - `interface DuelTimelinePoint { round: number; playerHpPct: number; enemyHpPct: number }`
  - `interface DuelResult { outcome: DuelOutcome; timeline: DuelTimelinePoint[] }`
  - `duelOutcome(result: BattleResult): DuelResult`
  - `runDuel(player: Ship, opponent: Ship, deps: CombatStatsDeps, seed: number): DuelResult`

- [ ] **Step 1: Write the failing `pickOpponents` test**

```ts
import { describe, it, expect } from 'vitest';
import { canDuel, pickOpponents } from '../pickOpponents';
import type { Ship } from '../../../../types/ship';

const ship = (id: string) => ({ id, name: id }) as Ship;
const fleet = ['a', 'b', 'c', 'd'].map(ship);

/** Deterministic `random` replaying `values`. */
const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};

describe('pickOpponents', () => {
    it('never picks the flown ship and returns two distinct ships', () => {
        for (let k = 0; k < 50; k++) {
            const pick = pickOpponents(fleet, 'b', Math.random)!;
            expect(pick).not.toBeNull();
            expect(pick.map((s) => s.id)).not.toContain('b');
            expect(pick[0].id).not.toBe(pick[1].id);
        }
    });

    it('can reach every candidate', () => {
        const seen = new Set<string>();
        for (let k = 0; k < 200; k++) {
            for (const s of pickOpponents(fleet, 'a', Math.random)!) seen.add(s.id);
        }
        expect(seen).toEqual(new Set(['b', 'c', 'd']));
    });

    it('uses the injected random', () => {
        expect(pickOpponents(fleet, 'a', seq(0, 0))!.map((s) => s.id)).toEqual(['b', 'c']);
        expect(pickOpponents(fleet, 'a', seq(0.99, 0.99))!.map((s) => s.id)).toEqual(['d', 'c']);
    });

    it('returns null with fewer than two candidates', () => {
        expect(pickOpponents([ship('a'), ship('b')], 'a', Math.random)).toBeNull();
        expect(pickOpponents([], 'a', Math.random)).toBeNull();
    });

    it('canDuel needs a flown ship and two candidates', () => {
        expect(canDuel(fleet, 'a')).toBe(true);
        expect(canDuel(fleet, null)).toBe(false);
        expect(canDuel([ship('a'), ship('b')], 'a')).toBe(false);
    });
});
```

- [ ] **Step 2: Implement `pickOpponents.ts`**

```ts
import type { Ship } from '../../../types/ship';

/** Two distinct fleet ships other than the flown one, uniformly at random; `null` when the fleet
 *  cannot field two. */
export function pickOpponents(
    fleet: readonly Ship[],
    flownId: string,
    random: () => number
): [Ship, Ship] | null {
    const pool = fleet.filter((s) => s.id !== flownId);
    if (pool.length < 2) return null;
    const first = pool.splice(Math.floor(random() * pool.length), 1)[0];
    const second = pool[Math.floor(random() * pool.length)];
    return [first, second];
}

export function canDuel(fleet: readonly Ship[], flownId: string | null): boolean {
    return flownId !== null && fleet.filter((s) => s.id !== flownId).length >= 2;
}
```

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade/duel` → PASS.

- [ ] **Step 3: Write the failing `runDuel` test**

Fixture ships go through `buildTeam`, which derives stats from `baseStats` (gear/engineering resolve to nothing with these deps), so they need full `baseStats` and skill text — a ship with no skill text casts nothing and every fight is a 0-damage draw.

```ts
import { describe, it, expect } from 'vitest';
import { duelOutcome, runDuel } from '../runDuel';
import type { Ship } from '../../../../types/ship';
import type { BattleResult } from '../../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../../utils/ship/combatStats';

const deps: CombatStatsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const fighter = (id: string, attack: number, hp: number, skill = true): Ship =>
    ({
        id,
        name: id,
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        type: 'ATTACKER',
        baseStats: {
            hp,
            attack,
            defence: 1000,
            hacking: 0,
            security: 0,
            crit: 0,
            critDamage: 0,
            speed: 100,
            healModifier: 0,
            hpRegen: 0,
            shield: 0,
            damageReduction: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: skill ? 'This Unit deals <unit-damage>100% damage</unit-damage>.' : undefined,
        activeTarget: skill ? 'front' : undefined,
        activePattern: skill ? 'Pattern-Base' : undefined,
    }) as unknown as Ship;

/** Hand-built result: only the fields `duelOutcome` reads. */
const result = (
    winner: 'player' | 'enemy',
    rounds: { player: [number, boolean]; enemy: [number, boolean] }[]
): BattleResult =>
    ({
        outcome: { winner, lastRound: rounds.length },
        rounds: rounds.map((r, i) => ({
            round: i + 1,
            ships: [
                { actorId: 'p', side: 'player', hpPct: r.player[0], alive: r.player[1] },
                { actorId: 'e', side: 'enemy', hpPct: r.enemy[0], alive: r.enemy[1] },
            ],
        })),
    }) as unknown as BattleResult;

describe('duelOutcome', () => {
    it('follows the simulator winner when a side was wiped', () => {
        const r = result('player', [
            { player: [80, true], enemy: [40, true] },
            { player: [60, true], enemy: [0, false] },
        ]);
        expect(duelOutcome(r)).toEqual({
            outcome: 'win',
            timeline: [
                { round: 0, playerHpPct: 100, enemyHpPct: 100 },
                { round: 1, playerHpPct: 80, enemyHpPct: 40 },
                { round: 2, playerHpPct: 60, enemyHpPct: 0 },
            ],
        });
        expect(duelOutcome(result('enemy', [{ player: [0, false], enemy: [5, true] }])).outcome).toBe(
            'lose'
        );
    });

    it('at the round cap, the side with more HP wins even though the simulator says enemy', () => {
        expect(duelOutcome(result('enemy', [{ player: [70, true], enemy: [30, true] }])).outcome).toBe(
            'win'
        );
        expect(duelOutcome(result('enemy', [{ player: [30, true], enemy: [70, true] }])).outcome).toBe(
            'lose'
        );
    });

    it('at the round cap, the player wins a tie', () => {
        expect(duelOutcome(result('enemy', [{ player: [50, true], enemy: [50, true] }])).outcome).toBe(
            'win'
        );
    });
});

describe('runDuel', () => {
    it('runs a real 1v1 and produces a winner and a timeline', () => {
        const strong = fighter('strong', 6000, 20000);
        const weak = fighter('weak', 500, 8000);
        const r = runDuel(strong, weak, deps, 123);
        expect(r.outcome).toBe('win');
        expect(r.timeline.length).toBeGreaterThan(1);
        expect(r.timeline.at(-1)!.enemyHpPct).toBe(0);
        expect(runDuel(weak, strong, deps, 123).outcome).toBe('lose');
    });

    it('a fight nobody can win reaches the cap and the tie goes to the player', () => {
        const r = runDuel(fighter('a', 0, 1000, false), fighter('b', 0, 1000, false), deps, 1);
        expect(r.outcome).toBe('win');
    });

    it('a thrown error skips the duel', () => {
        const broken: CombatStatsDeps = {
            getGearPiece: () => {
                throw new Error('boom');
            },
            getEngineeringStatsForShipType: () => undefined,
        };
        const geared = { ...fighter('g', 1000, 1000), equipment: { weapon: 'x' } } as Ship;
        expect(runDuel(geared, fighter('b', 1000, 1000), broken, 1)).toEqual({
            outcome: 'skipped',
            timeline: [],
        });
    });
});
```

If the fixture's `baseStats` keys don't match `BaseStats` in `src/types/stats.ts`, fix the fixture to the real keys (keep `as unknown as Ship`). If `strong` vs `weak` does not produce a wipe, raise `attack`/lower `hp` until it does — the test must exercise a real wipe, not the cap rule.

- [ ] **Step 4: Run it to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade/duel`
Expected: FAIL — `../runDuel` not found.

- [ ] **Step 5: Implement `runDuel.ts`**

```ts
import type { Ship } from '../../../types/ship';
import type { DuelOutcome } from '../../../utils/arcade/types';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import { buildTeam } from '../../../utils/simulator/buildTeam';
import { runSeededBattle } from '../../../utils/simulator/seededRuns';

export interface DuelTimelinePoint {
    round: number;
    playerHpPct: number;
    enemyHpPct: number;
}

export interface DuelResult {
    outcome: DuelOutcome;
    timeline: DuelTimelinePoint[];
}

/**
 * The simulator's winner, except when the fight reached the round cap with both ships alive (the
 * simulator calls that an enemy win): then the higher final HP% wins and the player wins ties.
 */
export function duelOutcome(result: BattleResult): DuelResult {
    const timeline: DuelTimelinePoint[] = [{ round: 0, playerHpPct: 100, enemyHpPct: 100 }];
    for (const round of result.rounds) {
        const player = round.ships.find((s) => s.side === 'player');
        const enemy = round.ships.find((s) => s.side === 'enemy');
        timeline.push({
            round: round.round,
            playerHpPct: player?.hpPct ?? 0,
            enemyHpPct: enemy?.hpPct ?? 0,
        });
    }
    const last = result.rounds.at(-1);
    const bothAlive =
        !!last &&
        last.ships.some((s) => s.side === 'player' && s.alive) &&
        last.ships.some((s) => s.side === 'enemy' && s.alive);
    const end = timeline[timeline.length - 1];
    const won = bothAlive ? end.playerHpPct >= end.enemyHpPct : result.outcome.winner === 'player';
    return { outcome: won ? 'win' : 'lose', timeline };
}

/** A 1v1 at M2 on both sides with each ship's full gear/engineering stats. Any error → skipped. */
export function runDuel(
    player: Ship,
    opponent: Ship,
    deps: CombatStatsDeps,
    seed: number
): DuelResult {
    try {
        const input = {
            playerTeam: buildTeam({ M2: { ship: player } }, deps),
            enemyTeam: buildTeam({ M2: { ship: opponent } }, deps),
        };
        return duelOutcome(runSeededBattle(input, seed, deps.getGearPiece));
    } catch {
        return { outcome: 'skipped', timeline: [] };
    }
}
```

- [ ] **Step 6: Run tests + tsc**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade/duel && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add src/components/arcade/duel && git commit -m "feat(arcade): pick duel opponents and run 1v1 duels in the simulator"
```

---

### Task 3: Ship visual data (portraits, visual keys, flag, tint)

**Files:**
- Modify: `scripts/lib/catalogueSchema.ts`, `src/utils/ship/shipTemplate.ts`, `src/hooks/useShipsData.ts`
- Create: `scripts/fetch-ship-visual-keys.ts`, `src/components/arcade/ships/shipVisualKeys.ts` (generated), `src/components/arcade/ships/shipVisuals.ts`, `src/components/arcade/ships/useShipVisuals.ts`, `src/components/arcade/ships/arcadeFlags.ts`, `src/components/arcade/ships/factionTint.ts`, `src/components/arcade/ships/portraitSprite.ts`
- Test: `src/components/arcade/ships/__tests__/shipVisuals.test.ts`, `src/components/arcade/ships/__tests__/arcadeFlags.test.ts`

**Interfaces:**
- Produces:
  - `SHIP_VISUAL_KEYS: Readonly<Record<string, string>>`
  - `getDefinitionId(templateId: string): string | null` (on `useShipsData()`'s return)
  - `interface ShipVisual { portraitUrl: string | null; visualKey: string | null }`
  - `resolveShipVisual(ship: Ship, template: Ship | undefined, definitionId: string | null, keys: Readonly<Record<string, string>>): ShipVisual`
  - `useShipVisuals(): (ship: Ship) => ShipVisual`
  - `shipModelsEnabled(): boolean`
  - `interface NeonAccent { core: string; glow: string }`, `factionAccent(faction: string): NeonAccent`
  - `loadPortrait(url: string): Promise<HTMLImageElement>`, `cachedPortrait(url: string): HTMLImageElement | null`

- [ ] **Step 1: Accept `shipVisualKey` in the catalogue schema**

In `scripts/lib/catalogueSchema.ts`, inside `catalogueUnitSchema = z.object({ … })`, add `shipVisualKey: z.string().optional(),` (zod strips unknown keys, so without this the script never sees it).

- [ ] **Step 2: Write the generator script**

Create `scripts/fetch-ship-visual-keys.ts`:

```ts
/* eslint-disable no-console */
/**
 * Writes src/components/arcade/ships/shipVisualKeys.ts: unit definition id → the official 3D
 * render key (`https://starborne.com/ship-renders/<key>/…`). Read-only against the catalogue.
 *
 * Usage: npx tsx scripts/fetch-ship-visual-keys.ts
 */
import { writeFileSync } from 'fs';
import { fetchCatalogueIndex, fetchCatalogueUnits } from './lib/catalogueFetch';

const OUT = 'src/components/arcade/ships/shipVisualKeys.ts';

const main = async () => {
    const index = await fetchCatalogueIndex();
    const units = await fetchCatalogueUnits(index.slugs);
    const entries = units
        .filter((u) => u.shipVisualKey)
        .map((u) => [u.id, u.shipVisualKey as string] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    const body = entries.map(([id, key]) => `    ${JSON.stringify(id)}: ${JSON.stringify(key)},`);
    writeFileSync(
        OUT,
        [
            '// Generated by scripts/fetch-ship-visual-keys.ts — do not edit by hand.',
            '/** Unit definition id → official 3D render key. */',
            'export const SHIP_VISUAL_KEYS: Readonly<Record<string, string>> = {',
            ...body,
            '};',
            '',
        ].join('\n')
    );
    console.log(`wrote ${entries.length} of ${units.length} units to ${OUT}`);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
```

Check how other scripts are run (`grep -n "tsx\|ts-node" package.json`) and use the same runner. Confirm `CatalogueUnit` exposes the unit id as `id` (it is `unit.id` in the payload); adjust the property names to the schema if not.

- [ ] **Step 3: Run it and commit the generated file**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsx scripts/fetch-ship-visual-keys.ts`
Expected: `wrote N of M units …` with N close to M; the file contains `"Atlas_Supporter_Legendary_1": "Atlas_4",`. Run `npx prettier --write src/components/arcade/ships/shipVisualKeys.ts`.

- [ ] **Step 4: Expose `getDefinitionId` from `useShipsData`**

In `src/utils/ship/shipTemplate.ts` add to `ShipTemplate`: `definition_id?: string | null;`.

In `src/hooks/useShipsData.ts`: next to `cachedAscensionStats`, add

```ts
// Keyed by template id; the official unit id, used to look up the unit's 3D render key.
let cachedDefinitionIds: Map<string, string> = new Map();
```

inside the fetch, alongside the ascension loop, build `const definitionIds = new Map<string, string>();` and `if (row.definition_id) definitionIds.set(row.id, row.definition_id);`, then `cachedDefinitionIds = definitionIds;`. Add

```ts
    const getDefinitionId = (templateId: string): string | null =>
        cachedDefinitionIds.get(templateId) ?? null;
```

and return it: `return { ships, loading, error, fetchSingleShip, getAscensionStats, getDefinitionId };`. Check every existing mock of `useShipsData` (`grep -rn "useShipsData" src --include=*.test.*`) still type-checks; add `getDefinitionId: () => null` where a mock is typed against the full return.

- [ ] **Step 5: Write the failing `shipVisuals` and flag tests**

`src/components/arcade/ships/__tests__/shipVisuals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveShipVisual } from '../shipVisuals';
import type { Ship } from '../../../../types/ship';

const keys = { Atlas_Supporter_Legendary_1: 'Atlas_4' };
const fleetShip = (imageKey?: string) => ({ id: 'f1', name: 'Aegis', imageKey }) as Ship;
const template = (imageKey?: string) => ({ id: 't1', name: 'Aegis', imageKey }) as Ship;

describe('resolveShipVisual', () => {
    it('resolves the visual key through the template definition id', () => {
        expect(
            resolveShipVisual(fleetShip(), template('https://img/aegis'), 'Atlas_Supporter_Legendary_1', keys)
        ).toEqual({ portraitUrl: 'https://img/aegis_BigPortrait.jpg', visualKey: 'Atlas_4' });
    });

    it("prefers the fleet ship's own image key", () => {
        expect(resolveShipVisual(fleetShip('https://own'), template('https://tpl'), null, keys).portraitUrl).toBe(
            'https://own_BigPortrait.jpg'
        );
    });

    it('falls back to nulls on every miss', () => {
        expect(resolveShipVisual(fleetShip(), undefined, null, keys)).toEqual({
            portraitUrl: null,
            visualKey: null,
        });
        expect(resolveShipVisual(fleetShip(), template(), 'Unknown_Unit', keys).visualKey).toBeNull();
    });
});
```

`src/components/arcade/ships/__tests__/arcadeFlags.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { shipModelsEnabled } from '../arcadeFlags';

afterEach(() => vi.unstubAllEnvs());

describe('shipModelsEnabled', () => {
    it('is on only for the exact value 1', () => {
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', '1');
        expect(shipModelsEnabled()).toBe(true);
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', 'true');
        expect(shipModelsEnabled()).toBe(false);
        vi.stubEnv('VITE_ARCADE_SHIP_MODELS', '');
        expect(shipModelsEnabled()).toBe(false);
    });
});
```

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade/ships` → FAIL (modules missing).

- [ ] **Step 6: Implement the small modules**

`src/components/arcade/ships/arcadeFlags.ts`:

```ts
/** Official 3D ship models (loaded live from starborne.com). Off unless the build sets
 *  `VITE_ARCADE_SHIP_MODELS=1`; production stays off until the asset owner approves. */
export function shipModelsEnabled(): boolean {
    return import.meta.env.VITE_ARCADE_SHIP_MODELS === '1';
}
```

Add to `src/vite-env.d.ts`:

```ts
interface ImportMetaEnv {
    readonly VITE_ARCADE_SHIP_MODELS?: string;
}
```

`src/components/arcade/ships/shipVisuals.ts`:

```ts
import type { Ship } from '../../../types/ship';

export interface ShipVisual {
    portraitUrl: string | null;
    /** Official render key; `null` → callers use the portrait. */
    visualKey: string | null;
}

/** A fleet ship carries no definition id, so the 3D key comes from its template's. */
export function resolveShipVisual(
    ship: Ship,
    template: Ship | undefined,
    definitionId: string | null,
    keys: Readonly<Record<string, string>>
): ShipVisual {
    const imageKey = ship.imageKey || template?.imageKey;
    return {
        portraitUrl: imageKey ? `${imageKey}_BigPortrait.jpg` : null,
        visualKey: (definitionId && keys[definitionId]) || null,
    };
}
```

`src/components/arcade/ships/useShipVisuals.ts`:

```ts
import { useCallback, useMemo } from 'react';
import type { Ship } from '../../../types/ship';
import { useShipsData } from '../../../hooks/useShipsData';
import { SHIP_VISUAL_KEYS } from './shipVisualKeys';
import { resolveShipVisual, type ShipVisual } from './shipVisuals';

/** Fleet ships resolve to their template by name, as elsewhere in the app. */
export function useShipVisuals(): (ship: Ship) => ShipVisual {
    const { ships: templates, getDefinitionId } = useShipsData();
    const byName = useMemo(() => new Map(templates.map((t) => [t.name, t])), [templates]);
    return useCallback(
        (ship: Ship) => {
            const template = byName.get(ship.name);
            const definitionId = template ? getDefinitionId(template.id) : null;
            return resolveShipVisual(ship, template, definitionId, SHIP_VISUAL_KEYS);
        },
        [byName, getDefinitionId]
    );
}
```

If `getDefinitionId` is recreated every render (it is a plain closure in the hook), wrap it in `useCallback` inside `useShipsData` so `useShipVisuals`' callback is stable.

`src/components/arcade/ships/factionTint.ts`:

```ts
import { asFactionName, type FactionName } from '../../../constants/factions';

export interface NeonAccent {
    core: string;
    glow: string;
}

const accent = (r: number, g: number, b: number): NeonAccent => ({
    core: `rgb(${r}, ${g}, ${b})`,
    glow: `rgba(${r}, ${g}, ${b}, 0.28)`,
});

/** The neon fighter's hull outline per faction; unknown factions keep the default pink. */
const FACTION_ACCENTS: Partial<Record<FactionName, NeonAccent>> = {
    ATLAS_SYNDICATE: accent(255, 196, 64),
    BINDERBURG: accent(120, 200, 255),
    EVERLIVING: accent(90, 255, 140),
    FRONTIER_LEGION: accent(255, 90, 70),
    GELECEK: accent(190, 120, 255),
    MPL: accent(64, 240, 255),
    MARAUDERS: accent(255, 130, 40),
    TERRAN_COMBINE: accent(230, 230, 255),
    TIANCHAO: accent(255, 70, 160),
    XAOC: accent(160, 255, 60),
};

export const DEFAULT_ACCENT: NeonAccent = accent(255, 79, 216);

export function factionAccent(faction: string): NeonAccent {
    const key = asFactionName(faction);
    return (key && FACTION_ACCENTS[key]) || DEFAULT_ACCENT;
}
```

Use the real `FactionName` keys from `src/constants/factions.ts` (read the file; e.g. the Tianchen faction's key). `tsc` will reject a key that is not a `FactionName`.

`src/components/arcade/ships/portraitSprite.ts`:

```ts
const cache = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();

/** Session-cached portrait image. Never sets `crossOrigin`: the canvas only draws it. */
export function loadPortrait(url: string): Promise<HTMLImageElement> {
    let p = cache.get(url);
    if (!p) {
        p = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                loaded.set(url, img);
                resolve(img);
            };
            img.onerror = () => {
                cache.delete(url);
                reject(new Error(`portrait failed: ${url}`));
            };
            img.src = url;
        });
        cache.set(url, p);
    }
    return p;
}

/** The image if it has finished loading, for per-frame drawing. */
export function cachedPortrait(url: string): HTMLImageElement | null {
    return loaded.get(url) ?? null;
}
```

- [ ] **Step 7: Run tests, tsc, lint**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade src/hooks && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add scripts/lib/catalogueSchema.ts scripts/fetch-ship-visual-keys.ts src/components/arcade/ships src/hooks/useShipsData.ts src/utils/ship/shipTemplate.ts src/vite-env.d.ts && git commit -m "feat(arcade): resolve fleet ship portraits and official render keys"
```

---

### Task 4: Fighter select screen (flag off) + tinted fighter in the run

**Files:**
- Create: `src/components/arcade/ships/fleetOrder.ts`, `src/components/arcade/FighterSelect.tsx`
- Modify: `src/components/arcade/neonFighter.ts`, `src/components/arcade/flightRenderer.ts`, `src/components/arcade/FlightGame.tsx`
- Test: `src/components/arcade/ships/__tests__/fleetOrder.test.ts`

**Interfaces:**
- Consumes: `useShipVisuals`, `factionAccent`, `NeonAccent`, `canDuel` (Task 2/3), `createGame(seed, { duels })` (Task 1).
- Produces:
  - `orderFleet(ships: readonly Ship[], lastId: string | null): Ship[]`
  - `filterFleet(ships: readonly Ship[], query: string, faction: string): Ship[]` (`faction === ''` = all)
  - `readLastShipId(): string | null`, `writeLastShipId(id: string): void` (key `arcade:lastShipId`)
  - `FighterSelect` props: `{ ships: Ship[]; initialShipId: string | null; onLaunch: (ship: Ship) => void; onQuit: () => void }`
  - `NeonFighterPose` gains `accent?: NeonAccent`
  - `FlightView` gains `playerAccent: NeonAccent | null` (later: `playerFrames`)
  - `FlightGame` keeps `flownRef: React.MutableRefObject<Ship | null>`, phase union gains `'select'`

- [ ] **Step 1: Write the failing `fleetOrder` test**

```ts
import { beforeEach, describe, it, expect } from 'vitest';
import { filterFleet, orderFleet, readLastShipId, writeLastShipId } from '../fleetOrder';
import type { Ship } from '../../../../types/ship';

const s = (id: string, rarity: string, level: number, faction = 'MPL', name = id) =>
    ({ id, name, rarity, level, faction }) as Ship;

describe('orderFleet', () => {
    const fleet = [s('a', 'rare', 60), s('b', 'legendary', 40), s('c', 'legendary', 60), s('d', 'epic', 1)];

    it('orders by rarity desc, then level desc', () => {
        expect(orderFleet(fleet, null).map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    });

    it('puts the last chosen ship first', () => {
        expect(orderFleet(fleet, 'a').map((x) => x.id)).toEqual(['a', 'c', 'b', 'd']);
    });

    it('ignores a last id that is no longer owned', () => {
        expect(orderFleet(fleet, 'gone').map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    });
});

describe('filterFleet', () => {
    const fleet = [s('1', 'rare', 1, 'MPL', 'Aegis'), s('2', 'rare', 1, 'XAOC', 'Hermes')];

    it('matches name case-insensitively', () => {
        expect(filterFleet(fleet, 'aeg', '').map((x) => x.id)).toEqual(['1']);
    });

    it('filters by faction', () => {
        expect(filterFleet(fleet, '', 'XAOC').map((x) => x.id)).toEqual(['2']);
    });
});

describe('last ship storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips', () => {
        expect(readLastShipId()).toBeNull();
        writeLastShipId('x');
        expect(readLastShipId()).toBe('x');
    });
});
```

Use real `FactionName` keys for `faction` values if `asFactionName` doesn't accept `'MPL'`/`'XAOC'` as written (read `src/constants/factions.ts`).

- [ ] **Step 2: Implement `fleetOrder.ts`**

```ts
import { RARITY_ORDER } from '../../../constants/rarities';
import { asFactionName } from '../../../constants/factions';
import type { Ship } from '../../../types/ship';

const LAST_SHIP_KEY = 'arcade:lastShipId';

const rarityRank = (rarity: string) => {
    const i = RARITY_ORDER.indexOf(rarity);
    return i === -1 ? RARITY_ORDER.length : i;
};

/** Last chosen first, then rarity (legendary first), then level, highest first. */
export function orderFleet(ships: readonly Ship[], lastId: string | null): Ship[] {
    return [...ships].sort((a, b) => {
        if (a.id === lastId) return -1;
        if (b.id === lastId) return 1;
        return rarityRank(a.rarity) - rarityRank(b.rarity) || (b.level ?? 0) - (a.level ?? 0);
    });
}

/** `faction` is a `FactionName` key, or `''` for all. */
export function filterFleet(ships: readonly Ship[], query: string, faction: string): Ship[] {
    const q = query.trim().toLowerCase();
    return ships.filter(
        (s) =>
            (!q || s.name.toLowerCase().includes(q)) &&
            (!faction || asFactionName(s.faction) === faction)
    );
}

export function readLastShipId(): string | null {
    try {
        return localStorage.getItem(LAST_SHIP_KEY);
    } catch {
        return null;
    }
}

export function writeLastShipId(id: string): void {
    try {
        localStorage.setItem(LAST_SHIP_KEY, id);
    } catch {
        // Storage blocked: the choice simply isn't remembered.
    }
}
```

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade/ships` → PASS.

- [ ] **Step 3: Accent colour in the neon fighter**

In `src/components/arcade/neonFighter.ts`: import `type NeonAccent` from `./ships/factionTint`; add to `NeonFighterPose`:

```ts
    /** Hull outline colour; defaults to the neon pink. */
    accent?: NeonAccent;
```

Inside `drawNeonFighter`, compute `const pink = pose.accent?.core ?? NEON_PINK; const pinkGlow = pose.accent?.glow ?? NEON_PINK_GLOW;` and replace every `neonStroke(NEON_PINK, NEON_PINK_GLOW, …)` call with `neonStroke(pink, pinkGlow, …)`. Cyan details, canopy, flames, nav lights stay.

- [ ] **Step 4: Renderer uses the accent**

In `src/components/arcade/flightRenderer.ts`: import `type NeonAccent`; add `playerAccent: NeonAccent | null;` to `FlightView`; `createFlightView(origin?: FlightOrigin, accent: NeonAccent | null = null)` sets `playerAccent: accent`; in `drawPlayer` pass `accent: view.playerAccent ?? undefined` to `drawNeonFighter`.

- [ ] **Step 5: Build `FighterSelect.tsx`**

Props as in Interfaces. Behaviour:
- `ordered = orderFleet(ships, initialShipId)`, then `visible = filterFleet(ordered, query, faction)`; `index` clamps into `visible` when filters change (reset to 0).
- Card centred over the canvas (`absolute inset-0 flex items-center justify-center` wrapper, inner `card w-full max-w-md space-y-4`), heading "Choose your ship".
- `SearchInput` (name) and `Select` (faction: `''` → "All factions", then `FACTION_NAMES` with `FACTIONS[k].name` labels).
- Carousel: `Button variant="secondary"` "Previous" / "Next" around the ship view; the ship view is `<img src={portraitUrl} alt={ship.name} className="h-48 mx-auto object-contain" />` when `portraitUrl` exists, else a neutral placeholder `<div>` with the ship name. Under it: name, faction label (`getFaction(ship.faction)?.name ?? ship.faction`), rarity label (`getRarity(ship.rarity)?.label`) with its `textColor` class, `Level {ship.level ?? '?'}`.
- `Button` "Launch" calls `onLaunch(visible[index])`; `Button variant="secondary"` "Quit" calls `onQuit`.
- Empty `visible` → "No ships match." and Launch disabled.
- Keyboard (window `keydown`): ignored when `document.activeElement` is an `INPUT`/`TEXTAREA`/`[role=combobox]`; ArrowLeft/ArrowRight browse (wrap around), Enter launches. Escape is already handled by `FlightGame`.
- Swipe: `onPointerDown`/`onPointerUp` on the ship view; horizontal delta > 40 px browses.
- Accept a render prop `renderShip?: (ship: Ship, visual: ShipVisual) => React.ReactNode` so Task 6 can slot in the 3D model without rewriting this component; default renders the portrait as above.

- [ ] **Step 6: Wire the select phase into `FlightGame`**

Changes in `src/components/arcade/FlightGame.tsx`:
- `type Phase = 'select' | 'intro' | 'running' | 'paused' | 'countdown' | 'duel' | 'over';` (`'duel'` is used in Task 5; add now so the union is final).
- `const { ships } = useShips();` (from `../../contexts/ShipsContext`).
- `const flownRef = useRef<Ship | null>(null);` and `const duelsRef = useRef(false);`.
- Initial phase: `startOrigin` → `'intro'`; else `ships.length > 0` → `'select'`; else `'running'`.
- Easter egg (origin defined): before the first frame, `flownRef.current = ships.find((s) => s.id === readLastShipId()) ?? null` and build the initial view with that ship's accent. Compute this inside the existing `useState(() => …)` initialiser so the game and view are created with it: `createGame(newSeed(), { duels: canDuel(ships, flownRef.current?.id ?? null) })`.
- `launch(ship: Ship)`: `writeLastShipId(ship.id)`; `flownRef.current = ship`; `duelsRef.current = canDuel(ships, ship.id)`; `gameRef.current = createGame(newSeed(), { duels: duelsRef.current })`; `viewRef.current = createFlightView(undefined, factionAccent(ship.faction))`; reset inputs/HUD; `setPhase('running')`.
- `restart()` reuses `flownRef.current` and `duelsRef.current` (Retry does not re-show the select screen): `createGame(newSeed(), { duels: duelsRef.current })`, `createFlightView(undefined, flownRef.current ? factionAccent(flownRef.current.faction) : null)`.
- While `'select'`, the frame loop only renders (the existing `else { acc = 0; }` branch covers it). `isPausable` excludes `'select'` and `'duel'`. The keyboard handler already ignores phases other than running/paused for actions; ensure `p` (pause) does nothing in `'select'`.
- Render `<FighterSelect ships={ships} initialShipId={readLastShipId()} onLaunch={launch} onQuit={onClose} />` when `phase === 'select'`, and hide the HUD score/credits and Pause button during `'select'` (Quit stays).
- `ShipsContext` overlays template skill text asynchronously; reading `ships` at launch time is fine.

- [ ] **Step 7: Verify**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade src/utils/arcade && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

Manual (`npm start`, port 3000 — check `lsof -i :3000` first; if a server already runs from the main tree, start this worktree's on another port with `npx vite --port 3010`): `/arcade` → Start shows the select screen with portraits; arrows/Enter work; search and faction filter work; Launch starts a run with a tinted fighter; Retry restarts without the select screen; the background easter egg skips the select screen. Take a screenshot of the select screen (claude-in-chrome) and save it under the session scratchpad.

- [ ] **Step 8: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add src/components/arcade && git commit -m "feat(arcade): choose a ship from your fleet before a run"
```

---

### Task 5: Duels in the run — gates on the track, duel flow, summary

**Files:**
- Create: `src/components/arcade/duel/stakesText.ts`, `src/components/arcade/duel/DuelSummary.tsx`
- Modify: `src/components/arcade/flightRenderer.ts`, `src/components/arcade/FlightGame.tsx`
- Test: `src/components/arcade/duel/__tests__/stakesText.test.ts`

**Interfaces:**
- Consumes: `Checkpoint`, `DuelEffect`, `resolveDuel` (Task 1); `pickOpponents`, `runDuel`, `DuelResult` (Task 2); `useShipVisuals`, `loadPortrait`, `cachedPortrait` (Task 3); phase `'duel'`, `flownRef`, `duelsRef` (Task 4).
- Produces:
  - `stakesBanner(stakes: DuelStakes): string`, `effectText(effect: DuelEffect): string`
  - `interface GateArt { name: string; level: number | undefined; portraitUrl: string | null }`
  - `FlightView` gains `gateArt: Map<number, [GateArt, GateArt]>`
  - `DuelSummary` props: `{ player: DuelSide; opponent: DuelSide; stakes: DuelStakes; result: DuelResult | null; effect: DuelEffect | null; onDone: () => void }` with `interface DuelSide { name: string; level: number | undefined; imageUrl: string | null }`

- [ ] **Step 1: Failing test for the copy**

```ts
import { describe, it, expect } from 'vitest';
import { effectText, stakesBanner } from '../stakesText';

describe('stakesText', () => {
    it('labels every stakes kind', () => {
        expect(stakesBanner('win-or-die')).toBe('WIN OR DIE');
        expect(stakesBanner('bonus-or-penalty')).toBe('CREDITS ON THE LINE');
        expect(stakesBanner('power-up')).toBe('POWER-UP');
    });

    it('describes every effect', () => {
        expect(effectText({ kind: 'bonus', amount: 500 })).toBe('+500');
        expect(effectText({ kind: 'credits', delta: 25 })).toBe('+25 credits');
        expect(effectText({ kind: 'credits', delta: -12 })).toBe('−12 credits');
        expect(effectText({ kind: 'credits', delta: 0 })).toBe('No credits lost');
        expect(effectText({ kind: 'shield' })).toBe('Shield!');
        expect(effectText({ kind: 'magnet' })).toBe('Magnet!');
        expect(effectText({ kind: 'shield-absorbed' })).toBe('Shield absorbed the defeat');
        expect(effectText({ kind: 'game-over' })).toBe('Destroyed');
        expect(effectText({ kind: 'none' })).toBe('No reward');
    });
});
```

- [ ] **Step 2: Implement `stakesText.ts`**

```ts
import type { DuelEffect, DuelStakes } from '../../../utils/arcade/types';

export function stakesBanner(stakes: DuelStakes): string {
    switch (stakes) {
        case 'win-or-die':
            return 'WIN OR DIE';
        case 'bonus-or-penalty':
            return 'CREDITS ON THE LINE';
        case 'power-up':
            return 'POWER-UP';
    }
}

export function effectText(effect: DuelEffect): string {
    switch (effect.kind) {
        case 'bonus':
            return `+${effect.amount}`;
        case 'credits':
            if (effect.delta > 0) return `+${effect.delta} credits`;
            if (effect.delta < 0) return `−${-effect.delta} credits`;
            return 'No credits lost';
        case 'shield':
            return 'Shield!';
        case 'magnet':
            return 'Magnet!';
        case 'shield-absorbed':
            return 'Shield absorbed the defeat';
        case 'game-over':
            return 'Destroyed';
        case 'none':
            return 'No reward';
    }
}
```

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade/duel` → PASS.

- [ ] **Step 3: Draw checkpoints on the track**

In `flightRenderer.ts`:
- Export `interface GateArt { name: string; level: number | undefined; portraitUrl: string | null }`; add `gateArt: Map<number, [GateArt, GateArt]>` to `FlightView` (initialised to `new Map()` in `createFlightView`).
- `drawCheckpoint(ctx, g, c: Checkpoint, art: [GateArt, GateArt] | undefined)`: for each slot, project the gate lane at `c.z`; draw a glowing neon arch frame (reuse the obstacle's projection/fade-in maths, colour `#b06cff`), inside it the opponent portrait clipped to a circle (`cachedPortrait(url)`; if not loaded, a filled circle in the frame colour), and the name + `Lv N` beneath in a small white font scaled by `p.scale` (skip text when the font would be under 8 px). Draw a banner with `stakesBanner(c.stakes)` centred above the row (at the centre lane's projected position, above the arch tops).
- Add checkpoints to the depth-sorted `items` list in `renderFlight` so they occlude correctly: `...game.checkpoints.map((c) => ({ z: c.z, checkpoint: c }))`, and dispatch in `drawItem`.

- [ ] **Step 4: `DuelSummary.tsx`**

Overlay: `absolute inset-0 z-[55] flex items-center justify-center bg-black/70` (above the canvas and HUD at z-50's children, below Modal z-[60]). Inner `card w-full max-w-lg space-y-4 text-center`.
- `result === null` → "Simulating…" with both sides shown, no bars moving.
- With a result: two columns facing each other — left the player (`imageUrl` img or name placeholder), right the opponent mirrored with `-scale-x-100`; under each, name + level and a `ProgressBar` (`current={hp}`, `total={100}`, `percentage={hp}`) for HP. Read `ProgressBar` first and use its real props.
- Animation: `requestAnimationFrame` loop advancing `t` from 0 to `ANIM_SECONDS = 5`; current point = timeline index `Math.min(len-1, floor(t / 5 * len))`; show "Round N".
- When the animation ends (or the user presses Space / clicks the overlay): show the banner "Victory" / "Defeat" (or "Duel skipped" for `'skipped'`) and `effectText(effect)`, plus `Button` "Continue" that calls `onDone`. A second Space / click also calls `onDone`.
- `'skipped'` with an empty timeline skips straight to the result.
- Keyboard listener on `window` in capture phase for Space only; `preventDefault` so the run doesn't get a jump.

- [ ] **Step 5: Duel flow in `FlightGame`**

- After each frame's step loop, assign opponents to new checkpoints:

```ts
for (const c of game.checkpoints) {
    if (view.gateArt.has(c.id) || !flownRef.current) continue;
    const pick = pickOpponents(ships, flownRef.current.id, Math.random);
    if (!pick) continue;
    opponentsRef.current.set(c.id, pick);
    view.gateArt.set(c.id, pick.map(toGateArt) as [GateArt, GateArt]);
}
```

where `toGateArt(ship)` = `{ name: ship.name, level: ship.level, portraitUrl: visualOf(ship).portraitUrl }` and also calls `void loadPortrait(url).catch(() => {})` so the image is ready when drawn. `ships` and `visualOf` (from `useShipVisuals()`) are read through refs inside the loop effect (`shipsRef`, `visualOfRef`) so the effect does not restart. `opponentsRef = useRef(new Map<number, [Ship, Ship]>())`, cleared in `launch`/`restart`.
- Change the step loop's exit handling: after the while loop, `if (game.status === 'duel') startDuel();` alongside the existing `'over'` handling. Extract the existing over-handling into `finishRun()` (`runResult` → `setResult` → local best → `setPhase('over')`).
- `startDuel()`: `setPhase('duel')`; read `game.pendingDuel`; `opponent = opponentsRef.current.get(pending.checkpointId)?.[pending.slot]`; if missing (should not happen) → `resolveDuel(game, 'skipped')`, countdown. Else `setDuel({ player: side(flown), opponent: side(opponent), stakes: pending.stakes, result: null, effect: null })`, then `window.setTimeout(async () => { … }, 0)` so "Simulating…" paints first: `const { runDuel } = await import('./duel/runDuel');` → `const r = runDuel(flown, opponent, { getGearPiece, getEngineeringStatsForShipType }, newSeed())` → `const effect = resolveDuel(gameRef.current, r.outcome)` → `setDuel((d) => d && { ...d, result: r, effect })`. A rejected import → treat as `{ outcome: 'skipped', timeline: [] }`. Guard with a generation ref so an unmount/quit mid-duel never writes state.
- `getGearPiece` from `useInventory()`, `getEngineeringStatsForShipType` from `useEngineeringStats()`; read via refs like `ships`.
- `onDuelDone()`: `setDuel(null)`; refresh HUD from the game; if `gameRef.current.status === 'over'` → `finishRun()`; else `setCountdown(COUNTDOWN_SECONDS); setPhase('countdown')`.
- Render `{phase === 'duel' && duel && <DuelSummary … onDone={onDuelDone} />}`.
- `isPausable('duel')` stays false; Escape still quits.

- [ ] **Step 6: Verify**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade src/utils/arcade && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

Manual on the dev server with a fleet of ≥ 3 ships (signed out with a local fleet is fine): fly ~600 m; a checkpoint appears with two portraits, names/levels and a stakes banner; the empty lane passes with nothing; a gate starts a duel showing "Simulating…" then animated HP bars and a result; Continue resumes via 3-2-1; a lost win-or-die ends the run (or eats the shield); score includes the bonus. With 2 ships in the fleet, no checkpoints appear. Screenshot a checkpoint and a duel summary into the scratchpad.

- [ ] **Step 7: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add src/components/arcade && git commit -m "feat(arcade): duel fleet ships at random checkpoints"
```

---

### Task 6: Official 3D models behind `VITE_ARCADE_SHIP_MODELS`

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/components/arcade/FighterSelect.tsx` (via its `renderShip` prop from the caller), `src/components/arcade/flightRenderer.ts`, `src/components/arcade/FlightGame.tsx`
- Create: `src/components/arcade/ships/shipModelLoader.ts`, `src/components/arcade/ships/shipSprites.ts`, `src/components/arcade/ships/ShipModelView.tsx`
- Test: `src/components/arcade/ships/__tests__/shipModelLoader.test.ts`

**Interfaces:**
- Consumes: `shipModelsEnabled()`, `ShipVisual.visualKey`, `FighterSelect.renderShip`.
- Produces:
  - `modelUrls(key: string): { fbx: string; albedo: string; emissive: string; normal: string; orm: string }`
  - `loadShipModel(key: string, timeoutMs?: number): Promise<THREE.Group>` (cached per key; rejects after 10 s)
  - `BANK_ANGLES_DEG = [-30, -15, 0, 15, 30] as const`
  - `renderShipSprites(key: string, size?: number): Promise<HTMLCanvasElement[]>` (5 frames, transparent)
  - `ShipModelView` props `{ visualKey: string; fallback: React.ReactNode }`
  - `FlightView` gains `playerFrames: HTMLCanvasElement[] | null`; `GateArt` gains `spriteUrl?: string | null`

- [ ] **Step 1: Install three, pinned**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm install --save-exact three@0.186.1 && npm install --save-exact --save-dev @types/three@0.186.0 && npm run audit
```

Expected: `package.json` has `"three": "0.186.1"` and `"@types/three": "0.186.0"`; audit passes.

- [ ] **Step 2: Failing loader test (URL + timeout + cache, three mocked)**

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('three/addons/loaders/FBXLoader.js', () => ({
    FBXLoader: class {
        loadAsync = vi.fn(() => new Promise(() => {}));
    },
}));

import { loadShipModel, modelUrls } from '../shipModelLoader';

afterEach(() => vi.useRealTimers());

describe('shipModelLoader', () => {
    it('builds the official render URLs', () => {
        expect(modelUrls('Atlas_4')).toEqual({
            fbx: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_LOD0.fbx',
            albedo: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_A.webp',
            emissive: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_E.webp',
            normal: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_N.webp',
            orm: 'https://starborne.com/ship-renders/Atlas_4/Atlas_4_ORM.webp',
        });
    });

    it('rejects after the timeout', async () => {
        vi.useFakeTimers();
        const p = loadShipModel('Slow_1', 10_000);
        const assertion = expect(p).rejects.toThrow(/timed out/);
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });
});
```

Run → FAIL (module missing).

- [ ] **Step 3: Implement `shipModelLoader.ts`**

Before writing the material mapping, load one model in the browser console of the dev server (flag on) and log `object.children` names, material names and `new THREE.Box3().setFromObject(object)` — do not assume FBX units or mesh names. Then:

```ts
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const BASE = 'https://starborne.com/ship-renders';
const TIMEOUT_MS = 10_000;
/** The FBX's own texture references are replaced below, so its requests resolve to nothing. */
const EMPTY_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function modelUrls(key: string) {
    const at = (suffix: string) => `${BASE}/${key}/${key}_${suffix}`;
    return {
        fbx: at('LOD0.fbx'),
        albedo: at('A.webp'),
        emissive: at('E.webp'),
        normal: at('N.webp'),
        orm: at('ORM.webp'),
    };
}

const cache = new Map<string, Promise<THREE.Group>>();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
        p.then(
            (v) => {
                clearTimeout(id);
                resolve(v);
            },
            (e) => {
                clearTimeout(id);
                reject(e);
            }
        );
    });
}

async function load(key: string): Promise<THREE.Group> {
    const urls = modelUrls(key);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (url === urls.fbx ? url : EMPTY_PIXEL));
    const textures = new THREE.TextureLoader();
    textures.setCrossOrigin('anonymous');
    const [object, albedo, emissive, normal, orm] = await Promise.all([
        new FBXLoader(manager).loadAsync(urls.fbx),
        textures.loadAsync(urls.albedo),
        textures.loadAsync(urls.emissive),
        textures.loadAsync(urls.normal),
        textures.loadAsync(urls.orm),
    ]);
    albedo.colorSpace = THREE.SRGBColorSpace;
    emissive.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    orm.colorSpace = THREE.NoColorSpace;
    // ORM packs occlusion (R), roughness (G), metalness (B) — the channels MeshStandardMaterial reads.
    const material = new THREE.MeshStandardMaterial({
        map: albedo,
        emissiveMap: emissive,
        emissive: new THREE.Color(0xffffff),
        normalMap: normal,
        aoMap: orm,
        roughnessMap: orm,
        metalnessMap: orm,
    });
    object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = material;
    });
    // Centre and normalise so callers can frame any ship the same way.
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    object.position.sub(box.getCenter(new THREE.Vector3()));
    const wrapper = new THREE.Group();
    wrapper.add(object);
    wrapper.scale.setScalar(2 / size);
    return wrapper;
}

/** Session-cached; a failed or timed-out load is evicted so a later call retries. Callers fall back
 *  to the portrait on rejection. */
export function loadShipModel(key: string, timeoutMs = TIMEOUT_MS): Promise<THREE.Group> {
    let p = cache.get(key);
    if (!p) {
        p = withTimeout(load(key), timeoutMs, `ship model ${key}`);
        p.catch(() => cache.delete(key));
        cache.set(key, p);
    }
    return p;
}
```

If the browser check shows the model's nose points along a different axis, apply the needed base rotation on `wrapper` here (one place) so "from behind" means the same for every caller. Verify the official viewer's orientation visually against `https://starborne.com/frontiers/units/<slug>`.

Run the loader test → PASS.

- [ ] **Step 4: `shipSprites.ts` and `ShipModelView.tsx`**

`shipSprites.ts`: `renderShipSprites(key, size = 256)` → `loadShipModel(key)`, create one `THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })` sized `size×size`, a `PerspectiveCamera` placed behind and slightly above the ship looking at the origin, ambient + directional + a pink/cyan rim light; for each angle in `BANK_ANGLES_DEG`, clone the model (`model.clone()`), rotate around its forward axis by the angle, render, and copy `renderer.domElement` into a fresh 2D canvas (`drawImage`). Dispose the renderer (`renderer.dispose()`, `renderer.forceContextLoss()`) in `finally`. Return the 5 canvases.

`ShipModelView.tsx`: a `<canvas>` with its own small three renderer rotating the model around Y (rAF loop, disposed on unmount / key change); while loading or on rejection renders `fallback`.

- [ ] **Step 5: Use them only when the flag is on**

- Select screen: in `FlightGame`, pass `renderShip` to `FighterSelect` only when `shipModelsEnabled()`; it lazy-loads `ShipModelView` with `React.lazy(() => import('./ships/ShipModelView'))` inside `Suspense` (fallback: the portrait), and renders the portrait when `visual.visualKey` is null.
- Launch: when `shipModelsEnabled() && visual.visualKey`, `import('./ships/shipSprites').then(m => m.renderShipSprites(key))` → `viewRef.current.playerFrames = frames`; on rejection keep the tinted fighter. The run starts immediately; frames swap in when ready.
- Renderer: in `drawPlayer`, if `view.playerFrames`, pick frame `Math.round((bank + 1) * 2)` (bank −1..1 → index 0..4), draw it centred at the fighter position sized `s * 4.4` wide (the fighter's footprint), applying the jump scale, duck `squash` (vertical scale) and intro cross-fade alpha as the fighter does. Keep the engine glow / flames: export the flame/glow part of `neonFighter.ts` as `drawEngineGlow(ctx, s, pose)` and call it before the sprite at the sprite's rear. Shield ring / break flash are unchanged.
- Gates and duel summary: when the flag is on and an opponent has a `visualKey`, render its 0° frame (`renderShipSprites(key, 128)` → `frames[2].toDataURL()`) as `GateArt.spriteUrl` / `DuelSide.imageUrl`; the portrait remains the fallback.
- Never import `three`, `shipModelLoader`, `shipSprites` or `ShipModelView` statically from any module that is reachable when the flag is off. Check with `grep -rn "from './ships/ship\(ModelLoader\|Sprites\)'\|from 'three'" src/components/arcade` — only the lazy modules themselves may match.

- [ ] **Step 6: Verify both flag states**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run src/components/arcade && npx tsc --noEmit && npm run lint && npx vite build && ls dist/assets | grep -i three
```

Expected: tests/tsc/lint clean; the build emits three in a separate chunk (not in the main entry chunk — confirm by grepping the entry `index-*.js` for `FBXLoader`: no match).

Manual: run the dev server with `VITE_ARCADE_SHIP_MODELS=1 npx vite --port 3010`: select screen shows a rotating model (portrait while loading); the run shows the rendered sprite banking on lane changes; gates/duel summary show rendered ships. Run again without the flag and confirm in the Network panel that no request goes to `starborne.com` and no three chunk loads. Screenshots of the select screen with the flag on and off into the scratchpad.

- [ ] **Step 7: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add package.json package-lock.json src/components/arcade && git commit -m "feat(arcade): official 3D ship models behind VITE_ARCADE_SHIP_MODELS"
```

---

### Task 7: Docs, changelog, final verification

**Files:**
- Modify: `src/pages/DocumentationPage.tsx` (arcade section, ~line 2521), `src/pages/ArcadePage.tsx`, `src/constants/changelog.ts`

- [ ] **Step 1: DocumentationPage** — in the `#arcade` section add two short paragraphs/list items: fighter select (pick a ship from your fleet before each run; last choice is remembered; cosmetic only in the runner) and checkpoint duels (every 600–1400 m two gates show ships from your hangar; flying into one runs a 1v1 combat simulation; stakes table in plain words: win-or-die, credits on the line, power-up; the free lane skips; needs at least three ships). No mention of 3D models (flag off in production).

- [ ] **Step 2: ArcadePage** — add one sentence to the intro card: "Pick a ship from your fleet to fly, and fly through a duel gate at a checkpoint to fight one of your other ships for points, credits or a power-up."

- [ ] **Step 3: Changelog** — `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:

```ts
export const UNRELEASED_CHANGES: string[] = [
    'Arcade: choose a ship from your fleet to fly.',
    'Arcade: duel ships from your hangar at random checkpoints.',
];
```

- [ ] **Step 4: Full verification**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx vitest run && npx tsc --noEmit && npm run lint && npm run audit
```

Expected: all green. Confirm `git grep -n "VITE_ARCADE_SHIP_MODELS" -- netlify.toml .env*` returns nothing.

- [ ] **Step 5: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && git add src/pages/DocumentationPage.tsx src/pages/ArcadePage.tsx src/constants/changelog.ts && git commit -m "docs(arcade): fighter select and checkpoint duels"
```
