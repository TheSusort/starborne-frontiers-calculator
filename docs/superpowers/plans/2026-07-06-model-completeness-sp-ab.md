# Model-completeness SP-A + SP-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 5 real-gap `it.fails` probes owned by SP-A (Malvex, Voron-reduction) and SP-B (Paracelsus, Ravager, Nosorog) in `modelCompletenessTriage.test.ts`, faithfully — zero real-gap allowlist deferrals for these ships.

**Architecture:** Each gap is an independent change on the skill-parse → `buildShipAbilities` → combat-engine pipeline. Two need new engine consumption (Malvex's `self-shielded` incoming-condition, Ravager's inflictor-side reactive trigger); the rest are parser/build-branch additions reusing live infrastructure. Acceptance per gap = flip its `it.fails` → `it`. New reactive triggers additionally get a team-symmetry integration test (a ship acts identically on either side).

**Tech Stack:** TypeScript, Vitest. Skill text parsed in `src/utils/skillTextParser.ts` and `src/utils/abilities/buildShipAbilities.ts`; abilities typed in `src/types/abilities.ts`; combat engine in `src/utils/combat/`.

## Global Constraints

- **Parser truth = `docs/ship-skills.csv`**, verbatim. All probe text constants in `modelCompletenessTriage.test.ts` are already copied byte-identical; do NOT alter them.
- **Each PR flips exactly its own probe(s)** `it.fails` → `it`; no other triage probe changes state.
- **The full test suite must stay green** at the end of each task (`npm test`). The husky pre-commit hook runs `vitest --run`.
- **Percentage stats are integers** (crit: 70 not 0.70) — not directly relevant here but holds for any buff fixtures.
- **Team symmetry:** any new reactive trigger must fire identically whether the ship is player-side or enemy-side (engine-team-symmetry rule).
- **`.env` must exist in the worktree** before running the full suite (gitignored; ~14 `.tsx` tests fail to collect without it) — `cp` it from the main repo if working in a fresh worktree.
- The four PRs are mutually independent (different ships, different seams) and MAY be executed in parallel worktrees. Ordering below (trivial → Paracelsus → Ravager → Malvex) is by ascending invasiveness, not dependency.

---

## Task 1 (PR-trivial): Voron DoT reduction + Nosorog cleanse-verb widen

Two parser-only widenings, grouped into one PR (both trivial, no engine change).

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` — `parseIncomingDamageReductionPhrasings` (function at `:728-786`); add a Voron branch.
- Modify: `src/utils/skillTextParser.ts:1068-1069` — widen `OWN_CLEANSE_TRIGGER_RE` (Nosorog).
- Test: `src/utils/abilities/__tests__/modelCompletenessTriage.test.ts` — flip the Voron probe (`:76-95`) and the Nosorog probe (`:191-205`).
- Modify: `scripts/auditSkills.allowlist.ts` — remove the Voron `incoming-damage-reduction` entry (`:139-143`) and the Nosorog `ungated-effect-with-trigger` entry (`:39-43`). KEEP the Nosorog `damage-reflection` entry (`:123-127`, harness FP).
- Modify: `src/constants/changelog.ts` — `UNRELEASED_CHANGES`.

**Interfaces:**
- Consumes: `ParsedIncomingDamageReduction` (`buildShipAbilities.ts:700-706`), `detectReactiveTrigger` (`skillTextParser.ts:1122`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Flip both probes to failing**

In `modelCompletenessTriage.test.ts`, change the Voron probe (`:76`) from `it.fails(` to `it(` and the Nosorog probe (`:191`) from `it.fails(` to `it(`. Leave both assertion bodies unchanged (they already assert the faithful final shape).

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Voron|Nosorog"`
Expected: 2 FAIL — Voron: `expected false to be true` (no incoming-reduction built); Nosorog: `expected undefined to be 'on-own-cleanse'` (buff rides on-cast). (The SP-E Voron transform probe stays `it.fails` and green — do not touch it.)

- [ ] **Step 3: Add the Voron parser branch**

In `buildShipAbilities.ts`, inside `parseIncomingDamageReductionPhrasings`, after the `tormenterM` block (`:783`) and before `return out;` (`:785`):

```ts
    // Voron: "This Unit takes N% less damage from Damage over Time effects" — a flat
    // reduction against the unit's OWN incoming DoT ticks. scope:'dot' + condition:'always'
    // are both existing type-valid values (Tormenter uses the same pair via hpScaling).
    const voronM =
        /takes\s+(\d+(?:\.\d+)?)%\s+less\s+damage\s+from\s+damage\s+over\s+time\s+effects/i.exec(
            plain
        );
    if (voronM) {
        out.push({
            scopes: ['dot'],
            condition: 'always',
            pct: parseFloat(voronM[1]),
            matchIndex: voronM.index,
        });
    }
```

- [ ] **Step 4: Widen `OWN_CLEANSE_TRIGGER_RE` for Nosorog**

In `skillTextParser.ts:1068-1069`, replace the regex with one that also matches "removes a Debuff" (scoped to that exact phrase — NOT bare "removes", which also strips shields/buffs):

```ts
const OWN_CLEANSE_TRIGGER_RE =
    /\b(?:when\s+this\s+unit\s+cleanses\s+a\s+debuff|(?:when|upon)\s+cleansing\s+a\s+debuff|when\s+this\s+unit\s+removes\s+a\s+debuff)\b/i;
```

Also append to the doc comment above it (`:1058-1067`) a note that Nosorog's "removes a Debuff" phrasing is now covered.

- [ ] **Step 5: Run to verify both pass**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Voron|Nosorog"`
Expected: 2 PASS (the Voron reduction row and the Nosorog row). The Voron SP-E transform probe still `it.fails`-green.

- [ ] **Step 6: Remove the two allowlist entries and confirm audit clean**

Delete the Voron `incoming-damage-reduction` object (`scripts/auditSkills.allowlist.ts:139-143`) and the Nosorog `ungated-effect-with-trigger` object (`:39-43`). Do NOT touch the Nosorog `damage-reflection` object (`:123-127`).

Run: `npm run audit:skills`
Expected: 0 findings. (If Nosorog or Voron re-flags, restore only the re-flagging entry and note why in the PR — but per triage both should clear.)

- [ ] **Step 7: Add changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES`:
- "Voron now correctly takes 20% less damage from Damage-over-Time effects."
- "Nosorog's Defense Up II now triggers when it removes a debuff (previously fired on every cast)."

- [ ] **Step 8: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all green, 0 warnings.

- [ ] **Step 9: Commit**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/skillTextParser.ts \
        src/utils/abilities/__tests__/modelCompletenessTriage.test.ts \
        scripts/auditSkills.allowlist.ts src/constants/changelog.ts
git commit -m "fix(skills): Voron DoT reduction + Nosorog removes-debuff cleanse trigger"
```

---

## Task 2 (PR-B1): Paracelsus on-destroyed retaliation + ally-buff

Compose the existing `on-destroyed` trigger with the existing `hpBasisPct` config, and route both halves of the clause.

**Files:**
- Modify: `src/utils/skillTextParser.ts` — widen `KILLED_BY_DIRECT_RE` (`:1920`); add a `parseKilledByDirectHpDamage` parser (mirror `parseOnResistHpDamage` at `:378-386`); add a `KILLED_BY_DIRECT_RE` rule to `detectReactiveTrigger` (`:1122-1168`) so the ally-buff routes onto `on-destroyed`.
- Modify: `src/utils/abilities/buildShipAbilities.ts` — add a build block (mirror the Vindicator on-resist block at `:1136-1163`) emitting the retaliation damage on `on-destroyed`; import the new parser (`:28` import group).
- Test: `modelCompletenessTriage.test.ts` — flip Paracelsus probe (`:103-121`), add a 2nd assertion for the ally-buff.
- Test (integration): `src/utils/combat/__tests__/paracelsusOnDestroyed.integration.test.ts` (create).
- Modify: `scripts/auditSkills.allowlist.ts` — remove Paracelsus `ungated-effect-with-trigger` (`:34-38`).
- Modify: `src/constants/changelog.ts`.

**Interfaces:**
- Consumes: `phrasePosTrigger` / `detectKilledByDirectDamageTrigger` pattern (`skillTextParser.ts:1928-1933`); the `on-destroyed` live trigger (`abilities.ts:82`, `:179`) — already bound in the reactive registry.
- Produces: `parseKilledByDirectHpDamage(text: string | null | undefined): { pct: number } | null`.

- [ ] **Step 1: Flip + extend the probe**

In `modelCompletenessTriage.test.ts`, change the Paracelsus probe (`:103`) from `it.fails(` to `it(`. Keep the existing assertion (retaliation) and add a second assertion for the ally-buff below it:

```ts
            // Retaliation: on-destroyed HP-scaled damage.
            expect(
                abilities.some(
                    (a) =>
                        a.trigger === 'on-destroyed' &&
                        a.config.type === 'damage' &&
                        a.config.hpBasisPct != null
                )
            ).toBe(true);
            // Ally-buff half: Everliving Regeneration II must also fire on-destroyed
            // (was wrongly on-cast). Fixed together per the epic's faithfulness goal.
            const regen = abilities.find(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Everliving Regeneration II'
            );
            expect(regen?.trigger).toBe('on-destroyed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Paracelsus"`
Expected: FAIL on the first assertion (`expected false to be true` — no retaliation ability built).

- [ ] **Step 3: Widen `KILLED_BY_DIRECT_RE`**

In `skillTextParser.ts:1920`, widen to also match "upon being killed by direct damage":

```ts
const KILLED_BY_DIRECT_RE = /\b(?:when|upon\s+being)\s+killed\s+by\s+direct\b[^.;]*\bdamage\b/i;
```

(Faust's "when killed by direct Damage" still matches — the alternation only adds a case.)

- [ ] **Step 4: Add the retaliation-damage parser**

In `skillTextParser.ts`, after `parseOnResistHpDamage` (`:386`), add:

```ts
/**
 * "Upon being killed by direct Damage, this Unit deals Damage equal to N% of its max HP"
 * — Paracelsus on-destroyed HP-scaled retaliation. Mirrors parseOnResistHpDamage; the amount
 * rides hpBasisPct (multiplier:0), executed by the reactive-damage executor on on-destroyed.
 */
export function parseKilledByDirectHpDamage(text: string | null | undefined): { pct: number } | null {
    if (!text) return null;
    const re =
        /(?:when|upon\s+being)\s+killed\s+by\s+direct\s+damage\b[^.]*?<unit-damage>(?:damage\s+equal\s+to\s+)?(\d+(?:\.\d+)?)%[^<]*<\/unit-damage>\s*of\s+(?:its|this\s+unit'?s)\s+max\s+hp/i;
    const m = re.exec(text);
    if (!m) return null;
    const pct = parseFloat(m[1]);
    return isNaN(pct) ? null : { pct };
}
```

- [ ] **Step 5: Route the ally-buff onto on-destroyed**

In `skillTextParser.ts`, inside `detectReactiveTrigger`, add a rule BEFORE `return undefined;` (`:1168`). Place it after the `APPLYING_DEBUFF_RE` line (`:1167`):

```ts
    // Paracelsus: "Upon being killed by direct Damage … grants allies <buff>" — the named-buff
    // half of an on-destroyed clause. Mirrors Faust's detectKilledByDirectDamageTrigger (which
    // routes the purge half); here the buffName-scoped clause carries the same phrase.
    if (KILLED_BY_DIRECT_RE.test(clause)) return 'on-destroyed';
```

- [ ] **Step 6: Build the retaliation ability**

In `buildShipAbilities.ts`, import `parseKilledByDirectHpDamage` in the `skillTextParser` import group (near `:28`). Then, immediately after the Vindicator on-resist block (`:1163`, still inside `if (slot === 'passive') {`), add:

```ts
        // Paracelsus p2: "Upon being killed by direct Damage, this Unit deals Damage equal to
        // N% of its max HP." on-destroyed HP-scaled retaliation — composes the existing
        // on-destroyed trigger with hpBasisPct (multiplier:0), same executor shape as Vindicator.
        const onKilled = parseKilledByDirectHpDamage(text);
        if (onKilled) {
            const onKilledIdx = text.search(/<unit-damage>/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-destroyed',
                    conditions: [],
                    config: {
                        type: 'damage',
                        multiplier: 0,
                        hits: 1,
                        hpBasisPct: onKilled.pct,
                    },
                    autoFilled: true,
                },
                pos: onKilledIdx >= 0 ? onKilledIdx : MAX_POS,
            });
        }
```

- [ ] **Step 7: Run to verify the probe passes**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Paracelsus"`
Expected: PASS (both assertions — retaliation builds on-destroyed, Everliving Regen II routes on-destroyed). Also confirm Faust still green: `-t "Faust"` → PASS.

- [ ] **Step 8: Write the team-symmetry integration test**

Create `src/utils/combat/__tests__/paracelsusOnDestroyed.integration.test.ts`. Mirror an existing positional two-team integration test (template: `src/utils/combat/__tests__/enemyChargedCast.integration.test.ts` for `simulateBattle` setup). Assert: when a Paracelsus is killed by direct damage, (a) an enemy takes HP-scaled retaliation damage, and (b) allies receive Everliving Regeneration II — and that BOTH hold whether Paracelsus is on the player side OR the enemy side (two `simulateBattle` runs, sides swapped). If the on-destroyed executor does not run `type:'damage'` abilities, wire it in the reactive-damage executor (surface this in the PR description) — the executor already handles Vindicator's on-debuff-resisted HP-scaled damage, so the same path should apply.

- [ ] **Step 9: Run the integration test**

Run: `npx vitest run src/utils/combat/__tests__/paracelsusOnDestroyed.integration.test.ts`
Expected: PASS both sides.

- [ ] **Step 10: Remove allowlist entry + audit**

Delete the Paracelsus `ungated-effect-with-trigger` object (`scripts/auditSkills.allowlist.ts:34-38`).
Run: `npm run audit:skills`
Expected: 0 findings.

- [ ] **Step 11: Changelog**

Add to `UNRELEASED_CHANGES`: "Paracelsus now retaliates for 50% of its max HP and grants allies Everliving Regeneration II when killed by direct damage (previously the regen buff fired on every cast and the retaliation was missing)."

- [ ] **Step 12: Full suite + lint + commit**

Run: `npm test && npm run lint`
Expected: green, 0 warnings.

```bash
git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts \
        src/utils/abilities/__tests__/modelCompletenessTriage.test.ts \
        src/utils/combat/__tests__/paracelsusOnDestroyed.integration.test.ts \
        scripts/auditSkills.allowlist.ts src/constants/changelog.ts
git commit -m "feat(combat): Paracelsus on-destroyed retaliation + ally-buff routing"
```

---

## Task 3 (PR-B2): Ravager inflictor-side `on-own-debuff-resisted` trigger

New trigger literal + reactive-listener case + parser rule. No new event emission — the existing `debuff-resisted` bus event already carries the inflictor as `sourceId`.

**Files:**
- Modify: `src/types/abilities.ts` — add `'on-own-debuff-resisted'` to the `AbilityTrigger` union (`:62-150`) and to `LIVE_TRIGGERS` (`:160-205`).
- Modify: `src/utils/combat/triggers.ts` — add a `case 'on-own-debuff-resisted':` in the `registerReactiveListeners` switch (`:329+`), mirroring the `on-debuff-resisted` case (`:587-608`) but filtering `sourceId`.
- Modify: `src/utils/skillTextParser.ts` — add a `DEBUFF_RESISTED_RE` const + a rule in `detectReactiveTrigger` (`:1122-1168`).
- Test: `modelCompletenessTriage.test.ts` — flip Ravager probe (`:171-185`), strengthen the assertion.
- Test (integration): `src/utils/combat/__tests__/ravagerResistReaction.integration.test.ts` (create).
- Modify: `scripts/auditSkills.allowlist.ts` — remove Ravager `ungated-effect-with-trigger` (`:24-28`).
- Modify: `src/constants/changelog.ts`.

**Interfaces:**
- Consumes: the `debuff-resisted` bus event (`events.ts:98-106`, `{sourceId?, targetId, round, buffName}` — `sourceId`=inflictor, `targetId`=resister); the `on-debuff-resisted` listener template (`triggers.ts:587-608`); `detectReactiveTrigger` buff-name routing (`buildShipAbilities.ts:2324`).
- Produces: the `'on-own-debuff-resisted'` trigger literal (consumed only within this task).

- [ ] **Step 1: Flip + strengthen the probe**

In `modelCompletenessTriage.test.ts`, change the Ravager probe (`:171`) from `it.fails(` to `it(` and strengthen the assertion (`:183`) from `.not.toBe('on-cast')` to the exact trigger:

```ts
            expect(effect?.trigger).toBe('on-own-debuff-resisted');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Ravager"`
Expected: FAIL (`expected 'on-cast' to be 'on-own-debuff-resisted'`).

- [ ] **Step 3: Add the trigger literal**

In `src/types/abilities.ts`, add to the `AbilityTrigger` union (`:62-150`), directly after the `'on-debuff-resisted'` line (`:141`):

```ts
    // Fires when a debuff THIS unit inflicted is RESISTED by its target (inflictor-scoped on
    // sourceId === ownerId). Mirror of on-debuff-resisted (resister-scoped). Ravager's Hacking
    // Module Overdrive grant.
    | 'on-own-debuff-resisted'
```

And add `'on-own-debuff-resisted'` to the `LIVE_TRIGGERS` set (`:160-205`), next to `'on-debuff-resisted'` (`:200`).

- [ ] **Step 4: Add the reactive-listener case**

In `src/utils/combat/triggers.ts`, in the `registerReactiveListeners` switch (`:329+`), add a case immediately after the `on-debuff-resisted` case (`:587-608`), mirroring it but filtering the INFLICTOR side and routing back to the resister:

```ts
                case 'on-own-debuff-resisted':
                    bus.on('debuff-resisted', (e) => {
                        if (e.sourceId !== ownerId) return; // inflictor-scoped (the mirror)
                        enqueue(
                            e.targetId !== undefined
                                ? {
                                      ...intent,
                                      eventCtx: { ...intent.eventCtx, counterTargetId: e.targetId },
                                  }
                                : intent
                        );
                    });
                    break;
```

- [ ] **Step 5: Add the parser rule**

In `skillTextParser.ts`, near the other reactive-trigger regexes (after `APPLYING_DEBUFF_RE` at `:1088`), add:

```ts
// "If its debuff is resisted" — Ravager's INFLICTOR-side reaction (the debuff THIS unit
// inflicted got resisted). Distinct from the resister-side "when this Unit resists a debuff"
// (parseOnResistHpDamage). Corpus-verified: Ravager is the only "its debuff is resisted" row.
const OWN_DEBUFF_RESISTED_RE = /\bits\s+debuff\s+is\s+resisted\b/i;
```

Then add a rule in `detectReactiveTrigger`, before `return undefined;` (`:1168`):

```ts
    // Ravager: "If its debuff is resisted, it gains <buff>" — inflictor-side reaction.
    if (OWN_DEBUFF_RESISTED_RE.test(clause)) return 'on-own-debuff-resisted';
```

- [ ] **Step 6: Run to verify the probe passes**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Ravager"`
Expected: PASS (Hacking Module Overdrive routes onto `on-own-debuff-resisted`).

- [ ] **Step 7: Team-symmetry integration test**

Create `src/utils/combat/__tests__/ravagerResistReaction.integration.test.ts`. In a positional two-team `simulateBattle` (template: `enemyChargedCast.integration.test.ts`), give an enemy high debuff-resistance so Ravager's inflicted debuff is resisted, and assert a `buff` combat-log entry for "Hacking Module Overdrive" appears for Ravager. Assert it fires whether Ravager is player-side OR enemy-side (two runs, sides swapped). This also proves the listener case is reached (an unwired trigger would partition as reactive but never fire — see triggers.ts:184).

- [ ] **Step 8: Run the integration test**

Run: `npx vitest run src/utils/combat/__tests__/ravagerResistReaction.integration.test.ts`
Expected: PASS both sides.

- [ ] **Step 9: Remove allowlist entry + audit**

Delete the Ravager `ungated-effect-with-trigger` object (`scripts/auditSkills.allowlist.ts:24-28`).
Run: `npm run audit:skills`
Expected: 0 findings.

- [ ] **Step 10: Changelog**

Add to `UNRELEASED_CHANGES`: "Ravager now gains Hacking Module Overdrive when a debuff it inflicts is resisted (previously the buff was granted on every cast)."

- [ ] **Step 11: Full suite + lint + commit**

Run: `npm test && npm run lint`
Expected: green, 0 warnings.

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/skillTextParser.ts \
        src/utils/abilities/__tests__/modelCompletenessTriage.test.ts \
        src/utils/combat/__tests__/ravagerResistReaction.integration.test.ts \
        scripts/auditSkills.allowlist.ts src/constants/changelog.ts
git commit -m "feat(combat): Ravager on-own-debuff-resisted inflictor-side trigger"
```

---

## Task 4 (PR-A): Malvex `self-shielded` incoming-reduction

New `IncomingCondition` literal with full engine consumption. This is the most invasive task — the per-hit condition is context-driven, so every `IncomingHitContext` build site must populate the new field (the TypeScript compiler enforces this since the field is required).

**Files:**
- Modify: `src/types/abilities.ts` — add `'self-shielded'` to `IncomingCondition` (`:319-337`); add `victimHasShield: boolean` to `IncomingHitContext` (`:340-361`).
- Modify: `src/utils/combat/incomingEffects.ts:4-25` — add the `case 'self-shielded'` to `conditionMet`.
- Modify: `src/utils/combat/engine.ts` — add a `hasShield(actorId)` helper (mirror `hasBarrierRecharging` at `:2743-2744`); populate `victimHasShield` at every ctx build site (`:3196-3199`, `:3553-3556`, `:4145-4148`, `:4536` block, `:5298-5300`, `:5373-5375`, `:6318-6320`, `:6330-6332`).
- Modify: `src/utils/abilities/buildShipAbilities.ts` — add a Malvex branch in `parseIncomingDamageReductionPhrasings` (`:728-786`).
- Test: `modelCompletenessTriage.test.ts` — flip Malvex probe (`:55-69`), strengthen the assertion.
- Test (integration): `src/utils/combat/__tests__/malvexShieldedReduction.integration.test.ts` (create).
- Modify: `scripts/auditSkills.allowlist.ts` — remove Malvex `incoming-damage-reduction` (`:135-138`).
- Modify: `src/constants/changelog.ts`.

**Interfaces:**
- Consumes: `conditionMet(cond, ctx)` (`incomingEffects.ts:4-25`); `CombatActor.shieldPool` (`state.ts:119`, live absorption pool — "has shield" = `> 0`; do NOT use `ActorHealing.shield` at `state.ts:29`); `hasBarrierRecharging` helper precedent (`engine.ts:2743-2744`); `ParsedIncomingDamageReduction` (`buildShipAbilities.ts:700-706`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Flip + strengthen the probe**

In `modelCompletenessTriage.test.ts`, change the Malvex probe (`:55`) from `it.fails(` to `it(` and strengthen the assertion (`:63-67`) to check the condition, not just the type:

```ts
            expect(
                abilities.some(
                    (a) =>
                        a.type === 'incoming-reduction' &&
                        a.config.type === 'incoming-reduction' &&
                        a.config.condition === 'self-shielded'
                )
            ).toBe(true);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Malvex"`
Expected: FAIL (`expected false to be true` — no incoming-reduction built for the "When Shielded" clause).

- [ ] **Step 3: Add the `self-shielded` literal + context field**

In `src/types/abilities.ts`, add `'self-shielded'` to the `IncomingCondition` union (`:319-337`), after `'self-barrier-recharging'`. Then add a required field to `IncomingHitContext` (`:340-361`), mirroring `victimHasBarrierRecharging` (`:353-355`):

```ts
    /** Victim currently holds an active shield pool (shieldPool > 0) — gates self-shielded. */
    victimHasShield: boolean;
```

- [ ] **Step 4: Add the evaluator case**

In `src/utils/combat/incomingEffects.ts`, in the `conditionMet` switch (`:4-25`), add next to the `'self-barrier-recharging'` case:

```ts
        case 'self-shielded':
            return ctx.victimHasShield;
```

- [ ] **Step 5: Run typecheck to enumerate the ctx build sites**

Run: `npx tsc --noEmit`
Expected: FAIL — one "Property 'victimHasShield' is missing" error per `IncomingHitContext` literal in `engine.ts`. This is the authoritative checklist for Step 6.

- [ ] **Step 6: Add the helper + populate every ctx site**

In `engine.ts`, add near `hasBarrierRecharging` (`:2743-2744`):

```ts
    const hasShield = (actorId: string): boolean =>
        (allActorsById.get(actorId)?.shieldPool ?? 0) > 0;
```

Then at each ctx build site the compiler flagged (`:3196-3199`, `:3553-3556`, `:4145-4148`, the `:4536` block, `:5298-5300`, `:5373-5375`, `:6318-6320`, `:6330-6332`), add the field next to the existing `victimHasBarrierRecharging: hasBarrierRecharging(<victimId>)`, using the SAME victim id argument:

```ts
        victimHasShield: hasShield(<victimId>),
```

(At the reflected/counter site `:3553-3556` the victim is the original attacker — use whatever id that block passes to `hasBarrierRecharging`, keeping them identical.)

Re-run `npx tsc --noEmit` until 0 errors.

- [ ] **Step 7: Add the Malvex parser branch**

In `buildShipAbilities.ts`, inside `parseIncomingDamageReductionPhrasings`, after the Voron branch from Task 1 (or after `tormenterM` if Task 1 not yet merged) and before `return out;`:

```ts
    // Malvex: "When Shielded, this Ship takes N% less damage" — a self-shield-gated flat
    // reduction. New self-shielded IncomingCondition (evaluated per-hit against the victim's
    // live shieldPool). Anchored on "when shielded" so it never matches Voron's DoT phrasing
    // or a bare "takes N% less damage".
    const malvexM =
        /when\s+shielded,?\s+this\s+(?:ship|unit)\s+takes\s+(\d+(?:\.\d+)?)%\s+less\s+damage/i.exec(
            plain
        );
    if (malvexM) {
        out.push({
            scopes: ['direct'],
            condition: 'self-shielded',
            pct: parseFloat(malvexM[1]),
            matchIndex: malvexM.index,
        });
    }
```

- [ ] **Step 8: Run to verify the probe passes**

Run: `npx vitest run src/utils/abilities/__tests__/modelCompletenessTriage.test.ts -t "Malvex"`
Expected: PASS (incoming-reduction with `condition: 'self-shielded'` builds).

- [ ] **Step 9: Team-symmetry integration test**

Create `src/utils/combat/__tests__/malvexShieldedReduction.integration.test.ts`. In a positional two-team `simulateBattle`, give Malvex a shield and assert an incoming hit is reduced by 10% WHILE shielded and NOT reduced once the shield is gone — and that this holds whether Malvex is player-side OR enemy-side (confirms `conditionMet` is context-driven, not side-gated). Template: any existing `incomingEffects`/reduction integration test, or `enemyChargedCast.integration.test.ts` for the two-team harness.

- [ ] **Step 10: Run the integration test**

Run: `npx vitest run src/utils/combat/__tests__/malvexShieldedReduction.integration.test.ts`
Expected: PASS both sides.

- [ ] **Step 11: Remove allowlist entry + audit**

Delete the Malvex `incoming-damage-reduction` object (`scripts/auditSkills.allowlist.ts:135-138`).
Run: `npm run audit:skills`
Expected: 0 findings.

- [ ] **Step 12: Changelog**

Add to `UNRELEASED_CHANGES`: "Malvex now takes 10% less damage while it has an active shield."

- [ ] **Step 13: Full suite + lint + commit**

Run: `npm test && npm run lint`
Expected: green, 0 warnings.

```bash
git add src/types/abilities.ts src/utils/combat/incomingEffects.ts src/utils/combat/engine.ts \
        src/utils/abilities/buildShipAbilities.ts \
        src/utils/abilities/__tests__/modelCompletenessTriage.test.ts \
        src/utils/combat/__tests__/malvexShieldedReduction.integration.test.ts \
        scripts/auditSkills.allowlist.ts src/constants/changelog.ts
git commit -m "feat(combat): Malvex self-shielded incoming damage reduction"
```

---

## Cleanup on epic completion (after all 4 PRs merge)

- Confirm `npm run audit:skills` is at 0 findings with all five entries removed (Ravager, Paracelsus, Nosorog-`ungated`, Malvex, Voron). The Nosorog `damage-reflection` (harness FP) entry stays.
- Update `project_model_completeness_epic.md` memory: SP-A + SP-B ✅ MERGED; next = C ∥ D.

## Self-review notes

- **Spec coverage:** all 5 gaps have a task (Malvex T4, Voron T1, Paracelsus T2, Ravager T3, Nosorog T1); allowlist removal + changelog per task; team-symmetry integration tests for the 3 engine-touching gaps (Malvex, Paracelsus, Ravager); Voron/Nosorog need none (no engine change).
- **Type consistency:** `parseKilledByDirectHpDamage` return `{pct}` matches its consumer in T2 Step 6; `victimHasShield` field name is identical across T4 Steps 3/4/6; `'self-shielded'` / `'on-own-debuff-resisted'` literals are spelled identically at every use.
- **Voron↔Task-ordering:** Task 1's Voron branch and Task 4's Malvex branch both edit `parseIncomingDamageReductionPhrasings`; if run in parallel worktrees they touch adjacent lines — trivial merge, but the second-merged PR should re-run `npm test` after rebase.
