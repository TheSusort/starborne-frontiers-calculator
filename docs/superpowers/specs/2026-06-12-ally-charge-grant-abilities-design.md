# Ally-Charge-Grant Abilities (enemy-team support PR3 / full)

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — pending spec review + user review
**Branch (planned):** `feat/combat-engine-enemy-team-pr3-ally-charge` (stacked on PR2 `feat/combat-engine-enemy-team-pr2-routing` while #102/#103 are open; retarget to main after they merge)
**Predecessors:** enemy-team PR1 (reactive self-buffs), PR2 (cross-enemy buff routing); Phase 4b Liberator `parseAllyChargeOnEnemyDeath`; Phase 4c PR5 (`enemy-buff` live subject); Phase 4c PR6 (Chakara `start-of-round`).
**Parent spec:** `docs/superpowers/specs/2026-06-12-combat-engine-enemy-team-support-design.md` (§4 PR 3).

---

## 1. Background & motivation

PR3 was scoped as "optional enemy `grantAllyCharges` — only if a corpus enemy supporter needs it." A corpus scan (2026-06-12) found the charge-grant-to-allies category is small but real — **three ships**, all targeting `all-allies`:

| Ship | Trigger | Path | Parsed today? |
|------|---------|------|---------------|
| Liberator | `on-enemy-destroyed` | reactive | ✅ (`parseAllyChargeOnEnemyDeath`) |
| Hayyan | charged-skill on-cast | cast | ❌ unparsed |
| Graphite | `start-of-round` (gated: an enemy has Stealth; "within the active pattern") | reactive | ❌ unparsed |

The user chose to do the full feature: **parse Hayyan and Graphite, and wire the enemy-side charge grant**, so an enemy Hayyan/Graphite supporter accelerates the enemy attackers' charged bursts (→ bigger incoming-damage spikes → more healing needed). This is the genuinely valuable case; Liberator alone was near-inert enemy-side in single-target healing mode (its trigger needs a player ship to die, which ends the sim).

**Cross-side consequence (accepted):** parsing is global. Once Hayyan/Graphite emit an ally-charge ability, a player-team Hayyan/Graphite also grants the team charges in the DPS and healing calculators. This is intended and more accurate, not enemy-only.

---

## 2. Goals & non-goals

### Goals

1. Parse Hayyan's and Graphite's `all-allies` charge grants into charge abilities.
2. Close the cast-path gap so a **charged-skill** ally-charge grant (Hayyan) actually fires.
3. Wire an enemy-side `grantAllyCharges` so enemy Hayyan/Graphite/Liberator accelerate enemy attackers' charged skills, on both the cast path (enemy walk) and the reactive path (the PR1 no-op becomes real).

### Non-goals

- Generalizing `parseChargeGain` (the self-charge parser) — out of scope; risks mis-targeting Hermes/Asphodel/Chakara/Cobalt self-charges. We add a dedicated `all-allies` parser instead.
- Graphite's literal "within the active pattern" adjacency — approximated as all-allies (the established Cultivator precedent; real fix is the deferred targeting phase).
- Single-`ally` (non-`all-allies`) charge grants — none exist in the corpus.
- Enemy heal/cleanse routing, targeting/positional work — deferred.

---

## 3. Architecture

### 3.1 Parser — `parseAllyChargeGrant`

A new dedicated parser in `skillTextParser.ts`, mirroring the `parseAllyChargeOnEnemyDeath` precedent. It detects an ally-scoped charge-bar grant and returns `{ amount, trigger, condition? }`. `buildShipAbilities` emits an `all-allies` charge ability from it (alongside the existing self-charge and Liberator blocks).

- **Match shape:** an "adds/grants N charge(s) to … Charged Skill" phrase whose recipient is **all allies** — either explicit ("of all allies", "all allies' Charged Skill") or via the antecedent "their Charged Skill" when the same sentence grants something "to all allies" (Hayyan: "grants Cheat Death to all allies, and adds 1 charge to their Charged Skill"). MUST NOT match self phrasings ("adds 1 charge to its Charged Skill" — Hermes/Asphodel/Chakara/Cobalt) or "gains N charge" (self).
- **Trigger:** `start-of-round` when the clause is start-of-round-scoped ("At the start of the round …" — Graphite); else `on-cast` (Hayyan's charged rider). Reuse the existing start-of-round detection (`START_OF_ROUND_RE` / `detectReactiveTrigger`, shared masking for abbreviation periods).
- **Condition:** Graphite's "if an enemy has Stealth" → an `enemy-buff` (Stealth) condition, `derivable:true` (live since PR5). Hayyan → no condition. The "within the active pattern" scope is dropped (≈ all-allies).
- **Amount:** the numeral in the text (Graphite is "1/2 charges" across refit tiers; refit resolution is already upstream via `getShipSkillRows`, so the parser sees one number). NOTE the live CSV has the plural-with-singular typo "adds 1 charges" / "adds 2 charges" — the regex must tolerate `charges?` (as `SELF_CHARGE_ADD_RE` already does); add an explicit test for the plural-with-`1` form.

### 3.2 Engine — cast-path charged-action gap

`playerTurn.ts:1238` grants ally charges only when `action === 'active'` (written for Hermes, whose grant is on the active skill). Hayyan's grant rides the **charged** skill, so it is currently never granted. Generalize the gate to fire on the firing action — `action === 'active' || action === 'charged'` — reading the firing skill's ally-charge via the existing `chargeGainFromSkill({ targetFilter: 'ally' })`. Verify `gatedSkill` resolves to the firing skill on a charged turn. Graphite's `start-of-round` grant does NOT use this block (it partitions into the reactive path and fires via `executeIntent`'s charge branch).

This is a shared change: it fixes the player cast path AND the enemy walk (which runs the same `runPlayerTurn`).

**Partition guard (avoid double-grant):** the cast-path block sums ally-charge from BOTH the firing skill (`gatedSkill`) AND the passive (`gatedPassive`). Graphite's grant lives in a passive slot but is a `start-of-round` ability, so it MUST be partitioned out of `castSkills` into the reactive set (`partitionReactiveAbilities`) and fire only via `executeIntent` — not also be summed into `gatedPassive` here (which would double-grant: once on-cast, once reactive). The existing partition keys on the reactive trigger, so a correctly-`start-of-round`-tagged Graphite charge ability is excluded from the cast aggregation automatically; the plan must verify this (a parser test asserting the Graphite ability carries `start-of-round`, and an engine test asserting a single grant per round).

### 3.3 Engine — enemy `grantAllyCharges` mirror

Add `grantEnemyAllyCharges(amount)` next to the player `grantAllyCharges` (`engine.ts:1255`):

```ts
const grantEnemyAllyCharges = (amount: number): void => {
    for (const a of enemyAttackerActors) {
        if (a.chargeCount <= 0) continue;
        a.charges = Math.min(a.charges + amount, a.chargeCount);
    }
};
```

Replace the two enemy-side placeholders:
- Enemy walk (cast path): `engine.ts:2720` `grantAllyCharges: undefined` → `grantEnemyAllyCharges`. (The PR1/PR2 comment "allies are enemy-side, not the player team" was correct when no enemy buffed allies; now enemy supporters do.)
- Enemy reactive drain (PR1's no-op): `engine.ts:2225` `grantAllyCharges: () => {}` → `grantEnemyAllyCharges`.

The player `grantAllyCharges` and player drain side-ctx are unchanged.

### 3.4 Data flow

1. Parser emits an `all-allies` charge ability for Hayyan (on-cast, charged slot) and Graphite (start-of-round, enemy-Stealth gated).
2. **Player side:** Hayyan's charged turn → cast-path block (now firing on charged) → player `grantAllyCharges` bumps the team. Graphite → partitioned reactive → `round-started` → `executeIntent` charge branch → player `grantAllyCharges`.
3. **Enemy side:** an enemy Hayyan walking `runPlayerTurn` fires its charged skill → cast-path block → `grantEnemyAllyCharges` bumps enemy attackers. An enemy Graphite → PR1 enemy reactive registration → `drainEnemyIntents` → `executeIntent` charge branch → `grantEnemyAllyCharges`. Accelerated enemy attackers reach charged bursts sooner → higher incoming damage to the tank.

### 3.5 Error handling & edge cases

- **Self-charge ships must be untouched.** Lock-test that Hermes/Asphodel/Chakara/Cobalt still parse as `target:'self'` charge (the new parser must not steal them).
- **Charged-action gate:** confirm the generalized gate does not double-grant (active turn unchanged; charged turn now grants its charged-skill ally amount once).
- **Graphite enemy-side gate:** enemy Graphite's "an enemy has Stealth" means a *player* ship has Stealth — rarely modeled, so it usually stays dormant. Acceptable (conservative). On the player side the gate reads enemy Stealth (the configured enemy buffs), already live via PR5.
- **Enemy charge cadence:** `grantEnemyAllyCharges` only bumps the bar; the enemy walk's existing cadence (consume-at-cap / startCharged) governs when the charged skill fires. A bumped enemy with `chargeCount 0` is skipped.

---

## 4. Testing strategy

- **Goldens byte-identical** (`healingGoldenParity`, `dpsGoldenParity`): hand-built, no parser import. The risk is §3.2's gate change (`active`→`active|charged`): a synthetic golden whose charged skill carries an ally-charge config would churn. Run all goldens; STOP-and-investigate on any diff (never `vitest -u`).
- **Parser unit tests:** Hayyan → `all-allies`/`on-cast`/no-condition charge; Graphite → `all-allies`/`start-of-round`/enemy-Stealth-condition charge with the right amount; self-charge lock tests (Hermes et al. stay `self`).
- **Player-side engine tests:** a team Hayyan grants the team a charge off its charged turn (team charged cadence advances); a team Graphite grants only when an enemy has Stealth (gated off → no grant; on → grant).
- **Enemy-side engine tests:** an enemy Hayyan accelerates a co-enemy attacker's charged burst → higher incoming damage vs a control without the supporter; an enemy Graphite likewise when the gate is satisfied.
- **`audit:skills`:** 0 findings / 141 ships (Hayyan/Graphite gain a parsed charge ability — confirm no new findings / no double-emit).
- **Lint + tsc** clean.

---

## 5. Workflow notes

- `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op.
- `docs/` gitignored → `git add -f`; pre-commit hook runs the full suite (`--no-verify` for docs-only).
- One evolving `UNRELEASED_CHANGES` combat entry — fold.
- Update `docs/skill-model-coverage.md` (§6 enemy-team item + the charge `trigger`/parser rows) and the combat-engine state memory after merge.

---

## 6. Open questions / future work

- Graphite's "within the active pattern" → real adjacency in the deferred targeting phase.
- Single-`ally` charge grants — none today; the parser targets `all-allies` only (extend if a future ship needs single-ally).
- PR slicing: default one PR (parser + gate + enemy wiring). If §3.2's gate change shows wide player-side golden/real-data impact, split parser-first then enemy-wiring.
