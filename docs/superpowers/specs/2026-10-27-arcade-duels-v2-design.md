# Arcade: duels v2

Sub-project 3 of 4 in the arcade upgrade (1 = run feel and scoring, #749; 2 = look and performance,
#751; 4 = role perks). Owner decisions from the 2026-10-27 brainstorm; do not re-ask.

## Goal

Checkpoint duels become varied challenges where the right flown ship matters: 1v1, DPS, TANK, HEAL
and 3v3. A short slow-motion preview lets the player read the challenge and the gates before
choosing a lane, and gates show ship portraits instead of 3D models.

## Owner decisions

- **The flown ship always does the challenge.** Gates show rivals/opponents from the fleet, never
  a choice of which own ship competes.
- **Races against the gate ship** for DPS/HEAL/TANK: both ships do the identical task for 5
  rounds; the better result wins. No fixed thresholds.
- **One challenge type per row**: both gates of a row share the type; the player picks the rival.
  The free lane still skips.
- **3v3**: the flown ship plus 2 random geared fleet ships, against the trio on the chosen gate.
- **Slow-motion preview** the player can steer through, not a pause.
- **Portraits** replace the 3D models / sprites on the gates.
- **Short fights**: every challenge is capped at 5 rounds, so playback fits the existing ~10 s
  duel cap (#707 turn-by-turn playback).

## Challenge rows

- `Checkpoint` gains `challenge: 'duel' | 'dps' | 'tank' | 'heal' | 'team'` (1v1 is `'duel'`),
  drawn uniformly by the engine's seeded RNG when the row spawns, next to `stakes`.
- `'team'` is only drawn when the fleet is eligible (see "Picks": 8 eligible ships besides the
  flown one); otherwise the type is drawn uniformly among the other four. Eligibility is passed
  in through `GameOptions` (the engine does not see ships), so the draw stays deterministic per
  seed and eligibility.
- Stakes stay per row (`win-or-die`, `bonus-or-penalty`, `power-up`) with today's effects.

## Picks

- `duel`, `dps`, `tank`, `heal`: each gate gets one ship, as `pickOpponents` does today (two
  distinct eligible ships other than the flown one).
- `team` ("Team picks"): two disjoint opposing trios (one per gate) and the player's two allies,
  all distinct and different from the flown ship. That needs 8 eligible ships besides the flown
  one; with fewer, `team` is not drawn. Allies are drawn when the row's picks are made, and shown
  in the preview.

## Win rules (all 5 rounds)

Each race runs the same existing calculator twice, once per ship, with identical scripted
inputs, and compares one number. The flown ship wins ties in every race.

| Type | Engine | Compared number |
|---|---|---|
| `duel` | `runDuel` (unchanged: `runSeededBattle`, 1v1 at M2) but `rounds` capped at 5 | today's rule: sim winner, else higher final HP% at the cap |
| `dps` | `simulateDPS` (`src/utils/calculators/dpsSimulator.ts`) against the DPS page's default enemy (`SYNTHESIZED_DPS_ENEMY_ID` setup) | total damage over 5 rounds |
| `heal` | `simulateHealing` (`healingEngineAdapter.ts`) with the healing page's default enemy (`healingDefaultEnemy.ts`) | total healing done over 5 rounds |
| `tank` | `simulateDefenseSurvivability` (`defenseSurvivabilitySim.ts`) with the defence page's default attacker | HP % left after 5 rounds (a destroyed ship has 0) |
| `team` | `runSeededBattle` with `buildTeam` of 3 per side, `rounds` capped at 5 | sim winner, else higher summed HP% at the cap |

- Each ship's inputs (stats, skills, gear, engineering) are built the same way the matching
  calculator page builds them for a selected ship; reuse those builders rather than re-deriving
  stats.
- A ship whose kit cannot do the task (an attacker in a heal race) simply scores 0 and loses
  unless the rival also scores 0 (then the flown ship wins the tie).
- Any engine error → `skipped`, as today.
- Races use a seed derived from the run seed and checkpoint id, like today's duels.

## Playback

- `duel` and `team` use the existing turn-by-turn duel screen (`DuelSummary`, `duelPlayback`);
  `team` shows three ships per side, each with its own HP/shield bars and buff chips.
- Races (`dps`, `heal`, `tank`) show both ships side by side with a bar per ship that fills round
  by round with the compared number (damage dealt, healing done, HP left), the running figure
  beside it, and a WIN/LOSE stamp at the end. Same ~10 s cap, reduced motion → no bar animation.
- The summary's stakes text and effect lines stay as today.

## Slow-motion preview

- The engine gains a time scale. When a checkpoint row reaches `PREVIEW_Z` ahead of the player,
  the scale eases from 1 to `PREVIEW_SCALE = 0.25` over ~0.3 s of real time, holds for
  `PREVIEW_SECONDS ≈ 2` of real time, then eases back to 1, all before the row reaches the
  player (pick `PREVIEW_Z` so this holds at `MAX_SPEED`).
- The scale multiplies the travel and the engine clock inside `step`, so obstacles, pickups,
  speed ramp and near-miss timing all stay consistent; the frame loop keeps calling `step` with
  `STEP_SECONDS`. Input (lane changes, jumps, ducks) works throughout. Distance, score and every
  rule stay deterministic per seed and inputs.
- The rows next to a checkpoint are already empty, so the preview never slows an obstacle row's
  crossing.
- During the preview the HUD shows a banner with the type and stakes ("TANK · WIN OR DIE"), and
  the renderer draws, above each gate, the rival's portrait, name and role (or three small
  portraits for `team`, plus the player's two allies in the banner).
- Reduced motion: the slow-down still happens (it is reading time, not decoration).

## Gates

- Gate art becomes the ship's portrait (the image `PortraitView` on the select screen uses) in a
  neon frame, replacing the 3D model / sprite renders on the track. `team` gates show three
  portraits side by side.
- The 3D models stay where they are elsewhere (select screen, duel screen).

## Docs and changelog

- `DocumentationPage.tsx` arcade section: the five challenge types, how each is won, the preview.
- `UNRELEASED_CHANGES`: one short `Arcade:` entry each for the new challenge types, the 3v3 team
  challenge, the slow-motion preview, and portraits on gates.

## Testing

- Type draw: deterministic per seed; `team` never drawn when ineligible; roughly uniform.
- Each win rule on fixed calculator results, including ties (flown ship wins) and a 0-scoring
  ship.
- Team picks: all distinct, never the flown ship; fewer than 8 eligible → no `team`.
- Engine slow-motion: same seed and inputs → same distance, score and events; the scale reaches
  0.25 and returns to 1 before the row crosses at `MAX_SPEED`; inputs during the preview apply.
- One real-engine smoke test per race type with two known template ships (results are finite and
  a winner is decided).
