# Combat Realism Epic — E tail (E4 + E5) Design

**Date:** 2026-06-20
**Sub-project:** E (per-victim AoE accounting, old PR7), tail.
**Parent:** `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`,
`docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md` (E1–E3 shipped).

## 1. Context

E1/E2/E3 shipped to `main` (PRs #122/#123/#124):

- **E1** — symmetric incoming surface: `enemySink` now writes per-victim intake into the
  shared `perActorIncoming` map keyed by victim id (internal; unread by UI).
- **E2** — per-victim leech, **and** the per-victim heal/shield **pool generalization** pulled
  forward: `applyHealToTarget(raw, victim = healTarget)` / `grantShieldToTarget(raw, victim = healTarget)`
  are now parametrized by victim (engine.ts ~1912/1928), defaulting to `healTarget` so non-positional
  callers stay byte-identical.
- **E3** — AoE on-cast purge over **all** footprint victims (the loop at `playerTurn.ts:1421`,
  `statusEngine.purge(vid, ab.config.count)`), at the parsed count of 1.

This spec covers the remaining two sub-parts: **E4** (Amartya crit-power-scaled purge count) and
**E5** (symmetric healing + the Nayra consequence + accounting tidy). After E5, sub-project E — and
the last remnant of the bySide-unification campaign — is closed.

### Correction to the umbrella E spec's E5 assumption

The umbrella E spec's E5 sketch claimed the documented Nayra limitation ("engine never heals enemy
ships") would resolve "with the Nayra condition + the now-general pools — **no new pool mechanism
needed**." That is **inaccurate**. The pools are parametrized, but enemy-side heals never reach them
because **`healEventOnly` actively skips the HP-restore mutation** for enemy actors
(`playerTurn.ts:1544/1594/1624/1639`: `if (!healEventOnly) { ... apply heal ... }`). So lighting up
Nayra requires a real (carefully-scoped) change: **lift the HP-restore half of `healEventOnly`**.
This is captured below and supersedes that sketch.

## 2. Goals / non-goals

**Goals**

- E4: Amartya's charge purge count scales with live crit power, applied to every footprint victim.
- E5: enemy ships actually heal (symmetric per-side healing), which lights up player-Nayra's
  already-parsed "target was repaired this round" purge/Stasis condition; plus close the deferred
  detonation per-victim intake caveat and the death-fallback DRY duplication.

**Non-goals (deferred elsewhere)**

- Surfacing enemy per-victim HP / heal / shield-absorb in the `/simulator` UI → sub-project **H**
  (shield system). E5 stays internal.
- New shield/leech/reflect **sources** (gear-set, implants) → sub-project **D**.
- Any change to player-side healing result accounting (the `healFor` buckets / healing-calc result
  surface) — enemy heals must NOT pollute those.

## 3. E4 — Amartya crit-power-scaled purge

**Game text (Amartya charge):** "This Unit deals 210% damage and purges 1 buff from all enemies for
every 50% crit power this Unit has." → `count = floor(critDamage / 50)`.

**Units:** `critDamage` is a `PERCENTAGE_ONLY_STAT` stored as an integer (e.g. `150` = 150%), so
`floor(critDamage / 50)` reads directly (150 crit power → 3 purges). Read the **live** value via
`effectiveStatsOf(caster).critDamage` (effectiveStats.ts ~98/205) at cast time, not the base stat.

**Mechanism**

1. **Parse** the "for every 50% crit power" phrasing on a purge ability into a count-scaling
   descriptor — shape TBD in the plan, e.g. `countScaling?: { stat: 'critDamage'; per: 50 }` on the
   purge ability config. Only Amartya matches in the corpus today.
2. **Apply** at `playerTurn.ts:1421` (the E3 footprint loop): when `countScaling` is present,
   compute `purgeCount = ab.config.count × floor(effectiveStatsOf(caster).critDamage / per)` (the
   base `count` multiplier preserves faithfulness for any future base-count > 1; 1× for Amartya) and
   pass that to `statusEngine.purge(vid, purgeCount)` for **every** footprint victim; otherwise use
   `ab.config.count` unchanged. Guard `per > 0 && finite` before dividing (defensive).

**Removes** the C2a single-anchor count-1 under-approximation flag/note left for E4.

**Edge cases:**

- `count === 0` (crit power < `per`) → no purge, no `purge-performed` emit (the emit is already
  gated on `removed > 0` at playerTurn.ts:1422, so this falls out for free). Amartya's base crit
  power is 50 → count 1, so this is only reachable with a crit-power debuff.
- **Confirm Amartya's charge parses as `target: 'all-enemies'`** so it enters the `aoeVictimIds`
  footprint branch (playerTurn.ts ~1419) rather than the single-anchor fallback — the per-victim
  claim depends on it (verify in the plan's baseline task).

**Gate:** byte-identical goldens (Amartya has no golden fixture). New unit test: count scales with
live crit power (e.g. 150 → 3, 100 → 2, buffed crit power → higher; 0-count edge), applied per
footprint victim.

## 4. E5 — symmetric healing + Nayra + accounting tidy

### 4.1 Symmetric healing (the core)

`healEventOnly` (set only on `enemyTurnBindings`, engine.ts ~2790, never on `playerTurnBindings`)
was introduced (Phase 4c PR4) so enemy heals **emit** heal events without **polluting the player
healing buckets** (`healFor` / `healing.credit`). It currently also blocks the HP-restore mutation,
which is why enemy HP never recovers and `repairedThisRound` never sees an enemy id.

**The pool mechanism is already fully general** — `applyHealToTarget(raw, victim = healTarget)`
(engine.ts ~1912) and `grantShieldToTarget(raw, victim = healTarget)` (~1928) heal **any** actor's
own `currentHp` / `shieldPool`, clamp against per-victim `recipientMaxHp(victim.id)` (~1789, resolves
any id via `lastTurnCtxByActor ?? baseHpFor`), and already call `repairedThisRound.add(victim.id)`.
**No pool change is needed.** Three player-centric *routing* facts are what block enemy heals:

1. `recipientsFor(target)` (playerTurn.ts:1457–1462) is hardcoded player-side:
   `self → [actor.id]`, `all-allies → healing.playerIds`, `ally → [healing.targetId]` (the player
   heal-target). For an enemy caster these resolve onto **player** ids.
2. The HP-apply is gated `if (rid === healing.targetId)` (playerTurn.ts:1613/1631), so even on the
   non-event path only the **player heal-target** gets HP/shield (other recipients get
   `directHeal`/`shield` credit only). The enemy recipient never reaches `applyHealToTarget`.
3. In `healEventOnly` mode the heal branch `continue`s (playerTurn.ts:1598) and the shield branch
   `continue`s (1624) **before computing the numeric `raw`** at all.

**Mechanism (confined entirely to the `healEventOnly === true` branch → player path byte-identical):**
Replace the event-only early-`continue` with an enemy-side apply path:

- **Compute the heal numeric in enemy mode.** Draw `healCritGate` (1601) and compute `raw`
  (1605–1611) exactly as the player path does. *(This adds RNG draws on the enemy turn — see the
  gate note in §6: deterministic-but-new draws, audited two-team-sim churn.)*
- **Route to the recipient's own pool, NOT the player heal-target.** Resolve each enemy recipient id
  to its `CombatActor` and call `applyHealToTarget(raw, recipientActor)` (heals enemy `currentHp`,
  fires `repairedThisRound.add(recipientId)`). **Id→actor resolution (pin):** `allActorsById`
  (engine.ts ~1665) already includes enemy actors; since `HealingRuntimeCtx` is built in engine.ts
  but consumed in playerTurn.ts, the enemy apply path must either close over `allActorsById` or gain
  an explicit `recipientActor(id) => CombatActor` resolver on the ctx (plan picks one — prefer the
  ctx resolver to keep the closure boundary clean, consistent with how prior routing fixes were
  threaded).
- **Suppress player-bucket credit.** Do **not** call `healing.credit(...)` on the enemy path (no
  enemy result surface until sub-project H). Still push recipients to `healTargets` so the
  `heal-performed` event fires (as today).

**Enemy recipient resolution.** Make `recipientsFor` side-aware off the acting actor's side:

- `self → [actor.id]` (already side-agnostic; covers the common case — most enemy repairs are
  self-targeted, e.g. Isha "when directly damaged, this Unit repairs 3% of its max HP").
- `all-allies →` the acting side's ally id list. Thread an `enemyIds` list into `HealingRuntimeCtx`
  (mirror of the existing `playerIds` field, ~1937), sourced like the enemy-team routing of
  PRs #102–#104 (`enemyRecipientIds`).
- `ally` (single-target) on the enemy side: **DECISION (plan-level, default proposed):** resolve to
  the **lowest-HP living enemy ally** (deterministic, mirrors typical healer targeting). If the plan
  finds no single-target `ally` enemy heal in the corpus that matters for Nayra, this may be deferred
  with a logged note rather than implemented speculatively.

**healingCtx existence.** `healingCtx` is built only when a player `healTarget` exists (~1901). It is
present in **healing-calc** mode and in the **two-team battle-sim** (battleSimulator sets
`healTargetId: focus.id`, the vestigial workaround C1 relies on). In **pure DPS** there is no
`healingCtx` and the enemy is the indestructible dummy with no heal abilities → enemy heals are moot.
So every mode that can host an enemy healer already has the ctx.

**REQUIRED CHANGE — enemy max-HP seed (not just a confirm).** `recipientMaxHp(id)` (~1789) is
`lastTurnCtxByActor.get(id)?.effectiveMaxHp ?? baseHpFor(id)`, and `baseHpById` (~1689) **excludes
enemy ids** (explicit comment ~1688 "Enemy ids are never queried as recipients"), so `baseHpFor`
returns `?? 0` for an enemy. For an enemy recipient healed **before its first turn** (no
`lastTurnCtxByActor` entry yet), `recipientMaxHp` → 0 → the deficit `Math.max(0, min(raw, 0 -
currentHp))` → `consumed === 0` → the heal is all overheal **and `repairedThisRound.add` never fires**
(gated on `consumed > 0`, ~1925), silently breaking the Nayra consequence for that case. E5 **must
extend `baseHpById` to seed enemy attacker base HP** (from `enemyAttackerInputs` / `enemyRecipientIds`)
so enemy recipients have a real pre-first-turn cap. The same `recipientMaxHp` cap governs
`grantShieldToTarget` (~1930), so a future enemy-shield lift (sub-project H) inherits this fix for free.

### 4.2 Nayra lights up (consequence, no new code beyond 4.1)

Nayra's condition is **already parsed and gated** (C2b-3): active "if the target was repaired this
round → inflict Stasis 1 turn"; charge "if the target was repaired this round → inflict Exposed 1 turn
and purge all buffs." The engine already tracks `repairedThisRound` per victim id (engine.ts ~1897,
add at ~1925, clear at ~2275, read at ~2881 `targetRepairedThisRound: repairedThisRound.has(tgt.id)`).
Once 4.1 lets an enemy ally be healed by its enemy healer, that enemy's id enters `repairedThisRound`,
and player-Nayra attacking it sees `targetRepairedThisRound === true` → fires the purge/Stasis. No
Nayra-specific code beyond 4.1; verified by an end-to-end test.

### 4.3 Detonation per-victim intake (deferred caveat)

Close the E5-tagged caveat at engine.ts ~4000–4052: non-positional enemy attack **detonations** are
not yet recorded per-victim into `perActorIncoming` (only the positional path reads per-victim
outcomes). Record detonation intake symmetrically per victim, matching E1's incoming surface.

### 4.4 Death-fallback DRY

Extract the synthesized no-action `PlayerTurnResult` shape duplicated between `handleDeadTargetSkip`
(engine.ts ~2937–2962) and the Stasis turn-skip (~3582–3605) into one helper
(`synthesizeSkippedTurn()` or similar). Pure DRY; `tsc` catches drift.

### 4.5 Credit≠intake closeout (documentation)

The "collapse the dual credit/intake paths" framing in the umbrella spec overstates the redundancy:
the **credit** path (`roundDamage` / `creditDamage`, damage *dealt* per source, feeds row totals +
damage-dealt leeches) and the **intake** path (`perActorIncoming` / `intakeFor`, damage *taken* per
victim, feeds healing-mode rows) record **complementary** facts, not duplicate ones. E5 does not merge
them; it documents this (a comment at the two declarations) so the framing is closed honestly.

## 5. Locked decisions

- **E4 count** = `floor(effectiveStatsOf(caster).critDamage / 50)`, live each cast, all footprint
  victims.
- **E5 lifts the HP-restore half of `healEventOnly`** for enemy heals; **keeps player-bucket credit
  suppressed**. (Corrects the umbrella spec's "no new pool mechanism needed" assumption.)
- **Nayra requires no Nayra-specific code** beyond 4.1 — its condition + repair tracking already ship.
- **One spec, two sequential PRs:** E4 first (small, gameplay-visible), then E5.
- **E5 is one PR** (symmetric healing → Nayra → detonation → DRY → doc); user ratified not peeling
  detonation/DRY into a separate follow-up. **Known risk / pressure valve:** §4.1 (healing routing)
  is the riskiest change in the epic and is bundled with two unrelated cleanups (§4.3 detonation
  intake, §4.4 DRY). If, during planning or implementation, §4.1 proves larger than estimated, peel
  §4.3/§4.4 into a thin follow-up PR rather than ballooning the symmetric-healing PR's review surface.
- **Internal only** — no `/simulator` UI surfacing of enemy heal/HP (→ H).

## 6. Testing / gate

- **DPS goldens: byte-identical** (indestructible dummy enemy has no heal abilities).
- **Healing-calc goldens: byte-identical** — guaranteed *structurally*, not just by fixture audit:
  the entire change is confined to the `healEventOnly === true` branch, and `healEventOnly` is set
  only on `enemyTurnBindings` (never on `playerTurnBindings`). Player-side healing-calc turns never
  enter the changed code. (Still spot-audit that no healing-calc fixture's *enemy* attacker has a
  heal/shield ability whose new HP-restore moves a tank-survival trajectory.)
- **Two-team-sim goldens** (`twoTeamBattle`, `dpsSimulator` multi-actor, `positionalDamage.integration`):
  **AUDITED churn** where (a) an enemy ship now heals an enemy ally (HP trajectory + survival), (b)
  player-Nayra now fires its repaired-this-round purge/Stasis vs a repaired enemy, or (c) the new
  enemy-side `healCritGate` draws shift a deterministic RNG sequence. Every diff explained; never
  `vitest -u`. **RNG note:** drawing the heal crit gate on the enemy turn is a *new* consumption of
  the gate; if any two-team fixture shares an RNG stream across turns, downstream draws can shift —
  audit and explain, do not regenerate blindly.
- **New tests:**
  - E4: purge count scales with live crit power, per footprint victim.
  - E5: enemy heal restores enemy ally HP into its own pool + populates `repairedThisRound`; enemy
    heal does **not** appear in the player healing result (bucket-credit still suppressed);
    player-Nayra purge + Stasis fires vs a repaired enemy and does NOT fire vs an un-repaired enemy
    (non-vacuous contrast); non-positional detonation records per-victim intake.
- `npm run audit:skills` stays 0/141; `tsc --noEmit` + `npm run lint` (max-warnings 0) clean.
  Always run `npx tsc --noEmit` independently after subagent work (esbuild-based vitest does not
  typecheck).

## 7. Workflow (inherited from the B/C series)

- `gh auth switch --hostname github.com --user TheSusort` before PR ops; dev server on :3000.
- Use `npx vitest run <name>` — bare `npm test` is Vitest **watch** and hangs agents.
- docs/ is gitignored → `git add -f`, `--no-verify` for docs-only commits.
- Subagent-driven implementation; per-task spec+quality reviews + a final holistic (opus) review.
