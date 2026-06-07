# Damage-Leech Heals & Shields — Design

**Date:** 2026-06-07
**Status:** Approved (user-validated section by section)
**Baseline:** PR #87 merged (`a3c30447`) — Healing Calculator runs on the combat engine.
**Branch target:** `feat/damage-leech`

## Baseline correction (important)

The 2026-06-07 damage-leech handoff overstates what PR #87 shipped. Verified against the
code and `git log -S`:

- There is **no `damage-taken` event** and **no `on-ally-damaged` / `on-self-damaged`
  trigger** — `LIVE_TRIGGERS` has **8** entries, not 11. There is no `onCritHit` field on
  heal/shield configs.
- Cultivator-style "when an ally is directly damaged" repairs are **on-cast per-turn
  passive heals**; the PR #87 fix (`b36866b7`) was about their parsed *recipient*
  (ally vs self), not a trigger.
- Enemy attacker turns produce **one aggregate damage number** per turn
  (`runEnemyAttackerTurn`), with per-hit crit draws folded into a blended multiplier.
- Echoing Burst accumulator bursts emit **no event** — they flow through
  `creditDetonation(sourceId, damage)` only.

This design builds what it needs at the engine's damage **credit points** instead of the
(nonexistent) event seams. The handoff doc itself gets corrected as part of this work.

## Goal

The healing calculator simulates the ~14 leech text cells (~11 ships): heals/shields equal
to a percentage of damage **dealt** or damage **taken**. The mechanism is deterministic
(zero RNG), additive to the public result types, and leaves all 30 golden snapshots
(22 DPS + 8 healing) byte-identical.

## Scope

| Group | Ships / cells | Mechanism |
|---|---|---|
| **A. Same-cast riders** — "…and repairs/gains Shield equal to X% of the damage dealt" | Iridium (15%), Opal (10%), Tithonus (all allies 7%, noCrit), Pallas (lowest-HP ally 20%, noCrit), Quixilver active (shield 20%), FrontLine active+charged (shield 30%/40%) | Cast-local basis in the player-turn heal block |
| **B. Standing passive leech** — all damage the unit deals | Magnolia (20/40% self), Valerian (15% self, text explicitly includes DoT ticks) | Engine credit-time standing-leech hook |
| **C. Event-scoped standing leech** | Valkyrie passive — "When an Echoing Burst explodes … this Unit and the ally with the lowest current health percentage repair 5% of damage dealt" | Same hook, scoped to the detonation channel |
| **D. Damage-taken shields** | Quixilver passive (shield = 25% of damage taken, gated), Malvex (shield = 15% of damage dealt **to them**) | Per-attack proc in the enemy-attack block |

**Out of scope** (unchanged from the handoff's increment menu):
- FrontLine R4 passive ("When an enemy uses their Charged skill…") — enemy-action
  reaction, Phase 4. Gets a parser disqualifier so it cannot half-parse.
- Laika ("Shield equal to 20% of its Max HP upon removing Shield from an enemy") —
  hp-basis shield with an unparseable trigger; pre-existing behaviour untouched, noted as
  a known Phase-4 cell.
- Revive/Cheat Death (guard retained).

## User decisions (2026-06-07, do not re-litigate)

1. **Scope = A+B+C+D** (everything except the Phase-4 cells).
2. **Leech repairs draw heal crits** when the text doesn't say "cannot critically hit"
   (Magnolia, Valerian, Iridium, Opal). Tithonus/Pallas parse `noCrit: true` and skip the
   draw. Rationale: the explicit "cannot critically hit" exemptions imply the default
   crits. Deterministic draws on the existing per-actor heal crit gates.
3. **Standing leeches include DoT ticks AND detonations** ("damage it deals" = all damage
   credited to the actor). Valerian's "including DoT" phrasing is treated as
   clarification, not differentiation — Magnolia leeches her Inferno ticks too.
   On the in-game verify list.

## Design

### 1. Data model (additive)

The existing heal/shield `AbilityConfig` variant in `src/types/abilities.ts` gains two
basis values and one optional field:

```ts
{
  type: 'heal' | 'shield';
  pct: number;
  basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken';
  noCrit?: boolean;
  /** Passive-slot 'damage-dealt' only: which credited damage procs the leech.
   *  'all' (default: direct + DoT ticks + detonations) or 'detonation'
   *  (Valkyrie: Echoing Burst explosions only). */
  leechScope?: 'all' | 'detonation';
}
```

No new triggers, no Intent changes, no new event shapes. Slot decides the mechanism:
**active/charged-slot** `damage-dealt` = cast rider (group A); **passive-slot**
`damage-dealt` = standing leech (groups B/C); **passive-slot** `damage-taken` = group D.

### 2. Parser (`skillTextParser.ts` + `buildShipAbilities.ts`)

1. **Lift the guard:** `HEAL_DISQUALIFY_RE` drops `of the damage (?:taken|dealt)` and
   `\bdamage dealt\b`; keeps `revives?` / `cheat death`.
2. **Basis detection** (sentence-scoped tail after the repair/shield match):
   - `of (the) damage dealt` / `of the damage it deals` / `of damage dealt` →
     `damage-dealt`.
   - `of the damage taken` / `damage dealt to (them|this unit)` → `damage-taken`
     (Malvex's "Damage dealt **to them**" is damage *taken* — explicit rule, tested).
3. **Verb widening:** `HEAL_REPAIR_RE` matches only `repairs?`. Pallas uses "**heals**
   for 20% of the damage dealt" — widen to `heals?` **only when the sentence tail is a
   leech phrase** (no general "heals" parsing; avoids false positives).
4. **Recipients** (existing target machinery):
   - Damage-rider repairs/shields stay `self` (existing rule): Iridium, Opal, Quixilver
     active, FrontLine active/charged. Standing passives stay `self`: Magnolia, Valerian.
   - Tithonus "repairs all allies 7% of the damage dealt" → `all-allies`.
   - Pallas "The other ally with the lowest current health percentage heals for 20%" →
     `ally`.
   - Valkyrie "this Unit **and** the ally with the lowest current health percentage
     repair 5% of damage dealt" → **two abilities**: one `self` + one `ally`, 5% each,
     both `leechScope: 'detonation'`.
   - Healing-mode routing approximation (existing): `ally` → the bombarded heal target.
     "Lowest-HP ally" has no engine concept; documented.
5. **Valkyrie scope detection:** "When an Echoing Burst explodes" in the heal sentence →
   `leechScope: 'detonation'`. Bare standing leeches default to `'all'`.
6. **noCrit:** "this repair cannot critically hit" sets `noCrit: true` on the leech heal.
   Pallas: same sentence. Tithonus: the **following** sentence ("Then repairs all allies
   7% of the damage dealt. This repair cannot critically hit.") — the scan covers the
   heal's sentence plus an immediately-following "This repair cannot critically hit"
   sentence.
7. **Group-E disqualifier:** a leech heal/shield whose sentence carries an enemy-action
   trigger ("when an enemy uses…") does not parse (FrontLine R4).
8. **`auditSkills` mirrors** every guard/parse change (clause-scoping discipline — same
   masking in both files).
9. Meatshield's self-damage-conditional carve-out and all PR #87 routing rules are
   untouched (regression-tested).

### 3. Group A — cast riders (`playerTurn.ts` heal block)

- `basisValue('damage-dealt')` resolves to **this turn's cast damage**: the local direct
  total (which already includes secondary/conditional sub-buckets), **excluding**
  detonation damage (no group-A ship detonates on the same cast; documented).
- Full existing fold: one heal-crit draw per heal ability on the separate heal crit gate
  (`noCrit` respected), `healModifier`, `outgoingHeal`, recipient `incomingHeal`.
  Shields: `basis × pct` only (no crit, no channels — existing convention).
- Emits `heal-performed` like any cast heal.
- **Slot partition guard:** the heal block **skips** passive-slot `damage-dealt`
  abilities — those belong to the standing hook; processing them here would double-count
  the cast's direct portion. (Passive-slot `damage-taken` abilities are also skipped —
  they belong to the enemy-attack block.)
- DPS mode: unchanged — the whole block stays gated on `args.healing`.

### 4. Groups B+C — standing-leech hook (engine)

- **Setup:** scan each player runtime's passive-slot heal/shield abilities with
  `basis: 'damage-dealt'` into `standingLeeches: Map<ownerId, LeechEntry[]>`,
  `LeechEntry = { kind: 'heal' | 'shield', pct, target, noCrit, scope }`, in slot/text
  order (deterministic).
- **Hook:** a new engine closure `creditDamage(sourceId, channel, amount)` with
  `channel ∈ {direct, detonation, corrosion, inferno}` wraps the existing credit points:
  focus-turn direct/detonation fold, team-turn direct/detonation fold, DoT-tick credit,
  bomb credit, accumulator-burst credit. With an empty table it does exactly what the
  bare `dmg(sourceId)` writes do today — **pure refactor, goldens are the referee**.
- **Proc** (healing mode only; the hook no-ops in DPS mode): for each of the owner's
  entries where the scope matches (`'all'` = direct + corrosion/inferno + detonation;
  `'detonation'` = detonation only):
  - Heal: `raw = amount × pct/100 × (1 + owner.healModifier/100)`, then (unless
    `noCrit`) one draw on the owner's `activeHealCritGate` at the owner's standing
    crit/critDamage — specifically `PlayerActorRuntime.crit` / `.critDamage` (the
    adapter-derived base+gear stats), NOT the per-turn folded `effectiveCrit` (which
    only exists mid-turn). Simplified drain-style fold, documented approximation
    mirroring the executor's reactive-heal fold, **plus** the crit draw per user
    decision 2.
  - Shield: `raw = amount × pct/100` (no crit, no channels).
  - Recipients: `self` → owner; `ally` → heal target; `all-allies` → `playerIds` (fixed
    order). Heals credit the owner's `directHeal` bucket (no new bucket — YAGNI);
    consumption (`applyHealToTarget` / `grantShieldToTarget`) only when the recipient is
    the live heal target, split credited to the owner's effectiveHeal/overheal.
  - Procs apply **immediately at credit time** — a DoT-tick leech lands during the enemy
    turn, before later queue entries (correct for survival timelines; deterministic
    queue/credit order).
  - **No `heal-performed` emission** (chain guard, same convention as executor reactive
    heals). Consequence: leech procs never feed `on-ally-critically-repaired`;
    documented.

### 5. Group D — damage-taken procs (enemy-attack block in `engine.ts`)

- At setup, collect the heal target's passive-slot `damage-taken` heal/shield abilities.
- **Per enemy attack** (not per hit): after the attack's shield-first drain resolves,
  proc each ability on the **aggregate attack damage**:
  - **Malvex** (unconditional — "primary target" is always true in our single-target
    bombardment model): `shield += 15% × attackDamage`.
  - **Quixilver** ("when taking HP damage and still having Shield"): procs only when the
    attack started with `shieldPool > 0` **and** dealt HP damage (the attack punched
    through the pool): `shield += 25% × attackDamage`. This is the only reading
    consistent with the user-verified shield-first drain model; in-game verify flagged.
  - Proc shields credit the target's own `shield` bucket + `grantShieldToTarget`; a
    `damage-taken` *heal* (none in the current cells, but the config allows it) follows
    the standing-leech heal fold with the target as both owner and recipient.
- **Why per-attack:** per-hit application would restructure the shield-drain arithmetic
  and risk float-level churn on the 8 locked healing goldens; the accuracy difference
  (mid-attack shield compounding) is below the fidelity of the enemy model (manual flat
  or basics walk). On the in-game verify list. `runEnemyAttackerTurn` is unchanged.
- Dead target: no procs (damage is 0).

### 6. UI

- **Skill Editor** heal/shield fields: basis `Select` gains "Damage dealt" and "Damage
  taken" options; a scope `Select` ("All damage" / "Detonations only") renders only for
  passive-slot damage-dealt abilities. Existing `Select` component; no new primitives.
- **`DocumentationPage.tsx`:** healing-calc section gains a short leech paragraph.
- **Changelog:** fold into the ONE evolving healing entry in `UNRELEASED_CHANGES` —
  never append a second entry.

### 7. Testing

- **Parser fixtures** (`buildShipAbilities.test.ts`), one per shape: Magnolia (standing
  self, 20%), Valerian (standing self + extend-dot coexists), Iridium/Opal (rider self),
  Tithonus (all-allies + following-sentence noCrit), Pallas ("heals" verb + ally +
  noCrit), Valkyrie (two-ability split + detonation scope), Quixilver (active rider +
  taken passive), FrontLine (active+charged riders parse; R4 passive does NOT),
  Malvex ("dealt to them" → taken), Meatshield/Hermes/Cultivator/Morao regressions.
- **Engine tests:** cast-rider fold (crit draw, channels, slot partition guard),
  standing-hook procs per channel/scope (incl. detonation-only), per-attack D procs
  (Malvex unconditional, Quixilver gated on punch-through), DPS-mode inertness,
  determinism (two runs → identical output).
- **Goldens:** all 30 existing snapshots stay **byte-identical** (credit wrapper is a
  pure refactor; D is per-attack; DPS mode fully inert). New hand-verified healing
  goldens: Magnolia (Inferno-tick leech), Valerian (Corrosion leech), Tithonus + Pallas
  (noCrit riders), Valkyrie (detonation leech), Quixilver as heal target (active rider +
  taken passive + shield interplay). Targeted regeneration only (delete + re-run);
  NEVER `vitest -u`.
- Full suite via pre-commit (~2 min); ESLint zero warnings; **no RegExp lookbehind**
  (iOS Safari 15). Scope note: the lookbehind ban applies to bundled client code
  (`src/` — `skillTextParser.ts`); the Node-only `scripts/auditSkills.ts` already uses a
  lookbehind legitimately — do not "fix" it, and do not copy its split pattern into the
  parser.

### 8. Docs & corrections

- `docs/skill-model-coverage.md`: §5 gains the leech rules (user decisions 1–3, the
  per-attack approximation, the chain-guard consequence); §6 verify list gains
  Magnolia-DoT-leech, Quixilver punch-through, per-attack procs; coverage counts updated.
- **Handoff correction:** fix `docs/superpowers/handoffs/2026-06-07-damage-leech-handoff.md`
  "What shipped in PR #87" (no damage-taken event / damage triggers / onCritHit; 8 live
  triggers, not 11) so future sessions aren't misled.
- Memory file `project_combat_engine_roadmap.md` updated at the end.

## Hard constraints (inherited, unchanged)

- Public DPS/healing result types stay additive; goldens = referee, zero churn.
- Zero-RNG determinism; listeners pure; engine/executor sole mutators; no `'attacker'`
  literals in engine core.
- docs/ is gitignored — `git add -f` for spec/plan commits.
- Pre-commit full suite; no `--no-verify` for code commits.

## Verification (end of increment)

Live fleet check on :3002 (the 212-ship origin; I manage the dev server, never
implementer subagents): Magnolia self-sustain with Inferno ticking, Valerian Corrosion
leech, Tithonus all-ally rider, Pallas ally rider, Valkyrie burst heal, Quixilver/Malvex
as heal target under enemy bombardment. Skill Editor shows the new basis/scope fields;
parsed ships round-trip through the editor.
