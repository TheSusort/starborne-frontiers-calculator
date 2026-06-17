# A.3 — Buff-only Team-Actor → Walked-Path Migration — Design

**Date:** 2026-06-17
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project A, closing item)
**Parent sweep:** `2026-06-17-a-sweep-design.md` / `2026-06-17-a-sweep.md` — A.3 was re-scoped
out of that byte-identical sweep on 2026-06-17 when execution found the legacy branch is LIVE,
not dead. This is its standalone behavior-risk spec.
**Predecessors:** A1a, A1b, A2 (shipped on `feat/combat-sim-phase5-pr2`). A2 is load-bearing here —
its live `liveDebuffLandingChance` with 200/100 base defaults is what lets a synthesized walk compute
its own landing chance with no pre-derived input.
**Status:** Design — user-approved 2026-06-17 (both sections); pending spec review.

> Line numbers are 2026-06-17 snapshots. Re-locate by symbol, not offset.

## 1. Problem & goal

The combat engine still carries a legacy `else if (actor.kind === 'team')` branch
(`engine.ts:3257-3335`) plus a `sourceFired` landing-hook carve-out (`:3287-3295`). The A-sweep
audit originally judged this dead, but execution found it **LIVE**: `deriveTeamEngineActors`
(`dpsSimulator.ts:184`) returns a team actor **without a `walk` bundle** when it lacks
`shipSkills`/`stats` — the **buff-only team-actor format** — and that format routes through the
legacy branch. ~10 tests exercise it.

The legacy branch deals no damage; its job is to (a) advance the actor's charge cadence, (b) emit
`skill-fired`, (c) call `statusEngine.sourceFired(actor.id, slot)` to upsert the actor's manual
timed `selfBuffs`/`enemyDebuffs`, (d) restore the **focus attacker's** landing-hook closure so its
timed enemy debuffs draw the *attacker's* landing chance, and (e) synthesize + stage resisted
enemy applications.

**Goal:** route every team actor through the **walked path** (`runPlayerTurn`) so the legacy branch
+ carve-out become genuinely dead and are deleted — paying down the last A-scaffolding while keeping
the public buff-only `TeamActorInput` API intact for callers. This is a **behavior-risk** change
(not byte-identical): a small, enumerated set of golden deltas is expected and audited.

### Production reality (audited)
**No production code path produces buff-only team actors.** Both consumer pages always pass
`shipSkills` + `stats`:
- `DPSCalculatorPage.tsx:160` — `shipSkills: t.shipSkills, stats: t.stats`.
- `HealingCalculatorPage.tsx:381` — same, and ship-less heal targets synthesize an empty kit via
  `buildDefaultShipSkills()` (`:420`).
- `battleSimulator.ts:616` — always builds a full `walk` bundle.

The buff-only path is therefore a **test-only + documented escape-hatch** surface
(`TeamActorInput.shipSkills?`/`stats?` are optional with a "legacy scheduled-list source" doc).

## 2. Chosen approach

**Synthesize an empty-kit `walk` bundle for any team actor lacking one** (user-selected over
"drop the API + migrate every test fixture"). Lowest churn to the public contract; one code path
in the engine post-migration.

## 3. Architecture — synthesize at the engine boundary

The synthesis lives at the **`runCombat` entry**, NOT in `deriveTeamEngineActors`. Rationale: the
affected tests split two ways and only the engine boundary covers both:
- `simulateDPS`-based tests (`dpsSimulator.test.ts`, `dpsGoldenParity.test.ts`) reach buff-only
  actors via `deriveTeamEngineActors` (adapter).
- **Direct-`runCombat` tests** (`engine.events.test.ts:782/1027`, `triggers.test.ts:582/3067`)
  construct no-walk `teamActors` and bypass the adapter entirely.

Normalizing once at the single `runCombat` chokepoint covers both and is the natural home for "every
team actor walks." `deriveTeamEngineActors` keeps its `if (!t.shipSkills || !t.stats) return t;`
pass-through unchanged — the engine normalizes whatever it receives.

**Mechanism:** at `runCombat` entry, map `teamActors` → for each without `.walk`, attach a
synthesized walk (below). Everything downstream (`teamRuntimeById` builder `:1410`, the walked
dispatch branch `:3157`) then sees a uniform walked roster.

## 4. The synthesized walk bundle

For a team actor missing `.walk`, synthesize:

| Field | Value | Why |
|-------|-------|-----|
| `shipSkills` | **empty kit** `{ slots: [] }` (new helper, e.g. `buildEmptyShipSkills()`) | No abilities ⇒ zero damage, no skill-sourced buffs. **Must NOT** be `buildDefaultShipSkills()` — that carries a 100-multiplier damage ability and would inject phantom team damage. |
| `stats.hp` | `1` | Matches today's buff-only engine default (`:1659` `t.walk ? … : 1`). Keeps the actor a non-sink. |
| `stats.defence` | `0` | Matches `:1739` default. |
| `stats.hacking` | `200` | The old static landing default; via A2's live computation (vs security-default 100) yields landing 1.0. |
| `stats.{attack,crit,critDamage,defensePenetration}` | `0` | Inert — empty kit deals no damage. |
| `hasChargedSkill` | `chargeCount > 0` | **Load-bearing.** See §5. |
| `affinityDamageModifier` | `0` | Neutral (legacy buff-only actors carried no affinity). |
| `affinityCritCap` / `affinityCritPenalty` | `100` / `0` | Neutral. |
| `affinity` | `undefined` | Neutral 'antimatter' default downstream. |
| `healModifier` | `0` | — |
| `selfDotModifier` / `defensePenetrationBuff` | `0` | — |
| `debuffLandingChance` | default (e.g. `1`) | Fallback only; A2's live `liveDebuffLandingChance` (hacking 200 vs security 100) drives the actual per-turn value. |

Manual `selfBuffs`/`enemyDebuffs` need no special handling — they are registered via `teamSources`
(`engine.ts:1321`) regardless of walk status, and `runPlayerTurn` upserts them through its internal
`sourceFired(actor.id, slot)` call (`playerTurn.ts:738`).

## 5. Why the charge cadence is preserved (equivalence proof)

`runPlayerTurn`'s action-slot decision is **byte-identical in logic** to the legacy branch:

```
// runPlayerTurn (playerTurn.ts:650-656, 738)            // legacy branch (engine.ts:3271-3296)
if (hasChargedSkill && actor.charges >= chargeCount)     if (teamHasCharged && actor.charges >= chargeCount)
    action = 'charged'; else action = 'active';              teamAction = 'charged'; else 'active';
advanceChargeCadence(actor, hasChargedSkill);            advanceChargeCadence(actor, teamHasCharged);
sourceFired(actor.id, action==='charged'?'charge':'active', r);  sourceFired(actor.id, …, r);
```

The **only** difference is the gate input: legacy gates on `teamHasCharged = actor.chargeCount > 0`;
walked gates on the kit-derived `hasChargedSkill`. Setting the synthesized walk's
`hasChargedSkill = (chargeCount > 0)` makes them equal, so the walked path banks/fires charges on the
same cadence. The empty kit's `selectFiringSkill(shipSkills, 'charged')` returns nothing ⇒ a
zero-damage charged turn, whose `sourceFired('charge')` still upserts the actor's charge-sourced
manual debuffs (e.g. dpsGoldenParity `support-1`'s `Team Defense Down`). Active turns upsert
active-sourced ones (`Team Attack Up`). Resisted staging into `pendingResisted` / the last focus
turn's list is already mirrored in the walked branch (`:3237-3244`).

## 6. Behavior deltas (audited churn — NOT byte-identical)

1. **Landing-chance flip (accepted by user).** Buff-only actors' timed enemy debuffs now draw
   *their own* landing chance (synthesized hacking 200 vs security-default 100 → 1.0) instead of
   borrowing the focus attacker's via the carve-out. Aligns with the epic ("each actor uses its own
   stats; a ship behaves the same on either team"). Expected churn ≈ zero — existing buff-only
   goldens already land at 1.0. Any test where the attacker's landing was <1.0 *and* a buff-only
   actor inflicts debuffs would move; audit per-snapshot.
2. **`teamDamage` shape.** `hasWalkedTeam` (`:1500`) becomes true whenever any team actor exists, so
   `RoundData.teamDamage` is set to `0` where buff-only cases previously left it `undefined`.
   Consistent/harmless, but a golden-shape change to audit.
3. **Event emissions.** `runPlayerTurn` may emit events the legacy branch did not (e.g. a
   zero-damage turn event) for `engine.events` tests. The `skill-fired` + `debuff-applied` /
   `debuff-resisted` core is already mirrored; audit the full sequences.

Every moved snapshot is hand-audited line-by-line with a recorded rationale. **Never blind
`vitest -u`.** No snapshot should move that isn't explained by deltas 1-3 — if one does, STOP and
investigate.

## 7. Deletions / simplifications enabled

- Delete the legacy `else if (actor.kind === 'team')` branch (`engine.ts:3257-3335`) **and** its
  `setLandsTimedEnemyApplication(...)` carve-out (`:3287-3295`).
- Collapse the `t.walk ? t.walk.stats.hp : 1` (`:1659`) and `: 0` defence (`:1739`) ternaries to
  direct `t.walk.stats.*` reads (walk always present post-normalization).
- Remove now-dead symbols **only if `tsc` proves them unused.** `advanceChargeCadence`,
  `synthesizeResisted`, `landsTimedEnemyApplication`, `bus.emit('skill-fired')` are SHARED with the
  walked/focus paths — they MUST stay. Verify each individually before any removal.

## 8. Testing & gate

- **TDD:**
  1. Unit test: the engine-boundary normalizer produces a complete walk (empty kit; `hasChargedSkill`
     from `chargeCount`; neutral stats; hp 1 / defence 0) for a no-walk team-actor input.
  2. Equivalence test: a buff-only team actor and its synthesized-walk twin produce the same
     buff/debuff application + resisted outcomes (drives out the §5 cadence claim).
- Full suite green; `npx tsc --noEmit` clean; `npm run lint` 0 (max-warnings 0); `npm run audit:skills`
  0 findings / 141 ships.
- **Gate = audited golden churn, NOT byte-identical** (the one A-item that legitimately changes
  behavior). Each moved combat `.snap` reviewed and justified in the commit; only deltas 1-3 permitted.
- Subagent-driven implementation; per-task spec + quality review + final holistic review.

## 9. Risks

- **Empty kit through `runPlayerTurn`:** an actor with `{ slots: [] }` is a path the healing page
  never builds (it uses `buildDefaultShipSkills` with a damage ability). The TDD equivalence test
  must confirm `runPlayerTurn` tolerates an empty kit (no firing skill ⇒ zero damage, no crash) and
  still upserts manual sources. **Primary implementation risk.**
- **Churn enumeration:** if golden movement exceeds deltas 1-3 (e.g. an unexpected event-order
  change), STOP and surface the fuller list before accepting.
- **Dead-symbol over-removal:** removing a helper that's shared would break the walked path; gate
  every removal on `tsc`.

## 10. References

- `src/utils/combat/engine.ts` — legacy branch `:3257-3335`; carve-out `:3287-3295`; walked dispatch
  `:3157`; runtime builder `:1410-1496`; `teamSources` `:1321`; `hasWalkedTeam` `:1500`; hp/defence
  default ternaries `:1659`/`:1739`.
- `src/utils/combat/playerTurn.ts:650-656, 738` — action-slot decision (equivalence proof).
- `src/utils/calculators/dpsSimulator.ts:178-211` — `deriveTeamEngineActors` (pass-through retained).
- `src/utils/abilities/configToSimInputs.ts:7` — `buildDefaultShipSkills` (the kit to NOT reuse);
  new `buildEmptyShipSkills` lives alongside.
- `src/types/calculator.ts:280-305` — `TeamActorInput` (public API, unchanged).
- Affected tests: `dpsSimulator`, `dpsGoldenParity`, `engine.events`, `triggers` (direct + adapter
  paths).
