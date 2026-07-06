# Model-completeness epic — SP-A + SP-B (combined) design

**Date:** 2026-07-06
**Epic:** model-completeness (roadmap `docs/superpowers/specs/2026-07-05-model-completeness-epic-roadmap.md`)
**Input:** SP0 triage reconciliation `docs/model-completeness-triage-2026-07-05.md`
**Predecessor:** SP0 triage merged (#230); Curator dup-emission bug fixed (#231)

## Goal

Close the 5 real-gap `it.fails` probes owned by SP-A and SP-B, faithfully — zero real-gap
allowlist deferrals for these ships. SP-A and SP-B are independent infra (`A ∥ B` in the DAG);
combined here into one spec / plan / merge-loop because both are small.

**Acceptance per gap:** flip its `it.fails` → `it` in
`src/utils/abilities/__tests__/modelCompletenessTriage.test.ts`. Two probes are tier-1 (type-only
today) and get their assertions *strengthened* as their new literal lands (Malvex condition,
Ravager exact trigger).

## Scope decisions (locked with the user)

1. **Combined spec** covering SP-A (Malvex, Voron-reduction) + SP-B (Paracelsus, Ravager, Nosorog).
   Ships as separate PRs, one brainstorm/spec/plan/merge-loop.
2. **Voron-reduction built now** (not deferred to SP-E). It is type-valid and applies to *any*
   DoT Voron takes; SP-E's damage→DoT transform layers on top later.
3. **Paracelsus — fix both halves.** Route BOTH the 50%-max-HP retaliation AND the Everliving
   Regeneration II ally-buff onto `on-destroyed`. Both are wrong (on-cast) today.
4. **PR decomposition:** 4 PRs. Group the two trivial parser widenings (Voron + Nosorog); Malvex,
   Paracelsus, Ravager each atomic.

## Out of scope

- Voron's damage→DoT *transform* (SP-E, Task 6). This spec builds only Voron's DoT reduction.
- Belladonna, and all SP-C/D/E/F/G ships.
- Curator duplicate-emission (already fixed, #231).
- Any allowlist row not tied to these 5 ships.

---

## The five gaps

### SP-A — incoming-reduction gaps

Both feed the detector `parseIncomingDamageReductionPhrasings`
(`src/utils/skillTextParser.ts:728–786`), whose output the build loop at
`src/utils/abilities/buildShipAbilities.ts:2099–2124` turns into `incoming-reduction` abilities
(`target:'self'`, `trigger:'on-cast'`). The `incoming-reduction` config variant lives at
`src/types/abilities.ts:595–613` (`scope:'direct'|'dot'`, `condition: IncomingCondition`, `pct`,
`critFamily`, optional `hpScaling`).

#### A1 — Malvex (NEW primitive) — PR-A

**Clause (passive2):** "When Shielded, this Ship takes 10% less damage."

Today: no incoming-reduction ability builds for this clause at all (only the separate "gains
Shield = 15% of damage taken" ability). `IncomingCondition` has no self-shield member.

**Changes:**
1. **Type** — add `'self-shielded'` to the `IncomingCondition` union (`abilities.ts:319–337`).
   Fits existing naming (`self-stealth`, `self-stasis`, `self-barrier-recharging`).
2. **Parser** — new branch in `parseIncomingDamageReductionPhrasings` matching "When Shielded"
   → emit `{scopes:['direct'], condition:'self-shielded', pct:10}`.
3. **Engine consumption** — extend the per-hit `IncomingCondition` evaluator so `self-shielded`
   applies the reduction only when the victim currently holds an active shield (`shield > 0`).
   (Locate the evaluator that reads `config.condition` during damage resolution and add the case.)
4. **Test** — strengthen the tier-1 probe (currently `a.type === 'incoming-reduction'`) to also
   assert `a.config.condition === 'self-shielded'`, then flip `it.fails` → `it`.

Team-symmetry: incoming-reduction is victim-side per-hit; verify it protects Malvex on either team
(check the evaluator is not player-side-gated).

#### A2 — Voron reduction (trivial, type-valid) — PR-trivial (with Nosorog)

**Clause (passive2):** "…takes 20% less damage from Damage over Time effects."

Today: the whole passive slot builds no abilities for this clause.

**Changes:**
1. **Parser** — new branch in `parseIncomingDamageReductionPhrasings` matching "less damage from
   Damage over Time effects" → emit `{scopes:['dot'], condition:'always', pct:20}`.
2. **Engine** — none. `scope:'dot' + condition:'always'` is the live Tormenter path
   (`skillTextParser.ts:771–783` builds the same shape via `hpScaling`; the engine already
   consumes dot-scoped always-reductions).
3. **Test** — probe already asserts `scope==='dot' && condition==='always'`; flips automatically.

### SP-B — reactive-trigger gaps

#### B1 — Paracelsus (composes 2 precedents) — PR-B1

**Clause (passive2):** "Upon being killed by direct Damage, this Unit deals Damage equal to 50%
of its max HP and grants allies Everliving Regeneration II for 4 turns."

Today: only the Everliving Regen buff builds, and it wrongly rides `on-cast`; the retaliation
builds nothing. `hpBasisPct` and `on-destroyed` come from *different* precedents — this is the
first ship to combine them:
- `on-destroyed` trigger literal: `abilities.ts:82` (union) + `:179` (LIVE_TRIGGERS). Text→
  `on-destroyed` routing precedents: `detectKilledByDirectDamageTrigger` (Faust,
  `skillTextParser.ts:1918–1933`, regex `KILLED_BY_DIRECT_RE` at `:1920`) and
  `detectDestroyedAllyRepairTrigger` (Salvation, `:1693–1702`).
- `hpBasisPct` config field: `abilities.ts:424` (in the `type:'damage'` variant). Build precedent:
  Vindicator p2 at `buildShipAbilities.ts:1136–1163` (`type:'damage'`, `multiplier:0`, `hits:1`,
  `hpBasisPct`) — but that rides `on-debuff-resisted`, not `on-destroyed`.

**Changes:**
1. **Parser** — widen `KILLED_BY_DIRECT_RE` (`:1920`) to also match "**upon being** killed by
   direct damage" (today only "when killed…"). Re-verify Faust still matches after widening.
2. **Build (retaliation)** — emit a `type:'damage'`, `multiplier:0`, `hits:1`, `hpBasisPct:50`,
   `trigger:'on-destroyed'`, `target:'enemy'` ability (Vindicator's shape + on-destroyed trigger).
3. **Build (ally-buff)** — route the "grants allies Everliving Regeneration II 4t" buff onto
   `on-destroyed` (currently on-cast). `target:'all-allies'`.
4. **Team-symmetry** — verify both fire when Paracelsus dies on the enemy side.
5. **Test** — flip `it.fails` → `it` (existing assertion checks `on-destroyed` + damage +
   `hpBasisPct != null`); add a 2nd assertion that the Everliving Regen buff's
   `trigger === 'on-destroyed'`.

#### B2 — Ravager (NEW inflictor-side trigger) — PR-B2

**Clause (passive2):** "…If its debuff is resisted, it gains Hacking Module Overdrive for 1 turn."

Today: the grant rides `on-cast`. Only the resister-side `on-debuff-resisted` exists
(`abilities.ts:141` union, `:200` LIVE_TRIGGERS; "fires when THIS unit resists an incoming
debuff, self-scoped on targetId === ownerId"). Ravager needs the **inflictor** side — the debuff
*this* unit inflicted got resisted by the target.

**Changes:**
1. **Type** — add `'on-own-debuff-resisted'` to the `AbilityTrigger` union (`abilities.ts:62–150`)
   AND `LIVE_TRIGGERS` (`:160–205`). Doc it as the inflictor-side mirror of `on-debuff-resisted`.
2. **Parser** — new inflictor-side detector matching "if its debuff is resisted" → route the
   "gains Hacking Module Overdrive" grant onto `on-own-debuff-resisted`.
3. **Engine** — emit this trigger to the *inflictor* at the debuff-resist resolution point (mirror
   of the resister-side `on-debuff-resisted` emission). Team-symmetric — fires whichever side
   Ravager is on.
4. **Test** — strengthen the proxy assertion from `.not.toBe('on-cast')` to
   `=== 'on-own-debuff-resisted'`, then flip `it.fails` → `it`.

#### B3 — Nosorog (trivial regex widen) — PR-trivial (with Voron)

**Clause (passive2):** "…Additionally, when this Unit removes a Debuff, it gains Defense Up II
for 1 turn."

Today: the grant rides `on-cast`. `OWN_CLEANSE_TRIGGER_RE` (`skillTextParser.ts:1068–1069`) only
matches the verbs "cleanses"/"cleansing"; "removes a Debuff" is a different verb, so it never
routes to `on-own-cleanse`.

**Changes:**
1. **Parser** — widen `OWN_CLEANSE_TRIGGER_RE` to also match "**removes a Debuff**", scoped to
   that exact phrase (NOT bare "removes", which also strips shields/buffs — the purge parsers at
   `:3404–3418` deliberately exclude other verbs; keep them excluded).
2. **Engine** — none. Routing at `:1155` already returns `on-own-cleanse` (Phase-3 PR-H trigger,
   `abilities.ts:137` / `:171`), which the engine already consumes.
3. **Test** — probe already asserts `trigger === 'on-own-cleanse'`; flips automatically.

---

## PR decomposition (4 PRs, `A ∥ B`)

| PR | Ships | Kind | Engine work? |
|----|-------|------|--------------|
| PR-A | Malvex | NEW `IncomingCondition` literal + parser branch | Yes (`self-shielded` evaluator) |
| PR-trivial | Voron + Nosorog | Two parser-branch/regex widenings | No |
| PR-B1 | Paracelsus | Compose `on-destroyed` + `hpBasisPct`, route both halves | No (existing on-destroyed emission) |
| PR-B2 | Ravager | NEW `on-own-debuff-resisted` trigger + detector | Yes (inflictor-side emission) |

All four are mutually independent (different ships, different seams) and can be worked in parallel.

## Test strategy

- Each PR flips exactly its own probe(s) `it.fails` → `it`; no other triage probe changes.
- Tier-1 strengthenings land in the same PR as their literal (Malvex `self-shielded`, Ravager
  `on-own-debuff-resisted`).
- Per-PR gate: full suite minus the triage file must stay green, then the triage file's flipped
  probe passes (per the merge-loop lessons in `project_skill_model_gap_sweep`).
- New reactive triggers (Paracelsus `on-destroyed`, Ravager `on-own-debuff-resisted`) get a
  team-symmetry assertion — the ship behaves identically on either side (engine-team-symmetry rule).

## Cleanup on completion

- **Allowlist:** remove Malvex, Voron, Paracelsus, Ravager, Nosorog rows from
  `scripts/auditSkills.allowlist.ts`; add/update audit rules as each PR lands so `audit:skills`
  stays at 0 findings.
- **Changelog:** add `UNRELEASED_CHANGES` entries in `src/constants/changelog.ts` for the
  user-facing fidelity fixes (Malvex shield mitigation, Voron DoT resistance, Paracelsus death
  retaliation, Ravager resist-reaction, Nosorog cleanse-reaction).
- **Docs:** no `DocumentationPage.tsx` change (internal combat-model fidelity, not a new UI feature).

## Risks / watch-items

- **Malvex engine evaluator** is the only non-trivial engine change — confirm the per-hit
  `IncomingCondition` check is team-agnostic before wiring `self-shielded`.
- **`KILLED_BY_DIRECT_RE` widening** must not regress Faust (its on-destroyed purge rides the same
  regex) — assert Faust still routes to `on-destroyed` after the change.
- **Nosorog "removes" scoping** — must stay narrow ("removes a Debuff") so it doesn't capture
  shield/buff-strip phrasings.
- **Ravager inflictor-side emission** — ensure the resist event reaches the inflictor without
  double-firing the existing resister-side reaction.
