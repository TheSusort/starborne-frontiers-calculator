# Finite-Duration Passive Buff Aura Reclassification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the combat engine from treating finite-duration passive-slot buffs as permanent auras; apply them once at combat start as decrementing `timed` statuses that expire on their stated turn count and get wiped on death.

**Architecture:** Drop the `slot.slot === 'passive'` clause from the `isAura` classifier in `registerActorAbilityStatuses` so a numeric-duration passive buff classifies as `timed` instead of `aura`. Because the passive slot never "fires" as an action (the only `action` values are `'active' | 'charged'`), add a one-time **round-1 seeding** pass that applies each passive-sourced `timed` self-status once, onto its recipients, gated by `conditionsMet`. From there the existing timed-status lifecycle (`timedAbilityStatuses('self', …)` folding, `decrementPlayer` countdown, `clearRemovable` death-wipe, `buff-expired` event) handles everything. No-duration named buffs stay `aura` (unchanged); flat-stat `modifier` auras and Cheat Death are untouched.

**Tech Stack:** TypeScript, Vitest. All engine code under `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-09-aura-classification-finite-passive-buffs-design.md`

**Baseline / branch:** branch `fix/aura-classification-finite-passive-buffs` (already created off `main` at `95ea370d`; the spec commits `6762f64d` + `889e95a2` are already on it).

---

## Key reference points (verified against source)

- **Classifier:** `src/utils/combat/engine.ts:130-134` — the `isAura` expression with the `slot.slot === 'passive'` clause, inside `registerActorAbilityStatuses` (which only processes `cfg.type === 'buff' | 'debuff'`, guard at `engine.ts:117`).
- **Round loop:** `src/utils/combat/engine.ts:1479` (`for (let r = 1; ...)`), `beginRound(r)` at `:1482`.
- **Runtime collections (for seeding):** `runtimesById` (attacker + team) at `engine.ts:1365-1368`; `enemyPlayerRuntimes: PlayerActorRuntime[]` at `engine.ts:1173`. Each `PlayerActorRuntime` carries `timedSelfBySlot` (`playerTurn.ts:135`).
- **Status carries** `sourceSlot`, `recipients`, `conditions`, `payload`, `duration` (built in `registerActorAbilityStatuses`, `engine.ts:144-174`).
- **Apply / fold / decrement:** `applyTimedAbilityStatus(round, status, recipientId?)` (`statusEngine.ts:904`, asserts `round === lastRound` at `:917`); self-side fold via `statusEngine.timedAbilityStatuses('self', actor.id)` (`playerTurn.ts:811, 994`); decrement via `statusEngine.decrementPlayer(...)` returning `{ expired }` (drives `buff-expired`).
- **Death-wipe:** `clearRemovable(id)` (`statusEngine.ts:852`) preserves `turnsRemaining === 'permanent'` and `UNREMOVABLE_STATUSES` members (`isUnremovable`, `:842-845`); aura source lists re-derive (survive). `UNREMOVABLE_STATUSES` in `cheatDeathBuffs.ts:9-13` (currently only `'Acidic Decay'`).
- **Condition gate:** `conditionsMet(conditions, ctx)` + `buildActorConditionContext(statusEngine, ownerId, shared)` (`triggers.ts:392`).
- **Test harness:** `src/utils/combat/__tests__/engine.events.test.ts` — `ab(...)` ability factory (`:9`), `baseInput(...)` (`:44`), `collect(input)` returning `{ events, result }` with `buff-applied`/`buff-expired` taps (`:69-95`).
- **Reactive partition (NOT touched):** `partitionReactiveAbilities` / `LIVE_TRIGGERS` — reactive finite buffs are pulled out before the classifier and applied at their trigger; "at the start of combat" is not a reactive trigger, so those buffs reach the classifier.

---

## Task 1: Enumerate the real affected ship set (diagnostic, no production change)

Establishes the authoritative scope and the golden-delta review checklist. The CSV scan from brainstorming over-matches; this derives the set from the actual parser + classifier.

**Files:**
- Create (temporary): `src/utils/combat/__tests__/auraReclassScope.diagnostic.test.ts`

- [ ] **Step 1: Write a diagnostic test that lists passive buff/debuff abilities with a numeric duration**

For every ship, build its abilities (use the same path the engine uses — `getShipSkillRows` / `buildShipAbilities`; mirror an existing call site, e.g. how `parseAllSkillEffects`/`buildShipAbilities` are invoked in other tests or `src/utils/abilities/`), then for each `passive`-slot ability with `config.type === 'buff' | 'debuff'`, `typeof config.duration === 'number'`, and a **non-reactive** trigger (`!LIVE_TRIGGERS.has(ability.trigger)`), record `{ ship, buffName, duration, target, conditions: ability.conditions }`. `console.log` the collected list and `expect(list.length).toBeGreaterThan(0)`.

- [ ] **Step 2: Run it and capture the list**

Run: `npx vitest --run src/utils/combat/__tests__/auraReclassScope.diagnostic.test.ts`
Expected: PASS, prints the affected set. Confirm it includes Yazid / Tycho (Everliving Regeneration), Crucialis / IonScorp (Atlas Coordination), Iridium (Taunt). **Record the full printed list in this plan's Task 5 delta checklist below.**

- [ ] **Step 3: Note any affected buff carrying residual conditions**

In the printed output, flag any entry whose `conditions` (after the engine's `liveGateConditions` neutralization) is non-empty — those are the only ones where the round-1 seeding gate matters. Expectation: the "at start of combat" buffs are unconditional. Record findings.

- [ ] **Step 4: Delete the diagnostic test (do not commit it)**

```bash
rm src/utils/combat/__tests__/auraReclassScope.diagnostic.test.ts
```

No commit for this task — it is investigation. Its output feeds Task 5.

---

## Task 2: Reclassify finite passive buffs + round-1 seeding (the core fix)

**Files:**
- Modify: `src/utils/combat/engine.ts:130-134` (drop the passive clause)
- Modify: `src/utils/combat/engine.ts` (add round-1 seeding in the round loop, ~`:1482` after `beginRound(r)`)
- Test: `src/utils/combat/__tests__/engine.events.test.ts`

- [ ] **Step 1: Write the failing test — a finite passive self-buff expires (is not permanent)**

Add to `engine.events.test.ts`:

```ts
it('applies a finite-duration passive self-buff once at combat start and expires it on its window', () => {
    const skills: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })] },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-cast',
                        config: {
                            type: 'buff',
                            buffName: 'Everliving Regeneration II',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 3,
                        },
                    }),
                ],
            },
        ],
    };
    const { events } = collect(
        baseInput({ shipSkills: skills, numRounds: 6, hasChargedSkill: false, startCharged: false, chargeCount: 0 })
    );
    const applied = events.filter(
        (e) => e.type === 'buff-applied' && (e as any).buffName === 'Everliving Regeneration II'
    );
    const expired = events.filter(
        (e) => e.type === 'buff-expired' && (e as any).buffName === 'Everliving Regeneration II'
    );
    // Applied exactly once, at combat start.
    expect(applied.map((e) => (e as any).round)).toEqual([1]);
    // Expires after its 3-turn window (applied round 1 → decremented at the owner's
    // post-turn each round → 0 at the end of round 3).
    expect(expired.map((e) => (e as any).round)).toEqual([3]);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest --run src/utils/combat/__tests__/engine.events.test.ts -t "finite-duration passive self-buff"`
Expected: FAIL — under current behavior the buff is an `aura` (never applied as a discrete event, never expires): `applied` is `[]` and `expired` is `[]`.

- [ ] **Step 3: Drop the passive clause from `isAura`**

In `src/utils/combat/engine.ts:130-134`:

```ts
            const isAura =
                !accumulating &&
                (cfg.duration === 'recurring' || cfg.duration === undefined);
```

(Remove `|| slot.slot === 'passive'`.) Update the adjacent classification comment block (`engine.ts:63-65`) to drop "OR passive slot".

- [ ] **Step 4: Add the round-1 seeding pass**

In the round loop, immediately after `statusEngine.beginRound(r);` (`engine.ts:~1482`), add:

```ts
        // Combat-start seeding (round 1) for PASSIVE-sourced finite (timed) self-statuses.
        // The passive slot never fires as an action, so these would otherwise never apply;
        // they are a one-time window from combat start ("gains X for N turns"), NOT a per-turn
        // refresh. Apply once here, then the normal timed lifecycle (timedAbilityStatuses fold +
        // decrementPlayer + clearRemovable) expires them and wipes them on death. Gated by
        // conditionsMet for parity with the cast path (executeIntent); the affected buffs are
        // unconditional in practice (Task 1 enumeration).
        if (r === 1) {
            const seedRuntimes = [...runtimesById.values(), ...enemyPlayerRuntimes];
            for (const rt of seedRuntimes) {
                const seedCtx = buildActorConditionContext(statusEngine, rt.actor.id, {
                    corrosionEntryCount: 0,
                    infernoEntryCount: 0,
                    bombCount: 0,
                    enemyHpPct: 100,
                    enemyType, // in engine scope; `enemy-type` survives liveGateConditions, so
                    // omitting it would wrongly skip an enemy-class-gated passive buff.
                });
                for (const status of rt.timedSelfBySlot) {
                    if (status.sourceSlot !== 'passive') continue;
                    if (!conditionsMet(status.conditions, seedCtx)) continue;
                    for (const rid of status.recipients) {
                        statusEngine.applyTimedAbilityStatus(r, status, rid);
                        bus.emit({
                            type: 'buff-applied',
                            actorId: rid,
                            round: r,
                            buffName: status.payload.buffName,
                            duration: status.duration,
                        });
                    }
                }
            }
        }
```

Ensure both helpers are imported in `engine.ts`: `buildActorConditionContext` from `./triggers` (engine.ts does not currently import it — add to the existing `./triggers` import block) and `conditionsMet` from `../abilities/evaluateConditions` (a **new** import from a different module — not from `./triggers`). Confirm `status.recipients` is populated on the timed-by-slot variant (it is — stamped in `registerActorAbilityStatuses`, `engine.ts:144-151`, though typed optional on the union base).

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest --run src/utils/combat/__tests__/engine.events.test.ts -t "finite-duration passive self-buff"`
Expected: PASS.

- [ ] **Step 6: Run the full combat test suite (no unrelated breakage yet — goldens handled in Task 5)**

Run: `npx vitest --run src/utils/combat`
Expected: All non-golden combat tests pass. The golden parity test (`dpsGoldenParity`) MAY now fail with deltas — that is expected and handled in Task 5; do not `-u` here.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/engine.events.test.ts
git commit -m "fix(combat): finite-duration passive buffs expire instead of acting as permanent auras

Drop the passive-slot clause from the isAura classifier so a passive buff with a
numeric duration classifies as timed; seed passive-sourced timed self-statuses once
at combat start (the passive slot never fires) so they ride the normal decrement +
clearRemovable lifecycle. Fixes Everliving Regeneration running forever / surviving
Cheat Death.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Death wipe — a finite passive buff does NOT survive a Cheat Death revive

**Files:**
- Test: `src/utils/combat/__tests__/engine.events.test.ts` (or `healing.test.ts` if a Cheat-Death revive is easier to stage there — follow whichever existing test already exercises a Cheat Death wipe; reuse its setup)

- [ ] **Step 1: Find the existing Cheat-Death wipe test for setup reference**

Run: `grep -rn "Cheat Death\|clearRemovable\|cheat-death" src/utils/combat/__tests__/`
Identify the test that already triggers a Cheat Death activation (Phase 4b). Reuse its input shape.

- [ ] **Step 2: Write the failing test — finite passive buff is gone after a Cheat Death wipe and does not reappear**

Stage a unit carrying both a finite passive self-buff (e.g. `Everliving Regeneration II`, duration 9) and Cheat Death, take a lethal hit that triggers Cheat Death, then assert: after the wipe round, no further `buff-applied` for the finite buff (it is not re-seeded — seeding is round-1 only) and it is not present in the post-wipe round's `activeSelfBuffs` (read from `result` per-round data). Contrast: an `UNREMOVABLE_STATUSES` member (Task 4) WOULD survive.

- [ ] **Step 3: Run it to confirm it fails (or passes correctly)**

Run: `npx vitest --run src/utils/combat/__tests__/engine.events.test.ts -t "Cheat Death"`
Expected: With Task 2's change the buff is now a `timed` applied status, so `clearRemovable` wipes it. If this test already passes after Task 2, that confirms the fix end-to-end — keep it as a regression guard. If it fails, debug the seeding/lifecycle (it must NOT be re-seeded post-round-1).

- [ ] **Step 4: Make it pass if needed, then commit**

```bash
git add src/utils/combat/__tests__/engine.events.test.ts
git commit -m "test(combat): finite passive buff is wiped by Cheat Death and not re-seeded

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Unremovable named buffs survive the wipe (Magnetized Shielding)

**Files:**
- Modify: `src/utils/combat/cheatDeathBuffs.ts:9-13` (`UNREMOVABLE_STATUSES`)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts` (mirror the existing `'Acidic Decay'` clearRemovable test at `:1486`)

- [ ] **Step 1: Write the failing test — an applied `Magnetized Shielding` survives `clearRemovable`**

Mirror the shipped `UNREMOVABLE_STATUSES` test (`statusEngine.test.ts:1486`): apply a timed status named `Magnetized Shielding`, call `clearRemovable(id)`, assert it remains in the active list (alongside a removable control buff that is wiped).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest --run src/utils/combat/__tests__/statusEngine.test.ts -t "Magnetized Shielding"`
Expected: FAIL — `Magnetized Shielding` is not yet in `UNREMOVABLE_STATUSES`, so it is wiped.

- [ ] **Step 3: Add the name(s) to `UNREMOVABLE_STATUSES`**

In `src/utils/combat/cheatDeathBuffs.ts`, add `'Magnetized Shielding'` (and any other description-marked-unremovable named buffs surfaced in Task 1) to the set, with a short comment citing the in-game "cannot be removed" wording.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest --run src/utils/combat/__tests__/statusEngine.test.ts -t "Magnetized Shielding"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/cheatDeathBuffs.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "fix(combat): mark Magnetized Shielding unremovable so it survives a buff wipe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Golden parity — regenerate snapshots with documented deltas

**Files:**
- `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` + `__snapshots__/dpsGoldenParity.test.ts.snap`
- (any healing golden snapshot that moves)

**Affected-ship delta checklist (from Task 1 diagnostic — authoritative scope):**

Task 1 enumerated 116 passive buff/debuff rows with numeric duration + non-reactive trigger across ~60 ships (per-ship the refit-active passive is what fires in-game; durations below are the R0/R2 values surfaced). `liveGateConditions` neutralized nothing — pre/post-gate conditions are identical. The "start-of-combat" named buffs (Everliving Regeneration, Atlas Coordination, Iridium Taunt, Harvester Speed Up, Barrier, Legion Discipline, Terran Tenacity, Defense Up families) are all **unconditional**; 40 rows carry real conditions (enemy-buff/-debuff counts, enemy-type, hp-threshold, ally-* reactive) where the round-1 `conditionsMet` seeding gate matters.

Required-confirmation ships present: Yazid & Tycho (Everliving Regeneration), Crucialis & IonScorp (Atlas Coordination), Iridium (Taunt). No unremovable-marked buffs in the affected set (Magnetized Shielding is NOT in this list — Task 4 is independent, driven by the in-game "Unremovable" wording the user added to its buff description).

Full affected-ship set (any golden delta MUST be a ship on this list — anything off-list is a bug):

```
Kafa, Nuqtu, AEGIS, Gallant, Anjian, Bizon, Bayah, Iridium, Ravager, Mangler,
Panon, Morao, Nayra, Flamel, Ripper, Makoli, Butcher, Berserker, Sansi, Crucialis,
Shelter, Rys, IonScorp, Torcher, Quixilver, APEX, Warden, Guardian, Shepherd, Medved,
Curator, Provider, Harvester, Paracelsus, Prospect, Pallas, Yazid, Tycho, Stalwart,
Redeemer, Arum, Yarrow, Larkspur, Oleander, Cobalt, Opal, Refine, Meiying, Panguan,
Sha Xing, Shashou, Yuyan, Huanying, Los, Nosorog
```

Affected buff/debuff families: Everliving Regeneration, Atlas Coordination, Taunt, Barrier/Barrier Recharging, Stealth, Marauder Rage, Defense Up, Legion Discipline, Terran Tenacity, Terran Bolster, XAOC Swiftness, Tianchao Precision, Speed Down/Up, Out./Inc. Damage Down, Attack Down/Up, Crit Rate Down, Repair Over Time, Out./Inc. Repair Down, Gelecek Contagion, Binderburg Resilience, Provoke, Disable, Stasis, Block Buff/Shield, Hacking Module Overdrive, Leech.

Note: many conditioned rows (Marauder Rage gated on enemy-debuff count, Stealth gated on enemy-type, Pallas/Provider/Oleander on ally-reactive conditions) will NOT seed at round-1 because the gate is unmet at combat start — so they may produce **no** golden delta. That is expected, not a miss.

- [ ] **Step 1: Run the golden parity suite and inspect the diff (do NOT update yet)**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected: failures only. Capture the diff.

- [ ] **Step 2: Review every delta against the checklist**

For each changed snapshot row, confirm the ship is on the affected-ship checklist AND the change is consistent with "a finite passive buff now expires after N turns / is wiped on death" (e.g. a regen/defensive buff stops contributing past its window; pure-DPS rows for these ships may not move at all). **Any delta for a ship NOT on the checklist, or a delta inconsistent with the expected mechanism, is a bug — stop and fix Task 2, do not bless it.**

- [ ] **Step 3: Once every delta is explained, regenerate snapshots**

Run: `npx vitest --run src/utils/calculators/__tests__/dpsGoldenParity.test.ts -u`
Expected: PASS.

- [ ] **Step 4: Run the entire test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: 0 errors/warnings (`max-warnings: 0`).

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/__tests__/dpsGoldenParity.test.ts.snap src/utils/calculators/__tests__/
git commit -m "test(combat): regenerate golden snapshots for finite-passive-buff expiry (documented deltas)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Changelog entry

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`, `:8`)

- [ ] **Step 1: Add a plain-English entry**

Prepend to `UNRELEASED_CHANGES`:

```ts
    'DPS/Healing Calculator: finite-duration passive buffs now correctly expire. Buffs a ship grants itself at the start of combat for a set number of turns — such as Everliving Regeneration on Yazid and Tycho, Atlas Coordination, or Iridium’s Taunt — were treated as permanent and even persisted through a destroyed-and-revived (Cheat Death) ship. They now run for their stated turns and clear on death like any other buff.',
```

- [ ] **Step 2: Lint + commit**

Run: `npm run lint`
Expected: clean.

```bash
git add src/constants/changelog.ts
git commit -m "docs(changelog): finite-duration passive buffs now expire correctly

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria

- `isAura` no longer keys on the passive slot; finite passive buffs classify as `timed`.
- A finite passive self-buff is applied once at combat start, expires on its window, and is wiped by a Cheat Death revive without reappearing.
- Unremovable named buffs (Magnetized Shielding) survive the wipe.
- Golden snapshots regenerated with every delta explained and restricted to the affected-ship set.
- Changelog entry added.
- `npm test` and `npm run lint` both clean.

## Notes / non-goals

- No new status kind and no change to `clearRemovable`'s rule — death survival rides the existing `'permanent'` / `UNREMOVABLE_STATUSES` preservation.
- No-duration named buffs remain `aura` (unchanged). Reactive finite buffs (partitioned out) are unchanged. Cheat Death (forced `'recurring'`) is unchanged.
- Seeding covers all full runtimes (player attacker + team, and enemy attackers) for symmetry; if Task 1 shows zero enemy-side affected buffs, the enemy branch is inert but harmless.
