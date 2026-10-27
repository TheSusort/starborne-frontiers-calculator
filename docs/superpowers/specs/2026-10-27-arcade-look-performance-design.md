# Arcade: look and performance

Sub-project 2 of 4 in the arcade upgrade (1 = run feel and scoring, PR #749; 3 = duels v2; 4 = role
perks). Owner decisions from the 2026-10-27 brainstorm; do not re-ask.

Everything here is drawing and audio timing. The engine (`src/utils/arcade/`) and the score do not
change.

## 1. Zones

- Every `ZONE_METERS = 1000` metres (`metersTravelled`) the run enters the next zone. Zones cycle:
  **Sunset → Neon Night → Red Alert → Ice → Sunset …**. Zone 1 (0–999 m) is Sunset, which is
  today's look.
- A zone is a palette: sky gradient stops, sun colours, grid line colour, barrier colours (the
  `wall`/`low`/`high` sets in `barriers.ts`), speed-line glow/core colours. The current colours
  become the Sunset palette unchanged.
- Crossing a boundary cross-fades the palette over `ZONE_FADE_SECONDS = 2` of game time (paused
  and duel time does not advance it). The blend is a per-channel RGBA interpolation of the two
  palettes.
- A banner "ZONE 2 · NEON NIGHT" shows in the HUD under the score for ~1.5 s when a zone starts
  (not for zone 1). It fades in and out; reduced motion keeps the fade.
- Zone and blend are a pure function of distance, so every player sees the same zones at the same
  metres.
- Cached backdrop layers (sky, glow, ground, fan in `backdrop.ts`, the sun cache) must rebuild when
  the palette changes. During a fade they may rebuild at most every few frames (cache key = the
  blend quantised to ~1/16 steps), not every frame.

## 2. Beat sync

- A table of `{ bpm, firstBeat }` per track in `src/utils/music/` keyed by the track path, measured
  from the mp3s (first estimates: disco 107.7 / 0.461 s, disco2 99.4 / 0.208 s, disco3 136.0 /
  0.324 s, disco4 123.1 / 0.320 s; refine to stay in phase over the full track, and check by ear).
  Assume 4 beats per bar.
- The music controller exposes the current track and `currentTime` (read each frame; no Web Audio
  analysis).
- Beat phase `p` = fractional beats since `firstBeat`; pulse = `exp(-k · frac(p))`-style decay,
  stronger on the bar's first beat.
- What pulses: grid line brightness and the sun's glow. Barriers, pickups, ships and the camera do
  not move with the beat.
- No pulse while the music is off or paused, or before `firstBeat`. With reduced motion only the
  brightness pulses (the sun glow does not swell).

## 3. Speed blur

- Strength `s` = 0 below 60% of the way from `START_SPEED` to `MAX_SPEED` (`speedFraction` in
  `speedLines.ts`), rising linearly to 1 at `MAX_SPEED`.
- As `s` rises: speed lines get longer and more of them draw (on top of today's speed scaling), and
  an edge fringe appears: a pink/cyan colour split along the screen edges, drawn from a cached
  gradient canvas with `globalAlpha = s`.
- The lane wedge (`view.laneWedge`) stays clear of both.
- With reduced motion the fringe still shows; speed lines keep their existing reduced-motion
  handling.

## 4. Shield-break shake

- Triggers whenever `shieldBreakTime` is set: a barrier breaking the shield, and a lost
  win-or-die duel the shield absorbed.
- ~0.3 s of decaying shake, amplitude ~1.5% of the canvas height, as a translate of the whole
  canvas drawing. The HUD (DOM) does not shake.
- Off under reduced motion.

## 5. Performance

Measure with `scripts/arcade-bench.mjs` (see its header for running it) before and after, and put
the before/after numbers (alloc bytes per frame, record and raster p95) in the PR.

1. **Glow sprite cache.** Credits, shields and magnets drawn with `shadowBlur` every frame are
   instead pre-rendered once per (kind, size bucket, palette) into an offscreen canvas and drawn
   with `drawImage`. Same for the duel gate glow if the profile shows it costs. Sizes bucket so a
   pickup approaching the camera does not create a canvas per frame (check `canvasesCreated`).
2. **No per-frame item allocation.** `renderFlight`'s list of obstacles/pickups/checkpoints to draw
   is built into a reused scratch array instead of spreads, `map`, `filter` and a fresh array every
   frame.

A change ships only if the bench shows it helps, or at least does not regress.

## Testing

- Zone index and palette blend at given distances (boundary, mid-fade, after fade, cycling).
- Beat pulse from (time, bpm, firstBeat): on-beat peak, decay, bar accent, nothing before
  `firstBeat` or with music off.
- Speed-blur strength at 0%, 60%, 80% and 100%.
- Shake: starts at a shield break, decays to 0 by 0.3 s, zero under reduced motion.
- Glow cache: one canvas per (kind, bucket, palette); a cache hit creates none.
- The look itself is checked by the owner on the local dev server.

## Docs and changelog

- `DocumentationPage.tsx` arcade section: zones, beat-synced scenery.
- `UNRELEASED_CHANGES`: one short `Arcade:` entry each for zones, beat sync, speed blur and shake.
  None for the performance work.
