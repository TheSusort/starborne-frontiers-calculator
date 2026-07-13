# SP-F PR2 — Dropped Channels (F2, F3, F4, F5)

**Branch:** `epic/sp-f-pr2-dropped-channels` off `main` (`a349e256`, PR1 shipped).
**Spec:** `docs/superpowers/specs/2026-07-13-sp-f-accounting-fidelity-design.md`.
**Status:** Audit-first complete (4 parallel audits, all load-bearing claims verified against `a349e256`). Plan revised from the spec's one-line framing per SF3 / open-Q3.

## Audit outcome — scope reshaped

Three of four channels did **not** match the spec framing. Verified findings:

- **F2** — framing CORRECT. Consumer-side only. Engine emits `heal-performed.perTarget` (typed, always populated except hand-crafted test emits); consumer even-splits at `battleSimulator.ts:372`.
- **F3** — **no gap.** `shieldsAbsorbed` wired end-to-end since Shield-System H1 (#156); `battleSimulator.ts:413` reads real `shield?.absorbed`. No approximation comment exists. **Disposition (user): test-harden + doc-fix**, no production change.
- **F4** — framing WRONG. `healModifier` (a gear-set / base stat, NOT a squad-leader channel) is dropped entirely at the sim→engine boundary (0 hits in `battleSimulator.ts`); enemy side hard-codes `healModifier: 0` at `engine.ts:607`. Needs consumer threading **+ 1 engine line** (team symmetry). The `:172-177` "until PR F3 consumes them" docstring is about squad-leader modifier channels (already consumed) — a separate stale doc to reconcile.
- **F5** — framing MISDIRECTED. Support footprint already switches to charged pattern correctly; the **damage** footprint uses the *active* pattern at 3 engine cast sites even on charge turns. Target-*selection* axis has no threading (`chargedTarget` absent everywhere) and is corpus-inert (every divergent ship differs in pattern only). **Disposition (user): implement selection axis symmetrically** alongside the footprint fix.

## Golden discipline (per spec §5)

Every F is a **deliberate, audited golden move**. Regenerate goldens only after eyeballing the diff and confirming each changed number is explained by that F. Never blind `vitest -u`. If an F moves a golden it shouldn't, stop — leakage. Record which goldens moved and why in this ledger.

## Sequencing (on-branch, one commit per F; overlapping files ⇒ sequential, not parallel worktrees)

### F2 — Per-recipient healing (consumer-side)
1. RED: new sim fixture `healUnequalPerRecipient` in `simGoldenFixtures.ts` — player healer, active skill "repairs 20% of their Max HP" (basis `target-hp`), ≥2 allies with **distinct max HP** → unequal shares. Assert each recipient's `healingReceived` = its own `pct×maxHp`, NOT the even-split.
2. GREEN: in `assembleBattleResult` (`battleSimulator.ts:369-377`) prefer `e.perTarget` (sum `pt.amount` per `pt.targetId`); keep even-split as fallback only when `perTarget` absent/empty (hand-crafted emits).
3. Rewrite 3 stale comments: `:113-116` (`healingReceived` docstring), `:322`, `:365-366` — state the new per-recipient invariant + note HoT-tick and reactive-heal channels remain excluded (pre-existing, out of scope).
4. Existing heal goldens expected **byte-identical** (all use caster-max-HP basis → equal shares). If any move → leak, investigate.

### F3 — shieldsAbsorbed (test-harden + doc-fix; NO production change)
1. Tighten `twoTeamBattle.test.ts:1428` (or add sibling) from `shieldsAbsorbed > 0` to an **exact-drain** assertion (pool/attack chosen for a deterministic drain).
2. Fix stale spec line ref (`:382` → `:413`) in the SP-F spec.
3. Ledger note: F3 verified pre-closed at H1 (#156); no `battleSimulator.ts`/`engine.ts` edit.

### F4 — healModifier consumption (consumer threading + 1 engine line)
1. RED: new sim fixture — healer with `statOverrides.healModifier` > 0 (e.g. 50) → simulated heal scales ×1.5 vs a `healModifier:0` baseline. Add an enemy-side mirror after the engine fix (team symmetry).
2. GREEN consumer: add `healModifier` to `DerivedCombatStats` (`:535`), `resolveStats` (`o.healModifier ?? b.healModifier ?? 0`), `toWalkStats`/`toEnemyStats`, focus input (`~:909`), walk block (`:823-833`), enemy input (`:841`).
3. GREEN engine (symmetry): `engine.ts:607` `healModifier: 0` → `healModifier: e.healModifier ?? 0` (field typed on enemy attacker input).
4. Reconcile the stale `:172-177` docstring (drop the "until PR F3 consumes them" clause; squad-leader channels already consumed). Note: there is no `healModifier`-specific "not simulated" comment to remove — spec's acceptance wording doesn't map; document the deviation.
5. Existing goldens inert (all fixtures `healModifier:0`). New fixtures carry the move.

### F5 — Charged targeting (engine footprint fix + full selection-axis threading)
1. RED: Snakeroot fixture (`docs/ship-skills.csv`/`ship-targeting.csv`) — active `Pattern-Base` (anchor only) vs charged `Pattern-Line-Range-1`; placed opposite ≥2 in-line enemies. On the charge turn the footprint must expand from 1 victim to the line. Add a selection-axis fixture (synthetic ship whose charged target differs) since no corpus ship exercises it.
2. GREEN footprint (engine): compute `willFireCharged = hasChargedSkill(actor) && actor.charges >= chargeCountOf(actor)` before selection at all 3 cast sites (focus `engine.ts:6513-6514`, team `:6787`, enemy `:7124`); use `willFireCharged ? parsedChargedPatternFor : parsedPatternFor` for the `pattern` local, the positional-apply gate, `sel.pattern`, and `aoeVictimIds` (`:5267`).
3. GREEN selection (symmetric): add `chargedTarget` to engine input + `TeamActorEngineInput`/`EnemyActorInput`; thread `plan.chargedTargeting?.target` from `battleSimulator.ts:811/862/914`; add `parsedChargedTargetFor`; `selectTurnTarget` picks by the same `willFireCharged`.
4. Update `battleSimulator.ts:666-667` comment (charged targeting no longer support-only).
5. Golden-neutral for non-divergent ships (chargedPattern falls back to active → gate unchanged). New positional fixtures carry the move; audit any DPS-golden movement (should be none — position-less sink ignores footprint).

## Acceptance (PR2 done)
- F2/F4/F5 fidelity assertions added; F3 exact-drain assertion tightened.
- Approximation comments closed/reconciled (F2 ×3, F4 stale docstring); F3 documented as pre-closed.
- Full suite green; `audit:skills` 0; lint + tsc clean.
- Every moved golden audited-and-explained in the ledger below.

## Ledger (filled during execution)
- F2: _pending_
- F3: _pending_
- F4: _pending_
- F5: _pending_
