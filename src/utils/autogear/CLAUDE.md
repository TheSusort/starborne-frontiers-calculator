# Autogear

**Strategies:** each file in `strategies/` implements `AutogearStrategy` and is registered in
`getStrategy.ts` against a member of the `AutogearAlgorithm` enum — a new strategy needs an
entry in both. The Autogear page starts on `Genetic`, which is not the first enum member, so
the default cannot be inferred from the enum.

**Progress reporting:** `AutogearStrategy` requires `setProgressCallback`. `BaseStrategy`
implements it and emits `AutogearProgress` — extend `BaseStrategy` rather than wiring a
callback by hand.

Autogear is CPU-intensive and runs on the main thread. No Web Worker runs any part of it — the
only worker in the project is the workbox service worker registered in `src/index.tsx`, which
handles PWA auto-update and nothing else.

**`runShipOptimizer.ts`:** `findOptimalGearForShip` is the single entry point that runs one ship
through its configured strategy — both the batch Autogear run and the Simulate Candidates
comparison (below) call it, never a strategy directly. `useAutogearShipConfigs` owns the per-ship
config map plus `buildSimRerankConfig`, which scores the own-role row with the ship's real
configuration and every other compared role under that role's own built-in formula.

**`simRerank/`:** backs the opt-in "Simulate candidates" panel in Autogear Settings. It resolves a
fight (practice/encounter/saved setup), runs the ship's own role plus a handful of others through
`findOptimalGearForShip`, and replays each surviving build through the real combat engine over a
shared seed set to report paired deltas against the equipped baseline. `AutogearResult.candidates`
(a role's distinct runner-up loadouts, beyond its single best) is populated only by
`GeneticStrategy` — TwoPass and SetFirst leave it undefined, so a comparison run under either
degrades to one row per role with no runner-ups.
