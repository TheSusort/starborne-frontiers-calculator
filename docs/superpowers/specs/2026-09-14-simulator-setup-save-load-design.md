# Simulator: save and load a setup (local)

Issue: #510 (local half). Cross-user sharing is deliberately out of scope — see "Why sharing is
a separate spec" below.

## Problem

A simulator setup lives only in `SimulatorPage`'s React state. Both boards, every stat override,
both squad leaders, the seed and the run count are gone on reload. Ten minutes of board-building
is destroyed by a refresh, and there is no way to come back to a fight you set up yesterday.

`handleLoadEncounter` loads one side, ship ids only — no overrides, no seed, no leaders. It is not
a setup.

## What a setup is

```ts
interface SerializedPlacement {
    /** An owned ship id, or a reference id (`referenceShipId` / `parseReferenceShipId`). */
    shipId: string;
    overrides?: StatOverrides;
}

interface SimulatorSetup {
    version: 1;
    name: string;
    playerBoard: Partial<Record<Position, SerializedPlacement>>;
    enemyBoard: Partial<Record<Position, SerializedPlacement>>;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    /** Epoch ms, for ordering the saved list. */
    savedAt: number;
}
```

Ship *references*, not baked stats. Re-gearing a ship updates a saved setup, which is what you
want for your own setups — you save a fight to come back to it after changing something.

A reference unit (#520's any-unit picker) already has a portable id (`template:<templateId>:<r0
|refitted>`), so the *format* needs no change to carry a board across accounts. Note that portable
format is not portable result: `referenceShip` carries no gear and no implants, but
`shipFinalStats` still resolves the *viewer's* engineering stats off `ship.type`, so the same
reference board fights differently for two accounts with different engineering. That is a fidelity
problem for sharing, not for saving, and it belongs to the sharing spec.

`version: 1` is a discriminator for future migrations, not a compatibility promise. A stored
value whose version is not 1 is discarded like any other invalid value.

## Modules

### `src/utils/simulator/simulatorSetup.ts`

- `serializeSetup(args) -> SimulatorSetup` — pure. Takes both boards, both leaders, seed, run
  count, name. Drops `overrides` when `hasAnyOverride` is false so a setup never carries the `{}`
  spelling of "no overrides" (the same normalisation `handleOverridesChange` and `handleCopyBoard`
  already apply).
- `deserializeSetup(setup, resolve) -> DeserializedSetup` where

  ```ts
  interface DeserializedSetup {
      playerBoard: BoardState;
      enemyBoard: BoardState;
      playerSquadLeader?: SquadLeaderSelection;
      enemySquadLeader?: SquadLeaderSelection;
      seed: number;
      runCount: number;
      /** Cells whose ship id no longer resolves, by side. Reported to the user, not thrown. */
      dropped: { side: 'player' | 'enemy'; position: Position }[];
  }
  ```

  `resolve` is `(shipId: string) => Ship | null`. That resolution already exists as
  `resolveSavedShip`, private inside `PlacementBoard` — a reference id (`template:` prefix) is
  rebuilt from the unit catalogue via `referenceShip`, anything else is looked up among the
  player's own ships. Lift it into a shared helper (it needs `getShipById`, the catalogue `units`
  and `getAscensionStats`) so the encounter loader and the setup loader cannot drift; a reference
  id looked up among owned ships silently drops the cell, which is the bug that comment already
  warns about.

**An unresolvable ship id is normal, not corruption.** Switch to an alt account and every owned id
in a saved setup dangles at once; a ship deleted or re-imported can dangle too (import dedupes by
level/rank/stats/refit count, so an id is not guaranteed stable across re-import). The load path
drops those cells, keeps the rest of the setup, and surfaces a notice naming the count. It must
never throw and must never silently produce a board that looks complete.

### `src/utils/simulator/setupStorage.ts`

Two localStorage keys, following `squadLeaderSelection.ts` exactly — this is throwaway per-device
UI state, the same tier as view modes and filters, deliberately NOT the `useStorage`
IndexedDB/Supabase pipeline.

- `simulator-setup-autosave` — a single unnamed `SimulatorSetup`, written debounced (250 ms) on
  every board/override/leader/seed/run-count change, read once on mount.
- `simulator-setup-saved` — a `SimulatorSetup[]`, the named list.

Reads are validated and never throw: storage can be unavailable (blocked third-party contexts,
private mode) and stored JSON is user-editable. A malformed autosave resolves to "no autosave"; a
malformed list resolves to an empty list; an individual invalid entry is dropped and the rest of
the list is kept.

Validation is Zod, per security rule 5 — `src/schemas/sharedAutogearBuild.ts` is the precedent for
a schema over a persisted/portable payload. `Position`, `OverridableStat` and the leader shape all
have closed vocabularies to validate against.

Writes never throw either (quota, private mode): a failed write leaves the setup in memory for the
session, matching `writeStoredSquadLeaderSelection`.

## Page wiring

A `SimulatorSetupBar` component above the boards, built from existing `ui/` primitives:
`Input` + `Button` for "Save as…", `Select` for the saved list, `Button` for Load, and
`ConfirmModal` for Delete.

Two things the load path must get right:

1. **Squad leaders route through `handleSquadLeaderChange`**, not the raw setters. That handler is
   what write-throughs to `SQUAD_LEADER_STORAGE_KEYS`; bypassing it leaves the live selection and
   the stored one disagreeing until the next manual change.
2. **A load clears the run state.** `battleResult`, `aggregate`, `baseline` and `divergence`
   describe the previous boards. `RunProvenance` exists precisely so displayed results are never
   re-derived from live boards — a load must therefore clear them rather than leave a result
   captioned by a setup that did not produce it.

Autosave restores on mount before the first render that can run a battle, so a reload lands on the
same boards.

Saving is name-keyed: saving under an existing name overwrites that entry (confirmed via
`ConfirmModal`), so the list cannot fill with `setup`, `setup (2)`, `setup (3)`.

## Profile scoping

The keys are not profile-scoped, matching the squad-leader keys. A setup saved under one profile
and loaded under another dangles its owned ship ids and is handled by the drop path above. This is
self-healing and visible; scoping the keys would instead make saved setups silently vanish on a
profile switch.

## Testing

Pure functions, per the project's testing focus:

- `serializeSetup` / `deserializeSetup` round-trip a board carrying owned ships, reference ships,
  overrides on some cells and not others, and both leaders.
- An empty-overrides placement serializes with `overrides` absent, not `{}`.
- A setup naming a ship id that `resolve` returns `null` for loads the remaining cells and reports
  the dropped one — asserted on `dropped`, not merely on the absence of a throw.
- Storage reads survive: non-JSON, JSON of the wrong shape, a wrong `version`, an unknown
  `Position` key, an unknown override stat, and a `localStorage.getItem` that throws.
- One invalid entry in a saved list drops only that entry.

## Why sharing is a separate spec

#510 proposes baking resolved stats into a shared payload so it is portable. That is lossier than
it reads: `getGearPiece` is threaded into `simulateBattle` because gear-derived abilities resolve
*during* the fight, not from `statOverrides`. Share a fight whose Bulwark runs a set that procs a
barrier on first hit and the recipient gets the eleven numbers but not the barrier — the two
fights diverge and neither side can see why. `ReferenceVariant` is `r0 | refitted` only, so a
3-refit owned ship has no portable twin either, and refit count selects the active passive
(`getShipSkillRows`).

Reference units are not a clean escape either: they carry no gear or implants, but
`shipFinalStats` applies the viewer's own engineering stats off `ship.type`, so two accounts with
different engineering get different fights from the same reference board.

Sharing therefore needs a decision this spec does not make: reference-unit setups only, or shared
setups labelled approximate. It also needs a new Supabase table with its own RLS policies, a Zod
schema at the trust boundary, and a share route — the full new-user-data-table job. Its own spec.

## Out of scope

- Cross-user sharing (above).
- Cloud sync of saved setups.
- Saving a pinned baseline with a setup: a baseline is a *result*, and results are not part of a
  setup.
