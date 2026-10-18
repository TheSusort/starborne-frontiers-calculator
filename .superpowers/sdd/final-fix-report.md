# Final fix round report (arcade hangar)

**Status:** DONE. Every item, 1 to 16, is fixed in seven commits on `feat/arcade-hangar`, on top of `5f525586c`. Each commit passed the full husky pre-commit suite (1092+ files, about 12.7k tests).

| Commit | Items |
|---|---|
| `736d3bdfa` perf(arcade): split idle work into deadline-aware, cancellable units | 2c, 2d, and the cancellable queue for 3 |
| `465ce56c7` perf(arcade): keep sprite models resident on the GPU, bounded by an LRU | 1, 2a, 2b, 6, 7 (stage disposal), 14 (URL escaping) |
| `4fe14daf3` perf(arcade): cache sprites per page, cancel a closed arcade's work | 3, 4, 5, 7 (bounded caches), 10, 11 (accessor), select-screen prewarm |
| `9d0b5439e` perf(arcade): draw a settled ship as one frame, remember the grid fan | 8, 9 |
| `248a8eaf8` fix(arcade): structural ship-model gate, duel-skip trace, visual key check | 11 (tests), 12, 13, 14 (schema) |
| `77a3e16fe` docs(arcade): split the lanes/pose changelog entry, amend the hangar spec | 15, 16 |
| `a545f5f58` perf(arcade): two-tier select-screen prewarm, bounded portrait cache | 2 (prewarm tiers), 7 (portrait maps) |

## Measurements (item 2)
**How I measured.** I used Chrome through claude-in-chrome against a flag-on dev server on :3011, which I have now stopped. The automation tab was always **hidden** (`document.hidden === true`), so requestAnimationFrame was frozen. Chrome's timers were throttled, and `requestIdleCallback` effectively never fired.
- **Before:** direct `performance.now()` around the calls.
- **After:** I stubbed `requestIdleCallback` with a MessageChannel version that reports a 12 ms deadline. A MessageChannel ticker recorded the longest main-thread block, meaning the longest gap between ticks. I checked the ticker by injecting a 50 ms busy loop, and it read 50 ms.

**Before (HEAD `5f525586c`, Terran_7):**
| Step | Time |
|---|---|
| FBX fetch | 203 ms |
| FBX parse, cold module | 160 ms (42–52 ms warm on other ships) |

**Caveat on the parse numbers.** The "before" parse figures used a separately imported `FBXLoader` with no `LoadingManager` URL redirect, and the 160 ms one was the first parse on that module. The "after" 12–16 ms is the longest block inside the real pipeline. The conditions differ, so this is not a demonstrated tenfold parse speed-up. The parse simply now runs in idle time, and is held back while the ship flies.
| `loadShipModel` | 215 ms |
| First 5-frame sweep | 194 ms synchronous (the zoom fit alone is 79 ms precise over 45 clones, plus 6 ms of cloning) |
| Second sweep | 43 ms synchronous |
| Third sweep | 44 ms synchronous |

The second and third sweeps were slow because the old code released the GPU copies after every render, so each sweep recompiled the shader and re-uploaded the textures.

**After:**
| Step | Result |
|---|---|
| Second sweep of a loaded model | 4 ms wall, longest block 3 ms |
| All 45 frames | 17 ms in total, longest block 6.8 ms |
| A gate sprite plus a duel render of a resident model | about 7 ms |
| Model load (parse in idle) | longest block 12–16 ms |
| First sweep of a new model on an existing stage | longest blocks of 10–46 ms, over 100–130 ms wall |
| Very first render of a session | one 169 ms block |

- **First sweep of a new model:** the separate blocks are the compile, then four texture uploads (initTexture took 1–16 ms each when timed directly), then the first frame. A single 2k texture upload cannot be split further.
- **Very first render of a session:** this includes creating the WebGL renderer, the PMREM room environment (about 22 ms) and a cold shader compile.
- **Zoom fit:**
  - The fit over cached vertices takes 24 ms for all 45 poses, against 85 ms before. It runs one pose per idle unit, about 0.5 ms each.
  - It gives exactly the precise zoom: 0.5950737 against 0.5950737.
  - `precise=false` would have shrunk the ship by 28% (zoom 0.428).
  - "Only the extreme poses" would have been wrong: the largest extent is at heading −25°, pitch +10°, bank 0, which is not a corner.
- **Not measured:** none of this was measured on a visible, running game at 60 fps. Real idle periods during a run are shorter than the stub's 12 ms. The always-one-unit rule means progress never stalls; it does not make a unit cheaper.

**Where the work now happens.** I chose to render on the select screen, for three reasons:
- the select screen is idle;
- `ShipModelView` has already loaded and parsed the same model there, through the same cache;
- a run can start with its frames ready.

How it works, in two tiers:
- **400 ms dwell:** the focused ship's own frame grid and duel render start rendering.
- **1.5 s dwell:** its first opponents are picked, and their portraits, models, gate sprites and duel renders start loading. This is kept to the longer dwell because each opponent costs a model download plus parse and upload blocks, and browsing should not start those for every ship passed over.
- Moving focus on aborts the earlier ship's queued renders (its focus signal), and launching the focused ship keeps them going.
- A model download that has already started is not cancelled; only the queued renders are dropped.
- The easter-egg path skips the select screen. There, the flown ship's frames queue on mount, ahead of the opponents.

**Hold on heavy work.** While the ship flies (intro or running), the idle queue holds back "heavy" tasks: FBX parses of any model except the flown ship's, which is pinned as urgent. Opponents picked mid-run (after a free-lane pass) therefore parse at the next duel, countdown or pause, and their gates show portraits until then. That is the designed fallback.

## Per item
1. **GPU residency.**
   - `releaseGpu` no longer runs after each render.
   - The stage tracks the models it has uploaded in `resident`.
   - `disposeSpriteStage()` releases them, then calls `renderer.dispose()` and `forceContextLoss()`.
   - A model evicted from the LRU is released through `onShipModelEvicted`. That also clears its zoom cache and its `resident` entry.
2. **Idle work.**
   - **2a:** the FBX downloads with `FileLoader`, then `FBXLoader.parse` runs as a queued heavy task. The 10 s timeout now covers the download only.
   - **2b:** the zoom fit, as described in Measurements.
   - **2c:** a task calls `slice.next(budgetMs)` between units. A unit runs while the period has the budget left, and the first unit of every period runs regardless, so a page that is never idle still gets one unit per period. Units are: one pose of the fit, the compileAsync, one texture upload, and one frame.
   - **2d:** without `requestIdleCallback`, a period starts after the next requestAnimationFrame plus a 0 ms timeout, with a synthetic 8 ms deadline. The timeout caps the wait, which covers hidden tabs.
3. **Module-scope caches and cancellation.**
   - **Caches:** `ships/arcadeSprites.ts` has no three.js and holds the frame grids (3), gate sprites (16) and duel renders (6), keyed by visual key, with the flown ship's entries kept.
   - **Session:** FlightGame creates its session `AbortController` inside a mount effect, so each StrictMode remount gets a fresh one. Unmount aborts it, which drops queued tasks and stops a running one at its next unit.
   - **No writes after unmount:** every `setState` or view write that follows async work checks the session first. That covers `swapIn`, the duel simulation, gate sprites, frames and the prepare-next idle callback. Unmount also calls `endArcadeSession()`, which releases the pins, un-holds the queue and disposes the stage.
   - **Resuming:** a cancelled grid fill resumes at its missing sweeps.
   - **Not dropped:** model parses are queued without a signal, because `loadShipModel` takes none. A parse already queued when the player quits therefore still runs once `endArcadeSession` lifts the hold. This is harmless (the model lands in the model cache), but it is work done for a closed arcade, against the brief.
4. **Request race.** `createRequestCache` deletes an entry on failure only if it is still the same entry. A test covers this.
5. **Loop cleanup.** The loop effect's cleanup no longer bumps the run generation. Duels check `!session.aborted && generation === runGenerationRef.current`.
6. **Model LRU.** `createLoadCache` keeps 8 finished models. Pinned models and loads still in flight sit on top of that bound. Pins come from `modelPins`:
   - flown ship: urgent;
   - opponents still ahead: unresolved checkpoints plus the pre-picked pair;
   - `ShipModelView` pins the model it shows.
7. **Stage and caches.** The stage is disposed on unmount and recreated lazily. Gate sprites no longer go through `loadPortrait`. The portrait maps (`cache` and `loaded`) are now bounded to 32 with `evictOldest`.
8. **Blend fast path.**
   - Pose axes and the lane position snap onto their targets within 1e-3.
   - `axisBlend` treats an angle within 1e-6° of a grid angle as on it, because the centre lane's computed heading is a rounding error off 0.
   - Blend corners whose sweeps fall back to the same canvas are merged.
   - The existing exact-mean and sum tests are untouched.
   - On portrait screens the outer lanes rest at about ±16°, between two frames, so that case still composites two frames by design.
9. **Projection.** `arcadeGridColumns` remembers its result (frozen) for the last geometry, compared by value, because `sceneGeometry` returns a new object every frame.
10. **Gate sprites.** `GateArt.sprite` is an `HTMLCanvasElement` that `drawGate` draws directly. DuelSummary still receives data URLs.
11. **Model-module gate.** `arcadeFlags.loadShipSprites` and `loadShipModelView` reject with "ship models disabled" without importing anything. Every caller uses them, including `React.lazy(loadShipModelView)`. The convention comment is gone, and the lazy-import test comment now points to the accessors.
12. **Duel trace.** `runDuel` calls `console.warn` in DEV with the error. The test asserts it.
13. **Unset flag.** `vi.stubEnv(name, undefined)` removes the key in vitest 3.2.7 (asserted with `in`), and the flag reads as off.
14. **Visual keys.** The schema now has the regex, and `modelUrls` applies `encodeURIComponent`. All current keys already match the regex.
15. **Changelog.** The two new entries are word for word as the brief asked; the other three are unchanged.
16. **Spec.** I appended "Amendments (2026-10-18)" to `docs/superpowers/specs/2026-10-18-arcade-hangar-duels-design.md`. The file was already tracked, so `git add -f` was not needed.

## Tests (TDD where pure)
| Area | What is tested |
|---|---|
| `idle.test.ts` (13) | deadline-driven unit splitting with a fake deadline; one unit per period at `timeRemaining() == 0`; the rAF fallback deadline; the hidden-tab timeout; abort of queued and running tasks; heavy hold |
| `loadCache.test.ts` (6) | LRU order, pinning, released pin, in-flight kept, failed load retried |
| `modelPins.test.ts` (2) | pin counting and urgency, pin sets |
| `arcadeSprites.test.ts` (10) | `anySignal`; request cache dedupe, cancelled-then-restart, stale-failure race, bound with pins; `fillFrameGrid` order, skip on failure, abort and resume; `requestPlayerFrames` stops after abort and resumes |
| `spritePoses.test.ts` (+3) | on-grid snap; an eased pose landing on a resting target takes the single frame (this fails without either fix); settle bounds |
| `projection.test.ts` (+2) | memo identity and invalidation, and identical results whether or not the memo was hit |
| `arcadeFlags.test.ts` (+3) | unset case; the accessors reject and import nothing when off; they import when on |
| `catalogueSchema.test.ts` (new, 2) | `shipVisualKey` regex |
| Other | `shipModelLoader.test.ts` gains a key-escape test and the timeout test now runs over the fetch; `runDuel.test.ts` asserts the warn |

**Final run** (before the prewarm commit; that commit's pre-commit suite also passed): `vitest run src/components/arcade src/utils/arcade src/components/theme` plus the schema test gave 25 files and 267 tests passed. `tsc --noEmit` is clean. `npm run lint` is clean with 0 warnings. `npm run audit` is OK (3 advisories, none at or above high).

## Build checks
`npx vite build` ran with and without `VITE_ARCADE_SHIP_MODELS=1`, into scratchpad outDirs.
- **WebGLRenderer:** only `three-vendor-*.js` contains it in either build.
- **Entry chunk:** no import of three in either build.
- **Flag on:**
  - `FlightGame` refers to three-vendor only inside Vite's `__vite__mapDeps` preload list for the dynamic `import('./shipSprites')`; there is no static import.
  - `shipModelLoader` is now bundled inside the `shipSprites` chunk. Its `globIgnores` pattern is now unused but harmless.
- **Flag off:** no `shipSprites`, `ShipModelView` or `shipLighting` chunk is emitted. `three-vendor` is still emitted (manualChunks), but nothing references it.
- **Precache:** `sw.js` lists 127 assets in each build, and none of them is three-vendor, shipSprites, ShipModelView or shipLighting.

## Browser smoke test (flag on, :3011)
- I opened the arcade with `app:flight:start` and closed it with Quit: no console errors and no unhandled rejections. This origin has no fleet, so the run used the neon fighter with no select screen.
- Through `arcadeSprites` directly:
  - a fill aborted after its level sweep stopped at one sweep;
  - after `endArcadeSession()` disposed the stage, a gate sprite still rendered at 128×128 on a fresh stage;
  - a new request resumed and filled all 9 sweeps.

## Not verified
- **A real fleet in the browser:** the select-screen prewarm, launch, gates with sprites, duels with swapped renders, and StrictMode remount behaviour are covered by unit tests of the module logic only. There is no FlightGame component test; the cancellation token is enforced by code review, not by a test.
- **Frame timing during a visible run at 60 fps:** not measured, because the tab was hidden.
- **Safari's fallback path:** tested only in jsdom.

## Concerns
1. **Opponents picked mid-run show portraits until the next duel or pause.** This is caused by the heavy-work hold. Remove the hold, `runWhenIdle.hold` in FlightGame, if the owner prefers sprites sooner at the cost of 10–50 ms parse hitches mid-run.
2. **The first render of a new model still has single blocks of up to about 45 ms** (texture upload or first draw), plus one of about 170 ms for the session's stage creation and cold compile. The prewarm moves these to the select screen for the flown ship and its first opponents, but not for opponents picked later.
3. **The model-cache pins rely on FlightGame calling `refreshPins`** at each change point: launch, restart, prepare, gate assignment and checkpoint pass. A missed call costs only a re-download or re-render, not a crash.
4. **The focus prewarm renders the frame grid of every ship the user lingers on for 400 ms**, and loads opponents for every ship held for 1.5 s. Each lands in the frame-grid cache, which keeps 3 grids of about 12 MB each.

## Cleanup round
- **Closed-arcade parses:** the arcade-open flag lives in `modelPins` (no three dependency) and `endArcadeSession` clears it. A queued model parse throws `abortError()` while the arcade is closed and the key is unpinned; the load cache drops the rejection, so a later get retries. `setArcadePins` with a flown ship, or a live sprite request, reopens it.
- **Memory after close:** `endArcadeSession` drops every frame grid and viewer render except the last flown ship's, and `trimSpriteCaches` trims the model cache to `MODEL_CACHE_CLOSED_SIZE` (2, the flown ship's model included) and its zoom fits. `createLoadCache.trim` takes `(max, keep)`. Gate sprites (128 px) stay.
- **Stale resident entry:** `markResident` skips a model the cache has evicted.
- **Spec:** "Turning the model flag on in production" is marked superseded.
- **Tests (+5):** loadCache trim with keep, parse gate (closed, pinned), `endArcadeSession` trim and reopen, `markResident`.
- **Concern:** if the sprites module was never loaded, `endArcadeSession` trims nothing in the model cache.
