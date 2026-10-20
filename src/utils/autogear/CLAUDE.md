# Autogear

**Strategy:** `strategies/GeneticStrategy.ts` is the only strategy. It implements
`AutogearStrategy`, and `findOptimalGearForShip` builds a fresh instance per call (progress state
lives on the instance); there is no algorithm choice anywhere (config, saved config, or UI). Old saved configs in
storage may still carry an `algorithm` key; nothing reads it, and restore must keep ignoring it.

**Progress reporting:** `AutogearStrategy` requires `setProgressCallback`. `BaseStrategy`
implements it and emits `AutogearProgress` — extend `BaseStrategy` rather than wiring a
callback by hand.

Autogear is CPU-intensive and runs on the main thread. No Web Worker runs any part of it — the
only worker in the project is the workbox service worker registered in `src/index.tsx`, which
handles PWA auto-update and nothing else.

**`runShipOptimizer.ts`:** `findOptimalGearForShip` is the single entry point that runs one ship
through the strategy — the batch Autogear run calls it, never a strategy directly.
`useAutogearShipConfigs` owns the per-ship config map; `toSavedAutogearConfig` is the one mapping
from it to the persisted shape. Every player-configurable scoring input (role, priorities beyond
`statPriorities`, formula, etc.) crosses into a strategy's `findOptimalGear` as one `ScoringInputs`
object (`AutogearStrategy.ts`) built once here, from `config`, and forwarded unchanged — every
field is a required key (`field: T | undefined`, not `field?:`), so a field a future caller forgets
to name is a `tsc` error rather than a silently-undefined argument (#548).

**`offFormula/`:** off-formula detection (`offFormulaStats.ts`), the kit-derived scoring basis
(`basisDerivation.ts`), and which roles host a basis (`roleBasisHost.ts`). Backs `OffFormulaNotice`
and `roleBasis` scoring (#544).
