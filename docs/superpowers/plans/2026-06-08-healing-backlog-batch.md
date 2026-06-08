# Healing Backlog Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Clear the four self-contained healing/combat-engine backlog items (spec: `docs/superpowers/specs/2026-06-08-healing-backlog-batch-design.md` — READ IT FIRST). Graphite/Refine deferred to Phase 4.

**Architecture:** Four independent items: (1) Hermes Everliving Regeneration III reactive buff grant (parser); (2) team-actor `healModifier` threading; (3a) APEX shield on the existing `on-debuff-inflicted` trigger; (3b) Defiant shield-on-Stasis — a NEW `control-applied` event + `on-stasis-applied` trigger + charged-Stasis `control` parse; (4) align the buff/DoT auto-fill passive scan with the engine's refit-active resolution. 30 golden snapshots stay byte-identical (parity suites use hand-built fixtures); `buildShipAbilities.test.ts` + auto-fill tests change legitimately for item 4.

**Tech Stack:** TypeScript, Vitest, React. No new deps.

**Hard rules (every task):**
- Goldens: NEVER `vitest -u`. Delete the `.snap` + re-run only for NEW scenarios.
- No RegExp lookbehind in `src/` (iOS Safari 15). `scripts/auditSkills.ts` is Node-only — don't touch it.
- ESLint zero warnings; pre-commit runs the full suite (~2 min); NO `--no-verify` for code commits.
- Locate ships by NAME in `docs/ship-skills.csv` (cited line numbers are grep hints, not data rows).
- `docs/` gitignored → `git add -f`.
- Changelog: fold into the evolving healing/DPS `UNRELEASED_CHANGES` entries; don't append many new ones.
- There may be unrelated uncommitted files (user's parallel work) — never stage them; explicit per-file `git add`.

**Branch:** already on `feat/healing-backlog` (spec committed). Confirm with `git rev-parse --abbrev-ref HEAD`.

**Suggested order** (independence/risk): Task 1 (healModifier, isolated) → Task 2 (APEX, isolated) → Task 3 (Hermes parse) → Task 4 (auto-fill scan, shares the parse path — after Task 3 locks Hermes behavior) → Task 5 (Defiant, most machinery) → Task 6 (docs + final verify).

---

## Task 1: Team-actor healModifier threading (item 2)

**Files:**
- Modify: `src/types/calculator.ts` (`CombatStatBlock` ~232)
- Modify: `src/utils/calculators/dpsSimulator.ts` (`deriveTeamEngineActors` ~168 — this is where it's DEFINED; the healing adapter only CALLS it at `healingEngineAdapter.ts:146`). The engine reads `healModifier` off the **walk bundle** (`engine.ts:726`, `w.healModifier ?? 0`), so add `healModifier` INSIDE the `walk: {…}` object (~dpsSimulator.ts:183-193, alongside `affinityDamageModifier` etc.) — NOT the top-level team-actor input.
- Modify: `src/utils/calculators/healingEngineAdapter.ts` (update the "healModifier is NOT threaded" comment ~144)
- Modify: wherever team `CombatStatBlock`s are auto-filled from a ship (grep `CombatStatBlock` / team stat construction in the calculator pages/util — likely `TeamShipConfig` build)
- Test: `src/utils/combat/__tests__/healing.test.ts` or the adapter test

- [ ] **Step 1: Failing test** — a walked team healer with `healModifier: 50` heals at ×1.5. Build via `simulateHealing` with a `teamActors` entry whose `stats` carries `healModifier: 50` and a heal ability; assert the team healer's directHeal (raw) = basis × pct × 1.5 (study `healing.test.ts`/`healingGoldenParity.test.ts` team-actor fixtures first). Confirm it FAILS today (healModifier forced 0 → ×1.0).
- [ ] **Step 2: Implement** — add `healModifier?: number` to `CombatStatBlock`. In `deriveTeamEngineActors` (healingEngineAdapter.ts) pass `healModifier: stats.healModifier ?? 0` into the engine team-actor input (the engine's `TeamActorEngineInput.healModifier` already exists, consumed at engine.ts ~726). Remove/replace the "healModifier is NOT threaded" comment. Where team `CombatStatBlock`s are auto-filled from a ship, populate `healModifier` from the ship's stat (mirror `attack`/`crit`).
- [ ] **Step 3: Run** healing + DPS golden suites + combat tests: `npx vitest run src/utils/combat/ src/utils/calculators/`. Expect PASS, ZERO snapshot churn (existing fixtures default healModifier 0).
- [ ] **Step 4:** `npx tsc --noEmit` (CombatStatBlock is widely used — confirm the optional field compiles everywhere).
- [ ] **Step 5: Commit** `git add src/types/calculator.ts src/utils/calculators/healingEngineAdapter.ts <team-stat-build-file> <test>` → `feat: thread team-actor healModifier into the healing engine`

---

## Task 2: APEX shield-on-debuff (item 3a)

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (heal/shield emission + reactive-trigger detection) and/or `src/utils/skillTextParser.ts` (if shield-grant trigger detection needs widening)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 1: Failing test** — a ship with APEX's refit-active passive text ("This Unit gains a Shield equal to 3% of their Max HP when an enemy gets debuffed.") parses a `shield` ability `{ type:'shield', basis:'hp', pct:3, target:'self' }` with `trigger:'on-debuff-inflicted'`. (Copy the exact text from the Apex row in ship-skills.csv.) Confirm FAIL (today it's likely `on-cast` or unparsed-as-reactive).
- [ ] **Step 2: Implement** — detect the "when an enemy gets debuffed" clause on a shield grant and assign `trigger:'on-debuff-inflicted'` (own inflictions). Reuse the existing reactive-trigger detection pattern (mirror how `detectReactiveTrigger`/`detectCritRepairTrigger` route other reactive grants); add an own-debuff-inflicted detector if none matches this phrasing. Do NOT also fire on ally inflictions (own-only is the documented model). The executor shield follow-up already handles the rest.
- [ ] **Step 3: Engine test (optional but recommended)** — in healing mode, APEX inflicts a debuff → shield pool grows by 3% max HP. Add to `leech.test.ts`/`healing.test.ts` style or a small reactive test.
- [ ] **Step 4: Run** `npx vitest run src/utils/abilities/ src/utils/combat/ src/utils/calculators/` — PASS, zero golden churn (APEX not in any fixture).
- [ ] **Step 5: Commit** `feat: APEX shield-on-debuff via on-debuff-inflicted trigger`

---

## Task 3: Hermes Everliving Regeneration III grant (item 1)

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`parseSkillEffects` — the per-text buff-effect emitter, if the buff isn't emitted) and/or `src/utils/abilities/buildShipAbilities.ts` (buff-merge loop ~1058 where reactive triggers attach via `detectAllyCritTrigger`)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

CONTEXT: `buildShipAbilities` gets its buffs from `buildSkillBuffAutoFill(ship)` → `parseAllSkillEffects` → `parseSkillEffects`. Hermes's refit-active passive: "Defense +20%. When an ally critically hits an enemy, this Unit gains 1 charge to its Charged Skill **and Everliving Regeneration III for 2 turns**. Additionally, when this Unit critically repairs an ally, it Cleanses 1 debuff from itself." The charge + cleanse parse; the Everliving Regeneration III self-buff does NOT (the diagnostic in Step 1 pins whether it's not emitted by `parseSkillEffects` or emitted without the `on-ally-crit` trigger).

- [ ] **Step 1: Failing test** — there is an EXISTING test (~`buildShipAbilities.test.ts:1397`, in the `PALLAS_TEXT`/ally-crit block) asserting the Everliving Regeneration buff "does NOT parse (documented gap)". FLIP/REPLACE that test (don't just add a new one — leaving the old assertion makes a confusing red suite): assert the passive slot now contains a `buff` ability `{ type:'buff', target:'self', config:{ buffName:'Everliving Regeneration III', duration:2 }, trigger:'on-ally-crit' }` alongside the existing charge (`on-ally-crit`) and cleanse (`on-ally-critically-repaired`) abilities. The `PALLAS_TEXT` fixture carries this Hermes-shaped text (a naming artifact — fine to reuse; optionally add a Hermes-named alias). Confirm FAIL.
- [ ] **Step 2: Diagnose & implement** — if `parseSkillEffects` drops the conjoined "and Everliving Regeneration III for 2 turns" buff (charge-coupled clause), widen it to emit the buff SkillEffect (duration 2). Ensure the buff-merge loop's reactive-trigger detection (`detectAllyCritTrigger` on the buff's clause) assigns `on-ally-crit`. Everliving Regeneration III is in `BUFFS` with its incoming-repair effect — once emitted + triggered, the engine's reactive buff follow-up applies it (no engine change needed).
- [ ] **Step 3: Run** `npx vitest run src/utils/abilities/ src/utils/__tests__/skillTextParser.test.ts src/utils/calculators/` — PASS; zero golden churn (Hermes not in parity fixtures). Watch `skillBuffAutoFill.test.ts` — if Hermes/Everliving appears there, update expectations legitimately.
- [ ] **Step 4: Commit** `feat: parse Hermes Everliving Regeneration III reactive grant (on-ally-crit)`

---

## Task 4: Refit-active auto-fill passive scan (item 4)

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`parseAllSkillEffects` ~1731 — resolve passives via `getShipSkillRows` instead of scanning all three columns)
- Test: `src/utils/calculators/__tests__/skillBuffAutoFill.test.ts` (+ `buildDoTAutoFill` coverage); `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

CONTEXT (golden-safety, read carefully): `parseAllSkillEffects` scans `firstPassiveSkillText`/`second`/`third` separately → tier-inclusive passives (R0/R2/R4 each naming a different tier of the same buff) yield duplicate/tier-conflicting auto-fill entries. The engine's `buildShipAbilities` resolves the refit-active passive via `getShipSkillRows(ship)` for its damage/dot/heal abilities — BUT it gets BUFFS from `buildSkillBuffAutoFill` (→ `parseAllSkillEffects`), so it currently mixes refit-active abilities with all-passive buffs (the inconsistency this item fixes). Consequence: changing `parseAllSkillEffects` changes `buildShipAbilities` BUFF output for real ships AND `buildShipAbilities.test.ts` fixtures. The golden PARITY snapshots (`dpsGoldenParity`/`healingGoldenParity`) use HAND-BUILT `ab()` fixtures, NOT `buildShipAbilities`, so they stay byte-identical — confirm this.

- [ ] **Step 1: Failing test** — pick a ship whose passives name different tiers of the same buff across rows (e.g. Everliving Regeneration II on one passive, III on another, or a Defense Up I/II/III ladder — find one via `docs/ship-skills.csv`). Assert `buildSkillBuffAutoFill(ship).selfBuffs` contains ONLY the refit-active passive's tier, not duplicates from all three columns. Confirm FAIL (today it has duplicates).
- [ ] **Step 2: Implement** — change `parseAllSkillEffects` to scan active + charge + the refit-active passive resolved via `getShipSkillRows(ship)` (match `buildShipAbilities`'s row resolution). Keep active/charge scanning as-is. (If `getShipSkillRows` returns labeled rows, map the passive row to the `'passive1'|'passive2'|'passive3'` source tag the effects expect — or collapse to a single `'passive'` source if downstream allows; check `slotForBuffSource`/`slotFor` consumers so the slot mapping stays correct.)
- [ ] **Step 3: Run + golden integrity** — `npx vitest run src/utils/calculators/ src/utils/abilities/ src/utils/combat/`. Update `skillBuffAutoFill.test.ts` + `buildShipAbilities.test.ts` expectations that encoded the old all-passive-scan behavior (these are legitimate — old behavior was the bug). CONFIRM `dpsGoldenParity`/`healingGoldenParity` snapshots are byte-identical (they don't call this path). If a parity snapshot churns, STOP — investigate (a fixture may unexpectedly route through buildShipAbilities).
- [ ] **Step 4: Page spot-check (manual, note in commit)** — open the DPS (and Defense/Speed) auto-fill on the multi-tier ship from Step 1 in the running app; confirm duplicate buff entries are gone and no legitimate grant is dropped.
- [ ] **Step 5: Commit** `fix: auto-fill scans the refit-active passive (no duplicate tier buffs)`

---

## Task 5: Defiant shield-on-Stasis — new event + trigger (item 3b)

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` + `src/utils/skillTextParser.ts` (parse charged "inflicts Stasis" → a `control` ability; parse the passive shield → `on-stasis-applied` trigger)
- Modify: `src/utils/combat/events.ts` (new `control-applied` event)
- Modify: `src/types/abilities.ts` (`AbilityTrigger` + `LIVE_TRIGGERS` gain `on-stasis-applied`)
- Modify: `src/utils/combat/playerTurn.ts` (emit `control-applied` on the cast path when the firing skill carries a `control` ability)
- Modify: `src/utils/combat/triggers.ts` (register the `on-stasis-applied` listener)
- Test: parser tests + `src/utils/combat/__tests__/` (a new reactive/healing test) + a new healing golden

- [ ] **Step 1 (prerequisite): Parse the charged Stasis inflict as a `control` ability.** Failing parser test: Defiant's charged text ("…inflicts Stasis for 1 turn") → a `control` ability `{ type:'control', effect:'stasis' }` on the charged slot. Confirm FAIL (no `type:'control'` stasis parse exists today). Implement the parse in `buildShipAbilities`/parser. Run `npx vitest run src/utils/abilities/` — PASS; confirm DPS goldens untouched (control is inert in DPS — verify a control ability on a firing skill doesn't alter damage).
- [ ] **Step 2: New event + trigger types.** Add `{ type:'control-applied'; casterId:string; effect: <control effect type>; round:number }` to the `CombatEvent` union in `events.ts`. Add `'on-stasis-applied'` to `AbilityTrigger` and to `LIVE_TRIGGERS` (`src/types/abilities.ts`). `npx tsc --noEmit` — the switch in `triggers.ts`/listeners must stay exhaustive (add the case in Step 4).
- [ ] **Step 3: Emit on the cast path.** In `playerTurn.ts`, when the firing skill (active or charged) carries a `control` ability, `bus.emit({ type:'control-applied', casterId: actor.id, effect: cfg.effect, round: r })`. Present-only-when-fired. This does NOT simulate the control's combat effect — emission only. Failing test: an event-bus tap (see `engine.events.test.ts`) captures `control-applied` with `effect:'stasis'` when the actor casts a charged skill carrying a stasis control ability. Verify DPS goldens byte-identical (emitting an unconsumed event changes nothing).
- [ ] **Step 4: Register the listener.** In `triggers.ts` `registerReactiveListeners`, add the `on-stasis-applied` case: subscribe to `control-applied`, fire when `effect === 'stasis' && casterId === ownerId` (own-cast scoped), enqueue the shield intent. The executor's existing `shield` follow-up handles application (no new executor branch). Failing test then PASS.
- [ ] **Step 5: Parse Defiant's passive shield.** Failing test: Defiant's refit-active passive ("…gains Shield equal to 30% of its Max HP when applying Stasis") → `shield` `{ basis:'hp', pct:30, target:'self', trigger:'on-stasis-applied' }`. Implement the "when applying Stasis" → `on-stasis-applied` detection. PASS.
- [ ] **Step 6: Engine end-to-end + golden.** Healing-mode test: Defiant as heal target (or healer) casting its CHARGED skill (must be charged — its ACTIVE applies Provoke, not Stasis; start charged) → applies Stasis → `control-applied` → `on-stasis-applied` → shield pool grows by 30% max HP. Add a hand-verified healing golden scenario (additions-only; existing 8 byte-identical). Run `npx vitest run src/utils/combat/ src/utils/calculators/`.
- [ ] **Step 7: Commit** `feat: Defiant shield-on-Stasis via control-applied event + on-stasis-applied trigger`

---

## Task 6: Docs, changelog, coverage + final verification

**Files:** `docs/skill-model-coverage.md` (§5 new trigger + 4 items; §6 remove shipped backlog entries, add any verify items), `src/pages/DocumentationPage.tsx` (if user-facing copy warrants — likely a small note), `src/constants/changelog.ts` (`UNRELEASED_CHANGES`), the roadmap memory (end of increment).

- [ ] **Step 1: Coverage doc** — §5: document the `on-stasis-applied`/`control-applied` machinery, the Hermes/APEX/Defiant parses, team healModifier, and the refit-active auto-fill alignment. §6: remove the now-shipped backlog items (Pallas-mislabel→Hermes, team healModifier, APEX/Defiant shield procs, duplicate-passive scan); keep Graphite/Refine as Phase 4.
- [ ] **Step 2: Changelog** — fold concise notes into the evolving healing/DPS `UNRELEASED_CHANGES` entries (team heal-modifier support; Hermes/APEX/Defiant sustain now simulated; cleaner skill auto-fill without duplicate tier buffs). Don't append many new array elements.
- [ ] **Step 3: Full verification** — `npx vitest run && npm run lint`. Golden integrity: `git diff main -- src/utils/calculators/__tests__/__snapshots__/` shows ONLY added scenarios (zero modified lines). `grep -rn "(?<=" src/ --include=*.ts --include=*.tsx` → no matches.
- [ ] **Step 4: Live verification (MAIN SESSION ONLY — never a subagent; dev server is on port 3000 with the user's fleet)** — team healer with a heal modifier amplifies heals; Hermes ally-crit grants Everliving Regeneration; APEX builds shield as it debuffs; Defiant builds shield when its charged skill applies Stasis; a multi-tier-passive ship's auto-fill shows no duplicate buff entries; Skill Editor round-trips the new parsed abilities.
- [ ] **Step 5: requesting-code-review / finishing-a-development-branch** — final whole-branch review, then PR.
- [ ] **Step 6: Commit** `docs: healing backlog rules, coverage updates, changelog`
