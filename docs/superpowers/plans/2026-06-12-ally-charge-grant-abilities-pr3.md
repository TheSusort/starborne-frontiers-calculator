# Ally-Charge-Grant Abilities (enemy-team PR3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse Hayyan's and Graphite's `all-allies` charge-bar grants into charge abilities, close the cast-path gap that silences a *charged*-skill grant, and wire an enemy-side charge grant — so an enemy Hayyan/Graphite supporter accelerates the enemy attackers' charged bursts (and a player-team Hayyan/Graphite grants the team charges).

**Architecture:** A new dedicated parser `parseAllyChargeGrant` (mirroring the existing Liberator-specific `parseAllyChargeOnEnemyDeath`) emits an `all-allies` charge ability; the self-charge parser is untouched. The engine cast-path ally-charge grant is generalized from active-only to fire on the firing action (active or charged). A `grantEnemyAllyCharges` closure (mirror of the player `grantAllyCharges`) replaces the PR1/PR2 enemy-side placeholders, on both the enemy walk and the enemy reactive drain. Graphite's `start-of-round` grant rides the reactive path (already wired in PR1); Hayyan's `on-cast` charged grant rides the cast path.

**Tech Stack:** TypeScript, Vitest. Parser in `src/utils/skillTextParser.ts` + `src/utils/abilities/buildShipAbilities.ts`. Engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-12-ally-charge-grant-abilities-design.md`.

**Depends on:** PR1 (enemy reactive infra) + PR2 (enemy recipient routing). Branch `feat/combat-engine-enemy-team-pr3-ally-charge` is stacked on PR2 (`feat/combat-engine-enemy-team-pr2-routing`). Retarget to main once #102/#103 merge.

---

## Background the implementer needs

- **Two existing charge parsers** in `skillTextParser.ts`: `parseChargeGain` (line ~1335, hardcoded self; `CHARGE_DISQUALIFY_RE` at line 344 rejects `all allies` / `their charged skill` / `charged skill of all allies`) and `parseAllyChargeOnEnemyDeath` (line ~1398, Liberator-specific, `all-allies`, implicit `on-enemy-destroyed`). The new parser follows the SECOND pattern.
- **`buildShipAbilities.ts`** emits charge abilities in `abilitiesFromText` (~line 1042 self-charge block, ~1079 Liberator `allyCharge` block). The new ally-charge block goes alongside, emitting `target: 'all-allies'`, `type: 'charge'`.
- **Both target texts (verified against `docs/ship-skills.csv`):**
  - Hayyan (charged slot): *"This Unit repairs 17% of its Max HP, grants Cheat Death to all allies, and adds 1 charge to their Charged Skill."* → `all-allies`, `on-cast`, no condition.
  - Graphite (passive, refit tiers): *"At the start of the round, if an enemy Unit has Stealth, this Unit adds 1/2 charges to the charged skill of all allies within the active pattern."* → `all-allies`, `start-of-round`, condition = enemy-has-Stealth. Note the live CSV plural typo *"adds 1 charges"* — the regex must tolerate `charges?`.
- **Trigger detection:** reuse `detectReactiveTrigger` / `START_OF_ROUND_RE` (line ~706/740) — returns `'start-of-round'` for the Graphite clause; default to `'on-cast'` for Hayyan.
- **Condition for Graphite:** the enemy-has-Stealth gate → `{ subject: 'enemy-buff', ... derivable: true }` (the `enemy-buff` subject is live since PR5). Use the existing condition-detection helpers if one fits ("if an enemy … has Stealth"); else build the condition directly. Drop "within the active pattern" (≈ all-allies, the Cultivator precedent).
- **Cast-path gap (`playerTurn.ts:1238`):** `if (action === 'active' && grantAllyCharges) { ... allyCharges from gatedSkill + gatedPassive ... }`. Active-only → Hayyan's *charged* grant never fires. Generalize to `(action === 'active' || action === 'charged')`. `selectFiringSkill` returns the charged slot on a charged turn, so `gatedSkill` is the firing skill — confirmed in the spec review. Graphite's grant is `start-of-round` → partitioned OUT of `castSkills` into the reactive set, so it is NOT in `gatedSkill`/`gatedPassive` here (no double-grant); a test will assert single-grant-per-round.
- **Player `grantAllyCharges`** (`engine.ts:~1255`): bumps every `allPlayerActors` charge, capped at each `chargeCount`, skips 0. The enemy mirror bumps `enemyAttackerActors`.
- **Enemy placeholders to replace:** enemy walk `grantAllyCharges: undefined` (`engine.ts:~2720`); enemy reactive drain side-ctx `grantAllyCharges: () => {}` (`engine.ts:~2225`). Line numbers are approximate (the branch = PR2 tip) — locate by the surrounding comments ("allies are enemy-side" / "Gap F deferred to PR3").
- **`executeIntent` charge branch** (`triggers.ts:~762`) already routes `ally`/`all-allies` charge to `ctx.grantAllyCharges` — so Graphite's reactive path works the moment the enemy side-ctx supplies a real `grantEnemyAllyCharges`.
- **Golden discipline:** synthetic goldens (`healingGoldenParity`, `dpsGoldenParity`) are hand-built (no parser). Parser changes don't touch them; the `action` gate change (Task 2) is the churn risk — a synthetic golden whose CHARGED skill carries an ally-charge config would churn. Run all goldens; STOP-and-investigate on any diff. NEVER `vitest -u`.
- Commands: `npx vitest run <path>`; `npm run lint` (max-warnings 0); `npx tsc --noEmit`; `npm run audit:skills`.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/utils/skillTextParser.ts` | Skill-text → ability primitives | Add `parseAllyChargeGrant` (+ its regex), mirroring `parseAllyChargeOnEnemyDeath` |
| `src/utils/abilities/buildShipAbilities.ts` | Assemble abilities per ship | Emit an `all-allies` charge ability from `parseAllyChargeGrant` (trigger + condition aware) |
| `src/utils/combat/playerTurn.ts` | Per-turn pipeline | Generalize the ally-charge gate from `action === 'active'` to active-or-charged |
| `src/utils/combat/engine.ts` | Combat loop | Add `grantEnemyAllyCharges`; wire it into the enemy walk + enemy reactive drain side-ctx |
| `src/utils/abilities/__tests__/` (parser tests — match existing location) | Parser unit tests | NEW/extend: Hayyan/Graphite parse + self-charge lock tests |
| `src/utils/combat/__tests__/allyChargeGrant.test.ts` | Engine integration | NEW: player + enemy charge-grant behavior |
| `src/constants/changelog.ts`, `docs/skill-model-coverage.md` | Docs | Fold changelog; mark PR3 shipped |

---

## Task 1: Parser — `parseAllyChargeGrant` + ability emission

**Files:**
- Modify: `src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`
- Test: the parser test file (find where `parseChargeGain` / `parseAllyChargeOnEnemyDeath` are tested — match that location; likely `src/utils/__tests__/skillTextParser.test.ts` or `src/utils/abilities/__tests__/buildShipAbilities.test.ts`)

- [ ] **Step 1: Locate the existing charge-parser tests**

Grep for `parseAllyChargeOnEnemyDeath` and `parseChargeGain` in test files to find where to add parser unit tests; reuse that file + style.

- [ ] **Step 2: Write failing parser tests**

```ts
// Hayyan: all-allies, on-cast, no condition, amount 1
expect(parseAllyChargeGrant("repairs 17% of its Max HP, grants Cheat Death to all allies, and adds 1 charge to their Charged Skill"))
    .toEqual({ amount: 1, trigger: 'on-cast' });
// Graphite: all-allies, start-of-round, enemy-Stealth condition, amount 2 (note plural "charges" with the number)
expect(parseAllyChargeGrant("At the start of the round, if an enemy Unit has Stealth, this Unit adds 2 charges to the charged skill of all allies within the active pattern"))
    .toMatchObject({ amount: 2, trigger: 'start-of-round' /* + condition fields */ });
// plural-with-1 typo tolerated
expect(parseAllyChargeGrant("...adds 1 charges to the charged skill of all allies...")?.amount).toBe(1);
// self-charge ships are NOT matched by the ally parser
expect(parseAllyChargeGrant("adds 1 charge to its Charged Skill")).toBeNull();
```

Decide the exact return shape to fit `buildShipAbilities` (e.g. `{ amount, trigger, condition?, derivable? }`). Keep it small and explicit.

- [ ] **Step 3: Run — verify FAIL** (`parseAllyChargeGrant is not a function`).

Run: `npx vitest run <parser test file>`

- [ ] **Step 4: Implement `parseAllyChargeGrant`**

Add a regex (mirror `ALLY_CHARGE_ON_ENEMY_DEATH_RE`) matching the two ally forms — "adds/grants N charge(s) … to (their|all allies') Charged Skill" and "charge(s) to the charged skill of all allies" — tolerating `charges?` and `a|an|\d+`. Detect the trigger by calling `START_OF_ROUND_RE.test(text)` DIRECTLY (start-of-round → Graphite, else on-cast). **Do NOT use `detectReactiveTrigger`** — it is buff-name-scoped (`detectReactiveTrigger(text, buffName)`) and this grant has no buff name to key on; wiring a fake buff name would be wrong. Detect the enemy-Stealth condition for the start-of-round form (a simple `/if an enemy.*has Stealth/i`-style check). Return null when no ally-charge phrase matches (so self-charge ships fall through to `parseChargeGain`).

- [ ] **Step 5: Run — verify parser tests PASS.**

- [ ] **Step 6: Emit the ability in `buildShipAbilities`**

In `abilitiesFromText`, after the `parseChargeGain` self block and alongside the Liberator `allyCharge` block (~line 1079), add:

```ts
const allyChargeGrant = parseAllyChargeGrant(text);
if (allyChargeGrant) {
    const pos = text.search(/charge/i);
    out.push({
        ability: {
            id: nextId(),
            type: 'charge',
            target: 'all-allies',
            trigger: allyChargeGrant.trigger, // 'start-of-round' (Graphite) | 'on-cast' (Hayyan)
            conditions: allyChargeGrant.condition
                ? [{ subject: 'enemy-buff', buffName: 'Stealth', derivable: true }] // construct directly — do NOT use statusEffectCondition('Stealth') (it returns a self-buff condition, wrong here). Match the exact Condition type shape in the codebase.
                : [],
            config: { type: 'charge', amount: allyChargeGrant.amount },
            autoFilled: true,
        },
        pos: pos >= 0 ? pos : MAX_POS,
    });
}
```

Verify the self-charge block does NOT also emit for Hayyan/Graphite (it won't — `CHARGE_DISQUALIFY_RE` rejects them), and that the Liberator block is unaffected.

- [ ] **Step 7: Write + run a `buildShipAbilities`-level test**

Assert: building Hayyan's charged slot yields a `charge`/`all-allies`/`on-cast` ability; Graphite's passive yields a `charge`/`all-allies`/`start-of-round` ability with the enemy-Stealth condition; a self-charge ship (Hermes/Asphodel/Chakara/Cobalt) still yields a `charge`/`self` ability and NOT an `all-allies` one. (Match how existing buildShipAbilities tests construct a ship/slot.)

- [ ] **Step 8: tsc + lint + commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts <parser test files>
git commit -m "feat(parser): parse Hayyan/Graphite all-allies charge-bar grants"
```

---

## Task 2: Engine — fire the ally-charge grant on a charged turn

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (~line 1238)
- Test: `src/utils/combat/__tests__/allyChargeGrant.test.ts` (create)

- [ ] **Step 1: Write a failing engine test — a team Hayyan grants the team a charge off its CHARGED turn**

Build a 2-actor player team (an attacker + a Hayyan-shaped team ship whose CHARGED skill carries an `all-allies` charge ability, started charged so the charged skill fires). Assert the attacker's charge count advances by the granted amount on the round Hayyan's charged skill fires (observe via a charge-dependent effect or a charged-skill firing earlier than it otherwise would). Use the existing team-walk healing/DPS harness; assert on an observable (e.g. the attacker reaching its charged skill a round sooner → a damage/charged-badge delta vs a control team without Hayyan's grant).

- [ ] **Step 2: Run — verify FAIL** (the grant doesn't fire on a charged turn today).

Run: `npx vitest run src/utils/combat/__tests__/allyChargeGrant.test.ts`

- [ ] **Step 3: Generalize the gate**

In `playerTurn.ts:1238`, change `if (action === 'active' && grantAllyCharges)` to `if ((action === 'active' || action === 'charged') && grantAllyCharges)`. Update the surrounding comment (the "active-round charge step" note) to say the ally-charge grant fires on the firing skill, active OR charged. Confirm `gatedSkill` is the firing skill on a charged turn (it is — `selectFiringSkill`).

- [ ] **Step 4: Run — verify the test PASSES.**

- [ ] **Step 5: Golden parity (the churn-risk gate)**

Run: `npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected: byte-identical. If ANY golden churns, STOP — a synthetic golden's charged skill carries an ally-charge config; investigate before continuing (do NOT `-u`).

- [ ] **Step 6: tsc + lint + commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/allyChargeGrant.test.ts
git commit -m "feat(combat): fire ally-charge grant on a charged turn (Hayyan)"
```

---

## Task 3: Engine — enemy-side `grantAllyCharges` mirror

**Files:**
- Modify: `src/utils/combat/engine.ts`

- [ ] **Step 1: Add `grantEnemyAllyCharges`**

Next to the player `grantAllyCharges` (`engine.ts:~1255`), add (place it AFTER `enemyAttackerActors` is defined, ~line 1352):

```ts
// Enemy-team charge grant (enemy-team PR3): the mirror of grantAllyCharges — bump every
// ENEMY attacker's charges by `amount`, each capped at its own chargeCount, skipping 0.
// Lets an enemy supporter (Hayyan charged grant / Graphite start-of-round / Liberator on-kill)
// accelerate the enemy attackers' charged bursts. Empty enemy list (DPS mode) → never called.
const grantEnemyAllyCharges = (amount: number): void => {
    for (const a of enemyAttackerActors) {
        if (a.chargeCount <= 0) continue;
        a.charges = Math.min(a.charges + amount, a.chargeCount);
    }
};
```

- [ ] **Step 2: Wire the enemy walk (cast path)**

At the enemy walk's `runPlayerTurn` call (`engine.ts:~2720`), replace `grantAllyCharges: undefined` with `grantAllyCharges: grantEnemyAllyCharges`. Update the "allies are enemy-side, not the player team" comment to note enemy supporters now grant their own team.

- [ ] **Step 3: Wire the enemy reactive drain**

In the enemy reactive drain side-ctx (`engine.ts:~2225`), replace the `grantAllyCharges: () => {}` no-op with `grantAllyCharges: grantEnemyAllyCharges`. Update the "Gap F deferred to PR3" comment (it's now done).

- [ ] **Step 4: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): wire enemy-side grantAllyCharges (enemy-team PR3)"
```

---

## Task 4: Engine integration tests — both sides

**Files:**
- Test: `src/utils/combat/__tests__/allyChargeGrant.test.ts` (extend)

- [ ] **Step 1: Player-side Graphite gate test**

A team Graphite grants the team a charge at round start ONLY when an enemy has Stealth (configure the enemy buff). Gate off (no enemy Stealth) → no grant; gate on → grant. Assert the observable charge/damage delta. Also assert SINGLE grant per round (the start-of-round reactive path fires once; the cast-path block does NOT also grant — proves the partition).

- [ ] **Step 2: Enemy-side Hayyan test**

Two enemies: a Hayyan supporter (charged skill carries the all-allies charge, started charged so it fires) + a plain enemy attacker WITH a charged damage skill (so an extra charge makes its burst land sooner). Order so Hayyan acts first. Assert total incoming damage to the tank exceeds a control where Hayyan's charge grant is absent (the attacker bursts a round sooner). Use the `enemyTeamRouting.test.ts` harness style.

- [ ] **Step 3: Enemy-side Graphite test (optional-but-nice)**

An enemy Graphite at round start, with the gate satisfiable, grants the enemy attacker a charge. If the gate (a *player* ship has Stealth) isn't readily configurable in the harness, assert the dormant case (no grant when no player Stealth) and note the gate-on path is covered by the player-side test + the shared executor. Don't force an unreachable assertion — document.

- [ ] **Step 4: Run — verify PASS; commit**

Run: `npx vitest run src/utils/combat/__tests__/allyChargeGrant.test.ts`

```bash
git add src/utils/combat/__tests__/allyChargeGrant.test.ts
git commit -m "test(combat): player + enemy ally-charge-grant integration"
```

---

## Task 5: Full suite + audit + docs

**Files:**
- Modify: `src/constants/changelog.ts`, `docs/skill-model-coverage.md`

- [ ] **Step 1: Full suite + audit + tsc + lint**

Run: `npx vitest run && npm run audit:skills && npx tsc --noEmit && npm run lint`
Expected: all green; goldens byte-identical; `audit:skills` 0 findings / 141 ships (Hayyan/Graphite gain a parsed charge ability — confirm no new findings or double-emit). If audit flags Hayyan/Graphite, investigate (likely a parser shape issue).

- [ ] **Step 2: Changelog (fold into the existing combat entry)**

Add a plain-English line, e.g.: "Healing/DPS Calculator: ships that grant charges to their whole team are now simulated — Hayyan's charged skill and Graphite's start-of-round passive (when an enemy has Stealth) add a charge to all allies' Charged Skills, speeding up their bursts. Configured as enemy attackers, they likewise accelerate the enemy team." Fold, don't add a separate entry.

- [ ] **Step 3: Coverage doc §6**

Mark PR3 SHIPPED under the enemy-team item: `parseAllyChargeGrant` (Hayyan on-cast / Graphite start-of-round + enemy-Stealth gate); the `action==='active'`→active-or-charged cast-path fix; `grantEnemyAllyCharges` wired into the enemy walk + reactive drain. Note enemy-team support PR1+PR2+PR3 now complete; remaining = deferred targeting/simulator (team-agnostic principle).

- [ ] **Step 4: Commit docs**

```bash
git add src/constants/changelog.ts
git add -f docs/skill-model-coverage.md
git commit --no-verify -m "docs(combat): ally-charge-grant abilities PR3 — changelog + coverage"
```

---

## Task 6: Push, PR, review

- [ ] **Step 1: Push + PR (stacked on PR2)**

```bash
gh auth switch --hostname github.com --user TheSusort
git push -u origin feat/combat-engine-enemy-team-pr3-ally-charge
gh pr create --base feat/combat-engine-enemy-team-pr2-routing --title "feat(combat): ally-charge-grant abilities + enemy charge grant (enemy-team PR3)" --body "<summary + test plan + spec link; note it stacks on #103>"
```

- [ ] **Step 2: Address review** per the project flow (poll `mergeState=CLEAN` for CodeRabbit).

---

## Done-when

- Hayyan's and Graphite's `all-allies` charge grants parse into `charge`/`all-allies` abilities (Hayyan on-cast, Graphite start-of-round + enemy-Stealth gate); self-charge ships are unaffected.
- A team Hayyan grants the team a charge off its charged turn; a team Graphite grants only when an enemy has Stealth, once per round.
- An enemy Hayyan/Graphite accelerates the enemy attackers' charged bursts (higher incoming damage).
- Full suite green; healing + DPS goldens byte-identical; `audit:skills` 0 findings; tsc + lint clean.
- Changelog + coverage doc updated; enemy-team support PR1+PR2+PR3 complete.

## Out of scope

- Generalizing the self-charge parser; single-`ally` charge grants (none exist); Graphite's literal "within the active pattern" adjacency (→ targeting phase); the team-agnostic rewrite (→ targeting/simulator phase, per the recorded architecture principle).
