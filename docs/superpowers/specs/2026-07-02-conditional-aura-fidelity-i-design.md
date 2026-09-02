# Sub-project I — Conditional-Aura Fidelity (Design)

**Status:** Approved for phased implementation (2026-07-02).
**Epic:** Combat-realism epic — this is the **single remaining open sub-project** (A–H closed; F closed 2026-07-02).
**Author context:** brainstormed with user (game rules) + code archaeology (implementation). Advisor was unavailable during this session; escalate an implementation review before merging Phase 1.

---

## 1. Goal

Make outgoing damage/crit modifiers that are **conditioned on a live per-target or per-recipient status** resolve with full fidelity in the battle simulator — as opposed to today's name-agnostic / self-only approximations. A ship must behave identically on either team (engine team-symmetry rule).

Concretely, three mechanics are broken or missing today:

1. **Team-aura distribution is absent** for the parsed-modifier channel. "All allies deal N% more damage…" auras only ever affect **the caster's own** attacks — the `target: 'all-allies'` field on a modifier is silently ignored.
2. **`enemy-debuff` gating is name-agnostic.** A condition like "to enemies with Concentrate Fire" fires against **any** enemy carrying **any** debuff, because `evaluateCondition` returns `enemyDebuffCount` and ignores `buffName`.
3. **Enemy-status-gated outgoing modifiers are evaluated once per turn** against the primary target, not **per victim** in an AoE.

---

## 2. Locked game rules (user-confirmed 2026-07-02)

- **Per-victim / per-recipient exact.** In an AoE, only victims that currently carry the named status get the bonus; only allies that currently hold the recipient status get the aura. No representative-target approximation.
- **"Friendly … units" includes the caster.** Panguan's "Friendly Stealthed units deal 40% more direct damage" applies to a stealthed Panguan's own attacks too.
- **Lodolite shield strip:** "When this Unit Purges a buff from an enemy, it removes 100% of the enemy's shield" → set the **purged enemy's** `shieldPool` to **0** (full strip), on **any** purge Lodolite lands (the charged most-buffs purge is the live trigger).
- **Scope = full sweep** (all Pattern-A/B ships below) **+ Selenite** (enemy-Stealth count scaling).
- Standing epic rules still bind: `outgoingCritDamage` ≠ `critDamage` stat; "more critical damage" is a crit-conditional modifier; cross-source percentages on the same stat **sum** before one apply.

---

## 3. Ships in scope

Source of truth: `docs/ship-skills.csv` (only the **refit-active** passive applies in-game — resolve via `getShipSkillRows()`; several of these carry the clause on BOTH base + refit passive rows, so both parse identically).

### Pattern A — outgoing damage/crit gated on the ENEMY carrying a NAMED status

| Ship | Clause | Named status | Recipient | AoE? / channel |
|------|--------|--------------|-----------|----------------|
| **Lodolite** | "all allies deal 15% more direct damage to enemies with Concentrate Fire" (refit adds "…or Stealth") | Concentrate Fire (debuff) + Stealth (buff) | **all allies** (team aura) | per-victim, `outgoingDamage` |
| **Tygr** | "deal 30% more damage to enemies with Stasis or Disable" | Stasis, Disable (debuffs) | self | per-victim, `outgoingDamage` |
| **Rikra** | active "+60% against Taunted or Provoked enemies"; charge "+80%…" | Taunt, Provoke (debuffs) | self (firing skill) | per-victim, firing-skill damage/scaling |
| **Incinerator** | "30% more direct damage to enemies afflicted with Inferno" (refit only) | Inferno (DoT) | self | per-victim, `outgoingDamage` |
| **Wrecker** | charge "if the target is affected by Inferno, deals an additional 50% damage" | Inferno (DoT) | self (firing skill) | firing-skill (charge) |
| **Wildfire** | "…deals 1%/2% additional Inferno damage … for every 10% crit power"; refit 3rd passive "**all allies** deal 2% additional Inferno damage to that Unit" | Scorching Radiation | self, then **all allies** on refit | per-victim, **`dotDamage`** channel + crit-power scaling |

### Pattern B — team buff applied only to allies CURRENTLY holding a named status

| Ship | Clause | Named status | Recipient |
|------|--------|--------------|-----------|
| **Panguan** | "Friendly Stealthed units deal 40% more direct damage." (refit only) | Stealth (self-buff) | **all allies incl. self** who hold Stealth |

### Count-scaling (near-miss, explicitly in scope)

| Ship | Clause | Shape |
|------|--------|-------|
| **Selenite** | "deals 10% more direct damage for every enemy with Stealth" | self modifier scaled by the **count of stealthed enemies** |

**Status classification (verified via `classifyEnemyEffect`):** Stealth is `type:'buff'` → routes through `enemy-buff`, which is **already name-specific** (`countNames(enemyBuffNames, buffName)`). Concentrate Fire, Stasis, Disable, Taunt, Provoke → `enemy-debuff` (name-agnostic today → **need Layer 2**). Inferno / Scorching Radiation → DoT → `enemy-debuff`, **but** the modifier ctx already carries dedicated `infernoEntryCount` / `corrosionEntryCount` — see §5.2 reconciliation.

---

## 4. Current-state findings (file:line)

- `src/utils/abilities/evaluateConditions.ts:57-63` — `enemy-buff` matches by name; `enemy-debuff` returns `ctx.enemyDebuffCount`, **ignoring** `cond.buffName` (documented "name-agnostic by design, mirrors dpsSimulator").
- `src/utils/abilities/evaluateConditions.ts:4-44` — `ConditionContext` has `enemyDebuffCount: number` but **no** `enemyDebuffNames` list.
- `src/utils/abilities/applyAbilities.ts:25-91` — `modifierTotalsFromAbilities` sums modifier abilities **ignoring the `target` field** entirely.
- `src/utils/combat/playerTurn.ts:1339-1352` — `modifierAbilities` = **acting actor's own** firing + passive skills only. No teammate auras.
- `src/utils/combat/playerTurn.ts:1321-1337` — `modifierCtx` is built once per turn against the primary target's status.
- `src/utils/combat/engine.ts:3553-3595` — `victimIncomingModifiers(victimId)` is the existing **per-victim** channel (reads the victim's own per-actor enemy-debuff store via `victimEnemyBuffs`). This is the template for a per-victim **outgoing** channel; the name-reading helper `ownerDebuffNamesFor` (`triggers.ts`) already exists.
- `src/utils/skillTextParser.ts:2610-2678` — `PURGE_RE = /\bpurges?\s+(?:(\d+|all)|an?\b)/gi` deliberately excludes passive-voice "is Purged of all buffs" (Lodolite charged). `detectMostBuffsTarget` (`:1423`) + `enemy-most-buffs` target already exist.
- `src/utils/abilities/buildShipAbilities.ts:1210-1229` — passive-voice purge deferred; `enemy-most-buffs` target wired.
- `src/utils/combat/events.ts:180` + `playerTurn.ts:1884` — `purge-performed` event emitted per victim; `victim.shieldPool` is a mutable field (engine.ts:3052+). Hook point for the shield strip.
- `src/utils/abilities/buildShipAbilities.ts:358-383` — the "X% more direct damage to enemies with <effect>" branch already emits `enemyEffectConditions` with the correct `buffName`; the parse side is largely done, the **eval + distribution** sides are the gap.

---

## 5. Design

Three independent layers. Each ship needs a subset (see §6 matrix).

### 5.1 Layer 1 — Team-aura distribution for outgoing-damage / DoT-damage modifiers

**Problem:** `target: 'all-allies'` on a `modifier` ability does nothing.

**Approach:** when assembling an acting actor's `modifierAbilities`, additionally gather `all-allies`-targeted `modifier` abilities from **every living same-side ally** (excluding the actor's own, which are already included), carrying **each source's conditions**. `self`-targeted modifiers stay self-only. Enemy-side symmetric: an enemy actor gathers all-allies modifiers from its living enemy-side allies.

- Recipient set + source ordering reuse the existing `all-allies` recipient routing already used for buffs/heals/charges (`playerTurn.ts` `supportRecipients('all-allies', …)`, engine `playerIds` / enemy-attacker order). Do **not** invent a second ordering.
- The gathered ally modifiers are evaluated against the **recipient's own** ctx (the acting actor), so a self-status gate (Panguan's Stealth) and an enemy-status gate (Lodolite's CF) both resolve from the recipient-attacker's perspective. This is what makes Panguan "includes self" fall out for free — a stealthed Panguan is one of the recipients and its own ctx has `selfBuffNames` ⊇ {Stealth}.
- **Team-symmetry test** is mandatory (mirror of the E5 heal-lift template): the same aura source on the enemy side must buff enemy allies identically.

**Distribution must not double-apply.** A source's own attack already includes its own passive modifier; the gather step excludes `sourceId === actorId` to avoid counting Lodolite's aura twice on Lodolite.

### 5.2 Layer 2 — Name-specific `enemy-debuff` gating

**Add** `enemyDebuffNames?: string[]` to `ConditionContext`. Change `evaluateCondition` case `'enemy-debuff'`:

```
case 'enemy-debuff':
    if (cond.buffName && ctx.enemyDebuffNames)   // opt-in: both present → name-specific
        return countNames(ctx.enemyDebuffNames, cond.buffName);
    return ctx.enemyDebuffCount;                  // sentinel: array undefined → legacy count
```

**DPS-calculator parity (critical):** the DPS simulator must **not** populate `enemyDebuffNames` (leave it `undefined`) → it keeps the count path → **byte-identical DPS output**. Only the combat sim opts in. This is why the sentinel is `undefined`, not `[]` (an empty array would make every name-gate fail and change DPS).

**DoT-named reconciliation (Inferno / Scorching Radiation — Incinerator, Wrecker, Wildfire):** the modifier ctx already carries `infernoEntryCount` / `corrosionEntryCount`. Before routing an Inferno/Scorching gate through `enemyDebuffNames`, the implementer MUST verify how `buildRoundContext` folds DoT entries into `enemyDebuffCount` and whether a DoT-named gate should read the dedicated count instead. Preferred: a DoT-named gate reads the existing DoT-entry channel (no double-modeling); a control/marker-named gate (CF/Stasis/Disable/Taunt/Provoke) reads `enemyDebuffNames`. Resolve empirically in Phase 2 before wiring the DoT ships. If `enemyDebuffNames` already includes DoT names, prefer it for uniformity and drop the special-case — decide with a test, not by assumption.

**Golden audit:** this change legitimately moves behavior for **Tygr, Rikra, Incinerator, Wrecker, Lodolite** wherever they (or an ally that inherits the aura) appear in a golden fixture. Expect churn; audit line-by-line, never blind `vitest -u`. If a ship is absent from all goldens, output stays byte-identical.

### 5.3 Layer 3 — Per-victim evaluation of enemy-status-gated outgoing modifiers

**Problem:** `modifierCtx` reflects the primary target only. Lodolite/Tygr/Incinerator/Rikra want per-victim.

**Approach:** mirror `victimIncomingModifiers` with an **outgoing** analog. In the shared positional-apply driver (`drivePositionalApply`, engine.ts ~3618) that already loops per victim, compute the attacker's outgoing modifier **per victim** by rebuilding the enemy-status fields of the ctx (`enemyDebuffNames`, `enemyBuffNames`, `enemyType`, `enemyHpPct`) from **that victim's** own per-actor store (`ownerDebuffNamesFor` / the name-read helpers), then re-run `modifierTotalsFromAbilities` for the enemy-status-gated modifiers against that per-victim ctx.

- **Split the modifier fold** into (a) victim-independent modifiers (self/enemy-type-agnostic — folded once per turn as today) and (b) enemy-status-gated modifiers (re-folded per victim). Only enemy-status-gated auras pay the per-victim cost; everything else stays on the single-ctx fast path → byte-identical where no such aura is present.
- The single-target case is a 1-element loop → identical numerics to a correct per-turn eval; the divergence only appears in AoE.
- **Acceptance approximation to AVOID:** the existing `victimEnemyBuffs` jsdoc notes a "NEUTRAL ctx, no re-roll" approximation for the aura channel — do not inherit that for the crit fraction. Outgoing crit-conditional modifiers (`outgoingCritDamage`) interact with the per-hit crit schedule; keep them on the existing per-hit path and only vary the **gate** per victim.

### 5.4 Selenite — enemy-Stealth count scaling

"10% more direct damage for every enemy with Stealth" is a **count-scaling** modifier, not a per-target gate. `enemyBuffNames` today is a **union** (deduped) → cannot count multiple stealthed enemies. Add a distinct **count of stealthed enemies** source to the ctx (number of living opposing actors whose self-buff set contains Stealth) and a `scaling` rule (`perUnit: 10`, no cap unless the text states one). This is self-scoped (Selenite's own attacks) — no team distribution, no per-victim.

### 5.5 Lodolite charged purge + shield strip (self-contained)

1. **Parse the passive-voice purge.** Extend the purge parse to recognize "…is Purged of all buffs" (count `'all'`). Two options — pick the lower-churn one after testing: (a) add a passive-voice alternative to `PURGE_RE`; (b) a dedicated `detectPassiveVoicePurge` used only for the charged slot. The `charged`-slot on-cast gate + `detectMostBuffsTarget` → `enemy-most-buffs` target already route it correctly (`buildShipAbilities.ts:1227`). Guard against passive-slot false positives (a passive that merely mentions being purged).
2. **Shield strip on purge.** Add a purge-triggered shield removal: when Lodolite emits `purge-performed` against an enemy, set that enemy's `shieldPool = 0`. Model as a ship-sourced reactive keyed to the purge event (team-symmetric). Confirm ordering: strip AFTER the purge resolves, on the SAME victim id. Only Lodolite (legendary refit) carries it today — gate on the parsed ability, not a hardcoded ship name.

---

## 6. Per-ship layer matrix

| Ship | L1 team aura | L2 name-specific | L3 per-victim | Other |
|------|:---:|:---:|:---:|---|
| Lodolite (+15%) | ✅ | ✅ (CF) | ✅ | Stealth half via existing `enemy-buff` |
| Lodolite (charged) | — | — | — | §5.5 purge + shield strip |
| Tygr | — | ✅ (Stasis/Disable) | ✅ | — |
| Rikra | — | ✅ (Taunt/Provoke) | ✅ (if AoE) | firing-skill scaling path |
| Incinerator | — | ✅ (Inferno — §5.2 reconc.) | ✅ | — |
| Wrecker | — | ✅ (Inferno — §5.2 reconc.) | — (charge single-tgt; verify) | firing-skill scaling path |
| Wildfire | ✅ (refit) | ✅ (Scorching Rad. — §5.2) | ✅ | **`dotDamage`** channel + crit-power scaling |
| Panguan (+40%) | ✅ | — | — | self-buff Stealth gate; incl. self |
| Selenite | — | — (uses `enemy-buff`) | — | §5.4 stealthed-enemy count scaling |

---

## 7. Phased PR breakdown

Subagent-driven-development; per-task spec+quality pass + final holistic review. Each PR: `audit:skills` 0 errors, lint, tsc clean, goldens audited (byte-identical unless behavior legitimately changes — then line-by-line justification). `gh auth switch --hostname github.com --user TheSusort`. Work on the main checkout (avoid fresh-worktree esbuild crash). Docs gitignored → `git add -f` + `--no-verify`. Dev server on :3000. Never blind `vitest -u`.

- **I1 — Layer 2 (name-specific `enemy-debuff`).** Add `enemyDebuffNames?`, opt-in eval, thread the per-turn `enemyDebuffNames` into `modifierCtx` from the primary target. Resolve the DoT-name reconciliation (§5.2) with a test. Golden audit for Tygr/Rikra/Incinerator/Wrecker (single-target / per-turn correctness first, before per-victim). DPS parity test asserting `enemyDebuffNames === undefined` path unchanged. **This PR alone corrects the debuff-gated ships for single-target.**
- **I2 — Layer 3 (per-victim outgoing).** Per-victim outgoing-modifier fold in `drivePositionalApply`, split victim-independent vs enemy-status-gated. Per-victim `enemyDebuffNames` from each victim's store. AoE test where some victims carry the named status and some don't. Golden audit for any AoE-attacker ships.
- **I3 — Layer 1 (team-aura distribution).** Gather all-allies `modifier` abilities from living allies into each recipient's fold; enemy-side symmetric. Team-symmetry test. Wires **Lodolite +15% team aura** and **Panguan +40%** (self-buff gate, incl. self). Golden audit.
- **I4 — Wildfire.** `dotDamage`-channel team aura + Scorching-Radiation gate + crit-power scaling. Depends on I1–I3. May reveal the DoT-channel needs its own distribution seam distinct from `outgoingDamage`.
- **I5 — Selenite.** Stealthed-enemy count source + scaling rule.
- **I6 — Lodolite charged purge + shield strip.** Passive-voice purge parse + purge-triggered shield strip. Independent of I1–I5 — can land in parallel.

Ordering: I1 → I2 → I3 are a dependency chain (name-specific → per-victim → team). I4 depends on I1–I3. I5 and I6 are independent and can interleave.

---

## 8. Testing strategy

- **Unit:** `evaluateConditions` name-specific branch (buffName present + array present/absent); count-scaling for Selenite; passive-voice purge parse.
- **Integration (combat):** per each ship, a fixture where the named status is present vs absent on the target, asserting the bonus applies/doesn't. AoE mixed-victim fixture (I2). Team-aura fixture: ally attacks, gets/doesn't get the aura (I3). Team-symmetry fixture: same source enemy-side (I3/I6).
- **DPS parity:** explicit test that the DPS simulator's `ConditionContext` leaves `enemyDebuffNames` undefined and DPS output is unchanged (protects the sentinel invariant).
- **Golden audit:** whole `npm test` golden set. Any moved golden is justified line-by-line in the PR; the moving ships (Tygr/Rikra/Incinerator/Wrecker/Lodolite/Panguan/Wildfire) are the only legitimate movers.

---

## 9. Risks & known approximations

- **Golden churn breadth (I1):** the single name-specific change touches every debuff-gated ship at once. Mitigation: land I1 first for single-target correctness, audit before adding per-victim complexity.
- **DoT-name double-modeling (§5.2):** unresolved until Phase 2 empirical check — flagged, not assumed. Wrong resolution would double- or under-count Inferno-gated bonuses.
- **`dotDamage` channel distribution (I4):** Wildfire may need a distribution seam separate from `outgoingDamage`; scoped into its own PR to contain risk.
- **Selenite union-count (§5.4):** requires a genuinely new ctx source (stealthed-enemy count); confirm no existing source already provides it before adding.
- **Crit-fraction per-victim:** keep `outgoingCritDamage` on the per-hit crit path; per-victim variance applies to the **gate** only, not the crit re-roll.

---

## 10. Out of scope

- The other correctly-excluded near-misses from the sweep (Thresh/Panon/Wusheng/Yin Jian self-conditional; Gallant/Meiying/Zeolite enemy-CLASS gates already handled via `enemy-type`; Obsidian/Los/Tithonus/Akula HP-threshold scaling; Graphite charge-add-on-enemy-Stealth with no damage component).
- Any refactor of the DPS simulator's condition model (must stay byte-identical).
