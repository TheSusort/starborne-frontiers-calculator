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
