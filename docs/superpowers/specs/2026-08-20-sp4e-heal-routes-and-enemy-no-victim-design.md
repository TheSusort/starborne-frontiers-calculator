# SP-4e — retire the non-positional heal routes, and give the enemy side the player's no-victim rule

**Status:** design approved 2026-08-20. Last rung of the DPS-real-enemy epic.
**Base:** `af4f05ae` (SP-4d, PR #340). **Ships as ONE PR** (user decision).
**Closes:** #335. **Supersedes:** the epic spec's §6 "PR 4d — retire the non-positional heal routes"
(`docs/superpowers/specs/2026-08-13-sp4-retire-the-dummy-design.md`), whose premise this spec
measured and found false — see §1.

---

## 0. What this rung is for

Three legacies survive on the heal path, all of them from the era when a run had no board:

1. an **unconditional lowest-HP ally route** for a single-`ally` heal, gated on a *mode flag*
   (`teamBattle` / `isEnemyCaster`) rather than on what the ability's text says;
2. `procStandingLeeches` routing an `'ally'`-targeted leech to **the heal anchor**
   (`[healTarget!.id]`), deliberately left alone by SP-3 as "load-bearing for the non-positional
   all-allies case";
3. the enemy side's `TurnBindings.legacyVictim: healTarget` — the last fallback victim in the
   engine, and the reason the enemy side still answers a no-victim turn differently from the
   player side (#335).

4e replaces the mode flags with a **represented selector** so routing is derived from the parsed
skill text, then deletes the fallback victim and the two-axis split that existed only to serve it.

---

## 1. ⚠️ The epic spec's §6 premise was measured and is FALSE

§6 (PR 4d) said:

> The defect is the *unconditional* lowest-HP route applied to ships whose text says no such
> thing. Verify against `docs/ship-skills.csv` which shipped kits actually specify a lowest-HP ally
> before changing the routing.

Verified, as instructed — by running every ship's CSV skill text through `buildShipAbilities` and
collecting every ability with `target === 'ally'`. **There is no such ship on the cast path.**

`total single-'ally' abilities across the roster: 16` — of which the heal/shield/leech ones are 5:

| Ship | Slot / trigger | Text | Reaches `recipientsFor`? |
| --- | --- | --- | --- |
| **Pallas** | active, `on-cast` | "The **other** ally with the **lowest current health percentage** heals for 20% of the damage dealt" | **Yes** |
| **Volk** | passive, `on-cast` | "repairs 30% of its Max HP to the ally with the **most missing health**" | **Yes** |
| **Valkyrie** | passive, `on-bomb-detonated` | "this Unit and the ally with the **lowest current health percentage** repair 5% of damage dealt" | No — registers as a **standing leech** (passive + `basis: 'damage-dealt'`) |
| Cultivator | passive, `on-own-cleanse` | "repairs **that** ally for 4%" | No — hook-owned (`isHookOwned` filters reactive triggers out of `healAbilities`) |
| Hayyan | passive, `on-own-cleanse` | "repairs **the** ally for 4%" | No — hook-owned |

There are **no** single-`ally` *shield* abilities in the roster at all.

So exactly two abilities reach the `lowestHpAllyId` branch, and **both name a worst-HP ally in
their text.** The route is correct today *by accident*: nothing ties it to the ability. The genuine
defects are narrower and different from §6's:

- **D1 — Pallas's "other" is unenforced.** `lowestHpAllyId` returns `best ?? actor.id`, so with no
  other living ally the heal becomes a **self-heal**, which Pallas's text forbids.
- **D2 — Valkyrie's leech routes to the anchor.** `engine.ts:3908-3931`: `e.target === 'ally'` →
  `[healTarget!.id]`, and the pool only lands when `rid === healTarget.id`. Valkyrie's text names
  the lowest-HP ally, not the focus.
- **D3 — the healing calculator routes Pallas/Volk to the focus.** Without `teamBattle`, the
  `else base = [healing.targetId]` arm sends both ships' heals to the user's chosen focus ship
  rather than to the worst-HP ally.
- **D4 — the route is untied to the text**, so it is one parser change away from being wrong, and
  an editor-authored single-`ally` heal gets whichever branch the mode flag happens to pick.

### 1.1 A second false claim in the same paragraph

§6 says the correct routing should come "via the parser's `selection`, which already models it."
It does not. `src/utils/targetingParser.ts:8`:

```ts
export type TargetSelection = 'front' | 'back' | 'skip' | 'all' | 'team' | 'others' | 'self';
```

`ParsedTarget.selection` is the **board-position selector for the cast's own target** — it has no
lowest-HP variant and no ally-recipient meaning. The selector must be built. See §2.

### 1.2 Locked game rules (user-confirmed 2026-08-20)

| Question | Ruling |
| --- | --- |
| Volk's "most missing health" — absolute missing HP, or lowest HP %? | **Lowest HP percentage.** One selector covers Volk, Pallas and Valkyrie. Do NOT model an absolute-missing-HP basis. |
| Is a text-named selector narrowed by the caster's support footprint? | **No — never, regardless of slot.** "Pallas's support part is like Volk's, and will target the lowest hp% of the allies wherever on the board." This removes the pick-then-filter vs filter-then-pick ordering question entirely. |
| Where does a *plain* `'ally'` heal (no worst-HP wording) route? | **The ship's target pattern** — the own-side ally roster narrowed by the caster's support footprint. |

The footprint ruling is consistent with the already-recorded rule at `playerTurn.ts:1338-1343`
(user-verified 2026-07-31, via Volk): a passive support ability is not pattern-scoped, because
"its passive repair reaches the ally with the most missing health **wherever that ally stands**."
4e extends that from "passive" to "any text-named selector."

---

## 2. The selector

Add one variant to `AbilityTarget` (`src/types/abilities.ts:88`):

```ts
| 'lowest-hp-ally'   // SP-4e: the living same-side ally with the lowest currentHp/maxHp,
                     // caster EXCLUDED. Named by the ability's own text (Pallas "the other ally
                     // with the lowest current health percentage", Volk "the ally with the most
                     // missing health", Valkyrie "the ally with the lowest current health
                     // percentage"). NEVER narrowed by the caster's support footprint — it
                     // reaches its ally wherever they stand, on either slot (§1.2).
```

This is the ally-side sibling of three selector targets the model already carries:
`enemy-most-buffs`, `enemy-highest-attack`, `enemy-highest-speed`. Same shape — a global
selector resolved live at routing time — so it needs no new concept, only a new arm.

**Parser.** `skillTextParser.ts:4109` currently lumps two selector phrasings into the generic
`'ally'` alternation:

```ts
if (/\bthe\s+ally\b|\bthat\s+ally\b|\ban\s+ally\b|\bthem\b|most\s+missing\s+health|\bthe\s+other\s+ally\b/.test(…))
    return { target: 'ally', explicit: true };
```

`most missing health` and `the other ally` move out into a selector test placed **before** it,
joined by `lowest\s+current\s+health(\s+percentage)?`:

```ts
if (/most\s+missing\s+health|lowest\s+current\s+health(?:\s+percentage)?|\bthe\s+other\s+ally\b/.test(…))
    return { target: 'lowest-hp-ally', explicit: true };
```

Order matters: `the other ally` must be tested before the generic `\ban\s+ally\b`/`\bthe\s+ally\b`
arms, and Pallas's sentence contains both phrasings.

**Precedence check to run during implementation:** confirm no ship's text matches the selector
regex in a clause where the recipient is *not* the heal recipient (the way Chakara's "lowest Speed
among all allies" is a self-gate, not a recipient). Chakara is safe — it says *Speed*, not health —
but re-verify with the roster sweep from §1 rather than by reading.

---

## 3. Routing

### 3.1 `recipientsFor` — `playerTurn.ts:3850` (`lowestHpAllyId` at `:3834`)

Today:

```ts
if (target === 'self') base = [actor.id];
else if (target === 'all-allies') base = isEnemyCaster ? healing.enemyIds : healing.playerIds;
else if (isEnemyCaster) base = [lowestHpAllyId(healing.enemyIds)];
else if (healing.teamBattle) base = [lowestHpAllyId(healing.playerIds)];
else base = [healing.targetId];
return supportRecipients(target, base, { ability, fromPassive });
```

After:

- `'self'` → `[actor.id]` (unchanged).
- `'all-allies'` → own-side roster (unchanged).
- `'lowest-hp-ally'` → `lowestHpAllyId(ownSideIds)`, **returned WITHOUT passing through
  `supportRecipients`** — the selector is not footprint-scoped (§1.2). Yields `[]` when the
  selector finds nobody.
- `'ally'` → own-side ally roster, **through** `supportRecipients` so the caster's target pattern
  narrows it (§1.2).
- The `isEnemyCaster`, `healing.teamBattle` and `else … [healing.targetId]` arms are **deleted.**
  `ownSideIds = isEnemyCaster ? healing.enemyIds : healing.playerIds` is the only surviving use of
  `isEnemyCaster` in this block, which keeps the two sides symmetric by construction rather than
  by two mirrored branches.

`lowestHpAllyId` becomes the selector's resolver and changes in one way: **it no longer falls back
to the caster.** Living same-side allies, caster excluded, ranked by `currentHp / maxHp`, ties
broken by source order; **empty when there is no other living ally** (D1). Its `best ?? actor.id`
tail goes.

### 3.2 `procStandingLeeches` — `engine.ts:3908-3931`

```ts
const recipients =
    e.target === 'ally' ? [healTarget!.id]
    : e.target === 'all-allies' ? healingCtx.playerIds
    : [sourceId];
```

The `'ally'` arm becomes `'lowest-hp-ally'` and resolves the selector against the **owner's own
side**, then applies to **that actor's** pool via the parametrized closures
`applyHealToTarget(raw, actor)` / `grantShieldToTarget(raw, actor)` — the same mechanism the
per-victim positional leech already uses (`engine.ts:~3935+`). This retires the
`rid === healTarget.id` pool gate SP-3 deferred (D2).

**The epic spec's `leech.test.ts:355-404` citation has drifted** — that range now spans Test 6
(`healModifier`) and Test 7 (DPS-mode inertness), neither of which pins the pool gate. The two
tests that actually matter, cited by NAME because line numbers here have already gone stale once:

- **Test 3, "detonation-scope leech (Valkyrie shape)"** (`:181`) — the direct pin for D2. Read it
  first.
- **Test 8, "all-allies recipient routing"** (`:399`) — the real pin for the `rid ===
  healTarget.id` pool gate, i.e. for the "load-bearing for the non-positional all-allies case"
  claim SP-3 used to defer it.

Most fixtures in that file use `healTargetId: 'attacker'`, so the anchor IS the caster and they are
indifferent to the change. The ones that are not must be re-derived, not re-pinned.

A leftover generic `'ally'` on a standing leech (nothing in the roster produces one) routes over
the footprint like §3.1, for consistency.

### 3.3 Collapse the two-axis split — `playerTurn.ts:176-182`

`HealingRuntimeCtx.teamBattle` exists only to switch routing to lowest-HP. With routing derived
from the selector, it has no consumer: **delete the field**, delete `engine.ts:3338`
(`teamBattle: runMode === 'battle'`), and leave `perRecipientApply` as the single axis. The
comment pair at `:177-182` and `:4149-4153` that explains the two axes goes with it.

`healingEngineAdapter.ts:696` carries a comment justifying `perRecipientHealApply: true` as
"WITHOUT teamBattle's lowest-HP routing, which is not the game's rule (only Volk's passive is)."
That comment is **half right and now stale** — §1 shows Pallas and Valkyrie qualify too, and the
flag it justifies is the surviving axis. Rewrite it, do not delete it.

### 3.4 ⚠️ The hand-enumerated-layer sweep — the biggest hidden cost in this PR

Adding a variant to `AbilityTarget` obliges sweeping **every site that re-enumerates the union**.
This is the defect class that shipped two silent failures with a green suite on
`project_name_keyed_status_tranche2` (#294/#296), and it is bigger here than it looks:

**Measured:** `'all-allies'` — a proxy for "sites that enumerate ally-side targets" — appears at
**186 non-test sites across 15 files**: `types/calculator.ts`, `types/abilities.ts`,
`constants/squadLeaders.ts`, `utils/targetingParser.ts`, `utils/skillTextParser.ts`,
`utils/combat/playerTurn.ts`, `utils/combat/engine.ts`,
`utils/combat/preFight/squadLeaderPass.ts`, `utils/combat/triggers.ts`,
`utils/combat/audit/classes.ts`, `utils/abilities/buildEquipmentAbilities.ts`,
`utils/abilities/buildShipAbilities.ts`, `utils/abilities/applyAbilities.ts`,
`components/skills/abilityDefaults.ts`, `components/skills/AbilityCard.tsx`.

Not all 186 need a new arm — most are equality tests on a specific value. But every one must be
**classified**, because the dangerous shape is silent:

- **`switch` on `ability.target`** → add an arm, and add a `never`-typed default so the compiler
  catches the next variant. `tsc --noEmit` covers `src` only (`tsconfig` is `include: ["src"]`),
  so an exhaustiveness guard placed in `scripts/` is **never evaluated** — do not put one there.
- **`if`/ternary chains ending in an `else`** → the new variant silently falls into the `else`.
  These are the ones that produce a green suite and a wrong answer. `recipientsFor` itself is one
  (§3.1), and so is the **buff path at `playerTurn.ts:3764`** and the cleanse paths: they call
  `supportRecipients(ab.target, allyRoster)`, and `resolveSupportRecipients` merely *filters*, so
  a `'lowest-hp-ally'` buff would grant to **every ally**. Nothing in the roster produces that
  today (§1 measured only heals), so it is latent — but the variant makes it constructible from
  the skill editor, which is a shipped user-facing surface.
- **UI enumerations** (`abilityDefaults.ts`, `AbilityCard.tsx`) → the editor must be able to
  author and display the new target, or it becomes a value the engine honours and the UI cannot
  show. `DocumentationPage.tsx` needs the rule stated too (project convention).

**Method:** classify all 186 before changing any, and record the classification in the PR body.
A site left unswept is not visible in the diff, which is precisely why the sweep must be an
enumerated checklist rather than a search-as-you-go.

### 3.5 Parser regression gate

Run the §1 roster sweep (`buildShipAbilities` over every CSV row, dumping every ability's
`target`) **before and after** the parser change and diff the two inventories. The expected diff
is exactly three rows — Pallas, Volk, Valkyrie, `'ally'` → `'lowest-hp-ally'` — and nothing else.

**Chimei is the named risk.** Its passive text contains "the ally with the **lowest current health
percentage** repairs an amount equivalent to the over-repair" — a full match for the new selector
regex, in a sentence describing a *different, unimplemented* mechanic (over-repair overflow, §7).
Its two measured `'ally'` abilities come from the ACTIVE text, which carries no such phrase, so
the before/after diff must show Chimei **unchanged**. If it moves, the parser change is not
sentence-scoped and must be narrowed.

---

## 4. #335 — one no-victim rule for both sides

### 4.1 What changes

- **`TurnBindings.legacyVictim` is deleted outright.** The player half has been `undefined` since
  SP-4c-2d; this drops the enemy's `legacyVictim: healTarget` (`engine.ts:6989`). The field, its
  ~40-line doc comment, and both bindings go.
- **`selectTurnTarget` (`engine.ts:7272-7277`) returns `tgt: undefined` for both sides.** The
  `&& a.side === 'player'` conjunct goes; so do `legacyVictimFallbackCount`,
  `__getLegacyVictimFallbackCount` and its reset.
- **`noVictimPlayerTurnCount` → `noVictimTurnCount`** (with its accessor/reset renamed) — it now
  covers both sides, and the name must not outlive the fact, per the counter block's own rule
  about names going false.
- **The enemy call site (`engine.ts:10140`)** `if (skipDeadTargetTurn || tgt === undefined)`
  narrows to `if (skipDeadTargetTurn)`. The no-victim enemy turn then **runs**, through the
  side-agnostic machinery SP-4c-2b/4d already built: `runPlayerTurn` tolerating an absent victim,
  `buildTurnArgs` omitting the victim-derived args, and the publication guard that already lives
  in `runPlayerTurn`. No new mechanism.
- The `else` branch below currently narrows `tgt` to a defined `CombatActor` for the whole
  real-turn body. That narrowing is what the enemy path relies on, so removing the `tgt ===
  undefined` conjunct requires the same treatment the player sites got in 4d — every
  victim-derived read in the enemy body becomes conditional on `hasVictim`. **This, not the
  routing, is the largest mechanical surface in the PR.**
- `healTarget` **survives** as the healing calculator's accounting anchor (`healingCtx.targetId`,
  the `barrierAbsorbed` sourcing, the focus carve-outs). Only its use as a *targeting fallback*
  dies. Do not chase `healTarget` out of the file.

### 4.2 ⚠️ #335's own narrative is wrong — correct it in the PR

#335 says:

> **1,341 measured rows** take that arm (no targetable player roster **and** no heal anchor). …
> when there is no heal anchor, that supporter banks a charge and does nothing else

Measured on `af4f05ae` (probe on `selectTurnTarget`'s fallback, whole suite, per-file aggregation
by vitest's `stderr |` headers): the count is right and **the shape is not.** All 1,341 of those
rows have `parsedSide=enemy` — they are enemies that *want* to attack, whose every victim is dead.
They are not supporters, and no supporter is silenced there.

The ally-targeted enemy supporter is a **different, smaller class of 324 rows** — and those turns
**do** run today, because the anchor is defined. They run against a **fabricated victim**: the
focus player, bound as the victim of a cast that never targeted them. That is the real asymmetry
#335 should have described, and it is the one with observable consequences.

---

## 5. Measured churn expectation

**1,680 enemy-side fallback consultations, 25 files**, on `af4f05ae`. Three shapes, no others:

| | Rows / files | Fingerprint | Today | After 4e |
| --- | --- | --- | --- | --- |
| **C1** | 1,341 / 12 | `parsedSide=enemy`, `mode=dps`, `oppLiving=0`, `oppPlaced>0`, no anchor | `tgt: undefined` → cadence-only skip | **runs** a no-victim turn |
| **C2** | 324 / 10 | `parsedSide=ally`, `mode=battle`, `oppLiving>0`, `oppPlaced>0`, anchor alive | resolves the **focus player** as victim | `tgt: undefined` → no-victim turn |
| **C3** | 15 / 3 | `mode=healing`, `parsedSide=enemy`, `oppLiving=0`, anchor **dead** | dead-target skip | unchanged |

Per-file, for attribution:

**C2 — where the churn lands.** `audit/__tests__/placementSymmetry.test.ts` 180 ·
`interactionInvariants.integration.test.ts` 53 · `calculators/__tests__/simGolden.test.ts` 30 ·
`enemyReactiveSelfBuffs.test.ts` 16 · `twoTeamBattle.test.ts` 12 · `combatLogVisibility.test.ts`
12 · `reflectGearSet.integration.test.ts` 8 · `log/buffGranterAttribution.integration.test.ts` 5 ·
`reactiveDamagePositionalHp.test.ts` 4 · `counterReflectLog.integration.test.ts` 4.

**C1 — largest, least interesting.** `dpsSimulator.test.ts` 1,047 · `teamWalk.test.ts` 195 ·
`boostGearSet.integration.test.ts` 28 · `allyChargeGrant.test.ts` 16 ·
`chargeEveryNTurns.integration.test.ts` 15 · `judgeStartOfRoundDamage.integration.test.ts` 10 ·
`decimationDps.test.ts` 10 · `dynamicSpeed.smoke.test.ts` 6 · `lowestSpeedAlly.test.ts` 4 ·
`dynamicSpeedExtraAction.test.ts` 4 · `rhodiumChakaraDpsModeCredit.integration.test.ts` 4 ·
`endOfRoundExtraAction.test.ts` 2.

**C3.** `damageChannelAccounting.integration.test.ts` 8 · `perVictimDotTick.integration.test.ts` 4
· `destroyedRoundUnification.test.ts` 3.

### 5.1 Acceptance rules

1. **Never `vitest -u`.** Every moved golden is attributed to exactly one of: C1 (a skipped turn
   now runs a self-effect), C2 (a fabricated victim became no victim), or a **named ship** —
   Pallas, Volk, or Valkyrie. A move that fits none of those is a defect, not a re-pin.
2. **C2 includes the placement-symmetry oracle (180 rows).** That oracle exists to catch exactly
   this side asymmetry, so movement there is the *point*. Read it as a fingerprint change, and
   check that the moves are toward symmetry — an enemy supporter that stops reading a player
   victim should make the two sides agree, not diverge.
3. **C1's 1,341 rows move only where a no-victim turn has a self-effect** (a self-buff, a charge
   step beyond the cadence the skip already ran, a DoT tick). Where a golden does NOT move, that
   is expected — but per the epic's standing rule, a *predicted-zero that comes back zero* must be
   followed by finding the test that should have moved.
4. **Heal-routing tests must come in side-mirrored pairs** (locked rule: engine work is
   team-symmetric; E5's heal-lift is the template, #306 is the counterexample).
5. `perTargetDealt` non-empty, never a bare damage total (epic §7 rule 2).
6. **Sweep comment claims around each edit, not just the edit.** §3.2, §3.3 and §4.1 all sit under
   long comment blocks that assert the very behaviour being deleted; `engine.ts:1700-1741`,
   `2490`, `6941-6953`, `10148-10152` and `playerTurn.ts:177-182`, `1338-1343`, `3827-3864`,
   `4149-4153` are the known ones. **Re-grep every one before editing** — verifying this spec's own
   citations found two already stale (§3.2), the same drift the epic spec warned about and then
   committed itself. `dummyReachability.test.ts`'s header names the two enemy-side classes and
   must be rewritten against §5's table.

---

## 6. Testing

Red first, in this order:

1. **Pallas fizzle (D1).** A `'lowest-hp-ally'` heal with no other living ally heals **nobody** —
   today it self-heals. Mirror on the enemy side.
2. **Volk unchanged.** A passive `'lowest-hp-ally'` heal still reaches the worst-HP ally with the
   caster off-pattern — pins §1.2's footprint ruling. Mirror.
3. **Pallas on-pattern-irrelevance.** An *active*-slot `'lowest-hp-ally'` heal reaches an
   **off-footprint** worst-HP ally. This is the behaviour change §1.2 rules in, and the test that
   would have caught pick-then-filter. Mirror.
4. **Valkyrie leech (D2).** A standing leech with `'lowest-hp-ally'` applies to the worst-HP
   ally's own pool, not the anchor's — assert on the recipient axis, not on a summed total.
   Mirror.
5. **Healing-calculator route (D3).** Pallas/Volk in `mode: 'healing'` reach the worst-HP ally,
   not `healTargetId`.
6. **Plain `'ally'` over the footprint.** An authored single-`ally` heal (corpus-empty today, so
   this needs a hand-built ability) is narrowed by the caster's pattern. Mirror.
7. **The enemy no-victim turn (#335).** Extend the existing repro `twoTeamBattle.test.ts` "bug
   repro: enemy supporter turn skipped after the focus player dies" — it currently pins the
   *dead-anchor* half. Add the live-anchor half: an ally-targeted enemy supporter with a living
   player roster resolves **no** victim and still lands its support, and emits no `targetId`.
8. **Buff-path containment (§3.4).** A hand-built `'lowest-hp-ally'` **buff** must not grant to
   every ally. This is the latent `else`-fallthrough the new variant makes constructible from the
   skill editor, and it has no roster ability to catch it — so it needs a test written from the
   defect, not from a fixture.
9. **Parser inventory diff (§3.5).** The before/after roster sweep moves exactly Pallas, Volk and
   Valkyrie, and leaves Chimei unchanged. Keep this as a checked-in assertion, not a one-off
   script run, so the next parser change cannot quietly widen the selector.
10. **Counter contract.** `noVictimTurnCount` counts both sides; no `legacyVictim` symbol survives
   (`grep` assertion, and per the raw-bytes lesson, `file <path>` the target before trusting a
   grep that returns nothing).

The husky pre-commit hook is the only gate — there is no CI test workflow. Run the whole suite;
the golden audit spans all of `npm test`, not the combat directory.

`UNRELEASED_CHANGES` in `src/constants/changelog.ts` gets an entry: this is user-visible in the
combat sim (heal recipients change for Pallas, Volk and Valkyrie; enemy supporters stop
registering the focus ship as a target). PRs 4a-4d needed none; this one does.

---

## 7. Out of scope

- **`healTarget` as an accounting anchor.** Stays. Only the targeting fallback dies (§4.1).
- **Chimei's over-repair redirect** ("when over-repairing a damaged ally, the ally with the lowest
  current health percentage repairs an amount equivalent to the over-repair"). It matches the
  selector regex but it is a *different mechanic* — an overflow transfer, not a recipient choice.
  If the roster sweep in §2 shows it parsing to a `'lowest-hp-ally'` heal, that is a
  false positive to exclude, and the mechanic itself stays unimplemented. File it, don't build it.
- **An absolute "most missing HP" basis.** Ruled out (§1.2).
- The open issues that are not 4e's: **#331** (unassigned), **#341** display honesty,
  **#342** `as unknown as` fixture residue, **#343** `debuffRecipients.ts` naming.
