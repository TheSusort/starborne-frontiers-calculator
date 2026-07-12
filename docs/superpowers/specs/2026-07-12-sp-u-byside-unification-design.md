# SP-U: bySide Engine Unification

**Status:** Design approved (2026-07-12). Sub-project of the
[Team-Agnostic Engine Unification & Sim Fidelity epic](./2026-07-12-team-agnostic-engine-unification-epic-design.md).
This is SP-U's own spec → plan → implementation cycle.

**Branch:** `sp-u/byside-unification`, fresh off `main` @ `fb595fb7` (SP-0 shipped, PR #250).

---

## 1. Motivation & current state

`src/utils/combat/engine.ts` is ~8,078 lines. Prior bySide work (PR1–PR7, E1–E5, Phase 4c)
**already unified ~80% of the player/enemy mirror**: there is one speed-ordered turn queue
(`allActors` / `turnOrderActors`, `selectNextBySpeed`), one `runPlayerTurn`, one damage core
(`applyVictimDamage` + a `sink` abstraction), unified targeting resolvers
(`runtimeFor`/`parsedTargetFor`/…), side-agnostic healing inside `runPlayerTurn`, and a unified
reactive drain (`drainQueue(queue, sideCtx)`) — all behind `bySide(side)` / `TurnBindings` /
`sink`.

The residual dual-path is a smaller, well-marked residue. SP-U retires it and delivers the D4
DPS-calc migration (real skill-less enemy actor replacing the dummy scalar sink).

### 1.1 Residual-mirror inventory (what SP-U closes)

| # | Residual dual-path | Location (approx.) | Nature | Blocked on D4? |
|---|--------------------|--------------------|--------|:---:|
| R1 | Turn-body `kind`-branch **tails** — the credit/intake/emit code after the three `runPlayerTurn` sites (the deferred "PR7", comment at `engine.ts:4895`) | `engine.ts:6303` (attacker), `6636` (team), `7188` (enemy) | Pure refactor | No |
| R2 | Twin intent queues + drains + two `registerReactiveListeners` | `intentQueue` `2660` / `enemyIntentQueue` `2722`; `drainIntents` `5751` / `drainEnemyIntents` `5780`; listeners `2702`/`2728` | Pure refactor | No |
| R3 | `playerSink`/`enemySink` — bodies now byte-identical, collapse to one | `engine.ts:4206`/`4265` | Pure refactor | No |
| R4 | Dummy-enemy **scalar sink** (`cumulativeDamage`+`cumulativeTeamDamage` → overwrite `enemy.currentHp`) coexisting with per-victim `applyVictimDamage` — **the core asymmetry** | sink construct `1477–1494`; overwrite `7809` | Delete scalar sink | **Yes** |
| R5 | Focus-only result surface (`focus.*` totals `7777–7792`) vs the per-actor `roundDamage` map `3330` | post-round assembly `7773–7803` | Unify to per-actor | **Yes** |
| R6 | Vestigial `healTargetId` binding + `enemyAttackers require healTargetId` throw | throw `1979`; vestigial focus-id binding in `battleSimulator` (`~900`); type note `1047` | Decouple enemy-roster from heal target | Partly |

**The keystone insight:** R4/R5 exist **only** to serve DPS mode. The dummy is `indestructible`,
never dies, and accumulates a scalar so HP%-gates resolve against it. Healing mode and
`battleSimulator` **already** drive real enemy actors through the engine's existing
`enemyAttackers` input. So the D4 DPS-calc migration is not merely "one audited move at the end" —
it is the keystone that unblocks deleting the scalar sink (R4) and unifying the result surface (R5).

### 1.2 Out of scope (stays for later sub-projects)

- The **7 accounting-fidelity approximations** documented in `battleSimulator.ts` (AoE reconcile,
  per-recipient heal, `shieldsAbsorbed`, `healModifier`, charged targeting, per-victim
  affinity/crit, incidental damage) → **SP-F**.
- **FrontLine reactive shield** + **Meatshield stack-stealing** → **SP-M**.

SP-U is structural unification + the D4 migration. Nothing more.

> Note: the epic listed `healModifier` (F4) as forwarded-but-ignored in the simulator; the SP-U
> exploration confirmed it is not referenced in `battleSimulator.ts` at all — it is folded into
> team-actor heal casts elsewhere. Either way it is SP-F's concern, not SP-U's.

---

## 2. Locked decisions (SP-U-specific)

These refine the epic's open questions (epic §7) into settled choices.

| # | Decision | Rationale |
|---|----------|-----------|
| **U-D1** | **DPS-calc opponent = a real finite-HP actor that CAN die.** Not the epic's default (non-terminating). The run terminates on enemy death; DPS mode gains a real death path. | User-ratified. Turns the DPS calc into a realistic time-to-kill tool. |
| **U-D2** | **Headline DPS metric = rounds-to-kill, then damage.** Rank killed configs by fewest rounds (ascending); tie-break / secondary on total damage + avg/round. Configs that survive the N-round window rank last, shown as "survived (X% HP left)", ordered by remaining HP%. | User-ratified. Cumulative-total ranking is misleading once configs kill at different rounds. |
| **U-D3** | **Pure refactors first, D4 as the keystone.** U1–U4 are byte-identical refactors; U5 is the sole audited golden move; U6 is additive UI. | Isolates all golden churn to one reviewable engine PR (U5). |
| **U-D4** | **Enemy default keeps high HP; user configures.** The default enemy still survives the window (rounds-to-kill engages only when the user lowers HP or hardens their config). | User-ratified. Preserves today's out-of-the-box "output over window" feel; ranking degrades gracefully to the all-survived case. |
| **U-D5** | **Manual stat-block only — no "target ship" picker.** U6 evolves the existing `EnemySettingsPanel` with killable semantics; a template-fill picker is deferred to a possible later polish PR. | User-ratified. Keeps U6 lean. |

---

## 3. Increment slicing (U1…U6)

Byte-identical goldens through U1–U4, the audited D4 move in U5, additive UI in U6.

### U1 — Collapse `playerSink`/`enemySink` → one `sink`
Their bodies are already byte-identical (`intakeFor(victimId).incoming += …`). Delete one, route
both side-ternaries (`4206`/`4265`) through the single sink. **Goldens byte-identical.**

### U2 — Extract the triplicated positional-apply block (reshaped 2026-07-12, "Option B")
Originally scoped as a full 3-way tail unification (`applyTurnResult`). The U2 implementer's diff
table disproved that premise: the **enemy** tail uses a different accounting model (credits
*incoming* damage + a damage-taken leech block + distinct `attacked` emit + display grouping +
pre-call incoming-reduction) — the incoming-damage model that **U5** rewrites when the scalar sink
dies. Forcing a merge now would create the `if (side==='enemy')` tangle the plan's escalate clause
forbids. **Reshaped to Option B:** extract only the genuinely-unifiable chunk — the triplicated
*positional-apply block* (focus `~6337–6474` / team `~6648–6773` / enemy `~7353–7478`) — into
`drivePositionalTurnApply(actor, tb, sel, onVictimResolved)`, where the `onVictimResolved` callback
isolates the only intra-block divergence (leech direction: player standing-leech vs enemy
taken-leech). The incoming-vs-outgoing tail accounting stays inline, deferred to U5. Dedups all
three sites at the lowest golden risk. **Byte-identical.**

### U3 — Merge the twin reactive machinery
Fold `intentQueue`/`enemyIntentQueue`, `drainIntents`/`drainEnemyIntents`, and the two
`registerReactiveListeners` calls into one bySide structure. (The drain machinery
`drainQueue(queue, sideCtx)` is already unified — this unifies the *queues* feeding it.)
**Byte-identical.**

### U4 — Decouple enemy-roster construction from `healTargetId` (R6)
Build the positioned enemy roster whenever `enemyAttackers` exist, independent of a heal target.
Kill the vestigial focus-id binding in `battleSimulator` and the
`enemyAttackers require healTargetId` throw (`1979`). Healing mode still sets a *real* heal target;
nothing else does. **Byte-identical** for existing modes.

### U5 — D4 keystone (the sole audited golden move)
DPS mode drives a **real finite-HP skill-less enemy actor** instead of the dummy:

- Replace `createActor({ id:'enemy', indestructible:true, stats:{attack:0…} })` (`1477`) with a
  real `enemyAttackers`-style actor built from the enemy config: real
  `hp`/`defence`/`security`/`speed`/`affinity`/`type`, **no skills** (no kit parsed — it takes
  turns but casts nothing; it exists purely as a target).
- It takes real per-victim damage via `applyVictimDamage`; HP% gates read its *real* declining HP
  (more correct than the scalar); it dies at 0 HP → run terminates.
- Delete the scalar sink (R4): the `cumulativeDamage`/`cumulativeTeamDamage` → `enemy.currentHp`
  overwrite (`7809`) and the focus-only rawTotals.
- Unify the result surface (R5): DPS totals come from the same per-actor `roundDamage` map the sim
  already uses.
- `dpsSimulator` handles early termination: reads the trimmed `BattleResult.outcome.lastRound`
  when the enemy is wiped → `roundsToKill`; else `survived: true` + `finalHpPct`.
- **Absorbs the enemy turn-body tail unification deferred from U2.** Once the DPS enemy is a real
  actor and the scalar sink is gone, the enemy tail's incoming-damage accounting model converges
  toward the player tail (R5). Verify + fold the enemy positional/accounting tail onto the unified
  path here; the `if (side==='enemy')` divergence U2 could not cleanly merge dissolves once the
  scalar path is deleted.

**Golden impact:** DPS goldens shift (scalar→per-victim basis + early termination) — each regen
inspected and justified in the PR. Sim goldens should stay stable (already real-actor); any move is
a flag to investigate, not auto-accept. **Adds the SP-0 death-path sim golden here** (see §5).

### U6 — DPS enemy-config UI + rounds-to-kill display (additive)
- Evolve the existing `EnemySettingsPanel` with killable semantics (manual stat-block; keep the
  high-HP default per U-D4). No "target ship" picker (U-D5).
- Comparison view headline becomes rounds-to-kill; killed configs ascending, survivors last by
  remaining HP%; secondary display keeps total damage + avg/round.
- Chart adaptation: the cumulative-damage line chart's enemy-HP-to-0 crossing marks the kill round.

**No golden change (UI-only; component tests).**

---

## 4. Ranking semantics (U-D2, precise)

Given per-config results in a comparison:

1. **Killed configs first**, ordered by `roundsToKill` ascending (fewer rounds = better).
2. Ties on `roundsToKill` broken by total damage descending.
3. **Survived configs last** (never reached 0 HP within N rounds), ordered by `finalHpPct`
   ascending (lower remaining HP = closer to a kill = better).
4. Secondary columns always show total damage + avg/round regardless of outcome.

With the high-HP default (U-D4), the common out-of-the-box case is "all survived" → ranking falls
back to `finalHpPct` (equivalently, most total damage). This must be handled gracefully, not as an
error state.

---

## 5. Golden discipline & testing

**Golden discipline (epic core invariant):**
- **U1–U4 + U6:** BOTH golden tiers (synthetic DPS/healing + sim `BattleResult`) stay
  **byte-identical**. `vitest -u` forbidden; any diff = a bug to investigate. U6 is UI-only.
- **U5:** the *sole* audited golden move. DPS goldens shift; each regen inspected and justified.
  Sim goldens stable — investigate any move.

**New test coverage in U5:**
- **SP-0 death-path sim golden** — a decisive-outcome `BattleResult` fixture with ≥1 real death
  (a battle that terminates on a wipe), closing the SP-0 follow-up pin. The finite DPS enemy is the
  first natural death path.
- DPS-adapter tests for `roundsToKill` / `survived` / `finalHpPct` and the §4 ranking (killed
  ascending, then survivors by HP%, incl. the all-survived fallback).

**Cross-cutting invariants (every increment):**
- Team-symmetric (a ship acts identically on either side).
- `audit:skills` 0 findings.
- Production RNG untouched (`Math.random`); only the test harness seeds/streams.
- Lint + tsc clean; `npm test` green.
- Workflow: `gh auth switch --user TheSusort` before PR ops; docs are gitignored
  (`git add -f`, docs-only commits `--no-verify`); dev server on :3000.

---

## 6. Acceptance criteria (SP-U "done")

1. No dual-path markers remain for R1–R6: one bySide path for turn-body tails, reactive
   queues/drains, the sink, damage accounting, and the result surface.
2. The `healTargetId` requirement is gone; the enemy roster builds from `enemyAttackers` presence.
3. The DPS calculator drives a **real finite-HP skill-less enemy actor** (no dummy scalar sink);
   the run terminates on enemy death; the headline metric is rounds-to-kill (then damage), with
   graceful all-survived fallback.
4. DPS goldens audited (U5 only); sim goldens stable; the death-path sim golden is added.
5. `audit:skills` 0 findings; lint + tsc clean; full suite green.

**Epic acceptance satisfied by SP-U:** epic #1 (mirror gone) and epic #2 (DPS/healing on real
actors; DPS opponent a configurable skill-less real ship). Epic #3/#4/#5 remain SP-F/SP-M.

---

## 7. Non-goals (SP-U)

- The 7 accounting-fidelity approximations (SP-F) and FrontLine/Meatshield (SP-M).
- A "target ship" template-fill picker for the enemy config (deferred; U-D5).
- Distribution/Monte-Carlo sim UI, board/targeting changes, the #5 composition-selector merge
  (all epic-level non-goals).
