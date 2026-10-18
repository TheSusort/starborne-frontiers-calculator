# Synthwave Arcade — design

A lane-runner mini game ("Subway Surfers" style) in which the player takes control of the
fighter that flies over the synthwave background grid. Includes a global leaderboard.

## Entry points

- **Route `/arcade`** (lazy-loaded page, linked from the sidebar): title, Start button, controls
  legend, leaderboard. `/arcade?play=1` starts the game immediately.
- **Easter egg (synthwave theme only):** clicking the overhead fighter (`OverheadShip` in
  `SynthwaveCanvas`) while it is in flight dispatches `app:flight:start` on `window` with the
  ship's screen position `{ x, y, size }`. The game opens as a fullscreen overlay on top of the
  current page and animates the fighter from that position down to the player slot.
- **`FlightGame` overlay** is mounted once, globally, in `App.tsx` and listens for
  `app:flight:start`. The `/arcade` Start button dispatches the same event (without a position →
  the ship flies in from the horizon). The overlay renders the full synthwave scene itself, so it
  works in every theme. `Esc` quits back to the page underneath.

## Gameplay

- Rear-view fighter flying over the perspective grid, **3 lanes**.
- Controls: left/right (arrows, A/D, horizontal swipe) change lane; up/W/Space or swipe up =
  **jump** (ship rises and grows); down/S or swipe down = **duck** (ship flattens, hugs the grid).
  Jump and duck each last a fixed duration; a new jump/duck cannot start until the current one ends.
- Obstacles spawn at the horizon and approach using the same perspective projection as the grid
  lines:
  - **Wall** — occupies a lane; only a lane change avoids it.
  - **Low laser barrier** — must be jumped.
  - **High energy arch** — must be ducked.
- Spawning guarantees at least one passable lane/action per obstacle row.
- **Credits** (coins) in rows along lanes.
- **Power-ups:** **Shield** (absorbs one hit, then is consumed), **Magnet** (8 s; collects
  credits in adjacent lanes).
- Speed increases gradually over time, up to a cap.
- **Score** = floor(distance) + credits × 10.
- Game over screen: score, personal best, leaderboard snippet, "Try again".
- **Local best** (score) is stored in `localStorage` for everyone, including signed-out users.
- No music/sound in v1.

## Code structure

- `src/components/theme/synthwaveScene.ts` — sky, sun, mountains, perspective grid,
  `drawFighterRear`, projection helpers, extracted from `SynthwaveCanvas`. `SynthwaveCanvas`
  imports them; the background must look exactly as before.
- `src/utils/arcade/` — pure game logic, no DOM:
  - `types.ts` — `GameState`, `Obstacle`, `Pickup`, `Input`.
  - `engine.ts` — `createGame(seed)`, `step(state, input, dt)` (fixed timestep).
  - `spawner.ts` — seeded obstacle/pickup generation.
  - `collision.ts` — per-obstacle-type collision (lane + jump/duck state), shield handling.
  - `scoring.ts` — score formula.
- `src/components/arcade/FlightGame.tsx` — overlay, canvas, game loop
  (`requestAnimationFrame` + fixed-step accumulator), keyboard/touch input, HUD, game-over UI
  (using existing `Button`, `Modal`, `card` etc.).
- `src/components/arcade/flightRenderer.ts` — draws a `GameState` onto the canvas using
  `synthwaveScene`.
- `src/components/arcade/ArcadeLeaderboard.tsx` — leaderboard table (existing table components).
- `src/pages/ArcadePage.tsx` — the `/arcade` page.
- `src/services/arcadeService.ts` — `submitArcadeScore`, `getArcadeLeaderboard`.
- Hit test for the overhead ship lives in `SynthwaveCanvas` (pure helper exported for testing).

## Leaderboard (Supabase)

### Table `arcade_scores`

One row per **main account** (alts never get their own row).

| column          | type          | notes                                              |
| --------------- | ------------- | -------------------------------------------------- |
| `user_id`       | uuid PK       | FK `users.id`, always `auth.uid()`                 |
| `best_score`    | int           | `CHECK (best_score BETWEEN 0 AND 10000000)`        |
| `best_credits`  | int           | `CHECK >= 0`                                       |
| `best_distance` | int           | `CHECK >= 0`                                       |
| `updated_at`    | timestamptz   | default `now()`                                    |

The CHECK bound is a sanity bound, not anti-cheat. Anti-cheat is explicitly out of scope for v1.

**RLS enabled.** Policies for SELECT/INSERT/UPDATE/DELETE, all `user_id = auth.uid()`. Other
users' rows are only readable through the leaderboard RPC.

### RPCs (`SECURITY DEFINER`, `SET search_path = public`)

- `submit_arcade_score(p_score int, p_credits int, p_distance int)` → `(best_score int, rank int)`.
  Uses `auth.uid()` (raises if null). Upserts; overwrites only when `p_score > best_score`.
  `EXECUTE` granted to `authenticated` only.
- `get_arcade_leaderboard(p_limit int default 20)` → `(rank int, username text, best_score int,
  is_me boolean)`. Joins `users` for `username`; only rows whose user has a non-null `username`.
  Never returns email or user ids. `p_limit` clamped to 1..100. When the caller is signed in and
  ranked outside the top `p_limit`, their own row is appended (so "own rank" always shows). `EXECUTE` granted to `anon` and
  `authenticated`.

Migration: `supabase/migrations/20261018000001_arcade_scores.sql`. **The user applies it.**

### Client flow

- After every game over while signed in (the RPC keeps the max, so no client-side best check):
  - If the main account (`auth.uid()` row, not the active alt) has no `username`: open a `Modal`
    to choose one, using the same validation and update path as `ProfilePage` (3–20 chars,
    `^[a-zA-Z0-9 _-]+$`, unique). Submit after it is saved. Cancelling skips submission.
  - Otherwise submit directly.
- Signed out: "Sign in to join the leaderboard"; local best only.
- Leaderboard (top 20 + own rank) shown on `/arcade` and on the game-over screen.

## Error handling

- Submit/leaderboard failures: a quiet inline message on the game-over screen with a Retry
  button. Gameplay and the local best are unaffected.
- Username taken: error shown in the modal, as on ProfilePage.

## Performance & UX

- Auto-pause on `visibilitychange` (hidden) and window blur; resume with a 3-2-1 countdown.
- While the overlay is open, the background `SynthwaveCanvas` is paused (`animate={false}`).
- Fixed-timestep physics so speed is identical at 60/120/144 Hz.
- `prefers-reduced-motion`: easter-egg transition animation is skipped (game starts directly).
- Mobile: swipe input, `touch-action: none` on the canvas, body scroll locked through the existing
  reference-counted scroll lock.

## Testing

Vitest, focused on `src/utils/arcade/`:

- lane change bounds (cannot leave lanes 0..2);
- jump/duck durations and no re-trigger mid-action;
- collision per obstacle type × player state (wall/lane, low barrier/jump, high arch/duck);
- shield absorbs exactly one hit;
- magnet collects adjacent-lane credits only while active;
- score formula;
- same seed → same obstacle sequence; every spawned row is passable;
- overhead-ship hit test (inside/outside).

Background extraction is verified visually locally (`npm start`, port 3000).

## Docs & changelog

- New section in `src/pages/DocumentationPage.tsx`.
- `UNRELEASED_CHANGES` entry, e.g. `Arcade: fly the synthwave fighter in a new lane-runner mini game.`

## Out of scope (v1)

- Anti-cheat / server-side score validation.
- Music and sound effects.
- Per-alt leaderboard entries.
