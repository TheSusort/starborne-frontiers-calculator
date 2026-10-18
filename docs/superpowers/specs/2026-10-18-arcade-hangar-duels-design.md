# Arcade: fly your own ships, checkpoint duels — design

Extends the shipped Synthwave Arcade (1.79.0, spec `2026-10-18-synthwave-arcade-design.md`). The
player picks a ship from their own fleet to fly. At random checkpoints, two other ships from the
fleet appear on the track; flying into one starts a 1v1 combat-simulator duel with random stakes.

Two parts, built in order: **A** fighter select (+ 3D models behind a flag), **B** checkpoint duels.

## Rollout gate: official 3D models

The 3D ship models are Solid Clouds' assets, loaded live from starborne.com (never copied into the
repo or our CDN). The owner is asking Solid Clouds for approval. Until then:

- Build-time flag `VITE_ARCADE_SHIP_MODELS` (`'1'` = on). Off by default; production stays off
  until the owner approves.
- **Flag off:** fighter select and duel sprites use the ship portraits the app already uses (the
  existing ship image helpers / Cloudinary). The run draws the neon fighter tinted with the ship's
  faction colour.
- **Flag on:** 3D models on the select screen; rendered sprites in the run and in duels.
- `netlify.toml` CSP `connect-src` gets `https://starborne.com` only in the change that turns the
  flag on in production — not in this work.

Everything except model loading ships normally, behind no flag.

## A. Fighter select

### Ship → model mapping
- `scripts/fetch-ship-visual-keys.ts` reads the official catalogue API (the one
  `scripts/sync-unit-catalogue.ts` already uses: `/api/unit-catalogue/unit-locale?locale=en&slug=`)
  and writes `src/components/arcade/ships/shipVisualKeys.ts`:
  `Record<definitionId, shipVisualKey>` (e.g. `Atlas_Supporter_Legendary_1 → 'Atlas_4'`). The
  map is keyed on `definition_id`, never on name. A fleet `Ship` carries no `definition_id`, so it
  is resolved to its ship template through the app's existing ship-template lookup (the one the
  ship database / reference ships use), and the template's `definition_id` keys the map. Any miss
  (no template, no key) falls back to the portrait.
- `scripts/` is not type-checked or linted (`tsc`/lint cover `src/` only) — the generated file is.

### Model loading (flag on only)
- `shipModelLoader.ts`: fetches `https://starborne.com/ship-renders/<key>/<key>_LOD0.fbx` and the
  four textures `<key>_{A,E,N,ORM}.webp` (A = albedo sRGB, E = emissive sRGB, N = normal linear,
  ORM = occlusion/roughness/metalness linear), mirroring the official viewer. Session-level cache by
  key. Timeout 10 s → reject; callers fall back to the portrait.
- three.js + `FBXLoader` are a lazy chunk, imported only by the select screen and sprite renderer.
  Pin an exact three version.

### Select screen
- Shown inside the `FlightGame` overlay before each run started from `/arcade` Start, when the fleet
  (`useShips()`) is non-empty. Empty fleet → neon fighter, straight to the run (current behaviour).
- The easter egg (clicking the background ship) skips the screen and uses the last chosen ship
  (or the neon fighter if none / no longer owned).
- Carousel: one ship at a time — rotating 3D model (flag on) or portrait (flag off) — with name,
  faction, rarity, level. ←/→ or swipe to browse, Enter or "Launch" to start, Esc to quit.
  Search field (name) and faction filter. Order: last chosen first, then rarity desc, then level
  desc. Last choice stored in localStorage (per browser; wrapped in try/catch).
- Uses existing UI primitives (`Button`, `Input`, `Select`, `card`).

### Sprites
- On Launch (flag on): `shipSprites.ts` renders the model once from behind at 5 bank angles
  (−30°, −15°, 0°, 15°, 30°) into transparent canvases (offscreen three.js renderer, disposed after).
- Flag off: `portraitSprite.ts` returns the portrait image (no banking frames; the renderer tilts
  the image instead).
- The 2D renderer draws the sprite for the player instead of `drawNeonFighter`, picking the frame
  by bank; jump / duck squash / shield ring / intro cross-fade keep working. Engine-glow and flames
  stay drawn by the renderer at the sprite's rear.

### Gameplay
- The chosen ship is cosmetic for the runner (no stat effects). Its stats/gear matter only in duels.

## B. Checkpoint duels

### Engine (pure, seeded — `src/utils/arcade/`)
- `checkpoints.ts`: the next checkpoint distance is drawn uniformly from **600–1400 m** after each
  checkpoint (and from the start), using the game's seeded RNG.
- A checkpoint row: two **duel gates** in two random lanes, the third lane empty; no obstacles in
  the row immediately before and after it. Each checkpoint carries `stakes`:
  `'win-or-die' | 'bonus-or-penalty' | 'power-up'`, uniformly random.
- Crossing z = 0 in a gate's lane → engine sets `status: 'duel'` and records
  `pendingDuel: { checkpointId, slot: 0 | 1, stakes }`; `step` does nothing while in `'duel'`.
  The empty lane → nothing happens.
- `resolveDuel(state, outcome: 'win' | 'lose' | 'skipped')` applies the stakes and returns to
  `'running'`:

  | stakes | win | lose |
  |---|---|---|
  | win-or-die | `bonus += 500` | game over; a shield absorbs it (shield consumed, run continues) |
  | bonus-or-penalty | `credits += 25` | `credits -= floor(credits × 0.25)` |
  | power-up | shield or magnet (seeded 50/50) | nothing |

  `'skipped'` (sim failed) applies nothing.
- Score = metres + credits × 10 + `bonus`. `RunResult` gains nothing new (score already includes it).
- No checkpoints are scheduled when `createGame` is told duels are disabled
  (`createGame(seed, { duels: false })`).

### Opponents (`src/components/arcade/duel/pickOpponents.ts`, pure)
- Two distinct ships from the fleet, never the flown ship; uniform random. Fewer than 2 candidates
  → duels disabled for the run. Neon-fighter runs (no fleet ship chosen) have duels disabled.

### Running a duel (`runDuel.ts`)
- Lazy-imports the combat simulator. Builds the input with `buildTeam({ M2: { ship } }, deps)` for
  each side (`deps = { getGearPiece, getEngineeringStatsForShipType }` from the inventory and
  engineering contexts), then `runSeededBattle(input, seed, getGearPiece)` with a fresh random seed.
- Winner: the simulator's `outcome.winner`, except when the fight reached the round cap — then the
  side with the higher final `hpPct` wins (player wins ties).
- Returns `{ outcome: 'win' | 'lose', timeline: { round, playerHpPct, enemyHpPct }[] }`; any
  thrown error → `'skipped'`. Runs after a "Simulating…" frame has painted (`setTimeout(…, 0)`
  after state update).

### Duel summary (`DuelSummary.tsx`)
- Overlay inside `FlightGame` (above the canvas, below Modal z-[60]): both sprites facing each
  other, HP bars animating through `timeline` over ~5 s, a round counter, then a winner banner and
  the stakes result ("+500", "−12 credits", "Shield!", "Shield absorbed the defeat"). Space / click
  skips to the result. Then the existing 3-2-1 countdown resumes the run.
- On the track, each gate is drawn as the opponent's sprite, with a stakes banner over the row and
  each ship's name + level under it.

## Edge cases
- Empty fleet or < 2 opponents → no checkpoints.
- Signed-out players with a local fleet get duels (ShipsContext works without auth).
- Auto-pause during a duel summary is harmless (the run is already paused).
- Leaderboard: duel bonuses count toward the score (owner accepted that fleet strength now matters).

## Testing
- Engine: checkpoint spacing within 600–1400 m; the empty lane is always free; no obstacles
  adjacent to a checkpoint row; a duel requested only on hitting a gate; empty lane gives nothing;
  every stakes × outcome cell incl. the shield case; score includes `bonus`; determinism by seed;
  `duels: false` schedules nothing.
- `runDuel`: a real 1v1 on fixture ships produces a winner and a timeline; the round-cap HP rule;
  a thrown sim error → `'skipped'`.
- `pickOpponents`: never the flown ship, two distinct, < 2 → none.
- Manual: screenshots of the select screen (flag on and off), a checkpoint on the track and a duel
  summary, sent to the owner for approval.

## Docs & changelog
- DocumentationPage arcade section: fighter select and checkpoint duels.
- Changelog (one entry per user-visible change):
  `Arcade: choose a ship from your fleet to fly.` /
  `Arcade: duel ships from your hangar at random checkpoints.`

## Out of scope
- ~~Turning the model flag on in production (owner's call after approval).~~ Superseded: see Amendments, the models are on in production.
- Stat effects of the chosen ship on the runner.
- Skins.

## Amendments (2026-10-18)
- **Rollout.** Solid Clouds approved using the official models. They are ON in production:
  `netlify.toml` sets `VITE_ARCADE_SHIP_MODELS = "1"`, and the CSP allows `https://starborne.com`
  in `connect-src` (FBX download) and `img-src` (textures). The flag stays as the off switch, and
  the assets are still loaded live, never copied.
- **Run sprites.** The player ship is a 45-frame chase-camera grid: 5 headings × 3 banks ×
  3 pitches. The nose aims at the horizon's vanishing point, clamped to ±25°. Pose changes are
  eased, and in-between poses cross-fade neighbouring frames.
- **Duels.** Both sides use renders at the official viewer's default angle, turned to face each
  other.
- **Lanes.** The lane rails are gone: lanes sit on the background grid's columns, and the intro
  morphs the page grid into the arcade grid.
