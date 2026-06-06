# Ally-Crit-DoT Reactive + Parser Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Crocus's "ally inflicts a DoT with a critical hit" mechanic live (new reactive trigger `on-ally-crit-dot`) and guard three parser false-positives (Morao heal, Valkyrie burst-reference, Vindicator/Paracelsus reactive procs).

**Architecture:** `dot-applied` gains an additive `viaCrit` flag emitted from the applier's turn (critHits already in scope). A new live trigger mirrors `on-ally-debuff-inflicted`'s ally-scoped listener; execution is free (the Phase-3 executor already handles dot intents; reactive partitioning is slot-agnostic). The parser reroutes Crocus's shape from a manual condition to the trigger, and three narrow clause-scoped guards stop the false-positive parses.

**Tech Stack:** TypeScript, Vitest, existing combat engine + parser.

**Spec:** `docs/superpowers/specs/2026-06-06-ally-crit-dot-and-parser-guards-design.md` — read first; its claims are reviewer-verified against the code.

---

## Project conventions (binding)

- Pre-commit hook runs full suite (~2 min); **NEVER `--no-verify`** for code commits (docs-only commits may).
- Golden suite `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (21 scenarios) = referee. **ZERO churn**; NEVER `vitest -u`; new scenarios self-write then get hand-verified.
- No RegExp lookbehind in src/. ESLint zero warnings. No `'attacker'` literals in engine core.
- Changelog: edit the ONE evolving DPS entry in `UNRELEASED_CHANGES` in place.
- docs/ is gitignored — `git add -f`.

---

### Task 0: Branch

- [ ] `git checkout main && git pull && git checkout -b feat/combat-engine-ally-crit-dot`
- [ ] Commit this plan + spec are already on main; nothing to do.

---

### Task 1: `viaCrit` on the dot-applied event

**Files:**
- Modify: `src/utils/combat/events.ts` (dot-applied variant)
- Modify: `src/utils/combat/playerTurn.ts:1160-1172` (the `emitDotApplied` callback inside the `applyNewDoTs` call)
- Test: `src/utils/combat/__tests__/allyCritDot.test.ts` (create)

- [ ] **Step 1.1: Failing test.** Create the test file. Reuse the `ab`/BASE/bus-tap patterns from `src/utils/combat/__tests__/extraActions.test.ts` (read it first). Tests:

1. A single-hit active with a dot ability at **crit 100** → every `dot-applied` event carries `viaCrit: true`.
2. Same at **crit 0** → no `dot-applied` event carries `viaCrit` (field absent, not false).
3. An executor-applied dot (reactive dot follow-up — e.g. a `start-of-round`-triggered dot ability) emits `dot-applied` WITHOUT `viaCrit` (read the executor's emission at `triggers.ts:484-491` — it needs NO change; assert the deliberate omission).

- [ ] **Step 1.2:** Run → events lack the field → assertions on `viaCrit: true` FAIL.

- [ ] **Step 1.3: events.ts** — in the `dot-applied` variant add:

```ts
          /** The applying cast had >= 1 critting hit (per-hit crits). Present only when
           *  true. Executor-applied dots omit it (drain-time has no crit outcome). */
          viaCrit?: boolean;
```

- [ ] **Step 1.4: playerTurn.ts** — the emission site (~line 1160):

```ts
            emitDotApplied: (dotType, stacks) =>
                bus.emit({
                    type: 'dot-applied',
                    sourceId: actor.id,
                    targetId: enemy.id,
                    round: r,          // ← keep the existing field names exactly
                    dotType,
                    stacks,
                    ...(critHits > 0 ? { viaCrit: true } : {}),
                }),
```

(Adapt to the EXACT existing emit shape — read it; only the conditional spread is new. `critHits` is in scope from the per-hit draw block.)

- [ ] **Step 1.5:** Run new tests (PASS) + `npx vitest run src/utils/combat/ src/utils/calculators/` — zero golden churn (`git diff --stat -- "*.snap"` clean; events aren't snapshotted).

- [ ] **Step 1.6: Commit** — `git add src/utils/combat/events.ts src/utils/combat/playerTurn.ts src/utils/combat/__tests__/allyCritDot.test.ts && git commit -m "feat: dot-applied events carry viaCrit when the applying cast crit"`

---

### Task 2: `on-ally-crit-dot` trigger + listener

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union ~line 30, LIVE_TRIGGERS ~line 50)
- Modify: `src/utils/combat/triggers.ts` (registerReactiveListeners switch ~line 127; JSDoc bullet list ~line 98)
- Modify: `src/components/skills/AbilityCard.tsx:98-108` (TRIGGER_OPTIONS)
- Test: `src/utils/combat/__tests__/triggers.test.ts` (extend, following its listener-test pattern) and/or `allyCritDot.test.ts`

- [ ] **Step 2.1: Failing test.** NOTE: `triggers.test.ts` uses a full `runCombat` + bus-tap pattern, NOT a fake-bus/spy pattern — do NOT expect to find a spy scaffold there. Write a NEW direct unit test (in `allyCritDot.test.ts`) that calls `registerReactiveListeners` with a hand-rolled bus and an `enqueue` array — scaffold from scratch (it's ~20 lines: a Map-of-listeners bus like `perHitCrit.test.ts`'s tap, perOwner with one owner carrying the reactive dot ability, then emit synthetic `dot-applied` events). Register an owner with a reactive `dot` ability `trigger: 'on-ally-crit-dot'`; emit `dot-applied` events and assert:
  - `sourceId: otherPlayerId, viaCrit: true` → 1 enqueue
  - `sourceId: ownerId, viaCrit: true` → 0 (own casts excluded)
  - `sourceId: enemyId, viaCrit: true` → 0
  - `sourceId: otherPlayerId` without viaCrit → 0
- [ ] **Step 2.2:** Run → FAIL (trigger not in union/live set; listener case missing).
- [ ] **Step 2.3: types/abilities.ts:**

```ts
    | 'on-ally-crit-dot'    // in AbilityTrigger, after 'on-ally-debuff-inflicted'
```

and add `'on-ally-crit-dot'` to `LIVE_TRIGGERS`.

- [ ] **Step 2.4: triggers.ts** — new case in `registerReactiveListeners` (after `on-ally-debuff-inflicted`):

```ts
                case 'on-ally-crit-dot':
                    bus.on('dot-applied', (e) => {
                        // Ally DoT infliction whose cast crit (viaCrit): any OTHER
                        // player's crit-cast DoT. Own casts and the enemy are excluded
                        // (mirrors on-ally-debuff-inflicted's ally scoping). One enqueue
                        // per qualifying infliction EVENT (per-infliction-event rule).
                        if (e.viaCrit && e.sourceId !== ownerId && e.sourceId !== enemyId) {
                            enqueue(intent);
                        }
                    });
                    break;
```

Update the JSDoc bullet list (~line 98) with a matching `on-ally-crit-dot` line. `dot` is already in `REACTIVE_ABILITY_TYPES` — verify, change nothing.

- [ ] **Step 2.5: AbilityCard.tsx TRIGGER_OPTIONS** — add after the ally-debuff entry:

```ts
    { value: 'on-ally-crit-dot', label: 'After an ally inflicts a DoT with a crit' },
```

- [ ] **Step 2.6:** Run triggers tests + components tests + goldens — all green, zero churn. `npm run lint` clean.
- [ ] **Step 2.7: Commit** — `git add -A src/types src/utils/combat src/components/skills && git commit -m "feat: on-ally-crit-dot live reactive trigger (ally-scoped viaCrit dot-applied listener)"`

---

### Task 3: Parser reroute (Crocus)

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts:675-701` (the `parseAllyCritDot` block)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 3.1: Failing test** — Crocus second passive (real CSV text):

```ts
    it('Crocus ally-crit-DoT passive parses as a reactive on-ally-crit-dot dot ability', () => {
        const ship = makeShip({
            refits: [1, 2],
            secondPassiveSkillText:
                'When another ally inflicts a Damage Over Time (DoT) effect with a critical hit, this Unit <unit-damage>repairs itself for 3%</unit-damage> of its Max HP and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on that enemy.',
        });
        const skills = buildShipAbilities(ship);
        const passive = skills.slots.find((s) => s.slot === 'passive');
        const dot = passive?.abilities.find((a) => a.type === 'dot');
        expect(dot).toMatchObject({
            trigger: 'on-ally-crit-dot',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', duration: 2 },
        });
    });
```

(The file's fixture helper is named `ship()`, not `makeShip` — adapt. Its default is 4 refits; this test must override with a 2-element refits array → Passive R2, matching the live ship.)

- [ ] **Step 3.2:** Run → FAIL (trigger on-cast + ally-crit-dot condition today).
- [ ] **Step 3.3: buildShipAbilities.ts** — in the `parseAllyCritDot(text)` block, change the pushed ability to:

```ts
                    trigger: 'on-ally-crit-dot',
                    conditions: [],
```

and update the block comment: the shape now routes through the reactive machinery (live since this increment); note the manual `ally-crit-dot` ConditionSubject survives in the union for stored editor configs only (it was annotation-only and never simulated — no migration needed; a stored on-cast dot with that condition behaves exactly as before).

- [ ] **Step 3.3b: Editor warning carve-out.** `AbilityCard.tsx` (~line 600) shows the `PASSIVE_NOOP_WARNING` ("not simulated on the passive slot") for `slot === 'passive' && PASSIVE_NOOP_TYPES.has(ability.type)` — Crocus's reactive dot would still show it, which is now WRONG (reactive abilities are slot-agnostic). Add a live-trigger carve-out: suppress the warning when `LIVE_TRIGGERS.has(ability.trigger)` (the ability fires through the trigger machinery regardless of slot). Add a small component test (passive dot with on-ally-crit-dot → no warning; passive dot with on-cast → warning stays).

- [ ] **Step 3.4:** Run buildShipAbilities tests + goldens — green, zero churn. ALSO run `npm run audit:skills` and spot-check the Crocus rows (the report should show the dot under a reactive trigger; counts may shift by classification, which is expected — record the before/after line in the commit message).
- [ ] **Step 3.5: Commit** — `git add src/utils/abilities && git commit -m "feat: Crocus ally-crit-DoT routes through the on-ally-crit-dot reactive trigger"`

---

### Task 4: Parser false-positive guards

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`parseSecondaryDamage` ~line 190, `parseAccumulateDetonate` ~line 813)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 4.1: Failing tests** (real CSV texts):

```ts
describe('parser false-positive guards', () => {
    it('heal "additional X% of Max HP" is not secondary damage (Morao p2)', () => {
        expect(
            parseSecondaryDamage(
                'This Unit <unit-damage>repairs 5%</unit-damage> of its Max HP every turn and, upon <unit-aid>Cleansing a</unit-aid> Debuff, repairs an additional <unit-damage>5%</unit-damage> of its Max HP while gaining <unit-skill>Defense Up II</unit-skill> for 2 turns.'
            )
        ).toBeNull();
    });

    it('on-resist proc is not secondary damage (Vindicator p2)', () => {
        expect(
            parseSecondaryDamage(
                'This Unit has 20% Shield Penetration. At the start of combat, this Unit gains <unit-skill>Magnetized Shielding</unit-skill>.<br /><br />When this Unit resists a debuff infliction from an enemy, it deals <unit-damage>damage equal to 30%</unit-damage> of this Unit\'s max HP to that enemy.'
            )
        ).toBeNull();
    });

    it('on-death proc is not secondary damage (Paracelsus p1)', () => {
        expect(
            parseSecondaryDamage(
                'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP.'
            )
        ).toBeNull();
    });

    it('burst-explosion reference is not an accumulate-detonate application (Valkyrie p1)', () => {
        expect(
            parseAccumulateDetonate(
                'This Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn at the start of the round.<br /><br />When an <unit-aid>Echoing Burst</unit-aid> explodes on an enemy, this Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of damage dealt.'
            )
        ).toBeNull();
    });

    // Regression locks — existing legitimate parses keep working:
    it('regression: defense secondary still parses (Chakara active)', () => {
        expect(
            parseSecondaryDamage(
                'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.'
            )
        ).toEqual({ stat: 'defense', pct: 80 });
    });

    it('regression: Echoing Burst infliction still parses (Valkyrie charged)', () => {
        expect(
            parseAccumulateDetonate(
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>, deals <unit-damage>240% damage</unit-damage>, and inflicts <unit-skill>Inc. Damage Up II</unit-skill> and <unit-skill>Echoing Burst</unit-skill> for 2 turns."
            )
        ).toEqual({ turns: 2, pct: 100 });
    });
});
```

- [ ] **Step 4.2:** Run → the four guard tests FAIL (parsers currently match), regressions PASS.
- [ ] **Step 4.3: `parseSecondaryDamage` guard.** After `pattern.exec(text)` matches, scope to the SENTENCE containing the match and reject heal/reactive contexts. Implementation sketch (lookbehind-free; reuse the file's sentence conventions — `<br>` normalizes to '. ' like other parsers):

```ts
    const match = pattern.exec(text);
    if (!match) return null;
    // Clause guard: a match whose sentence is a heal ("repairs … an additional X% of
    // its Max HP") or a clearly-reactive Phase-4 proc ("When this Unit resists …",
    // "Upon being killed …") is NOT on-cast secondary damage. Scope to the sentence
    // so an earlier sentence's repair can't block a later legitimate secondary.
    const matchIdx = match.index;
    const plainBefore = text.slice(0, matchIdx).replace(/<br\s*\/?>/gi, '. ');
    const sentenceStart = Math.max(
        plainBefore.lastIndexOf('. '),
        plainBefore.lastIndexOf('; ')
    );
    const sentencePrefix = plainBefore.slice(sentenceStart + 1).toLowerCase();
    if (/\brepair/.test(sentencePrefix)) return null;
    if (/\bresists?\b[^.]*\bdebuff|upon being killed|upon being destroyed/.test(sentencePrefix)) {
        return null;
    }
    const pct = parseFloat(match[1]);
```

ITERATE against all 6 tests; the guard must NOT break any existing secondary-damage ship — after it passes, also run the FULL parser + abilities suites and the audit (`npm run audit:skills`) and diff the report for unexpected secondary-damage disappearances (`git diff docs/skill-audit.md` — docs/ is gitignored, so diff the regenerated file manually before/after if needed; at minimum confirm finding count is unchanged).

- [ ] **Step 4.4: `parseAccumulateDetonate` guard.** Inside the name loop, before returning, reject explosion references:

```ts
        const idx = plain.indexOf(name);
        if (idx === -1) continue;
        // Reference guard: "When an Echoing Burst explodes …" describes an EXISTING
        // burst detonating (a heal-on-burst reaction), not a fresh infliction.
        const before = plain.slice(Math.max(0, plain.lastIndexOf('. ', idx) + 1), idx);
        const after = plain.slice(idx + name.length, idx + name.length + 20);
        if (/\bwhen(?:ever)?\b[^.]*$/.test(before) || /^\s*explodes/.test(after)) continue;
```

- [ ] **Step 4.5:** All tests green; `npx vitest run src/utils/ && npm run lint` clean; goldens untouched.
- [ ] **Step 4.6: Commit** — `git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts && git commit -m "fix: parser guards — heal/reactive clauses are not secondary damage; burst-explosion references are not accumulate-detonate applications"`

---

### Task 5: Golden scenario 22 + engine integration test

**Files:**
- Modify: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
- Test: extend `src/utils/combat/__tests__/allyCritDot.test.ts`

- [ ] **Step 5.1: Integration test** (allyCritDot.test.ts): focus actor whose PASSIVE slot has a reactive dot (`trigger: 'on-ally-crit-dot'`, corrosion) + a walked team actor (`teamActors` input — mirror the fixture shape from golden scenario 19 'walked team actor', read it first) whose active applies a DoT and has **crit 100**. Assert:
  - The focus actor's corrosion entries appear (focus row `corrosionDamage > 0` / `activeCorrosionStacks` includes them) — the executor applies with the FOCUS actor's sourceId.
  - At team **crit 0**: the reactive dot never fires (no focus corrosion).
  - The trigger fires once per qualifying team cast (per-event).
- [ ] **Step 5.2: Golden scenario 22** — same shape, appended to the golden suite:

```ts
    // Scenario 22: ally-crit-DoT reactive (Crocus) — the focus actor's passive
    // corrosion fires when a walked team ally's crit-cast applies a DoT. Locks the
    // viaCrit event flag, ally scoping, and executor dot attribution. Added with the
    // ally-crit-dot increment (2026-06-06); hand-verified.
```

Fixture: BASE + focus `shipSkills` (active plain damage + passive reactive corrosion dot) + one `teamActors` entry with a DoT-applying active at a deterministic crit rate (use 100 for an unambiguous hand trace, or 50 to lock the alternation — implementer's choice, justify in the commit). Self-writes ONE new snapshot; 21 untouched.
- [ ] **Step 5.3: HAND-VERIFY** rounds 1-3: when the team actor's cast crits, a `dot-applied(viaCrit)` event fires during ITS turn → intent drains post-turn-body → the focus actor's corrosion entry lands with the focus actor's effectiveAttack/affinity (executor owner-routing) → ticks on the enemy turn into the FOCUS row's corrosionDamage. Trace the corrosion arithmetic (tier damage × stacks × the focus actor's multipliers) and the crit gate schedule. Write the trace into the commit message.
- [ ] **Step 5.4: Commit** — `git add src/utils/calculators/__tests__/ src/utils/combat/__tests__/allyCritDot.test.ts && git commit -m "test: golden scenario 22 locks ally-crit-DoT reactive flow (hand-verified)"`

---

### Task 6: Docs + changelog + audit

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 + §6), `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx` (only if it enumerates live triggers — check)

- [ ] **Step 6.1:** Coverage doc §5: the ally-crit-DoT rule with both documented approximations (any-hit-crit qualifier; once per dot-applied EVENT). §6: remove the Crocus gap entry; note Morao/Valkyrie/Vindicator/Paracelsus false-positive texts now parse clean (heal/Phase-4 content deferred by design — their entries move under the healing/Phase-4 seams).
- [ ] **Step 6.2:** Changelog: extend the ONE evolving DPS entry in place (Crocus-style "ally inflicts a DoT with a critical hit" reactions now simulated with team ships).
- [ ] **Step 6.3:** DocumentationPage: check the DPS section's trigger mentions; add the new trigger to any enumerating sentence (likely one line; skip if no enumeration exists).
- [ ] **Step 6.4:** `npm run audit:skills` — confirm 0 unexpected findings.
- [ ] **Step 6.5: Commit** — `git add src/constants/changelog.ts src/pages/DocumentationPage.tsx && git add -f docs/skill-model-coverage.md && git commit -m "docs: ally-crit-dot rules + coverage/changelog updates"`

---

### Task 7: Full verification + live check + PR

- [ ] **Step 7.1:** `npm test` (full suite green) + `npm run lint` (zero warnings).
- [ ] **Step 7.2:** Golden inventory vs main: `git diff main --stat -- "*.snap"` — pure addition (scenario 22 + any new test snapshots only).
- [ ] **Step 7.3:** Live verification WITH THE USER on localhost:3002 (reuse the running Vite instance; `evaluate_script` over snapshots; ShipSelector needs full pointerdown→click sequences): select **Crocus** as the focus ship with a DoT-applying, critting team ally configured → the passive corrosion appears in round data (corrosion stacks/damage on Crocus's rows); verify the Skill Editor shows the dot with the new trigger label.
- [ ] **Step 7.4:** Push, open PR (title `feat: ally-crit-DoT reactive trigger + parser false-positive guards`), body summarizing per the spec; standard footer. Watch CodeRabbit → triage → reply in-thread → wait for re-review → merge when clean (merge commit, branch kept).
