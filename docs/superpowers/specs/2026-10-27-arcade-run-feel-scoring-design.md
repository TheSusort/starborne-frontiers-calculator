# Arcade: run feel and scoring

Sub-project 1 of 4 in the arcade upgrade (2 = look and performance, 3 = duels v2, 4 = role perks).
Owner decisions from the 2026-10-27 brainstorm; do not re-ask.

## Goal

Reward skill inside a run, and make the controls forgive early presses:

1. Input buffer for jump/duck.
2. Duck-cancels-jump (fast drop into a duck) and jump-cancels-duck.
3. Near-miss bonus: a late dodge, paid as a growing chain.
4. Credit streak: two finished trails in a row double credit pickups.

All four are rules inside `step` (`src/utils/arcade/engine.ts`), so they stay deterministic per seed
and inputs, and are unit tested there. The renderer only reads what the engine reports.

## Rules

### Input buffer

- A `jump` or `duck` input that cannot start now is held for `INPUT_BUFFER_SECONDS = 0.15`.
- Only the latest held press is kept; a new jump/duck press replaces it.
- On each step, if the held press can now start, it starts and the buffer clears. When it ages
  past the window, it is dropped.
- Lane changes are not buffered; they apply at once, as today.
- With the cancels below, the buffer matters when the same action is pressed again (jump during a
  jump, duck during a duck or a drop).

### Cancels

- **Duck during a jump:** the player enters `drop` for `DROP_SECONDS = 0.1`, then a full duck
  (`DUCK_SECONDS`). One press does both.
- **Jump during a duck:** the duck ends and a full jump starts at once.
- `drop` is a new `PlayerAction`. It is neither jumping nor ducking, so `blocks` treats it like
  `run`: a low barrier or a high barrier crossing the player's lane during it hits.
- The renderer draws `drop` as a fast descent from the current jump height to the ground. The
  height at the moment of the cancel is kept in the player state so the descent starts where the
  jump was.

### Near miss (late dodge)

When an obstacle crosses z = 0 (where `step` already decides collisions) and does **not** hit, it
is a near miss if, within `NEAR_MISS_SECONDS = 0.2` before the crossing, either:

- the player **left the obstacle's lane** (tracked as the time each lane was last left), or
- the player **started the jump or duck that clears it** (a jump for a low barrier, a duck for a
  high barrier, including a duck started through the drop cancel; the duck's start is the moment
  the duck press was taken).

A wall only counts lane changes. Two obstacles in one row can each be a near miss.

**Chain:** the n-th near miss in a chain pays `min(25 · n, 150)` points (25, 50, 75, … 150, 150).
The chain resets after `NEAR_MISS_CHAIN_SECONDS = 3` with no near miss, and when an obstacle hits
the player (a shield break). Points go into `state.bonus`, so `computeScore` is unchanged.

### Credit streak

- `spawnRow` gives every pickup of one trail a shared `trailId`.
- A trail is **finished** when every credit in it is collected (a magnet pull counts; a power-up
  in the trail is not a credit and does not count either way).
- A trail is **decided** when its last pickup resolves. Finished → the streak count goes up by one;
  unfinished (including a trail the player never went near) → the count resets to 0.
- At a count of 2 or more, each credit collected is worth `STREAK_CREDIT_VALUE = 2` credits. There
  is one step only, no higher multiplier.
- Credits from duel rewards and penalties are not multiplied.
- Duels and checkpoints do not touch the streak.

## Engine reporting

- `GameState` gets `events: RunEvent[]`. `step` appends to it; the frame loop in `FlightGame`
  reads and clears it once per frame (several steps may run in one frame).
- `RunEvent` = `{ kind: 'near-miss'; points: number; chain: number; lane: Lane }`
  | `{ kind: 'streak-on' }` | `{ kind: 'streak-lost' }`.
- `GameState` also tracks `bestNearMissChain` and `nearMissPoints` for the game-over panel.

## UI

- A floating "NEAR MISS +75" label near the ship. It rises and fades over ~0.8 s, and with reduced
  motion it fades without moving.
- A "x2" chip beside the credit count in the HUD while the streak is on, with a short pulse when it
  turns on or breaks.
- The game-over panel adds "Best near-miss chain" and "Near-miss points".
- `DocumentationPage.tsx`: the arcade section describes near misses, the streak, the input buffer
  and the cancels.
- One `UNRELEASED_CHANGES` entry per player-visible change.

## Out of scope

- The score formula, the leaderboard schema and the submit RPC are unchanged; only the score's
  size grows.
- Server-side score verification.

## Testing

Engine unit tests in `src/utils/arcade/__tests__/`:

- Buffer: a press 0.14 s before the action frees fires; 0.16 s is dropped; the latest press wins.
- Cancels: duck mid-jump → drop → duck, timings exact; a low barrier during the drop hits; jump
  mid-duck jumps at once.
- Near miss: a lane change 0.19 s before the crossing pays, 0.21 s does not; a jump started in the
  window clears a low barrier and pays; a wall with a jump does not count; chain values 25 → 150
  cap; the chain resets after 3 s and on a shield break; a hit pays nothing.
- Streak: two finished trails switch it on; an untouched trail resets it; a magnet-collected trail
  counts as finished; credits count double only while it is on; duel credits are not doubled.
- Determinism: the same seed and inputs give the same score and events.
