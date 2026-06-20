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
   compute `count = floor(effectiveStatsOf(caster).critDamage / per)` and pass that to
   `statusEngine.purge(vid, count)` for **every** footprint victim; otherwise use `ab.config.count`
   unchanged.

**Removes** the C2a single-anchor count-1 under-approximation flag/note left for E4.

**Gate:** byte-identical goldens (Amartya has no golden fixture). New unit test: count scales with
live crit power (e.g. 150 → 3, 100 → 2, buffed crit power → higher), applied per footprint victim.

## 4. E5 — symmetric healing + Nayra + accounting tidy

### 4.1 Symmetric healing (the core)

`healEventOnly` was introduced (Phase 4c PR4) so enemy heals **emit** heal events without **polluting
the player healing buckets** (`healFor` / `credit`). It currently also blocks the HP-restore mutation,
which is why enemy HP never recovers and `repairedThisRound` never sees an enemy id.

Split `healEventOnly`'s two concerns:

- **(a) HP-restore mutation** — `applyHealToTarget(raw, victim)` adding `victim.currentHp` and
  `repairedThisRound.add(victim.id)`, plus `grantShieldToTarget` adding to `victim.shieldPool`:
  **ENABLE** for enemy-side heals, routed to the healed enemy ally's **own** pool via E2's
  parametrized closures (pass the resolved enemy recipient as `victim`, not the player `healTarget`).
- **(b) Player-bucket credit** — the `healFor` / `healing.credit` writes that build the player healing
  result: keep **SUPPRESSED** for enemy heals (no enemy result surface until sub-project H).

So after E5 the enemy heal **restores enemy HP** but its numbers **do not appear** in the player
healing result. Recipient resolution reuses the existing enemy-team ally routing (enemy-team support
PRs #102–#104) for `ally` / `all-allies` heal targets; positional heals ride E2's per-victim pools.

**Affected sites (from the scope map; plan confirms exact lines):** the four `healEventOnly` guards in
`playerTurn.ts` (~1544 HoT, ~1594/1624 cast heal, ~1639 shield) — separate the HP-mutation call from
the bucket-credit call so each can be gated independently; the enemy heal recipient resolution; and
the `applyHealToTarget`/`grantShieldToTarget` call sites that currently pass no `victim` arg.

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
  detonation/DRY into a separate follow-up.
- **Internal only** — no `/simulator` UI surfacing of enemy heal/HP (→ H).

## 6. Testing / gate

- **DPS goldens: byte-identical** (indestructible dummy enemy has no heal abilities).
- **Healing-calc goldens: byte-identical** — audit that no healing-calc fixture has an enemy that
  heals an enemy ally (expected none; if one exists, that churn is audited, not blind `-u`).
- **Two-team-sim goldens** (`twoTeamBattle`, `dpsSimulator` multi-actor, `positionalDamage.integration`):
  **AUDITED churn** only where (a) an enemy ship now heals an enemy ally, or (b) player-Nayra now fires
  its repaired-this-round purge/Stasis vs a repaired enemy. Every diff explained; never `vitest -u`.
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
