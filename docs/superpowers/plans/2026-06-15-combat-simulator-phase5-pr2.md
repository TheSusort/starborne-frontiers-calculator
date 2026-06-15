# Combat Simulator Phase 5 — PR 2 Implementation Plan (`/simulator` page)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `/simulator` page where the user places two real fleet squads on a 3×4 hex board (with optional stat overrides), runs `simulateBattle`, and steps through the battle round-by-round over both boards (HP/effects per cell, turn-order strip, event log, pinned per-ship card, outcome).

**Architecture:** Page-first PR 2 of 2. Consumes PR 1's `simulateBattle(input): BattleResult` (already merged/merging). Reuses `FormationGrid` (board), `ShipSelector`/`useShips` (fleet pick), `calculateTotalStats` (gear/refit/engineering stat resolution → `statOverrides`), and the calculator pages' state/memo + result-display patterns. The only pure-logic units worth TDD are the shared stat-resolution helper and the per-cell overlay derivation; the rest is UI assembly with RTL smoke/interaction tests.

**Tech Stack:** React 18, TypeScript, Vitest + React Testing Library, TailwindCSS. New page under `src/pages/`, new components under `src/components/simulator/`.

**Spec:** `docs/superpowers/specs/2026-06-15-combat-simulator-phase5-design.md` (§6 page, §11 PR 2).

---

## Workflow notes (read first)
- **Branch + worktree:** PR 2 **stacks on PR 1** (it imports `simulateBattle`). Branch `feat/combat-sim-phase5-pr2` off the tip of `feat/combat-sim-phase5-pr1` (#116), in a new worktree `.worktrees/sim-pr2`. Symlink `.env` + `docs/*.csv` + `docs/combat-system.md` + `.husky/_` from the main checkout. When #116 merges, rebase `--onto origin/main <old-pr1-tip>` + retarget base→main.
- **`gh auth switch --hostname github.com --user TheSusort`** before any PR/gh op.
- **Goldens byte-identical:** no engine change. Task 1 refactors `DPSCalculatorPage` to use an extracted helper — its behavior + existing tests must be unchanged. `git diff origin/main -- '*.snap'` empty throughout.
- `docs/` gitignored → `git add -f`; docs commits `--no-verify`. Tests next to components / in `__tests__/`.
- **UI conventions (CLAUDE.md):** use `src/components/ui/` primitives — `Button`, `card` class, `StatCard`, `PageLayout`, `IconBadge`, `BaseChart`; NO raw `<button>` for actions; no emojis in UI text (plain text + color classes). There is NO slider component → use `<input type="range">` (it exposes `role="slider"`).
- Test cmds: `npm test -- <path>`, `npm test`, `npm run lint`, `npx tsc --noEmit`. Dev server on :3000 — HOLD pushes during any UI iteration the user wants to do.

---

## File structure
| File | Responsibility | Change |
|---|---|---|
| `src/utils/ship/combatStats.ts` | **new** — extracted `shipFinalStats(ship, deps)` + `combatStatsFromShip(final)` (shared by DPS page + simulator) | Create |
| `src/pages/calculators/DPSCalculatorPage.tsx` | use the extracted helper (behavior-preserving) | Modify |
| `src/pages/SimulatorPage.tsx` | **new** — the page: placement state, two boards, Run, playback orchestration | Create |
| `src/components/simulator/BattleBoard.tsx` | **new** — a board (reuse/wrap `FormationGrid`) with per-cell HP/effect overlay + read-only playback mode | Create |
| `src/components/simulator/RoundStepper.tsx` | **new** — ⏮◀▶⏭ + range slider + play/pause; controlled `currentRound` | Create |
| `src/components/simulator/RoundEventLog.tsx` | **new** — renders `BattleRound.events` | Create |
| `src/components/simulator/ShipRoundCard.tsx` | **new** — pinned per-ship detail (HP, dealt/taken, healing, shields, buffs) | Create |
| `src/utils/simulator/boardOverlays.ts` | **new** — PURE: `BattleRound` → `Record<Position,{hpPct,alive,buffs,effect}>` per side | Create |
| `src/App.tsx` | add lazy `/simulator` route | Modify |
| `src/components/ui/layout/Sidebar.tsx` | add nav entry | Modify |
| `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts` | docs + changelog | Modify |

---

## Task 1: Extract shared combat-stat resolution helper

**Files:** Create `src/utils/ship/combatStats.ts`; Modify `src/pages/calculators/DPSCalculatorPage.tsx` (lines ~46-72); Test `src/utils/ship/__tests__/combatStats.test.ts`.

`DPSCalculatorPage` has inline `shipFinalStats(ship)` (→ `calculateTotalStats(...).final`) + `combatStatsFromShip(final)`. Extract them to a shared, pure(ish) module so the simulator reuses them (DRY; the PR-1 reviewer flagged this).

```ts
// combatStats.ts
import { calculateTotalStats } from './statsCalculator';
import type { Ship } from '../../types/ship';
// deps are the context fns the page already has (getGearPiece, getEngineeringStatsForShipType)
export function shipFinalStats(ship: Ship, deps: {
    getGearPiece: (id: string) => GearPiece | undefined;
    getEngineeringStatsForShipType: (t: ShipTypeName) => EngineeringStat | undefined;
}) {
    const eng = ship.type ? deps.getEngineeringStatsForShipType(ship.type) : undefined;
    return calculateTotalStats(ship.baseStats, ship.equipment || {}, deps.getGearPiece, ship.refits, ship.implants, eng, ship.id).final;
}
export function combatStatsFromShip(final: ReturnType<typeof shipFinalStats>) {
    return { attack: Math.round(final.attack), crit: Math.round(final.crit), critDamage: Math.round(final.critDamage),
        defensePenetration: Math.round(final.defensePenetration || 0), hacking: Math.round(final.hacking ?? 200),
        defence: Math.round(final.defence ?? 0), hp: Math.round(final.hp ?? 0), speed: Math.round(final.speed ?? 100),
        healModifier: Math.round(final.healModifier ?? 0) };
}
```

- [ ] **Step 1: Write the failing test** — `combatStatsFromShip` rounds + applies the documented defaults (hacking 200, speed 100) for a ship with known `final` stats (call `shipFinalStats` with a stub `getGearPiece`/`getEngineeringStatsForShipType` and a hand-built `Ship`, or test `combatStatsFromShip` directly on a hand-built `final`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `combatStats.ts`; refactor `DPSCalculatorPage` to import + use it (delete the inline copies, pass its existing `getGearPiece`/`getEngineeringStatsForShipType`). Behavior must be identical.
- [ ] **Step 4: Run** the new test + the DPS page tests + full suite — all green, **byte-identical goldens** (the DPS refactor is behavior-preserving).
- [ ] **Step 5: Commit** `refactor(ship): extract shared combatStatsFromShip helper`.

---

## Task 2: `/simulator` route + page skeleton (placement + Run)

**Files:** Create `src/pages/SimulatorPage.tsx`; Modify `src/App.tsx` (lazy route) + `src/components/ui/layout/Sidebar.tsx` (nav); Test `src/pages/__tests__/SimulatorPage.test.tsx`.

The page (mirror `DPSCalculatorPage` state/memo): placement state for both teams `Record<Position, Ship>` (player + enemy) + selected cell per board; a `ShipSelector` to fill the selected cell; (NO per-cell stat-override editor in v1 — see Notes; geared stats are used directly); a **Run** `Button` that resolves each placed ship via Task-1's helper → `BattlePlacement[]` (statOverrides = resolved combat stats, position) and memoizes `simulateBattle({playerTeam, enemyTeam, rounds: 30})` → `BattleResult` in state.

- [ ] **Step 1: Write a failing smoke test** (RTL, `MemoryRouter`, mock `useShips`/`useInventory`/`useEngineeringStats` per `HealingCalculatorPage.test.tsx`): page renders the title, two boards (`getAllByRole('grid')` length 2 — or a board test id), and a Run button.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the page skeleton + route (lazy in `App.tsx`) + Sidebar nav entry. Use `PageLayout`, `card`, `Button`, `ShipSelector`, two `FormationGrid` (or the Task-3 `BattleBoard` if built first — order tasks so the board component exists; if not, render two `FormationGrid` directly here and swap to `BattleBoard` in Task 4). Resolve stats via `shipFinalStats`+`combatStatsFromShip`.
- [ ] **Step 4: Run** smoke test + full suite (green; byte-identical). tsc + lint.
- [ ] **Step 5: Commit** `feat(sim): /simulator route + placement page skeleton + Run`.

---

## Task 3: Round-stepper playback control

**Files:** Create `src/components/simulator/RoundStepper.tsx`; Test co-located. Wire into `SimulatorPage`.

A controlled stepper: props `{ round, total, onChange }`. Renders `⏮ ◀ "Round N / total" ▶ ⏭` (as `Button`s), an `<input type="range" min=1 max=total>` (role slider), and a Play/Pause `Button` that auto-advances via `setInterval` (clear on pause/unmount/last round). No emojis — use text labels or icon components from `src/components/ui/icons/`.

- [ ] **Step 1: Write failing component tests:** clicking ▶ calls `onChange(round+1)`; the slider `fireEvent.change` to 5 calls `onChange(5)`; ◀ at round 1 is disabled/no-op; Play advances over time (use fake timers).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `RoundStepper`; wire `currentRound` state into `SimulatorPage` (clamp to `battleResult.rounds.length`; reset to 1 on a new Run).
- [ ] **Step 4: Run** tests + full suite green; tsc + lint.
- [ ] **Step 5: Commit** `feat(sim): round-stepper playback control`.

---

## Task 4: Board overlays + per-ship card + event log + outcome

**Files:** Create `src/utils/simulator/boardOverlays.ts` (PURE) + test; `src/components/simulator/BattleBoard.tsx`, `RoundEventLog.tsx`, `ShipRoundCard.tsx`; wire into `SimulatorPage`.

- **PURE overlay derivation** (`boardOverlays.ts`): `overlaysForRound(round: BattleRound, side: 'player'|'enemy', roster): Record<Position, { hpPct: number; alive: boolean; buffs: string[]; debuffs: string[]; effect?: 'damage'|'heal' }>` — maps the round's per-ship state to per-cell overlay data (effect = damage if damageTaken>0, heal if healingReceived>0). This is the testable core.
- **`BattleBoard`**: renders a side's board for playback. Reuse `FormationGrid` if a small additive `readOnly?` + `cellOverlay?(position)` render-prop can be added WITHOUT changing encounter-feature behavior (default off); otherwise build a focused read-only hex board. Enemy board mirrored (col 4 = front). Per cell: HP bar (`width: hpPct%`), shield/effect indicator, dead styling; click a cell → pin that ship (`onPinShip`).
  - **actorId↔shipId mapping (REQUIRED — don't get stuck here):** `BattleResult.roster` uses SYNTHETIC actor ids (`'attacker'`, `p:<shipId>:<idx>`, `e:<shipId>:<idx>`), NOT raw ship ids; `FormationGrid.getShipForPosition` resolves by raw `shipId` from `useShips()`. So the page must keep its own `Position → {ship, actorId}` placement map and the overlay keys off the **actorId** (matching `roster`/`rounds[].ships[].actorId`). The focused read-only board sidesteps `FormationGrid`'s shipId lookup entirely — recommended for the playback board.
- **`ShipRoundCard`**: pinned per-ship detail for the current round (HP, damage dealt/taken, healing done/received, shields, active buffs/debuffs) — `StatCard`/`card`. Add a code comment that `activeDebuffs` is infliction-only (no `debuff-expired` in PR1's surface) so it accumulates/persists for the rest of the battle — expected, not a bug.
- **`RoundEventLog`**: renders `BattleRound.events` (damage/heal/death lines) for the current round.
- **Outcome summary**: `battleResult.outcome` (winner/lastRound) via `StatCard`.

- [ ] **Step 1: Write failing tests** — (a) PURE `overlaysForRound`: a round with a ship at 30% HP + damageTaken>0 → that cell's overlay `{hpPct:30, effect:'damage'}`; a dead ship → `alive:false`; (b) `BattleBoard` renders HP bars from overlays + dead styling (RTL); (c) `RoundEventLog` lists the round's event lines; (d) `ShipRoundCard` shows the pinned ship's current-round stats. Mock `BattleResult` data (no `simulateBattle` needed for the pure/overlay tests).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the pure derivation + components; wire into `SimulatorPage` (board overlays update with `currentRound`; pin state; event log + outcome).
- [ ] **Step 4: Run** tests + full suite green; **byte-identical**; tsc + lint. If `FormationGrid` was extended, confirm the encounter-feature tests still pass unchanged.
- [ ] **Step 5: Commit** `feat(sim): board overlays, per-ship card, event log, outcome`.

---

## Task 5: Integration test, docs, changelog, final verify + PR

**Files:** `src/pages/__tests__/SimulatorPage.test.tsx` (extend); `src/pages/DocumentationPage.tsx`; `src/constants/changelog.ts`.

- [ ] **Step 1: End-to-end page test** — place a couple of ships on each board (drive `ShipSelector`/placement via the mocked `useShips` fleet), click Run, assert the boards show HP bars + the outcome renders; step a round and assert overlays/event-log update. Mock the contexts; `simulateBattle` runs for real on the mocked ships (or a small fixture).
- [ ] **Step 2:** Update `DocumentationPage.tsx` (new Battle Simulator section) + add an `UNRELEASED_CHANGES` changelog entry (this is the first user-visible Phase-5 surface — plain English: "New Battle Simulator: place two squads on the board and watch a round-by-round fight play out.").
- [ ] **Step 3: Final gate:** `npm test` full suite green; **goldens byte-identical** (`git diff origin/main -- '*.snap'` empty); `npm run lint` + `npx tsc --noEmit` clean.
- [ ] **Step 4: Holistic self-review** vs spec §6: two-board placement, fleet selection, Run, board-centric round-stepper playback (arrows + slider + play, turn-order strip [derived from event order, or dropped with a note], event log, pinned ship card, outcome). Override editor explicitly deferred (v1 decision). Confirm `FormationGrid`/encounter feature unaffected + byte-identical goldens.
- [ ] **Step 5:** Open PR (`gh auth switch`), base = `feat/combat-sim-phase5-pr1` (retarget to main after #116 merges). Body: completes Phase 5 page-first; links spec. CodeRabbit poll.

---

## Notes / decisions
- **Turn-order strip — V1 DECISION: derive from the round's event sequence.** `BattleResult.rounds[].events` are in emission order, so the distinct acting `actorId`s in order approximate the round's turn order. Build the strip from that (Task 4, alongside the event log). If it proves misleading (e.g. reactive intents interleave confusingly), DROP it for v1 with a one-line note — do NOT add a turn-order field to the PR1 surface in this PR.
- **Stat overrides UI — V1 DECISION: DEFER the editor.** v1 uses each ship's resolved geared stats (Task 1 helper) as `statOverrides`, with NO per-ship override editor (the spec labels overrides "optional inline"). The editor is an explicit follow-up. So Task 2's "per-cell stat-override editor" is OUT of v1 — placement just selects a ship; its geared stats are used.
- **`FormationGrid` extension vs new board:** prefer additive optional props (`readOnly`, `cellOverlay`) so the encounter feature is untouched; if that proves invasive, build a focused read-only board in `BattleBoard` and keep `FormationGrid` only for the interactive placement step.
- This PR completes the positional-combat arc's page-first goal; the full team-agnostic engine unification remains a deferred later phase.
