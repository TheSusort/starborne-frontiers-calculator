# Synthwave Arcade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 3-lane runner mini game in which the player flies the synthwave background's rear-view fighter, with a local best and a global Supabase leaderboard.

**Architecture:** The background's stateless drawing code moves into `synthwaveScene.ts` so the background and the game share it. The game rules are pure TypeScript in `src/utils/arcade/` (seeded and testable). A fullscreen `FlightGame` overlay is mounted once in `App.tsx`. It opens on an `app:flight:start` window event, which comes from clicking the overhead ship (easter egg) or from the Start button on `/arcade`. The leaderboard is one table plus two `SECURITY DEFINER` RPCs.

**Tech Stack:** React 18, TypeScript, Canvas 2D, Tailwind, Vitest (jsdom), Supabase (Postgres RPC + RLS).

Spec: `docs/superpowers/specs/2026-10-18-synthwave-arcade-design.md`.

## Global Constraints

- **Node 22**: prefix every test/lint/commit command with `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`. The agent shell starts on Node 20.
- The husky pre-commit hook runs the full Vitest suite (about 1 min). Never use `--no-verify` on code commits.
- `docs/` is gitignored, so plan and spec files need `git add -f`.
- **Never run the Supabase CLI** in any form. The user applies migrations. Never edit `supabase/current-schema.sql`.
- UI must use `src/components/ui/` primitives (`Button`, `Modal`, `Input`, `DataTable`, `PageLayout`) and the `card` class. No raw `<button>`. No `dangerouslySetInnerHTML`. No emojis in UI text.
- jsdom has no 2D canvas context. Unit-test only pure modules: `src/utils/arcade/*`, `projection.ts`, `flightInput.ts`, `localBest.ts`, the hit test, and the leaderboard row parsers. Rendering is verified visually with `npm start` (port 3000). Do not add `vitest-canvas-mock`.
- Code comments: present-tense behaviour contracts only. No task numbers, no "moved from" history.
- z-index layers: Sidebar `z-20`, game overlay **`z-50`**, Modal portal `z-[60]`/`z-[80]`, tutorial `z-[100]`. The username `Modal` must stack above the overlay.
- Changelog entries: area prefix + 8–12 words, one per user-visible change.
- All work happens on branch `feat/synthwave-arcade` (it already holds the spec commit). It ships as **one PR**: Phase A = Tasks 1–6, Phase B = Tasks 7–10. Don't push or open the PR until all tasks are done.

## File map

| File | Responsibility |
| --- | --- |
| `src/components/theme/synthwaveScene.ts` (new) | Stateless scene drawing + geometry + overhead-ship hit test |
| `src/components/theme/SynthwaveCanvas.tsx` (modify) | Background loop; calls `synthwaveScene`; easter-egg pointer listener |
| `src/utils/arcade/{types,constants,rng,scoring,collision,spawner,engine}.ts` (new) | Pure game rules |
| `src/utils/arcade/leaderboardRows.ts` (new) | Runtime validation of RPC rows |
| `src/components/arcade/flightEvents.ts` (new) | `app:flight:start` / `app:flight:end` event contract |
| `src/components/arcade/projection.ts` (new) | World (lane, z) → screen mapping on the shared grid |
| `src/components/arcade/flightInput.ts` (new) | Key/swipe → `InputAction` |
| `src/components/arcade/localBest.ts` (new) | localStorage best score |
| `src/components/arcade/flightRenderer.ts` (new) | Draws a `GameState` |
| `src/components/arcade/FlightGame.tsx` (new) | Overlay: loop, input, HUD, pause, game over |
| `src/components/arcade/GameOverPanel.tsx` (new) | Game-over card |
| `src/components/arcade/ArcadeLeaderboard.tsx` (new) | Leaderboard table |
| `src/components/arcade/ArcadeUsernameModal.tsx` (new) | Pick a username before first submit |
| `src/components/arcade/useArcadeSubmission.ts` (new) | Submit flow state machine |
| `src/services/arcadeService.ts` (new) | RPC calls |
| `src/pages/ArcadePage.tsx` (new) | `/arcade` page |
| `src/components/ui/layout/Modal.tsx` (modify) | Export `useBodyScrollLock` |
| `src/services/userProfileService.ts` (modify) | Export `isValidUsername` |
| `src/App.tsx`, `src/components/ui/layout/Sidebar.tsx`, `src/constants/seo.ts` (modify) | Route, overlay mount, nav, SEO |
| `supabase/migrations/20261018000001_arcade_scores.sql` (new) | Table, RLS, RPCs |
| `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts` (modify) | Docs + changelog |

---

# Phase A — the game (local best only)

### Task 1: Extract the synthwave scene (move-only refactor)

**Files:**
- Create: `src/components/theme/synthwaveScene.ts`
- Modify: `src/components/theme/SynthwaveCanvas.tsx`
- Test: `src/components/theme/__tests__/synthwaveScene.test.ts`

**Interfaces — Produces:**
```ts
export const HORIZON_RATIO = 0.45;
export const GRID_NEAR_PLANE = 1;
export const GRID_FAR_PLANE = 15;
export interface SceneGeometry { w: number; h: number; horizonY: number; gridHeight: number; vanishX: number; }
export function sceneGeometry(w: number, h: number): SceneGeometry;
export function depthToScreenY(g: SceneGeometry, depth: number): number;
export interface Star { x: number; y: number; size: number; brightness: number; twinkleSpeed: number; twinkleOffset: number; }
export function createStars(count: number): Star[];
export interface SunCache { canvas: HTMLCanvasElement | null; frame: number; }
export const createSunCache = (): SunCache;
export function drawFighter(c: CanvasRenderingContext2D, s: number): void;
export function drawFighterRear(c: CanvasRenderingContext2D, s: number): void;
export function drawContrail(c: CanvasRenderingContext2D, points: { x: number; y: number }[], maxAlpha: number, maxWidth: number): void;
export function drawSky(ctx: CanvasRenderingContext2D, g: SceneGeometry): void;
export function drawStars(ctx: CanvasRenderingContext2D, g: SceneGeometry, stars: Star[], timeMs: number, animate: boolean): void;
export function drawSun(ctx: CanvasRenderingContext2D, g: SceneGeometry, cache: SunCache, timeMs: number, animate: boolean): void;
export function drawMountains(ctx: CanvasRenderingContext2D, g: SceneGeometry): void;
export function drawGround(ctx: CanvasRenderingContext2D, g: SceneGeometry): void;
export function drawGrid(ctx: CanvasRenderingContext2D, g: SceneGeometry, gridOffset: number): void;
export function drawFadeOverlay(ctx: CanvasRenderingContext2D, g: SceneGeometry): void;
export interface OverheadShipHit { x: number; y: number; size: number; progress: number; }
export const OVERHEAD_HIT_RADIUS = 36;
export function hitTestOverheadShip(ship: OverheadShipHit | null, px: number, py: number): boolean;
```

This is a **move**. Pixels must not change. Line numbers below refer to `SynthwaveCanvas.tsx` at commit `fc5c2a61`. Copy each block verbatim and change only the names listed.

- [ ] **Step 1: Write the failing test** for the pure helpers.

```ts
// src/components/theme/__tests__/synthwaveScene.test.ts
import { describe, it, expect } from 'vitest';
import {
    sceneGeometry,
    depthToScreenY,
    hitTestOverheadShip,
    OVERHEAD_HIT_RADIUS,
    GRID_NEAR_PLANE,
    GRID_FAR_PLANE,
} from '../synthwaveScene';

describe('sceneGeometry', () => {
    it('puts the horizon at 45% of the height and the vanishing point at the centre', () => {
        const g = sceneGeometry(1000, 800);
        expect(g.horizonY).toBe(360);
        expect(g.gridHeight).toBe(440);
        expect(g.vanishX).toBe(500);
    });
});

describe('depthToScreenY', () => {
    it('maps the near plane to the bottom and far depths toward the horizon', () => {
        const g = sceneGeometry(1000, 800);
        expect(depthToScreenY(g, GRID_NEAR_PLANE)).toBe(800);
        const far = depthToScreenY(g, GRID_FAR_PLANE);
        expect(far).toBeGreaterThan(g.horizonY);
        expect(far).toBeLessThan(g.horizonY + 40);
    });
});

describe('hitTestOverheadShip', () => {
    const ship = { x: 100, y: 100, size: 5, progress: 0.3 };
    it('hits inside the radius', () => {
        expect(hitTestOverheadShip(ship, 100 + OVERHEAD_HIT_RADIUS - 1, 100)).toBe(true);
    });
    it('misses outside the radius', () => {
        expect(hitTestOverheadShip(ship, 100 + OVERHEAD_HIT_RADIUS + 1, 100)).toBe(false);
    });
    it('misses once the ship is near the horizon', () => {
        expect(hitTestOverheadShip({ ...ship, progress: 0.9 }, 100, 100)).toBe(false);
    });
    it('misses when no ship is flying', () => {
        expect(hitTestOverheadShip(null, 100, 100)).toBe(false);
    });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/theme/__tests__/synthwaveScene.test.ts`
Expected: FAIL, cannot resolve `../synthwaveScene`.

- [ ] **Step 3: Create `synthwaveScene.ts`**

Header and pure helpers (write exactly):

```ts
export const HORIZON_RATIO = 0.45;
export const GRID_NEAR_PLANE = 1;
export const GRID_FAR_PLANE = 15;

export interface SceneGeometry {
    w: number;
    h: number;
    horizonY: number;
    gridHeight: number;
    vanishX: number;
}

export function sceneGeometry(w: number, h: number): SceneGeometry {
    const horizonY = h * HORIZON_RATIO;
    return { w, h, horizonY, gridHeight: h - horizonY, vanishX: w / 2 };
}

/** Screen Y of a grid depth; the horizontal grid lines use the same mapping. */
export function depthToScreenY(g: SceneGeometry, depth: number): number {
    return g.horizonY + g.gridHeight * (GRID_NEAR_PLANE / depth);
}

export interface Star {
    x: number;
    y: number;
    size: number;
    brightness: number;
    twinkleSpeed: number;
    twinkleOffset: number;
}

export function createStars(count: number): Star[] {
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
        stars.push({
            x: Math.random(),
            y: Math.random() * 0.5,
            size: Math.random() * 1.5 + 0.3,
            brightness: Math.random() * 0.6 + 0.2,
            twinkleSpeed: Math.random() * 2 + 1,
            twinkleOffset: Math.random() * Math.PI * 2,
        });
    }
    return stars;
}

export interface SunCache {
    canvas: HTMLCanvasElement | null;
    frame: number;
}

export const createSunCache = (): SunCache => ({ canvas: null, frame: -1 });

export interface OverheadShipHit {
    x: number;
    y: number;
    size: number;
    progress: number;
}

/** The fighter is ~11px wide, so the click target is a generous circle around it. */
export const OVERHEAD_HIT_RADIUS = 36;
const OVERHEAD_HIT_MAX_PROGRESS = 0.85;

export function hitTestOverheadShip(ship: OverheadShipHit | null, px: number, py: number): boolean {
    if (!ship || ship.progress >= OVERHEAD_HIT_MAX_PROGRESS) return false;
    const r = Math.max(OVERHEAD_HIT_RADIUS, ship.size * 3);
    const dx = px - ship.x;
    const dy = py - ship.y;
    return dx * dx + dy * dy <= r * r;
}
```

Then add these functions, bodies copied **verbatim** from `SynthwaveCanvas.tsx`. Inside each, first destructure `const { w, h, horizonY, gridHeight, vanishX } = g;` (only the names the body uses):

| Function | Source lines | Renames inside body |
| --- | --- | --- |
| `drawFighter(c, s)` | 127–146 | none |
| `drawFighterRear(c, s)` | 149–178 | none |
| `drawContrail(c, points, maxAlpha, maxWidth)` | 181–205 | none |
| `drawSky(ctx, g)` | 214–248 | none |
| `drawStars(ctx, g, stars, timeMs, animate)` | 251–260 | loop over `stars` instead of `starsRef.current`; `time` → `timeMs` |
| `drawMountains(ctx, g)` | 466–507 | none |
| `drawGround(ctx, g)` | 569–584 | none |
| `drawGrid(ctx, g, gridOffset)` | 587–697 | delete `const gridSpeed = animate ? gridOffsetRef.current : 0;` and use `const gridSpeed = gridOffset;`; delete `const gridBottom = h; const gridHeight = …; const vanishX = …;` and add `const gridBottom = h;`; `nearPlane`/`farPlane` → `GRID_NEAR_PLANE`/`GRID_FAR_PLANE` |
| `drawFadeOverlay(ctx, g)` | 700–706 | none |

`drawSun` wraps lines 312–323 (sun glow) plus 325–371 (cached body). `canvas` becomes `ctx.canvas`, `sunCanvasRef.current` becomes `cache.canvas`, and `lastSunDrawRef.current` becomes `cache.frame`. The zero-size guard returns instead of scheduling a frame:

```ts
export function drawSun(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    cache: SunCache,
    timeMs: number,
    animate: boolean
): void {
    const { w, h, horizonY } = g;
    const time = timeMs;
    const canvas = ctx.canvas;
    // lines 313–323 verbatim (sunR, sunX, sunY, outer glow)
    // lines 326 and 331–371 verbatim, with `sunCanvasRef.current` → `cache.canvas`,
    // `lastSunDrawRef.current` → `cache.frame`; replace lines 327–330 with:
    //     if (canvas.width === 0 || canvas.height === 0) return;
}
```

(The two comment lines in this skeleton say where the copied code goes. The finished file contains the copied code, not these comments.)

- [ ] **Step 4: Rewire `SynthwaveCanvas.tsx`**

- Delete the `Star` interface and import it from `./synthwaveScene` together with every function above.
- Replace `sunCanvasRef` and `lastSunDrawRef` with `const sunCacheRef = useRef<SunCache>(createSunCache());`. In `resize()`, replace the two invalidation lines with `sunCacheRef.current = createSunCache();`.
- Star generation (lines 76–88) becomes `if (starsRef.current.length === 0) starsRef.current = createStars(150);`.
- Delete the local `drawFighter`, `drawFighterRear` and `drawContrail` helpers. The calls stay the same and now resolve to the imports.
- In `render`, set `const g = sceneGeometry(w, h);` and keep `const { horizonY } = g;` for the code that stays (shooting stars, overhead ships, lightning, spaceships, particles, pulse). Replace the moved blocks, in their original order, with:
  - `drawSky(ctx, g)` (was 214–248)
  - `drawStars(ctx, g, starsRef.current, time, animate)` (251–260)
  - `if (canvas.width === 0 || canvas.height === 0) { animationRef.current = requestAnimationFrame(render); return; }` then `drawSun(ctx, g, sunCacheRef.current, time, animate)` (312–371). The guard must come **before** the overhead ships, as it does today.
  - `drawMountains(ctx, g)` (466–507)
  - `drawGround(ctx, g)` (569–584)
  - `drawGrid(ctx, g, animate ? gridOffsetRef.current : 0)` (587–697)
  - `drawFadeOverlay(ctx, g)` (700–706)
- The grid-pulse block (729–772) still reads `aspectRatio`, `vanishX` and `gridBottom`. Declare `const aspectRatio = w / h; const { vanishX } = g; const gridBottom = h;` just above it.

- [ ] **Step 5: Run the tests, then type-check and lint**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/theme && npx tsc --noEmit && npx eslint src/components/theme`
Expected: tests PASS, tsc 0 errors, eslint 0 problems.

- [ ] **Step 6: Visual check**

Run `npm start`, switch to the synthwave theme, and compare it with `main` (for example in a second worktree on another port). The sky, sun stripes, mountains, grid motion, overhead fighter and side fighters must look identical.

- [ ] **Step 7: Commit**

```bash
git add src/components/theme
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "refactor(theme): share synthwave scene drawing in synthwaveScene.ts"
```

---

### Task 2: Pure game engine

**Files:**
- Create: `src/utils/arcade/types.ts`, `constants.ts`, `rng.ts`, `scoring.ts`, `collision.ts`, `spawner.ts`, `engine.ts`
- Test: `src/utils/arcade/__tests__/engine.test.ts`, `src/utils/arcade/__tests__/spawner.test.ts`

**Interfaces — Produces:**
```ts
// types.ts
export type Lane = 0 | 1 | 2;
export type ObstacleKind = 'wall' | 'low' | 'high';
export type PickupKind = 'credit' | 'shield' | 'magnet';
export type PlayerAction = 'run' | 'jump' | 'duck';
export type InputAction = 'left' | 'right' | 'jump' | 'duck';
export interface Obstacle { id: number; kind: ObstacleKind; lane: Lane; z: number; resolved: boolean; }
export interface Pickup { id: number; kind: PickupKind; lane: Lane; z: number; resolved: boolean; collected: boolean; }
export interface PlayerState { lane: Lane; action: PlayerAction; actionTime: number; shield: boolean; magnetTime: number; }
export interface GameState {
    rngState: number; time: number; speed: number; distance: number; credits: number;
    player: PlayerState; obstacles: Obstacle[]; pickups: Pickup[];
    untilNextRow: number; nextId: number; status: 'running' | 'over'; shieldBreakTime: number;
}
export interface RunResult { score: number; credits: number; distance: number; }
// engine.ts
export function createGame(seed: number): GameState;
export function step(state: GameState, inputs: readonly InputAction[], dt: number): GameState;
// spawner.ts
export function spawnRow(state: GameState, z: number): { obstacles: Obstacle[]; pickups: Pickup[] };
// scoring.ts
export function metersTravelled(distanceUnits: number): number;
export function computeScore(state: GameState): number;
export function runResult(state: GameState): RunResult;
// constants.ts — all names in Step 3
```

- [ ] **Step 1: Write the failing engine tests**

```ts
// src/utils/arcade/__tests__/engine.test.ts
import { describe, it, expect } from 'vitest';
import { createGame, step } from '../engine';
import { computeScore } from '../scoring';
import {
    STEP_SECONDS,
    JUMP_SECONDS,
    MAX_SPEED,
    MAGNET_SECONDS,
    METERS_PER_UNIT,
    CREDIT_POINTS,
} from '../constants';
import type { GameState, ObstacleKind, PickupKind, PlayerAction, Lane } from '../types';

/** A game that never spawns, so each test places exactly what it needs. */
function quietGame(): GameState {
    const g = createGame(1);
    g.untilNextRow = Number.POSITIVE_INFINITY;
    return g;
}

function withObstacle(kind: ObstacleKind, lane: Lane, action: PlayerAction): GameState {
    const g = quietGame();
    g.player.action = action;
    g.player.actionTime = action === 'run' ? 0 : 10;
    g.obstacles.push({ id: 99, kind, lane, z: 0.01, resolved: false });
    return step(g, [], STEP_SECONDS);
}

function withPickup(kind: PickupKind, lane: Lane, playerLane: Lane, magnet: number): GameState {
    const g = quietGame();
    g.player.lane = playerLane;
    g.player.magnetTime = magnet;
    g.pickups.push({ id: 98, kind, lane, z: 0.01, resolved: false, collected: false });
    return step(g, [], STEP_SECONDS);
}

describe('lane changes', () => {
    it('starts in the middle lane and clamps at both edges', () => {
        const g = quietGame();
        expect(g.player.lane).toBe(1);
        step(g, ['left', 'left', 'left'], STEP_SECONDS);
        expect(g.player.lane).toBe(0);
        step(g, ['right', 'right', 'right', 'right'], STEP_SECONDS);
        expect(g.player.lane).toBe(2);
    });
});

describe('jump and duck', () => {
    it('a jump lasts JUMP_SECONDS and then returns to running', () => {
        const g = quietGame();
        step(g, ['jump'], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        const steps = Math.floor(JUMP_SECONDS / STEP_SECONDS) - 2;
        for (let i = 0; i < steps; i++) step(g, [], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        for (let i = 0; i < 4; i++) step(g, [], STEP_SECONDS);
        expect(g.player.action).toBe('run');
    });

    it('cannot start a duck or restart a jump mid-jump', () => {
        const g = quietGame();
        step(g, ['jump'], STEP_SECONDS);
        for (let i = 0; i < 10; i++) step(g, [], STEP_SECONDS);
        const remaining = g.player.actionTime;
        step(g, ['duck', 'jump'], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        expect(g.player.actionTime).toBeLessThan(remaining);
    });
});

describe('collision', () => {
    const cases: [ObstacleKind, PlayerAction, 'running' | 'over'][] = [
        ['wall', 'run', 'over'],
        ['wall', 'jump', 'over'],
        ['wall', 'duck', 'over'],
        ['low', 'run', 'over'],
        ['low', 'duck', 'over'],
        ['low', 'jump', 'running'],
        ['high', 'run', 'over'],
        ['high', 'jump', 'over'],
        ['high', 'duck', 'running'],
    ];
    it.each(cases)('%s in your lane while you %s → %s', (kind, action, expected) => {
        expect(withObstacle(kind, 1, action).status).toBe(expected);
    });

    it('an obstacle in another lane never hits', () => {
        expect(withObstacle('wall', 0, 'run').status).toBe('running');
    });

    it('a shield absorbs exactly one hit', () => {
        const g = quietGame();
        g.player.shield = true;
        g.obstacles.push({ id: 1, kind: 'wall', lane: 1, z: 0.01, resolved: false });
        step(g, [], STEP_SECONDS);
        expect(g.status).toBe('running');
        expect(g.player.shield).toBe(false);
        expect(g.shieldBreakTime).toBeGreaterThan(0);
        g.obstacles.push({ id: 2, kind: 'wall', lane: 1, z: 0.01, resolved: false });
        step(g, [], STEP_SECONDS);
        expect(g.status).toBe('over');
    });
});

describe('pickups', () => {
    it('collects a credit in your lane', () => {
        expect(withPickup('credit', 1, 1, 0).credits).toBe(1);
    });
    it('misses a credit in the next lane without a magnet', () => {
        expect(withPickup('credit', 2, 1, 0).credits).toBe(0);
    });
    it('a magnet collects a credit in the next lane', () => {
        expect(withPickup('credit', 2, 1, 3).credits).toBe(1);
    });
    it('a magnet does not reach two lanes away', () => {
        expect(withPickup('credit', 2, 0, 3).credits).toBe(0);
    });
    it('a magnet does not pull power-ups from other lanes', () => {
        expect(withPickup('shield', 2, 1, 3).player.shield).toBe(false);
    });
    it('a shield pickup arms the shield', () => {
        expect(withPickup('shield', 1, 1, 0).player.shield).toBe(true);
    });
    it('a magnet pickup runs for MAGNET_SECONDS', () => {
        expect(withPickup('magnet', 1, 1, 0).player.magnetTime).toBeCloseTo(MAGNET_SECONDS, 5);
    });
});

describe('speed and score', () => {
    it('accelerates and caps at MAX_SPEED', () => {
        const g = quietGame();
        const start = g.speed;
        step(g, [], 1);
        expect(g.speed).toBeGreaterThan(start);
        for (let i = 0; i < 1000; i++) step(g, [], 1);
        expect(g.speed).toBe(MAX_SPEED);
    });

    it('score = metres + credits × CREDIT_POINTS', () => {
        const g = quietGame();
        g.distance = 400;
        g.credits = 3;
        expect(computeScore(g)).toBe(Math.floor(400 * METERS_PER_UNIT) + 3 * CREDIT_POINTS);
    });

    it('a finished game does not advance', () => {
        const g = withObstacle('wall', 1, 'run');
        const d = g.distance;
        step(g, [], 1);
        expect(g.distance).toBe(d);
    });
});

describe('spawning through step', () => {
    it('spawns the first row once FIRST_ROW_DELAY units are travelled', () => {
        const g = createGame(7);
        expect(g.obstacles).toHaveLength(0);
        for (let i = 0; i < 400 && g.obstacles.length === 0; i++) step(g, [], STEP_SECONDS);
        expect(g.obstacles.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Write the failing spawner tests**

```ts
// src/utils/arcade/__tests__/spawner.test.ts
import { describe, it, expect } from 'vitest';
import { createGame } from '../engine';
import { spawnRow } from '../spawner';
import { SPAWN_Z } from '../constants';

function rows(seed: number, count: number, distance: number) {
    const g = createGame(seed);
    g.distance = distance;
    return Array.from({ length: count }, () => spawnRow(g, SPAWN_Z));
}

describe('spawnRow', () => {
    it('is deterministic for a seed', () => {
        const shape = (seed: number) =>
            rows(seed, 50, 5000).map((r) => [
                r.obstacles.map((o) => `${o.kind}@${o.lane}`).join(','),
                r.pickups.map((p) => `${p.kind}@${p.lane}`).join(','),
            ]);
        expect(shape(42)).toEqual(shape(42));
        expect(shape(42)).not.toEqual(shape(43));
    });

    it('always leaves at least one lane free of obstacles', () => {
        for (const r of rows(3, 500, 100000)) {
            const lanes = new Set(r.obstacles.map((o) => o.lane));
            expect(lanes.size).toBe(r.obstacles.length);
            expect(lanes.size).toBeLessThanOrEqual(2);
        }
    });

    it('never puts a pickup in a lane that has an obstacle in the same row', () => {
        for (const r of rows(5, 500, 100000)) {
            const blocked = new Set(r.obstacles.map((o) => o.lane));
            for (const p of r.pickups) expect(blocked.has(p.lane)).toBe(false);
        }
    });

    it('starts with single obstacles and introduces doubles as distance grows', () => {
        const early = rows(9, 200, 0);
        const late = rows(9, 200, 100000);
        expect(early.every((r) => r.obstacles.length === 1)).toBe(true);
        expect(late.some((r) => r.obstacles.length === 2)).toBe(true);
    });

    it('produces every obstacle kind and both power-ups over a long run', () => {
        const all = rows(11, 2000, 100000);
        const kinds = new Set(all.flatMap((r) => r.obstacles.map((o) => o.kind)));
        const pickups = new Set(all.flatMap((r) => r.pickups.map((p) => p.kind)));
        expect([...kinds].sort()).toEqual(['high', 'low', 'wall']);
        expect([...pickups].sort()).toEqual(['credit', 'magnet', 'shield']);
    });
});
```

- [ ] **Step 3: Run both test files and confirm they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/utils/arcade`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

```ts
// src/utils/arcade/types.ts
export type Lane = 0 | 1 | 2;
export type ObstacleKind = 'wall' | 'low' | 'high';
export type PickupKind = 'credit' | 'shield' | 'magnet';
export type PlayerAction = 'run' | 'jump' | 'duck';
export type InputAction = 'left' | 'right' | 'jump' | 'duck';

/** `z` is world units ahead of the player; the player sits at z = 0. */
export interface Obstacle {
    id: number;
    kind: ObstacleKind;
    lane: Lane;
    z: number;
    /** Set when the obstacle crosses z = 0; collision is decided exactly once, at that crossing. */
    resolved: boolean;
}

export interface Pickup {
    id: number;
    kind: PickupKind;
    lane: Lane;
    z: number;
    resolved: boolean;
    collected: boolean;
}

export interface PlayerState {
    lane: Lane;
    action: PlayerAction;
    /** Seconds left in the current jump/duck; 0 while running. */
    actionTime: number;
    shield: boolean;
    magnetTime: number;
}

export interface GameState {
    rngState: number;
    time: number;
    speed: number;
    /** World units travelled; see `metersTravelled` for the displayed figure. */
    distance: number;
    credits: number;
    player: PlayerState;
    obstacles: Obstacle[];
    pickups: Pickup[];
    untilNextRow: number;
    nextId: number;
    status: 'running' | 'over';
    shieldBreakTime: number;
}

export interface RunResult {
    score: number;
    credits: number;
    distance: number;
}
```

```ts
// src/utils/arcade/constants.ts
export const LANE_COUNT = 3;
export const STEP_SECONDS = 1 / 120;
export const START_SPEED = 20;
export const MAX_SPEED = 48;
export const ACCELERATION = 0.4;
export const SPAWN_Z = 80;
export const ROW_GAP = 22;
export const FIRST_ROW_DELAY = 40;
export const DESPAWN_Z = -6;
export const JUMP_SECONDS = 0.75;
export const DUCK_SECONDS = 0.75;
export const MAGNET_SECONDS = 8;
export const SHIELD_BREAK_FLASH = 0.5;
export const METERS_PER_UNIT = 0.25;
export const CREDIT_POINTS = 10;
export const CREDITS_PER_TRAIL = 4;
export const CREDIT_SPACING = 4;
export const CREDIT_TRAIL_CHANCE = 0.7;
export const POWERUP_CHANCE = 0.08;
/** Metres at which the chance of a two-obstacle row reaches its cap. */
export const DOUBLE_ROW_RAMP_METERS = 1500;
export const DOUBLE_ROW_MAX_CHANCE = 0.6;
/** Rows before this many metres always carry a single obstacle. */
export const SINGLE_ROW_METERS = 100;
```

```ts
// src/utils/arcade/rng.ts
/** mulberry32. The whole generator state is one uint32 stored on the game, so a seed replays a run. */
export function nextRandom(state: { rngState: number }): number {
    state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
    let t = state.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
```

```ts
// src/utils/arcade/scoring.ts
import { CREDIT_POINTS, METERS_PER_UNIT } from './constants';
import type { GameState, RunResult } from './types';

export function metersTravelled(distanceUnits: number): number {
    return Math.floor(distanceUnits * METERS_PER_UNIT);
}

export function computeScore(state: GameState): number {
    return metersTravelled(state.distance) + state.credits * CREDIT_POINTS;
}

export function runResult(state: GameState): RunResult {
    return {
        score: computeScore(state),
        credits: state.credits,
        distance: metersTravelled(state.distance),
    };
}
```

```ts
// src/utils/arcade/collision.ts
import type { ObstacleKind, Pickup, PlayerAction, PlayerState } from './types';

/** wall: only a lane change avoids it. low: jump over. high: duck under. */
export function blocks(kind: ObstacleKind, action: PlayerAction): boolean {
    if (kind === 'wall') return true;
    if (kind === 'low') return action !== 'jump';
    return action !== 'duck';
}

/** The magnet reaches adjacent lanes for credits only; power-ups need your own lane. */
export function canCollect(pickup: Pickup, player: PlayerState): boolean {
    if (pickup.lane === player.lane) return true;
    return (
        pickup.kind === 'credit' &&
        player.magnetTime > 0 &&
        Math.abs(pickup.lane - player.lane) === 1
    );
}
```

```ts
// src/utils/arcade/spawner.ts
import {
    CREDIT_SPACING,
    CREDIT_TRAIL_CHANCE,
    CREDITS_PER_TRAIL,
    DOUBLE_ROW_MAX_CHANCE,
    DOUBLE_ROW_RAMP_METERS,
    POWERUP_CHANCE,
    ROW_GAP,
    SINGLE_ROW_METERS,
} from './constants';
import { nextRandom } from './rng';
import { metersTravelled } from './scoring';
import type { GameState, Lane, Obstacle, ObstacleKind, Pickup } from './types';

function shuffledLanes(state: GameState): Lane[] {
    const lanes: Lane[] = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
        const j = Math.floor(nextRandom(state) * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes;
}

function pickKind(roll: number): ObstacleKind {
    if (roll < 0.4) return 'wall';
    if (roll < 0.7) return 'low';
    return 'high';
}

/**
 * Adds one row at depth `z` to `state` and returns what it added. A row holds at most two
 * obstacles in distinct lanes, so a free lane always exists; the credit trail uses a free lane.
 */
export function spawnRow(state: GameState, z: number): { obstacles: Obstacle[]; pickups: Pickup[] } {
    const meters = metersTravelled(state.distance);
    const doubleChance =
        meters < SINGLE_ROW_METERS
            ? 0
            : Math.min(DOUBLE_ROW_MAX_CHANCE, (meters / DOUBLE_ROW_RAMP_METERS) * DOUBLE_ROW_MAX_CHANCE);
    const count = nextRandom(state) < doubleChance ? 2 : 1;
    const lanes = shuffledLanes(state);

    const obstacles: Obstacle[] = [];
    for (let i = 0; i < count; i++) {
        obstacles.push({
            id: state.nextId++,
            kind: pickKind(nextRandom(state)),
            lane: lanes[i],
            z,
            resolved: false,
        });
    }

    const pickups: Pickup[] = [];
    if (nextRandom(state) < CREDIT_TRAIL_CHANCE) {
        const lane = lanes[count];
        const powerUp =
            nextRandom(state) < POWERUP_CHANCE
                ? nextRandom(state) < 0.5
                    ? 'shield'
                    : 'magnet'
                : null;
        const start = z + ROW_GAP * 0.25;
        for (let i = 0; i < CREDITS_PER_TRAIL; i++) {
            pickups.push({
                id: state.nextId++,
                kind: powerUp && i === 1 ? powerUp : 'credit',
                lane,
                z: start + i * CREDIT_SPACING,
                resolved: false,
                collected: false,
            });
        }
    }

    state.obstacles.push(...obstacles);
    state.pickups.push(...pickups);
    return { obstacles, pickups };
}
```

```ts
// src/utils/arcade/engine.ts
import { blocks, canCollect } from './collision';
import {
    ACCELERATION,
    DESPAWN_Z,
    DUCK_SECONDS,
    FIRST_ROW_DELAY,
    JUMP_SECONDS,
    LANE_COUNT,
    MAGNET_SECONDS,
    MAX_SPEED,
    ROW_GAP,
    SHIELD_BREAK_FLASH,
    SPAWN_Z,
    START_SPEED,
} from './constants';
import { spawnRow } from './spawner';
import type { GameState, InputAction, Lane, PlayerState } from './types';

export function createGame(seed: number): GameState {
    return {
        rngState: seed >>> 0,
        time: 0,
        speed: START_SPEED,
        distance: 0,
        credits: 0,
        player: { lane: 1, action: 'run', actionTime: 0, shield: false, magnetTime: 0 },
        obstacles: [],
        pickups: [],
        untilNextRow: FIRST_ROW_DELAY,
        nextId: 1,
        status: 'running',
        shieldBreakTime: 0,
    };
}

/** A jump or duck cannot start until the current one ends; lane changes are always allowed. */
function applyInput(player: PlayerState, action: InputAction): void {
    switch (action) {
        case 'left':
            player.lane = Math.max(0, player.lane - 1) as Lane;
            break;
        case 'right':
            player.lane = Math.min(LANE_COUNT - 1, player.lane + 1) as Lane;
            break;
        case 'jump':
            if (player.action === 'run') {
                player.action = 'jump';
                player.actionTime = JUMP_SECONDS;
            }
            break;
        case 'duck':
            if (player.action === 'run') {
                player.action = 'duck';
                player.actionTime = DUCK_SECONDS;
            }
            break;
    }
}

/**
 * Advances `state` by `dt` seconds in place and returns it. The loop calls it with
 * `STEP_SECONDS`, so behaviour does not depend on the display's frame rate.
 */
export function step(state: GameState, inputs: readonly InputAction[], dt: number): GameState {
    if (state.status === 'over') return state;
    const player = state.player;
    for (const input of inputs) applyInput(player, input);

    if (player.action !== 'run') {
        player.actionTime -= dt;
        if (player.actionTime <= 0) {
            player.action = 'run';
            player.actionTime = 0;
        }
    }
    player.magnetTime = Math.max(0, player.magnetTime - dt);
    state.shieldBreakTime = Math.max(0, state.shieldBreakTime - dt);

    state.time += dt;
    state.speed = Math.min(MAX_SPEED, state.speed + ACCELERATION * dt);
    const travel = state.speed * dt;
    state.distance += travel;
    for (const o of state.obstacles) o.z -= travel;
    for (const p of state.pickups) p.z -= travel;

    state.untilNextRow -= travel;
    while (state.untilNextRow <= 0) {
        spawnRow(state, SPAWN_Z + state.untilNextRow);
        state.untilNextRow += ROW_GAP;
    }

    for (const o of state.obstacles) {
        if (o.resolved || o.z > 0) continue;
        o.resolved = true;
        if (o.lane !== player.lane || !blocks(o.kind, player.action)) continue;
        if (player.shield) {
            player.shield = false;
            state.shieldBreakTime = SHIELD_BREAK_FLASH;
        } else {
            state.status = 'over';
        }
    }

    for (const p of state.pickups) {
        if (p.resolved || p.z > 0) continue;
        p.resolved = true;
        if (!canCollect(p, player)) continue;
        p.collected = true;
        if (p.kind === 'credit') state.credits++;
        else if (p.kind === 'shield') player.shield = true;
        else player.magnetTime = MAGNET_SECONDS;
    }

    state.obstacles = state.obstacles.filter((o) => o.z > DESPAWN_Z);
    state.pickups = state.pickups.filter((p) => p.z > DESPAWN_Z && !p.collected);
    return state;
}
```

- [ ] **Step 5: Run the tests**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/utils/arcade`
Expected: all PASS. If `'is deterministic for a seed'` fails only on the `not.toEqual` half, change seed 43 to another value. Do not weaken the equality half.

- [ ] **Step 6: Non-vacuity check (temporary, do not commit)**

Change `blocks` to `return false` and confirm the collision cases fail. Change `spawnRow`'s `count` cap so 3 obstacles can occur (`? 3 : 1`) and confirm `'always leaves at least one lane free'` fails. Revert both.

- [ ] **Step 7: Commit**

```bash
git add src/utils/arcade
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): pure lane-runner engine with seeded spawner"
```

---

### Task 3: Projection, input mapping, local best, flight events

**Files:**
- Create: `src/components/arcade/projection.ts`, `flightInput.ts`, `localBest.ts`, `flightEvents.ts`
- Test: `src/components/arcade/__tests__/projection.test.ts`, `flightInput.test.ts`, `localBest.test.ts`

**Interfaces — Consumes:** `sceneGeometry`, `depthToScreenY`, `GRID_NEAR_PLANE`, `GRID_FAR_PLANE`, `SceneGeometry` (Task 1); `SPAWN_Z`, `InputAction` (Task 2).
**Produces:**
```ts
// projection.ts
export const PLAYER_DEPTH = 1.35;
export const DEPTH_PER_UNIT: number;
export function laneWidthAtPlayer(g: SceneGeometry): number;
export function project(g: SceneGeometry, laneX: number, z: number): { x: number; y: number; scale: number };
export function gridOffsetDelta(travelUnits: number): number;
// flightInput.ts
export const SWIPE_THRESHOLD_PX = 30;
export function keyToAction(key: string): InputAction | null;
export function swipeToAction(dx: number, dy: number): InputAction | null;
// localBest.ts
export const ARCADE_BEST_KEY = 'arcade_best';
export function readLocalBest(): number;
export function writeLocalBest(score: number): number;
// flightEvents.ts
export const FLIGHT_START_EVENT = 'app:flight:start';
export const FLIGHT_END_EVENT = 'app:flight:end';
export interface FlightOrigin { x: number; y: number; size: number; }
export interface FlightStartDetail { origin?: FlightOrigin; }
export function requestFlight(origin?: FlightOrigin): void;
export function announceFlightEnd(): void;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/arcade/__tests__/projection.test.ts
import { describe, it, expect } from 'vitest';
import { project, PLAYER_DEPTH, gridOffsetDelta, laneWidthAtPlayer } from '../projection';
import { sceneGeometry, depthToScreenY, GRID_FAR_PLANE, GRID_NEAR_PLANE } from '../../theme/synthwaveScene';
import { SPAWN_Z } from '../../../utils/arcade/constants';

const g = sceneGeometry(1200, 800);

describe('project', () => {
    it('puts the player row at PLAYER_DEPTH with scale 1', () => {
        const p = project(g, 0, 0);
        expect(p.scale).toBeCloseTo(1);
        expect(p.y).toBeCloseTo(depthToScreenY(g, PLAYER_DEPTH));
        expect(p.x).toBe(g.vanishX);
    });
    it('puts the spawn row on the grid far plane', () => {
        expect(project(g, 0, SPAWN_Z).y).toBeCloseTo(depthToScreenY(g, GRID_FAR_PLANE));
    });
    it('moves up the screen and shrinks as z grows', () => {
        const near = project(g, 1, 10);
        const far = project(g, 1, 40);
        expect(far.y).toBeLessThan(near.y);
        expect(far.scale).toBeLessThan(near.scale);
        expect(far.x - g.vanishX).toBeLessThan(near.x - g.vanishX);
    });
    it('places lanes one lane-width apart at the player row', () => {
        expect(project(g, 1, 0).x - project(g, 0, 0).x).toBeCloseTo(laneWidthAtPlayer(g));
    });
    it('stays finite behind the player', () => {
        expect(Number.isFinite(project(g, 0, -6).y)).toBe(true);
    });
});

describe('gridOffsetDelta', () => {
    it('scrolls one full grid cycle per far-to-near span of world travel', () => {
        expect(gridOffsetDelta(SPAWN_Z)).toBeCloseTo(
            (GRID_FAR_PLANE - PLAYER_DEPTH) / (GRID_FAR_PLANE - GRID_NEAR_PLANE)
        );
    });
});
```

```ts
// src/components/arcade/__tests__/flightInput.test.ts
import { describe, it, expect } from 'vitest';
import { keyToAction, swipeToAction, SWIPE_THRESHOLD_PX } from '../flightInput';

describe('keyToAction', () => {
    it.each([
        ['ArrowLeft', 'left'], ['a', 'left'], ['A', 'left'],
        ['ArrowRight', 'right'], ['d', 'right'],
        ['ArrowUp', 'jump'], ['w', 'jump'], [' ', 'jump'],
        ['ArrowDown', 'duck'], ['s', 'duck'],
    ])('%s → %s', (key, action) => {
        expect(keyToAction(key)).toBe(action);
    });
    it('ignores other keys', () => {
        expect(keyToAction('Enter')).toBeNull();
        expect(keyToAction('x')).toBeNull();
    });
});

describe('swipeToAction', () => {
    it('ignores short drags', () => {
        expect(swipeToAction(SWIPE_THRESHOLD_PX - 1, 0)).toBeNull();
    });
    it('uses the dominant axis', () => {
        expect(swipeToAction(-50, 10)).toBe('left');
        expect(swipeToAction(50, -10)).toBe('right');
        expect(swipeToAction(10, -50)).toBe('jump');
        expect(swipeToAction(-10, 50)).toBe('duck');
    });
});
```

```ts
// src/components/arcade/__tests__/localBest.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readLocalBest, writeLocalBest, ARCADE_BEST_KEY } from '../localBest';

beforeEach(() => localStorage.clear());

describe('localBest', () => {
    it('is 0 when nothing is stored or the value is junk', () => {
        expect(readLocalBest()).toBe(0);
        localStorage.setItem(ARCADE_BEST_KEY, 'banana');
        expect(readLocalBest()).toBe(0);
    });
    it('keeps the maximum', () => {
        expect(writeLocalBest(500)).toBe(500);
        expect(writeLocalBest(200)).toBe(500);
        expect(readLocalBest()).toBe(500);
    });
    it('survives storage that throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(writeLocalBest(300)).toBe(300);
        spy.mockRestore();
    });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/components/arcade/projection.ts
import {
    depthToScreenY,
    GRID_FAR_PLANE,
    GRID_NEAR_PLANE,
    SceneGeometry,
} from '../theme/synthwaveScene';
import { SPAWN_Z } from '../../utils/arcade/constants';

/** Grid depth of the player row: slightly above the bottom edge of the screen. */
export const PLAYER_DEPTH = 1.35;
/** Maps world z onto grid depth so the spawn row lands on the grid's far plane. */
export const DEPTH_PER_UNIT = (GRID_FAR_PLANE - PLAYER_DEPTH) / SPAWN_Z;
const MIN_DEPTH = 0.2;

export function laneWidthAtPlayer(g: SceneGeometry): number {
    return Math.min(g.w * 0.26, g.h * 0.42);
}

/** `laneX` is the lane offset from the centre (-1, 0, 1, or fractional while sliding). */
export function project(g: SceneGeometry, laneX: number, z: number) {
    const depth = Math.max(MIN_DEPTH, PLAYER_DEPTH + z * DEPTH_PER_UNIT);
    const scale = PLAYER_DEPTH / depth;
    return {
        x: g.vanishX + laneX * laneWidthAtPlayer(g) * scale,
        y: depthToScreenY(g, depth),
        scale,
    };
}

/** Grid scroll (in `drawGrid`'s 0..1 offset units) that matches `travelUnits` of world travel. */
export function gridOffsetDelta(travelUnits: number): number {
    return (travelUnits * DEPTH_PER_UNIT) / (GRID_FAR_PLANE - GRID_NEAR_PLANE);
}
```

```ts
// src/components/arcade/flightInput.ts
import type { InputAction } from '../../utils/arcade/types';

export const SWIPE_THRESHOLD_PX = 30;

export function keyToAction(key: string): InputAction | null {
    switch (key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            return 'left';
        case 'ArrowRight':
        case 'd':
        case 'D':
            return 'right';
        case 'ArrowUp':
        case 'w':
        case 'W':
        case ' ':
            return 'jump';
        case 'ArrowDown':
        case 's':
        case 'S':
            return 'duck';
        default:
            return null;
    }
}

export function swipeToAction(dx: number, dy: number): InputAction | null {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) return null;
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'jump' : 'duck';
}
```

```ts
// src/components/arcade/localBest.ts
/** Deliberately not in `StorageKey`: that map feeds the data backup, and a game score is not player data. */
export const ARCADE_BEST_KEY = 'arcade_best';

export function readLocalBest(): number {
    try {
        const n = Number(localStorage.getItem(ARCADE_BEST_KEY));
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
        return 0;
    }
}

/** Stores max(previous, score) and returns it; storage failures keep the best for this session only. */
export function writeLocalBest(score: number): number {
    const best = Math.max(readLocalBest(), Math.floor(score));
    try {
        localStorage.setItem(ARCADE_BEST_KEY, String(best));
    } catch {
        // storage unavailable (private mode, quota)
    }
    return best;
}
```

```ts
// src/components/arcade/flightEvents.ts
export const FLIGHT_START_EVENT = 'app:flight:start';
export const FLIGHT_END_EVENT = 'app:flight:end';

/** Viewport coordinates and size of the background fighter the player clicked. */
export interface FlightOrigin {
    x: number;
    y: number;
    size: number;
}

export interface FlightStartDetail {
    origin?: FlightOrigin;
}

export function requestFlight(origin?: FlightOrigin): void {
    window.dispatchEvent(
        new CustomEvent<FlightStartDetail>(FLIGHT_START_EVENT, { detail: { origin } })
    );
}

export function announceFlightEnd(): void {
    window.dispatchEvent(new Event(FLIGHT_END_EVENT));
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/arcade
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): projection, input mapping, local best and flight events"
```

---

### Task 4: Renderer and the FlightGame overlay

**Files:**
- Create: `src/components/arcade/flightRenderer.ts`, `src/components/arcade/FlightGame.tsx`, `src/components/arcade/GameOverPanel.tsx`
- Modify: `src/components/ui/layout/Modal.tsx` (export `useBodyScrollLock`)

**Interfaces — Consumes:** Tasks 1–3.
**Produces:**
```ts
// Modal.tsx
export function useBodyScrollLock(active: boolean): void;
// flightRenderer.ts
export const INTRO_SECONDS = 1.2;
export interface FlightView { gridOffset: number; playerX: number; stars: Star[]; sun: SunCache; intro: FlightOrigin | null; introElapsed: number; }
export function createFlightView(origin?: FlightOrigin): FlightView;
export function advanceView(view: FlightView, travelUnits: number): void;
export function renderFlight(ctx: CanvasRenderingContext2D, game: GameState, view: FlightView, timeMs: number, dt: number): void;
// FlightGame.tsx (default export)
interface FlightGameProps { origin?: FlightOrigin; onClose: () => void; }
// GameOverPanel.tsx
interface GameOverPanelProps { result: RunResult; localBest: number; onRetry: () => void; onQuit: () => void; children?: React.ReactNode; }
```

No unit tests here: the canvas cannot run in jsdom, and the logic is already covered by Tasks 2–3. Verification is `tsc`, lint, and the manual checklist in Step 6.

- [ ] **Step 1: Export the scroll lock as a hook**

In `Modal.tsx`, add this below `releaseScrollLock` and replace the Modal's scroll-lock `useEffect` with `useBodyScrollLock(isOpen);`. Keep the existing explanatory comment and move it onto the hook:

```ts
/** Locks body scroll while `active`; reference-counted, so nested locks compose. */
export function useBodyScrollLock(active: boolean): void {
    useEffect(() => {
        if (!active) return;
        acquireScrollLock();
        return () => releaseScrollLock();
    }, [active]);
}
```

Run `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/ui/layout` and expect the existing Modal tests to PASS unchanged.

- [ ] **Step 2: Renderer**

```ts
// src/components/arcade/flightRenderer.ts
import {
    createStars,
    createSunCache,
    drawFighterRear,
    drawGrid,
    drawGround,
    drawMountains,
    drawSky,
    drawStars,
    drawSun,
    sceneGeometry,
    SceneGeometry,
    Star,
    SunCache,
} from '../theme/synthwaveScene';
import { JUMP_SECONDS, SHIELD_BREAK_FLASH, SPAWN_Z } from '../../utils/arcade/constants';
import type { GameState, Obstacle, Pickup } from '../../utils/arcade/types';
import { gridOffsetDelta, laneWidthAtPlayer, project } from './projection';
import type { FlightOrigin } from './flightEvents';

export const INTRO_SECONDS = 1.2;
const LANE_SLIDE_RATE = 14;
const FADE_IN_UNITS = 10;

export interface FlightView {
    gridOffset: number;
    /** Rendered lane offset; eases toward the logical lane so lane changes slide. */
    playerX: number;
    stars: Star[];
    sun: SunCache;
    intro: FlightOrigin | null;
    introElapsed: number;
}

export function createFlightView(origin?: FlightOrigin): FlightView {
    return {
        gridOffset: 0,
        playerX: 0,
        stars: createStars(150),
        sun: createSunCache(),
        intro: origin ?? null,
        introElapsed: 0,
    };
}

export function advanceView(view: FlightView, travelUnits: number): void {
    view.gridOffset = (view.gridOffset + gridOffsetDelta(travelUnits)) % 1;
}

const laneOffset = (lane: number) => lane - 1;

function drawLaneRails(ctx: CanvasRenderingContext2D, g: SceneGeometry): void {
    ctx.strokeStyle = 'rgba(255, 120, 220, 0.35)';
    ctx.lineWidth = 2;
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
        const a = project(g, x, -2);
        const b = project(g, x, SPAWN_Z);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
}

function drawObstacle(ctx: CanvasRenderingContext2D, g: SceneGeometry, o: Obstacle): void {
    const p = project(g, laneOffset(o.lane), o.z);
    const u = laneWidthAtPlayer(g) * p.scale;
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z - o.z) / FADE_IN_UNITS));
    if (o.kind === 'wall') {
        ctx.fillStyle = 'rgba(255, 40, 140, 0.85)';
        ctx.strokeStyle = '#ff9ad5';
        ctx.lineWidth = Math.max(1, 2 * p.scale);
        ctx.fillRect(p.x - 0.42 * u, p.y - 0.9 * u, 0.84 * u, 0.9 * u);
        ctx.strokeRect(p.x - 0.42 * u, p.y - 0.9 * u, 0.84 * u, 0.9 * u);
    } else if (o.kind === 'low') {
        ctx.fillStyle = '#40f0ff';
        ctx.fillRect(p.x - 0.45 * u, p.y - 0.22 * u, 0.9 * u, 0.08 * u);
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.26 * u, 0.04 * u, 0.26 * u);
        ctx.fillRect(p.x + 0.43 * u, p.y - 0.26 * u, 0.04 * u, 0.26 * u);
    } else {
        ctx.fillStyle = '#ffb040';
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.95 * u, 0.94 * u, 0.14 * u);
        ctx.fillRect(p.x - 0.47 * u, p.y - 0.95 * u, 0.05 * u, 0.95 * u);
        ctx.fillRect(p.x + 0.42 * u, p.y - 0.95 * u, 0.05 * u, 0.95 * u);
    }
    ctx.globalAlpha = 1;
}

function drawPickup(ctx: CanvasRenderingContext2D, g: SceneGeometry, pk: Pickup, timeMs: number): void {
    const p = project(g, laneOffset(pk.lane), pk.z);
    const u = laneWidthAtPlayer(g) * p.scale;
    const bob = Math.sin(timeMs * 0.006 + pk.id) * 0.04 * u;
    const cx = p.x;
    const cy = p.y - 0.3 * u + bob;
    const r = 0.12 * u;
    ctx.globalAlpha = Math.min(1, Math.max(0, (SPAWN_Z - pk.z) / FADE_IN_UNITS));
    ctx.lineWidth = Math.max(1, 2 * p.scale);
    if (pk.kind === 'credit') {
        ctx.fillStyle = '#ffe04a';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.7, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.7, cy);
        ctx.closePath();
        ctx.fill();
    } else if (pk.kind === 'shield') {
        ctx.strokeStyle = '#40f0ff';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        ctx.strokeStyle = '#ff60c0';
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 0, true);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function drawPlayer(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    game: GameState,
    view: FlightView
): void {
    const base = project(g, view.playerX, 0);
    const u = laneWidthAtPlayer(g);
    let s = u * 0.16;
    let x = base.x;
    let y = base.y - u * 0.25;
    let squash = 1;

    const { action, actionTime } = game.player;
    if (action === 'jump') {
        const t = 1 - actionTime / JUMP_SECONDS;
        const arc = Math.sin(Math.PI * t);
        y -= arc * u * 0.6;
        s *= 1 + arc * 0.25;
    } else if (action === 'duck') {
        squash = 0.55;
        y += u * 0.08;
    }

    if (view.intro && view.introElapsed < INTRO_SECONDS) {
        const t = view.introElapsed / INTRO_SECONDS;
        const e = 1 - (1 - t) * (1 - t);
        x = view.intro.x + (x - view.intro.x) * e;
        y = view.intro.y + (y - view.intro.y) * e;
        s = view.intro.size + (s - view.intro.size) * e;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash);
    const glow = ctx.createRadialGradient(0, s * 0.6, 0, 0, s * 0.6, s * 2);
    glow.addColorStop(0, 'rgba(220, 180, 255, 0.8)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-s * 2, -s * 1.4, s * 4, s * 4);
    ctx.fillStyle = '#0d0620';
    ctx.strokeStyle = '#e070ff';
    ctx.lineWidth = 1.5;
    drawFighterRear(ctx, s);
    ctx.stroke();
    ctx.restore();

    if (game.player.shield) {
        ctx.strokeStyle = 'rgba(64, 240, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, s * 3, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (game.shieldBreakTime > 0) {
        const k = 1 - game.shieldBreakTime / SHIELD_BREAK_FLASH;
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, s * (3 + k * 3), 0, Math.PI * 2);
        ctx.stroke();
    }
}

export function renderFlight(
    ctx: CanvasRenderingContext2D,
    game: GameState,
    view: FlightView,
    timeMs: number,
    dt: number
): void {
    const w = ctx.canvas.offsetWidth;
    const h = ctx.canvas.offsetHeight;
    if (w === 0 || h === 0) return;
    const g = sceneGeometry(w, h);

    const target = laneOffset(game.player.lane);
    view.playerX += (target - view.playerX) * Math.min(1, dt * LANE_SLIDE_RATE);

    ctx.clearRect(0, 0, w, h);
    drawSky(ctx, g);
    drawStars(ctx, g, view.stars, timeMs, true);
    drawSun(ctx, g, view.sun, timeMs, true);
    drawMountains(ctx, g);
    drawGround(ctx, g);
    drawGrid(ctx, g, view.gridOffset);
    drawLaneRails(ctx, g);

    const items: ({ z: number } & ({ obstacle: Obstacle } | { pickup: Pickup }))[] = [
        ...game.obstacles.map((o) => ({ z: o.z, obstacle: o })),
        ...game.pickups.filter((p) => !p.collected).map((p) => ({ z: p.z, pickup: p })),
    ];
    items.sort((a, b) => b.z - a.z);
    for (const item of items) {
        if ('obstacle' in item) drawObstacle(ctx, g, item.obstacle);
        else drawPickup(ctx, g, item.pickup, timeMs);
    }

    drawPlayer(ctx, g, game, view);
}
```

- [ ] **Step 3: Game-over panel**

```tsx
// src/components/arcade/GameOverPanel.tsx
import React from 'react';
import { Button } from '../ui/Button';
import type { RunResult } from '../../utils/arcade/types';

interface GameOverPanelProps {
    result: RunResult;
    localBest: number;
    onRetry: () => void;
    onQuit: () => void;
    children?: React.ReactNode;
}

export const GameOverPanel: React.FC<GameOverPanelProps> = ({
    result,
    localBest,
    onRetry,
    onQuit,
    children,
}) => {
    const isBest = result.score > 0 && result.score >= localBest;
    return (
        <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/50">
            <div className="card w-full max-w-md space-y-4 text-center max-h-full overflow-y-auto">
                <h2 className="text-2xl font-bold">Game over</h2>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <div className="text-theme-text-secondary text-sm">Score</div>
                        <div className="text-xl font-semibold">{result.score.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="text-theme-text-secondary text-sm">Distance</div>
                        <div className="text-xl font-semibold">{result.distance.toLocaleString()} m</div>
                    </div>
                    <div>
                        <div className="text-theme-text-secondary text-sm">Credits</div>
                        <div className="text-xl font-semibold">{result.credits}</div>
                    </div>
                </div>
                <p className={isBest ? 'text-primary font-semibold' : 'text-theme-text-secondary'}>
                    {isBest ? 'New personal best' : `Personal best: ${localBest.toLocaleString()}`}
                </p>
                {children}
                <div className="flex gap-2 justify-center">
                    <Button onClick={onRetry}>Try again</Button>
                    <Button variant="secondary" onClick={onQuit}>
                        Quit
                    </Button>
                </div>
            </div>
        </div>
    );
};
```

- [ ] **Step 4: The overlay**

```tsx
// src/components/arcade/FlightGame.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { useBodyScrollLock } from '../ui/layout/Modal';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { createGame, step } from '../../utils/arcade/engine';
import { STEP_SECONDS } from '../../utils/arcade/constants';
import { computeScore, runResult } from '../../utils/arcade/scoring';
import type { GameState, InputAction, RunResult } from '../../utils/arcade/types';
import { advanceView, createFlightView, FlightView, INTRO_SECONDS, renderFlight } from './flightRenderer';
import { keyToAction, swipeToAction } from './flightInput';
import { readLocalBest, writeLocalBest } from './localBest';
import { GameOverPanel } from './GameOverPanel';
import type { FlightOrigin } from './flightEvents';

type Phase = 'intro' | 'running' | 'paused' | 'countdown' | 'over';

const COUNTDOWN_SECONDS = 3;
/** A long frame (tab switch, GC pause) is clamped so the game never jumps ahead. */
const MAX_FRAME_SECONDS = 0.1;
const HUD_INTERVAL_SECONDS = 0.1;
const NO_INPUT: readonly InputAction[] = [];

const newSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

interface FlightGameProps {
    origin?: FlightOrigin;
    onClose: () => void;
}

const FlightGame: React.FC<FlightGameProps> = ({ origin, onClose }) => {
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const startOrigin = reducedMotion ? undefined : origin;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<GameState>(createGame(newSeed()));
    const viewRef = useRef<FlightView>(createFlightView(startOrigin));
    const inputsRef = useRef<InputAction[]>([]);
    const phaseRef = useRef<Phase>(startOrigin ? 'intro' : 'running');
    const escapeBlockedRef = useRef(false);
    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

    const [phase, setPhaseState] = useState<Phase>(phaseRef.current);
    const [hud, setHud] = useState({ score: 0, credits: 0, shield: false, magnet: 0 });
    const [countdown, setCountdown] = useState(0);
    const [result, setResult] = useState<RunResult | null>(null);
    const [localBest, setLocalBest] = useState(readLocalBest);

    useBodyScrollLock(true);

    const setPhase = useCallback((p: Phase) => {
        phaseRef.current = p;
        setPhaseState(p);
    }, []);

    const resume = useCallback(() => {
        if (phaseRef.current !== 'paused') return;
        setCountdown(COUNTDOWN_SECONDS);
        setPhase('countdown');
    }, [setPhase]);

    const togglePause = useCallback(() => {
        if (phaseRef.current === 'running' || phaseRef.current === 'countdown') setPhase('paused');
        else resume();
    }, [resume, setPhase]);

    const restart = useCallback(() => {
        gameRef.current = createGame(newSeed());
        viewRef.current = createFlightView();
        inputsRef.current = [];
        setResult(null);
        setHud({ score: 0, credits: 0, shield: false, magnet: 0 });
        setPhase('running');
    }, [setPhase]);

    // Game loop: fixed-step simulation, render every frame.
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            viewRef.current.sun.canvas = null;
        };
        resize();
        window.addEventListener('resize', resize);

        let raf = 0;
        let last = performance.now();
        let acc = 0;
        let hudTimer = 0;

        const frame = (now: number) => {
            const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
            last = now;
            const game = gameRef.current;
            const view = viewRef.current;

            if (phaseRef.current === 'intro') {
                view.introElapsed += dt;
                if (view.introElapsed >= INTRO_SECONDS) setPhase('running');
            } else if (phaseRef.current === 'running') {
                acc += dt;
                let inputs: readonly InputAction[] = inputsRef.current.splice(0);
                while (acc >= STEP_SECONDS && game.status === 'running') {
                    const before = game.distance;
                    step(game, inputs, STEP_SECONDS);
                    inputs = NO_INPUT;
                    advanceView(view, game.distance - before);
                    acc -= STEP_SECONDS;
                }
                if (inputs.length > 0) inputsRef.current.unshift(...inputs);

                if (game.status === 'over') {
                    const r = runResult(game);
                    setResult(r);
                    setLocalBest(writeLocalBest(r.score));
                    setPhase('over');
                }
                hudTimer += dt;
                if (hudTimer >= HUD_INTERVAL_SECONDS) {
                    hudTimer = 0;
                    setHud({
                        score: computeScore(game),
                        credits: game.credits,
                        shield: game.player.shield,
                        magnet: game.player.magnetTime,
                    });
                }
            } else {
                acc = 0;
            }

            renderFlight(ctx, game, view, now, dt);
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, [setPhase]);

    // Resume countdown.
    useEffect(() => {
        if (phase !== 'countdown') return;
        if (countdown <= 0) {
            setPhase('running');
            return;
        }
        const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => window.clearTimeout(id);
    }, [phase, countdown, setPhase]);

    // Auto-pause when the tab is hidden or the window loses focus.
    useEffect(() => {
        const pause = () => {
            if (phaseRef.current === 'running' || phaseRef.current === 'countdown') setPhase('paused');
        };
        const onVisibility = () => {
            if (document.hidden) pause();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('blur', pause);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', pause);
        };
    }, [setPhase]);

    // Keyboard. Keys are only captured while flying or paused, so typing elsewhere is untouched.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (!escapeBlockedRef.current) onClose();
                return;
            }
            const p = phaseRef.current;
            if (p !== 'running' && p !== 'paused') return;
            if (e.key === 'p' || e.key === 'P') {
                togglePause();
                return;
            }
            const action = keyToAction(e.key);
            if (!action) return;
            e.preventDefault();
            if (p === 'running') inputsRef.current.push(action);
            else resume();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, resume, togglePause]);

    const onPointerDown = (e: React.PointerEvent) => {
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: React.PointerEvent) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!start) return;
        if (phaseRef.current === 'paused') {
            resume();
            return;
        }
        const action = swipeToAction(e.clientX - start.x, e.clientY - start.y);
        if (action && phaseRef.current === 'running') inputsRef.current.push(action);
    };

    return (
        <div
            className="fixed inset-0 z-50 bg-black select-none"
            role="dialog"
            aria-modal="true"
            aria-label="Synthwave arcade"
        >
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full touch-none"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
            />
            <div className="absolute top-0 inset-x-0 flex justify-between items-start p-4 pointer-events-none text-white font-mono">
                <div>
                    <div className="text-2xl">{hud.score.toLocaleString()}</div>
                    <div className="text-sm text-yellow-300">{hud.credits} credits</div>
                </div>
                <div className="flex gap-2 items-center pointer-events-auto">
                    {hud.shield && <span className="text-cyan-300 text-sm">SHIELD</span>}
                    {hud.magnet > 0 && (
                        <span className="text-pink-300 text-sm">MAGNET {Math.ceil(hud.magnet)}</span>
                    )}
                    {phase !== 'over' && (
                        <Button variant="secondary" size="sm" onClick={togglePause}>
                            {phase === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                        Quit
                    </Button>
                </div>
            </div>
            {phase === 'paused' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="card text-center space-y-3 pointer-events-auto">
                        <p className="text-xl font-semibold">Paused</p>
                        <Button onClick={resume}>Resume</Button>
                    </div>
                </div>
            )}
            {phase === 'countdown' && countdown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-6xl font-bold text-white">
                    {countdown}
                </div>
            )}
            {phase === 'over' && result && (
                <GameOverPanel
                    result={result}
                    localBest={localBest}
                    onRetry={restart}
                    onQuit={onClose}
                />
            )}
        </div>
    );
};

export default FlightGame;
```

`escapeBlockedRef` stays `false` in this phase. Task 9 sets it while the username modal is open.

- [ ] **Step 5: Type-check and lint**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && npx eslint src/components/arcade src/components/ui/layout/Modal.tsx`
Expected: 0 errors. The overlay is not mounted yet. Task 5 mounts it, and Task 5 Step 4 does the visual check.

- [ ] **Step 6: Commit**

```bash
git add src/components/arcade src/components/ui/layout/Modal.tsx
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): flight game overlay, renderer and game-over panel"
```

---

### Task 5: Mount the overlay, easter egg, /arcade page, nav, SEO

**Files:**
- Modify: `src/App.tsx`, `src/components/theme/SynthwaveCanvas.tsx`, `src/components/ui/layout/Sidebar.tsx`, `src/constants/seo.ts`
- Create: `src/pages/ArcadePage.tsx`

**Interfaces — Consumes:** `FLIGHT_START_EVENT`, `FlightStartDetail`, `requestFlight`, `announceFlightEnd`, `FLIGHT_END_EVENT` (Task 3); `hitTestOverheadShip`, `OverheadShipHit` (Task 1); `FlightGame` (Task 4); `readLocalBest` (Task 3).

- [ ] **Step 1: Easter egg in `SynthwaveCanvas.tsx`**

Add `const overheadHitRef = useRef<OverheadShipHit | null>(null);`. In the overhead-ship filter callback, directly after `const s = 5 * shipScale;`, add:

```ts
overheadHitRef.current = t < 1.0 && s > 0.4 ? { x: screenX, y: screenY, size: s, progress: t } : null;
```

After the `overheadShipsRef.current = overheadShipsRef.current.filter(...)` statement, add `if (overheadShipsRef.current.length === 0) overheadHitRef.current = null;`.

Add a second effect below the render effect:

```ts
// The background sits under the page (pointer-events: none), so clicks are read at the
// document and matched against the overhead fighter's last drawn position.
useEffect(() => {
    if (!animate) return;
    const onPointerDown = (e: PointerEvent) => {
        const canvas = canvasRef.current;
        if (!canvas || canvas.offsetWidth === 0) return;
        if ((e.target as Element | null)?.closest(INTERACTIVE_SELECTOR)) return;
        const rect = canvas.getBoundingClientRect();
        const ship = overheadHitRef.current;
        if (!ship || !hitTestOverheadShip(ship, e.clientX - rect.left, e.clientY - rect.top)) return;
        const flying = overheadShipsRef.current[0];
        if (flying) flying.progress = 1;
        overheadHitRef.current = null;
        requestFlight({ x: ship.x + rect.left, y: ship.y + rect.top, size: ship.size });
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
}, [animate]);
```

with, at module scope:

```ts
const INTERACTIVE_SELECTOR =
    'a, button, input, select, textarea, label, [role="button"], [contenteditable="true"]';
```

The `canvas.offsetWidth === 0` guard handles the dark theme, where `#synthwave-bg` is `display: none`.

- [ ] **Step 2: Mount in `App.tsx`**

Add these imports and lazy component:

```tsx
import {
    FLIGHT_START_EVENT,
    type FlightStartDetail,
    announceFlightEnd,
} from './components/arcade/flightEvents';
const FlightGame = lazy(() => import('./components/arcade/FlightGame'));
const ArcadePage = lazy(() => import('./pages/ArcadePage'));
```

In the `App` component body:

```tsx
const [flight, setFlight] = useState<FlightStartDetail | null>(null);

useEffect(() => {
    const onStart = (e: Event) => {
        const detail = (e as CustomEvent<FlightStartDetail>).detail ?? {};
        setFlight((current) => current ?? detail);
    };
    window.addEventListener(FLIGHT_START_EVENT, onStart);
    return () => window.removeEventListener(FLIGHT_START_EVENT, onStart);
}, []);

const closeFlight = useCallback(() => {
    setFlight(null);
    announceFlightEnd();
}, []);
```

(Add `useCallback` to the React import.) Change `<SynthwaveCanvas />` to `<SynthwaveCanvas animate={!flight} />`. Directly after the `#synthwave-bg` div, add:

```tsx
{flight && (
    <Suspense fallback={null}>
        <FlightGame origin={flight.origin} onClose={closeFlight} />
    </Suspense>
)}
```

Then add the route next to `/bounty-credits`:

```tsx
<Route path="/arcade" element={<ArcadePage />} />
```

(Format it like the surrounding routes. Prettier runs in pre-commit.)

- [ ] **Step 3: Page, nav, SEO**

`src/constants/seo.ts`: add next to `bountyCredits`:

```ts
arcade: {
    title: 'Arcade',
    description:
        'Fly the synthwave fighter in a lane-runner mini game: dodge walls, jump lasers, duck arches and collect credits.',
    keywords: 'starborne frontiers, mini game, arcade, synthwave',
},
```

`Sidebar.tsx`: in `publicNavigationLinks`, insert `{ path: '/arcade', label: 'Arcade' },` before `{ path: '/documentation', label: 'Help' }`.

```tsx
// src/pages/ArcadePage.tsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { FLIGHT_END_EVENT, requestFlight } from '../components/arcade/flightEvents';
import { readLocalBest } from '../components/arcade/localBest';

const ArcadePage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [best, setBest] = useState(readLocalBest);

    useEffect(() => {
        if (searchParams.get('play') !== '1') return;
        requestFlight();
        const next = new URLSearchParams(searchParams);
        next.delete('play');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const onEnd = () => setBest(readLocalBest());
        window.addEventListener(FLIGHT_END_EVENT, onEnd);
        return () => window.removeEventListener(FLIGHT_END_EVENT, onEnd);
    }, []);

    return (
        <>
            <Seo {...SEO_CONFIG.arcade} />
            <PageLayout
                title="Arcade"
                description="Take the controls of the synthwave fighter and see how far you can fly."
            >
                <div className="card space-y-4">
                    <p className="text-theme-text">
                        Dodge walls, jump over lasers, duck under arches and collect credits. The
                        speed keeps rising. Shields absorb one hit; magnets pull in credits from
                        the next lane.
                    </p>
                    <ul className="text-theme-text space-y-1 list-disc list-inside">
                        <li>
                            <strong>Left / Right, A / D, swipe sideways</strong> change lane
                        </li>
                        <li>
                            <strong>Up, W, Space, swipe up</strong> jump
                        </li>
                        <li>
                            <strong>Down, S, swipe down</strong> duck
                        </li>
                        <li>
                            <strong>P</strong> pauses, <strong>Esc</strong> quits
                        </li>
                    </ul>
                    <p className="text-theme-text-secondary">
                        Personal best: {best.toLocaleString()}
                    </p>
                    <Button onClick={() => requestFlight()}>Start</Button>
                </div>
            </PageLayout>
        </>
    );
};

export default ArcadePage;
```

- [ ] **Step 4: Verify**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && npx eslint src && npx vitest run src/components src/utils/arcade`
Expected: 0 errors, all PASS.

Manual check with `npm start` on port 3000. Every item must pass:
1. **Dark theme**, `/arcade` → Start: the overlay opens with the synthwave scene and the fighter flies in from the bottom.
2. Lane change slides smoothly. Jump clears cyan lasers, duck clears orange arches, and walls end the run.
3. Credits count up. A shield pickup shows the ring and absorbs one wall. The magnet shows a countdown.
4. Switching tabs pauses the game. Resume runs a 3-2-1 countdown.
5. Esc and Quit close the overlay and the page underneath scrolls again. The personal best on `/arcade` updates.
6. **Synthwave theme**: wait for the overhead fighter (about 20 s), click it on an empty area, and the game opens with the fighter flying from where it was. Clicking a button or link under the ship does **not** start the game.
7. `/arcade?play=1` starts the game directly, and the URL loses `?play=1`.
8. A DevTools mobile viewport (e.g. iPhone 12): swipes control the ship and the page does not scroll.
9. DevTools rendering emulation `prefers-reduced-motion: reduce`: clicking the ship starts the game with no fly-in animation.
10. The background animation resumes after closing the game in the synthwave theme.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/theme/SynthwaveCanvas.tsx src/components/ui/layout/Sidebar.tsx src/constants/seo.ts src/pages/ArcadePage.tsx
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): /arcade page, global overlay and background ship easter egg"
```

---

### Task 6: Phase A docs and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`

- [ ] **Step 1: Docs section**

In `DocumentationPage.tsx`, directly after the closing `</section>` of `id="classified"`, add:

```tsx
<section id="arcade" className="space-y-4 [counter-increment:section]">
    <h2 className="text-2xl font-bold before:content-[counter(section)'.'] before:mr-2">
        Arcade
    </h2>
    <div className="card space-y-4">
        <p className="text-theme-text">
            The Arcade (<code>/arcade</code>) is a lane-runner mini game in which you fly the
            synthwave fighter over the grid. In the synthwave theme you can also click the
            fighter flying over the background to take control of it from any page.
        </p>
        <div className="card">
            <h4 className="font-semibold text-primary mb-2">Controls</h4>
            <ul className="text-theme-text space-y-1 list-disc list-inside">
                <li>
                    <strong>Left / Right, A / D, swipe sideways</strong> — change lane
                </li>
                <li>
                    <strong>Up, W, Space, swipe up</strong> — jump over lasers
                </li>
                <li>
                    <strong>Down, S, swipe down</strong> — duck under arches
                </li>
                <li>
                    <strong>P</strong> — pause; <strong>Esc</strong> — quit
                </li>
            </ul>
        </div>
        <div className="card">
            <h4 className="font-semibold text-primary mb-2">Scoring</h4>
            <p className="text-theme-text">
                Score is metres flown plus 10 points per credit. Walls can only be dodged by
                changing lane. A shield absorbs one hit; a magnet collects credits from the
                neighbouring lanes for 8 seconds. Your personal best is saved in this browser.
            </p>
        </div>
    </div>
</section>
```

- [ ] **Step 2: Changelog**

```ts
export const UNRELEASED_CHANGES: string[] = [
    'Arcade: fly the synthwave fighter in a new lane-runner mini game.',
];
```

- [ ] **Step 3: Verify and commit**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && npx eslint src/pages/DocumentationPage.tsx src/constants/changelog.ts`

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "docs(arcade): document the arcade mini game"
```

---

# Phase B — global leaderboard

### Task 7: Migration

**Files:**
- Create: `supabase/migrations/20261018000001_arcade_scores.sql`

There are no automated tests, because the agent must not run the database. The user applies the migration. Step 2 is the checklist the reviewer reads the SQL against.

- [ ] **Step 1: Write the migration**

```sql
-- Arcade leaderboard: one best score per main account.
--
-- Scores are written only through submit_arcade_score, which keys the row on auth.uid() (the
-- main account; alt profiles never get a row) and keeps the higher score. Other players' rows
-- are read only through get_arcade_leaderboard, which exposes username and score and nothing
-- else. The score bound is a sanity check, not anti-cheat.
--
-- ON DELETE CASCADE: admin_delete_account deletes public.users rows; without the cascade a
-- player with a score could not be deleted.

CREATE TABLE public.arcade_scores (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  best_score integer NOT NULL CHECK (best_score BETWEEN 0 AND 10000000),
  best_credits integer NOT NULL DEFAULT 0 CHECK (best_credits >= 0),
  best_distance integer NOT NULL DEFAULT 0 CHECK (best_distance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX arcade_scores_best_score_idx ON public.arcade_scores (best_score DESC);

ALTER TABLE public.arcade_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own arcade score" ON public.arcade_scores
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own arcade score" ON public.arcade_scores
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own arcade score" ON public.arcade_scores
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own arcade score" ON public.arcade_scores
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.submit_arcade_score(
  p_score integer,
  p_credits integer,
  p_distance integer
)
RETURNS TABLE (best integer, player_rank integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.arcade_scores AS a (user_id, best_score, best_credits, best_distance, updated_at)
  VALUES (uid, p_score, p_credits, p_distance, now())
  ON CONFLICT (user_id) DO UPDATE
    SET best_score = EXCLUDED.best_score,
        best_credits = EXCLUDED.best_credits,
        best_distance = EXCLUDED.best_distance,
        updated_at = now()
    WHERE EXCLUDED.best_score > a.best_score;

  -- Rank uses the leaderboard's definition: players with a username, ties share a rank.
  RETURN QUERY
  SELECT s.best_score,
         (SELECT count(*)::integer + 1
            FROM public.arcade_scores o
            JOIN public.users u ON u.id = o.user_id
           WHERE u.username IS NOT NULL AND o.best_score > s.best_score)
    FROM public.arcade_scores s
   WHERE s.user_id = uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (player_rank integer, username text, best_score integer, is_me boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT u.username,
           a.best_score,
           a.user_id,
           rank() OVER (ORDER BY a.best_score DESC)::integer AS player_rank
      FROM public.arcade_scores a
      JOIN public.users u ON u.id = a.user_id
     WHERE u.username IS NOT NULL
  )
  SELECT r.player_rank, r.username, r.best_score, coalesce(r.user_id = auth.uid(), false)
    FROM ranked r
   WHERE r.player_rank <= LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
      OR r.user_id = auth.uid()
   ORDER BY r.player_rank, r.username;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default,
-- so both are revoked explicitly before the intended grants.
REVOKE ALL ON FUNCTION public.submit_arcade_score(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_arcade_score(integer, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(integer) TO anon, authenticated;
```

- [ ] **Step 2: Review the SQL against the checklist**

- RLS is enabled, with policies for all four operations, all `user_id = auth.uid()`. This is CLAUDE.md Security rule 4. `has_profile_access` is not used on purpose, because alt profiles must not own rows.
- Both functions are `SECURITY DEFINER` with `SET search_path = public`.
- `RETURNS TABLE` column names (`best`, `player_rank`) differ from the table columns, so plpgsql has no ambiguous references.
- `submit_arcade_score` cannot be executed by `anon`.
- No email or user id is returned by `get_arcade_leaderboard`.
- `supabase/current-schema.sql` is untouched.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261018000001_arcade_scores.sql
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): arcade_scores table and leaderboard RPCs"
```

---

### Task 8: Service and row validation

**Files:**
- Create: `src/utils/arcade/leaderboardRows.ts`, `src/services/arcadeService.ts`
- Modify: `src/services/userProfileService.ts`
- Test: `src/utils/arcade/__tests__/leaderboardRows.test.ts`

**Interfaces — Produces:**
```ts
// leaderboardRows.ts
export interface ArcadeLeaderboardEntry { rank: number; username: string; bestScore: number; isMe: boolean; }
export interface ArcadeSubmitResult { bestScore: number; rank: number; }
export function parseLeaderboardRows(data: unknown): ArcadeLeaderboardEntry[];
export function parseSubmitResult(data: unknown): ArcadeSubmitResult | null;
// arcadeService.ts
export function submitArcadeScore(run: RunResult): Promise<ArcadeSubmitResult | null>;
export function getArcadeLeaderboard(limit?: number): Promise<ArcadeLeaderboardEntry[]>;
// userProfileService.ts
export function isValidUsername(value: string): boolean;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/arcade/__tests__/leaderboardRows.test.ts
import { describe, it, expect } from 'vitest';
import { parseLeaderboardRows, parseSubmitResult } from '../leaderboardRows';

describe('parseLeaderboardRows', () => {
    it('maps RPC rows', () => {
        expect(
            parseLeaderboardRows([
                { player_rank: 1, username: 'Ace', best_score: 900, is_me: false },
                { player_rank: 7, username: 'Me', best_score: 100, is_me: true },
            ])
        ).toEqual([
            { rank: 1, username: 'Ace', bestScore: 900, isMe: false },
            { rank: 7, username: 'Me', bestScore: 100, isMe: true },
        ]);
    });
    it('drops malformed rows and tolerates non-arrays', () => {
        expect(parseLeaderboardRows(null)).toEqual([]);
        expect(
            parseLeaderboardRows([
                { player_rank: '1', username: 'A', best_score: 1 },
                { player_rank: 1, username: null, best_score: 1 },
                { player_rank: 1, username: 'B', best_score: 1.5 },
                'junk',
            ])
        ).toEqual([]);
    });
    it('treats a missing is_me as false', () => {
        expect(parseLeaderboardRows([{ player_rank: 2, username: 'X', best_score: 5 }])[0].isMe).toBe(
            false
        );
    });
});

describe('parseSubmitResult', () => {
    it('reads the first row of the RPC table', () => {
        expect(parseSubmitResult([{ best: 500, player_rank: 3 }])).toEqual({ bestScore: 500, rank: 3 });
    });
    it('returns null for an empty or malformed result', () => {
        expect(parseSubmitResult([])).toBeNull();
        expect(parseSubmitResult([{ best: 'x', player_rank: 1 }])).toBeNull();
    });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/utils/arcade/__tests__/leaderboardRows.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/arcade/leaderboardRows.ts
export interface ArcadeLeaderboardEntry {
    rank: number;
    username: string;
    bestScore: number;
    isMe: boolean;
}

export interface ArcadeSubmitResult {
    bestScore: number;
    rank: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validates `get_arcade_leaderboard` rows; a malformed row is dropped, never rendered. */
export function parseLeaderboardRows(data: unknown): ArcadeLeaderboardEntry[] {
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
        if (!isRecord(row)) return [];
        const { player_rank, username, best_score, is_me } = row;
        if (!isInt(player_rank) || typeof username !== 'string' || !isInt(best_score)) return [];
        return [{ rank: player_rank, username, bestScore: best_score, isMe: is_me === true }];
    });
}

/** Validates the single row `submit_arcade_score` returns. */
export function parseSubmitResult(data: unknown): ArcadeSubmitResult | null {
    const row = Array.isArray(data) ? data[0] : data;
    if (!isRecord(row)) return null;
    const { best, player_rank } = row;
    if (!isInt(best) || !isInt(player_rank)) return null;
    return { bestScore: best, rank: player_rank };
}
```

```ts
// src/services/arcadeService.ts
import { supabase } from '../config/supabase';
import type { RunResult } from '../utils/arcade/types';
import {
    ArcadeLeaderboardEntry,
    ArcadeSubmitResult,
    parseLeaderboardRows,
    parseSubmitResult,
} from '../utils/arcade/leaderboardRows';

export async function submitArcadeScore(run: RunResult): Promise<ArcadeSubmitResult | null> {
    const { data, error } = await supabase.rpc('submit_arcade_score', {
        p_score: run.score,
        p_credits: run.credits,
        p_distance: run.distance,
    });
    if (error) throw error;
    return parseSubmitResult(data);
}

export async function getArcadeLeaderboard(limit = 20): Promise<ArcadeLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_arcade_leaderboard', { p_limit: limit });
    if (error) throw error;
    return parseLeaderboardRows(data);
}
```

In `userProfileService.ts`, add this above `checkUsernameAvailability` and use it there in place of the inline regex:

```ts
const USERNAME_PATTERN = /^[a-zA-Z0-9 _-]{3,20}$/;

/** Mirrors the `users.username` CHECK constraint. */
export function isValidUsername(value: string): boolean {
    return USERNAME_PATTERN.test(value);
}
```

and in `checkUsernameAvailability`:

```ts
if (!isValidUsername(username)) {
    return false;
}
```

- [ ] **Step 4: Run tests, tsc, lint**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/utils/arcade src/services && npx tsc --noEmit && npx eslint src/services src/utils/arcade`
Expected: all PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/arcade/leaderboardRows.ts src/utils/arcade/__tests__/leaderboardRows.test.ts src/services/arcadeService.ts src/services/userProfileService.ts
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): leaderboard service with validated RPC rows"
```

---

### Task 9: Leaderboard UI, username modal, submission flow

**Files:**
- Create: `src/components/arcade/ArcadeLeaderboard.tsx`, `src/components/arcade/ArcadeUsernameModal.tsx`, `src/components/arcade/useArcadeSubmission.ts`
- Modify: `src/components/arcade/FlightGame.tsx`, `src/pages/ArcadePage.tsx`

**Interfaces — Consumes:** Task 8 (`submitArcadeScore`, `getArcadeLeaderboard`, `ArcadeLeaderboardEntry`, `isValidUsername`); `getUserProfile`, `updateUserProfile`, `checkUsernameAvailability` (existing `userProfileService`); `useAuth` (`src/contexts/AuthProvider`, `user.id` is the main account's `users.id`).
**Produces:**
```ts
export type SubmissionStatus = 'signed-out' | 'checking' | 'needs-username' | 'submitting' | 'submitted' | 'skipped' | 'error';
export function useArcadeSubmission(result: RunResult | null): {
    status: SubmissionStatus; rank: number | null; leaderboardVersion: number;
    retry: () => void; onUsernameSaved: () => void; skip: () => void;
};
export const ArcadeLeaderboard: React.FC<{ limit?: number; refreshKey?: number }>;
export const ArcadeUsernameModal: React.FC<{ isOpen: boolean; userId: string; onSaved: () => void; onCancel: () => void }>;
```

The submission flow uses `useAuth().user.id`, **not** `activeProfileId`. The score and the username belong to the main account even while an alt is active.

- [ ] **Step 1: Submission hook**

```ts
// src/components/arcade/useArcadeSubmission.ts
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { getUserProfile } from '../../services/userProfileService';
import { submitArcadeScore } from '../../services/arcadeService';
import type { RunResult } from '../../utils/arcade/types';

export type SubmissionStatus =
    | 'signed-out'
    | 'checking'
    | 'needs-username'
    | 'submitting'
    | 'submitted'
    | 'skipped'
    | 'error';

/**
 * Submits every finished run for a signed-in player; the RPC keeps the higher score, so the
 * client never compares against a stored best. A main account without a username is asked
 * for one first.
 */
export function useArcadeSubmission(result: RunResult | null) {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const [status, setStatus] = useState<SubmissionStatus>(userId ? 'checking' : 'signed-out');
    const [rank, setRank] = useState<number | null>(null);
    const [leaderboardVersion, setLeaderboardVersion] = useState(0);

    const submit = useCallback(async () => {
        if (!result) return;
        setStatus('submitting');
        try {
            const saved = await submitArcadeScore(result);
            setRank(saved?.rank ?? null);
            setStatus('submitted');
            setLeaderboardVersion((v) => v + 1);
        } catch (error) {
            console.error('Error submitting arcade score:', error);
            setStatus('error');
        }
    }, [result]);

    useEffect(() => {
        setRank(null);
        if (!result) return;
        if (!userId) {
            setStatus('signed-out');
            return;
        }
        let cancelled = false;
        setStatus('checking');
        getUserProfile(userId)
            .then((profile) => {
                if (cancelled) return;
                if (profile?.username) void submit();
                else setStatus('needs-username');
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Error loading profile for arcade score:', error);
                setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [result, userId, submit]);

    const retry = useCallback(() => void submit(), [submit]);
    const onUsernameSaved = useCallback(() => void submit(), [submit]);
    const skip = useCallback(() => setStatus('skipped'), []);

    return { status, rank, leaderboardVersion, retry, onUsernameSaved, skip };
}
```

- [ ] **Step 2: Username modal**

```tsx
// src/components/arcade/ArcadeUsernameModal.tsx
import React, { useState } from 'react';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import {
    checkUsernameAvailability,
    isValidUsername,
    updateUserProfile,
} from '../../services/userProfileService';

interface Props {
    isOpen: boolean;
    userId: string;
    onSaved: () => void;
    onCancel: () => void;
}

export const ArcadeUsernameModal: React.FC<Props> = ({ isOpen, userId, onSaved, onCancel }) => {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const name = value.trim();
        if (!isValidUsername(name)) {
            setError('3-20 characters: letters, numbers, spaces, dashes and underscores');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            if (!(await checkUsernameAvailability(name))) {
                setError('Username is already taken');
                return;
            }
            await updateUserProfile(userId, { username: name });
            onSaved();
        } catch (e) {
            console.error('Error saving arcade username:', e);
            setError('Could not save the username, please try again');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onCancel} title="Choose a leaderboard name" maxWidth="max-w-md">
            <div className="space-y-4">
                <p className="text-theme-text">
                    Your name is shown next to your score on the arcade leaderboard. You can change
                    it later on your profile.
                </p>
                <Input
                    label="Username"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void save();
                    }}
                    error={error ?? undefined}
                    maxLength={20}
                    autoFocus
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onCancel}>
                        Skip
                    </Button>
                    <Button onClick={() => void save()} disabled={saving}>
                        Save
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
```

- [ ] **Step 3: Leaderboard table**

```tsx
// src/components/arcade/ArcadeLeaderboard.tsx
import React, { useEffect, useState } from 'react';
import { DataTable, Column } from '../ui/tables/DataTable';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthProvider';
import { getArcadeLeaderboard } from '../../services/arcadeService';
import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';

const COLUMNS: Column<ArcadeLeaderboardEntry>[] = [
    { key: 'rank', label: '#', render: (r) => `#${r.rank}` },
    { key: 'username', label: 'Pilot', render: (r) => (r.isMe ? `${r.username} (You)` : r.username) },
    { key: 'bestScore', label: 'Score', align: 'right', render: (r) => r.bestScore.toLocaleString() },
];

interface Props {
    limit?: number;
    refreshKey?: number;
}

export const ArcadeLeaderboard: React.FC<Props> = ({ limit = 20, refreshKey = 0 }) => {
    const { user } = useAuth();
    const [rows, setRows] = useState<ArcadeLeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setFailed(false);
        getArcadeLeaderboard(limit)
            .then((data) => {
                if (!cancelled) setRows(data);
            })
            .catch((error) => {
                console.error('Error loading arcade leaderboard:', error);
                if (!cancelled) setFailed(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [limit, refreshKey, user?.id, attempt]);

    if (failed) {
        return (
            <div className="space-y-2">
                <p className="text-sm text-red-400">Could not load the leaderboard.</p>
                <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <DataTable
            data={rows}
            columns={COLUMNS}
            loading={loading}
            emptyMessage="No scores yet. Be the first."
            getRowKey={(r) => `${r.rank}-${r.username}`}
            rowClassName={(r) => (r.isMe ? 'bg-primary/10 font-semibold' : '')}
        />
    );
};
```

- [ ] **Step 4: Wire into FlightGame**

In `FlightGame.tsx`:

```tsx
import { useAuth } from '../../contexts/AuthProvider';
import { useArcadeSubmission, SubmissionStatus } from './useArcadeSubmission';
import { ArcadeUsernameModal } from './ArcadeUsernameModal';
import { ArcadeLeaderboard } from './ArcadeLeaderboard';
```

In the component body, after `result` state:

```tsx
const { user } = useAuth();
const submission = useArcadeSubmission(result);

useEffect(() => {
    escapeBlockedRef.current = submission.status === 'needs-username';
}, [submission.status]);
```

Replace the `GameOverPanel` render with:

```tsx
{phase === 'over' && result && (
    <GameOverPanel result={result} localBest={localBest} onRetry={restart} onQuit={onClose}>
        <SubmissionLine status={submission.status} rank={submission.rank} onRetry={submission.retry} />
        <div className="max-h-64 overflow-y-auto text-left">
            <ArcadeLeaderboard refreshKey={submission.leaderboardVersion} />
        </div>
    </GameOverPanel>
)}
{user && (
    <ArcadeUsernameModal
        isOpen={submission.status === 'needs-username'}
        userId={user.id}
        onSaved={submission.onUsernameSaved}
        onCancel={submission.skip}
    />
)}
```

Add this at module scope in `FlightGame.tsx`:

```tsx
const SubmissionLine: React.FC<{ status: SubmissionStatus; rank: number | null; onRetry: () => void }> = ({
    status,
    rank,
    onRetry,
}) => {
    switch (status) {
        case 'signed-out':
            return <p className="text-sm text-theme-text-secondary">Sign in to join the leaderboard.</p>;
        case 'checking':
        case 'submitting':
            return <p className="text-sm text-theme-text-secondary">Saving score...</p>;
        case 'submitted':
            return (
                <p className="text-sm text-theme-text-secondary">
                    {rank ? `Leaderboard rank #${rank}` : 'Score saved'}
                </p>
            );
        case 'skipped':
            return <p className="text-sm text-theme-text-secondary">Score not submitted.</p>;
        case 'error':
            return (
                <div className="space-y-2">
                    <p className="text-sm text-red-400">Could not save your score.</p>
                    <Button variant="secondary" size="sm" onClick={onRetry}>
                        Retry
                    </Button>
                </div>
            );
        default:
            return null;
    }
};
```

The `ArcadeUsernameModal` renders into the `z-[60]` portal, so it sits above the `z-50` overlay. Its own Escape handler calls `skip`, and `escapeBlockedRef` stops the overlay from also closing.

- [ ] **Step 5: Leaderboard on the page**

In `ArcadePage.tsx`, import `ArcadeLeaderboard` and add `const [boardVersion, setBoardVersion] = useState(0);`. In the `FLIGHT_END_EVENT` handler, also call `setBoardVersion((v) => v + 1)`. After the first `card`, add:

```tsx
<div className="card space-y-2">
    <h2 className="text-xl font-semibold">Leaderboard</h2>
    <ArcadeLeaderboard refreshKey={boardVersion} />
</div>
```

- [ ] **Step 6: Verify**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && npx eslint src && npx vitest run src/components src/utils/arcade src/services`
Expected: 0 errors, all PASS.

Manual (`npm start`), **after the user has applied the migration**:
1. Signed out: game over shows "Sign in to join the leaderboard". The table loads (anon read).
2. Signed in without a username: the modal opens above the game. Esc or Skip shows "Score not submitted." and the game overlay stays open. A taken name shows the error.
3. Signed in with a username: the score saves and the rank appears. A worse run does not lower the stored best.
4. With an alt profile active, the score still lands on the main account's name.
5. Before the migration is applied, the leaderboard shows "Could not load the leaderboard." with Retry, and the game is unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/components/arcade src/pages/ArcadePage.tsx
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "feat(arcade): global leaderboard with username prompt"
```

---

### Task 10: Phase B docs and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`

- [ ] **Step 1:** In the `arcade` docs section, add a third inner card after "Scoring":

```tsx
<div className="card">
    <h4 className="font-semibold text-primary mb-2">Leaderboard</h4>
    <p className="text-theme-text">
        Signed-in players are ranked by their best score. The first time you finish a run
        without a username you are asked to choose one; it is shared with your profile. Scores
        always count for your main account, even while an alt profile is active.
    </p>
</div>
```

- [ ] **Step 2:** Add a second changelog entry:

```ts
export const UNRELEASED_CHANGES: string[] = [
    'Arcade: fly the synthwave fighter in a new lane-runner mini game.',
    'Arcade: signed-in players compete on a global leaderboard.',
];
```

- [ ] **Step 3: Full verification and commit**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && npm run lint && npx vitest run`
Expected: 0 errors, the full suite PASSES.

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" git commit -m "docs(arcade): document the arcade leaderboard"
```

## Handoff to the user

- Apply `supabase/migrations/20261018000001_arcade_scores.sql` (dashboard SQL editor or your CLI) before merging. The game works without it, and only the leaderboard shows its error state.
- Open the PR against `main` when the user asks.
