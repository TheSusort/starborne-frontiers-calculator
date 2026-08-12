# SP-3 — Healing Calculator: Real Positional Enemy + Positional Heals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the healing calculator run on a real, positioned enemy roster with pattern-driven heals, removing the last production caller of the engine's vestigial dummy enemy.

**Architecture:** Three sequential PRs. **3a** splits the overloaded `teamBattle` flag so per-recipient heal application can be enabled without dragging lowest-HP routing along, and adds a recipient-keyed healing aggregate — all additive, proven by zero golden movement. **3b** rewires `healingEngineAdapter` to supply positions, real parsed skill targeting, and real enemy HP/defence/security, deleting the dummy scalars. **3c** adds slot dropdowns and the per-recipient report table.

**Tech Stack:** TypeScript, React 18, Vitest + React Testing Library, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-08-12-sp3-healing-real-positional-enemy-design.md`
**Base:** `34c64da5` on `main`

## Global Constraints

- **NEVER run `vitest -u`.** Zero `.snap` movement is a hard gate in PR 3a. In PR 3b every golden move must be individually audited against a stated cause.
- **husky pre-commit runs the FULL `npm test`** (~minutes). Commits are slow; that is expected and correct. husky skips lint.
- **No new dummy branches in the engine.** Epic-wide locked rule. Needing one means the ordering is wrong.
- **Heals go by targeting pattern, never by lowest HP.** Volk's lowest-HP repair is its *passive*, already correct. The healing calculator must never adopt the `teamBattle` → `lowestHpAllyId` branch (`playerTurn.ts:3350`).
- **Do NOT set `input.positionalTeamBattle` from the healing adapter.** It is documented as "NOT the healing calculator" (`engine.ts:1203-1207`) precisely because it conflates two behaviours.
- **Combat-engine work must be team-symmetric.** Passives fire on both sides.
- Dev server is **`npm start`** (there is no `npm run dev`). The healing page route is **`/healing`** (`App.tsx:228`).
- Single-test command form: `npx vitest run <path> -t "<name>"`.
- Use existing UI primitives from `src/components/ui/` — never raw `<button>`, never hand-rolled cards or selects.
- Percentage-only stats are stored as integers (crit `70`, not `0.70`).
- `docs/` is gitignored — commit spec/plan docs with `git add -f`, on the feature branch (not local `main`).

## Per-PR Exit Checklist

Run this before opening **every** PR in this plan — 3a, 3b and 3c alike.

- [ ] `npx tsc --noEmit && npm run lint && npm test && npm run audit` all clean.
- [ ] `git status --short` reviewed for `.snap` movement. PR 3a: **zero**. PR 3b: every move individually audited with a named cause in the commit body. PR 3c: zero engine/adapter snapshots, UI fixtures only.
- [ ] **Placement-symmetry oracle at the exact `2 / 146 / 13-13-13` baseline** (`--seeds 15`). PRs 3b and 3c should not move it at all — they touch no engine file — so a move there means something leaked into the engine and must be explained before merging.
- [ ] **Negative controls extended to the new channel** (spec testing item 6). Any existing test that asserts a channel is EMPTY must also assert the new `perRecipient` / `perTargetDealt` channels are empty, or it silently goes vacuous once data starts flowing. Find them with:
      `grep -rn "toHaveLength(0)\|\.size).toBe(0)\|toEqual({})" src/utils/combat/__tests__/ src/utils/calculators/__tests__/ | grep -i "heal"`
- [ ] **CodeRabbit actually reviewed HEAD.** Grep its latest review body for `Reviewing files that changed … between <base> and <head>` and check `<head>` against the real HEAD SHA. A green check with a stale range has shipped un-reviewed commits twice in this epic — never trust the check alone.
- [ ] Test-file docstrings swept for claims the PR made stale. **Never `grep -v __tests__`** — a docstring asserting removed behaviour keeps passing forever.

---

# PR 3a — Engine: split the gate, add the additive recipient axis

**Branch:** `sp3a-healing-per-recipient-axis`

**Why first:** the healing calculator is still non-positional throughout this PR. That is what makes the zero-golden-movement gate meaningful — it proves the change is additive and that `simulateBattle` is untouched.

### Task 1: Separate per-recipient heal application from lowest-HP routing

Per-recipient heal application already exists but shares `healing.teamBattle` with lowest-HP routing. This task adds a second, narrower signal that enables *only* the application half.

Note the **shield** path already routes per-recipient unconditionally (`playerTurn.ts:3706`, H1 Task 5) — only the *heal* branch needs the new signal.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:132-173` (`HealingRuntimeCtx`), `:3628`
- Modify: `src/utils/combat/engine.ts:1203-1210` (input flag), `:2960` (ctx construction)
- Test: `src/utils/combat/__tests__/healingPerRecipientApply.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CombatEngineInput.perRecipientHealApply?: boolean`
  - `HealingRuntimeCtx.perRecipientApply?: boolean`

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/healingPerRecipientApply.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

// Pattern-Line-Support-Range-1 @ M3 covers exactly {M3, M4} (resolvePattern.test.ts:83-87).
// So: healer at M3, ON-footprint ally at M4, OFF-footprint ally at M1.
// The OFF-footprint ally is deliberately given much lower HP so that lowest-HP routing,
// if it ever leaked in, would heal IT and fail this test.
const FOCUS_ID = 'attacker';
const ON_FOOTPRINT_ID = 'ally-on-pattern';
const OFF_FOOTPRINT_ID = 'ally-off-pattern-low-hp';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3a_${++idc}`,
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const allyTarget = (): ParsedTarget => ({ raw: 'allies', side: 'ally', selection: 'all' });

// ⚠️ CRITICAL MECHANIC — read before touching these fixtures.
// `resolveSupportRecipients` (supportRecipients.ts:15-19) FILTERS `baseRecipients` by the
// footprint; it NEVER expands it. And `recipientsFor` (playerTurn.ts:3342-3352) builds that base as:
//   'self'                          → [actor.id]
//   'all-allies'                    → playerIds        ← the only MULTI-element base
//   single 'ally', teamBattle ON    → [lowestHpAllyId(playerIds)]
//   single 'ally', teamBattle OFF   → [healing.targetId]
// So a single-`ally` heal has exactly ONE base recipient and the pattern can only REMOVE it.
// Multi-ally pattern healing therefore comes only from `all-allies` abilities. Fixture A uses
// `all-allies` to exercise the application half; Fixture B uses single-`ally` to exercise the
// routing fence, because that is the only shape that reaches `lowestHpAllyId` at all.

/** `all-allies` repair for 10% of the caster's 50000 hp basis → 5000 raw per recipient. */
const allAlliesHeal = (): Ability =>
    ab({ type: 'heal', target: 'all-allies', config: { type: 'heal', pct: 10, basis: 'hp' } });

/** Single-`ally` repair — the ONLY shape that reaches the lowest-HP routing branch. */
const singleAllyHeal = (): Ability =>
    ab({ type: 'heal', target: 'ally', config: { type: 'heal', pct: 10, basis: 'hp' } });

const healerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [allAlliesHeal()] }],
});

const singleAllyHealerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [singleAllyHeal()] }],
});

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself.
// `normalizeTeamActorsToWalked` (teamActorWalk.ts:47) synthesizes NEUTRAL_WALK_STATS with
// **hp: 1** for any team actor arriving without one, silently DISCARDING a bare `stats.hp` —
// so a fixture that sets `stats: { hp: 50_000 }` and no `walk` gets a 1-HP ally that dies
// instantly. Only the ADAPTER builds walk bundles (`deriveTeamEngineActors`); `runCombat` does
// not. Established pattern: `healing.test.ts:388-405`.
const teamAlly = (id: string, position: Position, hp: number) => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const BASE = (): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: healerSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 50_000,
    speed: 300,
    healTargetId: FOCUS_ID,
    position: 'M3',
    target: allyTarget(),
    pattern: parsePattern('Pattern-Line-Support-Range-1'),
    teamActors: [
        // ON the footprint (M4). Same max HP as the off-footprint ally so the ONLY difference
        // between them is which cell they stand on.
        teamAlly(ON_FOOTPRINT_ID, 'M4', 50_000),
        // OFF the footprint (M1) — the support pattern from M3 covers only {M3, M4}.
        teamAlly(OFF_FOOTPRINT_ID, 'M1', 50_000),
    ],
});

/** Damage both allies to 50% so every heal has headroom (no all-overheal vacuity). */
const halveAllyHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === ON_FOOTPRINT_ID || a.id === OFF_FOOTPRINT_ID) {
            a.currentHp = Math.floor(a.stats.hp / 2);
        }
    }
};

describe('SP-3a: per-recipient heal application is separable from lowest-HP routing', () => {
    it('WITHOUT the flag: an on-footprint ally receives NO real HP (today behaviour)', () => {
        idc = 0;
        let onFootprint: CombatActor | undefined;
        runCombat({
            ...BASE(),
            __testTapActors: (actors) => {
                halveAllyHp(actors);
                onFootprint = actors.find((a) => a.id === ON_FOOTPRINT_ID);
            },
        });
        expect(onFootprint).toBeDefined();
        // Anti-vacuity: the ally really is damaged, so a landed heal WOULD be observable.
        expect(onFootprint!.currentHp).toBeLessThan(onFootprint!.stats.hp);
        // Heals route only to healTargetId (the focus), so the ally's HP is untouched.
        expect(onFootprint!.currentHp).toBe(25_000);
    });

    it('WITH perRecipientHealApply: the ON-footprint ally gains real HP', () => {
        idc = 0;
        let onFootprint: CombatActor | undefined;
        runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                halveAllyHp(actors);
                onFootprint = actors.find((a) => a.id === ON_FOOTPRINT_ID);
            },
        });
        expect(onFootprint).toBeDefined();
        expect(onFootprint!.currentHp).toBeGreaterThan(25_000);
    });

    it('WITH perRecipientHealApply: the OFF-footprint low-HP ally is NOT healed', () => {
        idc = 0;
        let offFootprint: CombatActor | undefined;
        runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                halveAllyHp(actors);
                offFootprint = actors.find((a) => a.id === OFF_FOOTPRINT_ID);
            },
        });
        expect(offFootprint).toBeDefined();
        // Decision 7: heals follow the PATTERN. This ally is identical to the on-footprint one in
        // every way EXCEPT its cell, so its receiving nothing isolates the pattern as the cause.
        expect(offFootprint!.currentHp).toBe(25_000);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/healingPerRecipientApply.test.ts`

Expected: tests 1 and 3 PASS (they pin today's behaviour — heals reach only `healTargetId`, which is
the focus, so neither ally is touched). Test 2 FAILS with `expected 25000 to be greater than 25000`.

If test 1 or 3 fails, **stop and report** — the fixture is not reproducing current behaviour and
every later assertion is untrustworthy. Do not adjust the fixture to make them pass.

- [ ] **Step 3: Add the input flag**

In `src/utils/combat/engine.ts`, immediately after the `positionalTeamBattle` field (`:1207`), add:

```ts
    /** Apply heals to EACH recipient's own actor (per-recipient application), WITHOUT adopting
     *  `positionalTeamBattle`'s lowest-HP single-`ally` routing. The healing calculator sets this
     *  once it runs positionally: its heals must follow the caster's support PATTERN, which is the
     *  game's rule for every ship (Volk's lowest-HP repair is its PASSIVE, not a pattern effect).
     *  `positionalTeamBattle` implies this behaviour too, so the battle sim is unaffected.
     *  Absent/false → heals apply only to `healTargetId` (legacy single-target accounting). */
    perRecipientHealApply?: boolean;
```

- [ ] **Step 4: Add the ctx field**

In `src/utils/combat/playerTurn.ts`, inside `HealingRuntimeCtx` immediately after `teamBattle` (`:172`), add:

```ts
    /** Apply heals to each recipient's own actor without `teamBattle`'s lowest-HP routing.
     *  `teamBattle` implies this; this flag alone does NOT imply lowest-HP routing. */
    perRecipientApply?: boolean;
```

- [ ] **Step 5: Thread the flag into the ctx**

In `src/utils/combat/engine.ts`, at the `healingCtx` construction, beside `teamBattle: input.positionalTeamBattle ?? false` (`:2960`), add:

```ts
              perRecipientApply:
                  (input.perRecipientHealApply ?? false) || (input.positionalTeamBattle ?? false),
```

- [ ] **Step 6: Use the new signal at the application site**

In `src/utils/combat/playerTurn.ts:3628`, replace:

```ts
                        const perRecipientActor = healing.teamBattle
                            ? healing.recipientActor(rid)
                            : undefined;
```

with:

```ts
                        // Per-recipient application is gated on `perRecipientApply`, NOT
                        // `teamBattle` — the healing calculator needs the application half without
                        // teamBattle's lowest-HP single-`ally` routing (:3350), which is not the
                        // game's rule. `perRecipientApply` is set by BOTH positionalTeamBattle and
                        // the healing calculator's own perRecipientHealApply, so the battle sim's
                        // behaviour is unchanged.
                        const perRecipientActor = healing.perRecipientApply
                            ? healing.recipientActor(rid)
                            : undefined;
```

Leave `:3350`'s `else if (healing.teamBattle) base = [lowestHpAllyId(healing.playerIds)];` **untouched**.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/healingPerRecipientApply.test.ts`
Expected: all three PASS.

⚠️ If test 2 still fails here, check whether the heal is reaching the ally as a RECIPIENT at all
before suspecting the flag: subscribe to `heal-performed` and inspect its targets. `recipientsFor`
must produce `ON_FOOTPRINT_ID`, which requires the ability to target `all-allies` — a single-`ally`
ability collapses to `[healing.targetId]` and no flag can widen it.

- [ ] **Step 8: Fence the gate in the OTHER direction**

Add to the same file:

This needs a SECOND fixture (B). Fixture A's heal is `all-allies`, which never reaches
`lowestHpAllyId` at all — only a single-`ally` heal does. Both candidate allies sit ON the footprint
here, so the footprint filter cannot mask the routing difference, and they carry **distinct HP
fractions** because `lowestHpAllyId` compares `currentHp / maxHp`, not absolute HP (`playerTurn.ts:3333-3336`)
— equal fractions would tie and resolve by iteration order, proving nothing.

```ts
// ── Fixture B: the routing fence ────────────────────────────────────────────
// Pattern-Line-Support-Range-3 @ M1 covers {M1, M2, M3, M4} (resolvePattern.test.ts:91-95),
// so BOTH allies are on-footprint and only the ROUTING rule can distinguish them.
const HIGH_HP_TARGET_ID = 'ally-high-hp-is-the-heal-target';
const LOW_HP_ID = 'ally-low-hp';

const FENCE = (): CombatEngineInput => ({
    ...BASE(),
    shipSkills: singleAllyHealerSkills(),
    position: 'M1',
    pattern: parsePattern('Pattern-Line-Support-Range-3'),
    // The configured heal target is the HIGHER-HP ally, so "routed to the heal target" and
    // "routed to the lowest-HP ally" predict DIFFERENT recipients.
    healTargetId: HIGH_HP_TARGET_ID,
    teamActors: [teamAlly(HIGH_HP_TARGET_ID, 'M2', 50_000), teamAlly(LOW_HP_ID, 'M3', 50_000)],
});

/** 90% for the heal target, 20% for the other — distinct FRACTIONS, no tie. */
const setFenceHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === HIGH_HP_TARGET_ID) a.currentHp = 45_000;
        if (a.id === LOW_HP_ID) a.currentHp = 10_000;
    }
};

describe('SP-3a: the fence — teamBattle keeps its lowest-HP routing', () => {
    it('perRecipientHealApply routes a single-`ally` heal to the HEAL TARGET, not lowest HP', () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        runCombat({
            ...FENCE(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
            },
        });
        // Decision 7: NOT lowest HP. The 20%-HP ally is on-pattern and still gets nothing.
        expect(target!.currentHp).toBeGreaterThan(45_000);
        expect(low!.currentHp).toBe(10_000);
    });

    it('positionalTeamBattle STILL routes that same heal by lowest HP', () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        runCombat({
            ...FENCE(),
            positionalTeamBattle: true,
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
            },
        });
        // The battle sim's shipped behaviour, unchanged by this PR: the 20% ally is chosen and the
        // configured heal target gets nothing. Exactly inverted from the test above on the SAME
        // fixture — which is what proves the two flags drive different routing. Asserting only the
        // widened side would prove nothing about strictness.
        expect(low!.currentHp).toBeGreaterThan(10_000);
        expect(target!.currentHp).toBe(45_000);
    });
});
```

- [ ] **Step 9: Run the fence test**

Run: `npx vitest run src/utils/combat/__tests__/healingPerRecipientApply.test.ts`
Expected: **all FIVE pass** — three in Fixture A, two in the fence.

If the SECOND fence test fails (`positionalTeamBattle` no longer routes by lowest HP),
`perRecipientApply` has been wired in place of `teamBattle` at `:3350` rather than only at `:3628`.
Re-read Step 6 — `:3350` must be untouched.

- [ ] **Step 10: Run the full suite and confirm ZERO snapshot movement**

```bash
npm test 2>&1 | tail -30
git status --short
```

Expected: all tests pass; `git status --short` shows **only** the two files you edited plus the new test file — **no `.snap` files**. A modified `.snap` means the change is not additive; revert and re-derive rather than accepting it.

- [ ] **Step 11: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts \
        src/utils/combat/__tests__/healingPerRecipientApply.test.ts
git commit -m "feat(sim): separate per-recipient heal application from lowest-HP routing

playerTurn.ts:3628 gated per-recipient heal application on \`teamBattle\`, which
also switches single-\`ally\` routing to the lowest-HP ally (:3350). Only Volk
repairs by lowest HP in the game, and that is its passive — so the healing
calculator needs the application half alone.

New \`perRecipientHealApply\` input drives a \`perRecipientApply\` ctx flag that
positionalTeamBattle also implies, leaving the battle sim byte-identical.
Fenced in both directions; zero snapshot movement."
```

---

### Task 2: Recipient-keyed healing aggregate

The healing report is credited by **source** (`credit(sourceId, …)`), so an AoE heal's per-ally split is invisible to it. Add a recipient-keyed map alongside, mirroring the existing `perActorIncoming` precedent.

**Files:**
- Modify: `src/utils/combat/engine.ts:1510-1536` (`HealingRoundEngine`), `:2957-2999` (ctx), `:10151-10160` (round push)
- Modify: `src/utils/combat/playerTurn.ts:3621-3642` (recipient credit calls)
- Test: `src/utils/combat/__tests__/healingPerRecipientAxis.test.ts` (create)

**Interfaces:**
- Consumes: `CombatEngineInput.perRecipientHealApply` (Task 1).
- Produces:
  - `HealingRoundEngine.perRecipient: Map<string, ActorHealing>` — keyed by **recipient** actor id (always present; empty unless per-recipient application is active).
  - `HealingRuntimeCtx.creditRecipient?: (recipientId: string, bucket: keyof ActorHealing, amount: number) => void` — **optional**, so the many existing `HealingRuntimeCtx` literals in tests keep compiling. Call it with `?.`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/healingPerRecipientAxis.test.ts`. Reuse the Task 1 fixture verbatim (do not import from it — copy it; the two files must be independently readable), then add:

```ts
describe('SP-3a: recipient-keyed healing aggregate', () => {
    it('credits effectiveHeal against the RECIPIENT, not only the source', () => {
        idc = 0;
        const result = runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: halveAllyHp,
        });
        const round = result.healing!.rounds[0];

        // Source axis: the healer is credited (unchanged behaviour).
        expect(round.perActor.get(FOCUS_ID)!.directHeal).toBeGreaterThan(0);

        // Recipient axis: the ON-footprint ally has its OWN entry.
        const onEntry = round.perRecipient.get(ON_FOOTPRINT_ID);
        expect(onEntry).toBeDefined();
        expect(onEntry!.effectiveHeal).toBeGreaterThan(0);

        // The OFF-footprint ally received nothing, so it has no entry (or a zero one).
        expect(round.perRecipient.get(OFF_FOOTPRINT_ID)?.effectiveHeal ?? 0).toBe(0);
    });

    it('the recipient axis sums to the source axis for effectiveHeal', () => {
        idc = 0;
        const result = runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: halveAllyHp,
        });
        const round = result.healing!.rounds[0];

        const bySource = [...round.perActor.values()].reduce((n, h) => n + h.effectiveHeal, 0);
        const byRecipient = [...round.perRecipient.values()].reduce(
            (n, h) => n + h.effectiveHeal,
            0
        );
        // Anti-vacuity: both sides must be non-zero, or the identity is trivially true.
        expect(bySource).toBeGreaterThan(0);
        expect(byRecipient).toBeCloseTo(bySource, 6);
    });

    it('without the flag the recipient map stays EMPTY (additive proof)', () => {
        idc = 0;
        const result = runCombat({ ...BASE(), __testTapActors: halveAllyHp });
        expect(result.healing!.rounds[0].perRecipient.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/healingPerRecipientAxis.test.ts`
Expected: FAIL — TypeScript error, `perRecipient` does not exist on `HealingRoundEngine`.

- [ ] **Step 3: Add the field to `HealingRoundEngine`**

In `src/utils/combat/engine.ts`, after `perActorIncoming` (`:1524`), add:

```ts
    /** Per-RECIPIENT healing accounting, keyed by the actor the repair/shield LANDED ON —
     *  the counterpart to `perActor`, which is keyed by the SOURCE that cast it. Populated only
     *  when `perRecipientHealApply` (or `positionalTeamBattle`) is set; **empty otherwise**, which
     *  is what keeps every legacy healing result byte-identical. Drives the healing calculator's
     *  per-ally breakdown: a pattern heal covering three allies produces three entries here while
     *  `perActor` still shows one healer. */
    perRecipient: Map<string, ActorHealing>;
```

- [ ] **Step 4: Add the round-scoped map and its accessor**

In `src/utils/combat/engine.ts`, beside the existing `currentRoundHealing` declaration (`:2736`), add:

```ts
    // Recipient-keyed companion to `currentRoundHealing` (which is source-keyed). Rebound per
    // round in the same place, for the same reason.
    let currentRoundRecipientHealing = new Map<string, ActorHealing>();
    const recipientHealFor = (id: string): ActorHealing => {
        let h = currentRoundRecipientHealing.get(id);
        if (!h) {
            h = emptyActorHealing();
            currentRoundRecipientHealing.set(id, h);
        }
        return h;
    };
```

Find every place `currentRoundHealing` is rebound to a fresh `Map` at the top of a round and rebind `currentRoundRecipientHealing` identically:

```bash
grep -n "currentRoundHealing = new Map" src/utils/combat/engine.ts
```

- [ ] **Step 5: Expose `creditRecipient` on the ctx**

In `src/utils/combat/playerTurn.ts`, inside `HealingRuntimeCtx` after `credit` (`:134`), add:

```ts
    /** Credit a bucket against the RECIPIENT the repair/shield landed on (the `perRecipient`
     *  axis). No-op unless per-recipient application is active. */
    creditRecipient?: (recipientId: string, bucket: keyof ActorHealing, amount: number) => void;
```

In `src/utils/combat/engine.ts`, in the `healingCtx` object beside `credit` (`:2961`), add:

```ts
              creditRecipient: (recipientId, bucket, amount) => {
                  recipientHealFor(recipientId)[bucket] += amount;
              },
```

- [ ] **Step 6: Credit the recipient axis at the heal application site**

In `src/utils/combat/playerTurn.ts`, inside the `if (perRecipientActor || rid === healing.targetId)` block (`:3631-3642`), after the existing source-axis credits, add:

```ts
                            // Recipient axis (SP-3a Task 2): credit the actor the repair LANDED
                            // ON. Gated on perRecipientActor so a legacy single-target run leaves
                            // the map empty and every existing golden stays byte-identical.
                            if (perRecipientActor) {
                                healing.creditRecipient?.(rid, 'directHeal', raw);
                                healing.creditRecipient?.(rid, 'effectiveHeal', consumed);
                                healing.creditRecipient?.(rid, 'overheal', overheal);
                            }
```

- [ ] **Step 7: Surface the map on the round push**

In `src/utils/combat/engine.ts`, in the `healingRounds.push({ … })` object (`:10151`), after `perActor: currentRoundHealing,` add:

```ts
                perRecipient: currentRoundRecipientHealing,
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/healingPerRecipientAxis.test.ts`
Expected: all three PASS.

- [ ] **Step 9: Run the full suite and confirm ZERO snapshot movement**

```bash
npm test 2>&1 | tail -30
git status --short
```

Expected: green, no `.snap` changes. The "without the flag the map stays EMPTY" test is the local proof; `git status` is the global one.

- [ ] **Step 10: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/playerTurn.ts \
        src/utils/combat/__tests__/healingPerRecipientAxis.test.ts
git commit -m "feat(sim): add a recipient-keyed healing aggregate beside the source-keyed one

HealingRoundEngine.perActor is keyed by the SOURCE that cast a repair, so an
AoE heal's per-ally split was invisible to the healing report. Adds
\`perRecipient\`, keyed by the actor the repair landed on, mirroring the existing
perActorIncoming precedent.

Populated only under per-recipient application, so every legacy healing result
keeps an empty map and zero snapshots move."
```

---

### Task 3: Comment sweep and PR 3a wrap-up

The #318 lesson: a comment block documenting a deferred gap accumulates staleness in its **neighbours**. Sweep the claims *around* each edit, not just the edits.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (`:166-172`, `:3321-3350`, `:3623-3630`)
- Modify: `src/utils/combat/engine.ts` (`:1203-1210`)

- [ ] **Step 1: Find every comment asserting the old conflation**

```bash
grep -rn "teamBattle" src/utils/combat/ src/utils/calculators/ | grep -v "__tests__"
grep -rn "NOT the healing calculator" src/utils/combat/
```

- [ ] **Step 2: Update each stale claim**

For every comment found that says per-recipient application requires `teamBattle`, or that the healing calculator always routes to a fixed target, revise it to name `perRecipientApply` as the application signal and `teamBattle` as the lowest-HP-routing signal. Specifically:

- `playerTurn.ts:166-172` (`teamBattle` doc): keep the lowest-HP-routing description, and add that per-recipient *application* now rides `perRecipientApply`, which `teamBattle` implies.
- `playerTurn.ts:3623-3627`: the comment says "The healing calculator (teamBattle off) keeps single-target accounting on healing.targetId" — now true only when `perRecipientApply` is also off. Correct it.
- `playerTurn.ts:3349`: same correction for the routing comment.

- [ ] **Step 3: Sweep test docstrings too**

```bash
grep -rn "teamBattle" src/utils/combat/__tests__/ src/utils/calculators/__tests__/
```

**Never exclude `__tests__` from a staleness sweep.** A docstring asserting removed behaviour keeps passing forever and instructs the next reader to reintroduce the bug.

- [ ] **Step 4: Verify everything green**

```bash
npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20 && npm run audit
```

Expected: all clean, no `.snap` movement.

- [ ] **Step 5: Run the placement-symmetry oracle**

Find and run the oracle (`grep -rn "placement-symmetry" package.json scripts/`), with `--seeds 15`.
Expected: the exact baseline **`2 / 146 / 13-13-13`**. Any other number is a regression, not a new baseline.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "docs(sim): sweep comments stale after the teamBattle gate split"
git push -u origin sp3a-healing-per-recipient-axis
gh pr create --title "feat(sim): separate per-recipient heal application from lowest-HP routing (SP-3a)" --body "$(cat <<'BODY'
First of three PRs for SP-3 (healing calculator: real positional enemy).

`playerTurn.ts:3628` gated per-recipient heal application on `teamBattle`, which
also switches single-`ally` routing to the lowest-HP ally (`:3350`). Per the
owner's ruling, heals follow the caster's targeting **pattern** — only Volk
repairs by lowest HP, and that is its passive. So the healing calculator needs
the application half without the routing half.

- New `perRecipientHealApply` input → `perRecipientApply` ctx flag, which
  `positionalTeamBattle` also implies, leaving the battle sim byte-identical.
- New `HealingRoundEngine.perRecipient` map, keyed by the actor a repair landed
  on, beside the source-keyed `perActor`.

Fenced in both directions: too strict and the healing calc never activates; too
loose and the battle sim's routing changes. Zero `.snap` movement is the proof
the change is additive. Oracle at the exact `2 / 146 / 13-13-13` baseline.

Spec: docs/superpowers/specs/2026-08-12-sp3-healing-real-positional-enemy-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
BODY
)"
```

⚠️ Before merging, confirm CodeRabbit actually reviewed HEAD: grep its latest review body for `Reviewing files that changed … between <base> and <head>` and check `<head>` against the real HEAD SHA. A green check with a stale range has shipped un-reviewed commits twice in this epic.

---

# PR 3b — Adapter: the positional healing run

**Branch:** `sp3b-healing-positional-adapter` (base: `main` after 3a merges)

This is where healing goldens move. Every move needs a stated cause: *the enemy now acts* / *the enemy can die* / *heals now land on a footprint*. A move explained by none of those is a defect.

### Task 4: Widen the adapter's public input types

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts:28-51` (`EnemyAttackerInput`)
- Modify: `src/types/calculator.ts:352-384` (`TeamActorInput`)
- Test: `src/utils/calculators/__tests__/healingEngineAdapter.test.ts` (extend)

**Interfaces:**
- Produces:
  - `EnemyAttackerInput.stats` gains `defence?: number`, `hp?: number`, `security?: number`
  - `EnemyAttackerInput` gains `position?: Position`, `target?: ParsedTarget`, `pattern?: ParsedPattern`, `chargedTarget?: ParsedTarget`, `chargedPattern?: ParsedPattern`
  - `TeamActorInput` gains `target?: ParsedTarget`, `pattern?: ParsedPattern`, `chargedTarget?: ParsedTarget`, `chargedPattern?: ParsedPattern`

- [ ] **Step 1: Confirm the engine already accepts all of these**

```bash
sed -n '1208,1250p' src/utils/combat/engine.ts
```

Expected: `enemyAttackers[].stats` already carries optional `defence`, `hp`, `hacking`, `security`, and the actor already carries `position`, `target`, `pattern`. This task widens only the **adapter's** public types — no new engine surface.

- [ ] **Step 2: Add the fields to `EnemyAttackerInput`**

In `src/utils/calculators/healingEngineAdapter.ts`, inside `EnemyAttackerInput.stats`:

```ts
        /** Enemy's own defence. Load-bearing since SP-3: the healer's damage cast now lands on
         *  this enemy, and that number is the basis for `damage-dealt` heal/shield riders. */
        defence?: number;
        /** Enemy's own max HP. Load-bearing since SP-3: enemies can now be killed, which reduces
         *  incoming pressure over the window. */
        hp?: number;
        /** Enemy's own security — resists the HEALER's outbound debuffs. Must be supplied: the
         *  engine defaults an absent security to 0, so omitting it makes debuffs land strictly
         *  more often than the pre-SP-3 fixed ENEMY_SECURITY of 100 did. */
        security?: number;
```

and on `EnemyAttackerInput` itself:

```ts
    /** Board slot. Required for `isPositional` to resolve a real target: it needs BOTH this and
     *  an opposing actor's position, or `selectTurnTarget` falls back to the vestigial dummy. */
    position?: Position;
    /** Parsed target selection. Position alone does NOT route a cast — with no ParsedTarget,
     *  `selectTurnTarget` short-circuits to `legacyVictim` however well-positioned the roster. */
    target?: ParsedTarget;
    /** Parsed pattern. Required by the SAME positional-apply gate as `target`: with a target but
     *  no pattern the cast resolves onto the real enemy yet skips the per-victim apply, leaving
     *  `perTargetDealt` empty while the damage number still looks plausible. */
    pattern?: ParsedPattern;
    /** Charged-axis targeting when it differs from active. Falls back to `target` / `pattern`. */
    chargedTarget?: ParsedTarget;
    chargedPattern?: ParsedPattern;
```

Add the imports `Position`, `ParsedTarget`, `ParsedPattern` if absent.

- [ ] **Step 3: Add the targeting fields to `TeamActorInput`**

In `src/types/calculator.ts`, after the existing `position` field (`:373`):

```ts
    /** Parsed ACTIVE targeting for this team actor. Forwarded to the engine's
     *  `teamActors[].target` / `.pattern` by `deriveTeamEngineActors`'s spread. Both are needed:
     *  the positional apply gate requires target AND pattern, and a missing pattern fails
     *  SILENTLY (the cast resolves but credits nothing per-victim). */
    target?: ParsedTarget;
    pattern?: ParsedPattern;
    /** Parsed CHARGED targeting when it differs from active; falls back to the active axes. */
    chargedTarget?: ParsedTarget;
    chargedPattern?: ParsedPattern;
```

- [ ] **Step 4: Verify the types compile and nothing else moved**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -20 && git status --short
```

Expected: clean, green, **no `.snap` movement** — these are purely additive optional fields with no reader yet.

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/healingEngineAdapter.ts src/types/calculator.ts
git commit -m "feat(healing): widen adapter input types for positions, targeting, and enemy hp/defence/security"
```

---

### Task 5: Default placement for the healing roster

**Files:**
- Create: `src/utils/calculators/healingPlacement.ts`
- Test: `src/utils/calculators/__tests__/healingPlacement.test.ts`

**Interfaces:**
- Consumes: `resolvePlayerSlots`, `ATTACKER_SLOT_OPTIONS`, `DEFAULT_FRONT_ENEMY_TARGET`, `DEFAULT_BASE_PATTERN` from `dpsEnemyPlacement.ts`.
- Produces:
  - `DEFAULT_HEALER_SLOT: Position`
  - `defaultHealTargetSlot(): Position`
  - `defaultHealingTeamSlot(index: number): Position`
  - `defaultEnemySlot(index: number): Position`
  - `resolveEnemySlots(slots: ReadonlyArray<Position>): Position[]`

- [ ] **Step 1: Write the failing test**

Create `src/utils/calculators/__tests__/healingPlacement.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_HEALER_SLOT,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    defaultEnemySlot,
    resolveEnemySlots,
} from '../healingPlacement';

describe('healing calculator default placement', () => {
    it('the healer, heal target, and team ships never share a default slot', () => {
        const slots = [
            DEFAULT_HEALER_SLOT,
            defaultHealTargetSlot(),
            ...[0, 1, 2, 3].map(defaultHealingTeamSlot),
        ];
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('gives the heal target NO front bias (decision 2)', () => {
        // Column 4 is the FRONT. The heal target must not be seeded there just to keep taking
        // damage — the owner ruled placement is explicit.
        expect(defaultHealTargetSlot().endsWith('4')).toBe(false);
    });

    it('seeds distinct enemy slots', () => {
        const slots = [0, 1, 2, 3].map(defaultEnemySlot);
        expect(new Set(slots).size).toBe(slots.length);
    });

    it('resolveEnemySlots pushes a colliding enemy to a free slot', () => {
        expect(resolveEnemySlots(['M4', 'M4'])).toEqual(['M4', 'T1']);
    });

    it('resolveEnemySlots keeps non-colliding slots untouched', () => {
        expect(resolveEnemySlots(['M4', 'M3', 'B2'])).toEqual(['M4', 'M3', 'B2']);
    });

    it('returns a same-length array', () => {
        expect(resolveEnemySlots(['M4', 'M4', 'M4'])).toHaveLength(3);
    });
});

// ── Decision 9: minimal autoplace ───────────────────────────────────────────
// Seed the heal target into a cell the HEALER's own support footprint covers, so a default board
// does not silently produce zero healing. Only SUPPORT patterns filter ally recipients
// (`supportFootprintAllyIds` returns undefined otherwise), so a non-support pattern needs no
// autoplace at all.
describe('defaultHealTargetSlot — minimal autoplace (decision 9)', () => {
    it('seeds a cell the healer support footprint covers', () => {
        // Pattern-Line-Support-Range-1 @ M2 covers {M2, M3} (resolvePattern.test.ts:83-87 shows the
        // M3 anchor case; from M2 the forward cell is M3). M2 is the healer's own cell, so the heal
        // target must land on M3.
        expect(defaultHealTargetSlot('M2', parsePattern('Pattern-Line-Support-Range-1'))).toBe('M3');
    });

    it('never returns the healer own cell', () => {
        const slot = defaultHealTargetSlot('M2', parsePattern('Pattern-Line-Support-Range-3'));
        expect(slot).not.toBe('M2');
    });

    it('still respects decision 2 — no front bias when an alternative exists', () => {
        // Range-3 @ M1 covers {M1, M2, M3, M4}. M4 is the FRONT column and must not be preferred
        // while M2/M3 are available.
        const slot = defaultHealTargetSlot('M1', parsePattern('Pattern-Line-Support-Range-3'));
        expect(slot).not.toBe('M4');
        expect(['M2', 'M3']).toContain(slot);
    });

    it('falls back to the neutral default when no pattern is known (manual entry)', () => {
        expect(defaultHealTargetSlot('M2', undefined)).toBe('M3');
    });

    it('falls back to the neutral default for a NON-support pattern', () => {
        // A non-support pattern never filters ally recipients, so coverage is irrelevant.
        expect(defaultHealTargetSlot('M2', parsePattern('Pattern-Cone-Range-1'))).toBe('M3');
    });

    it('falls back gracefully when the footprint covers only the healer own cell', () => {
        // Line-Support-Range-1 @ M4: the forward cell clips off-board, leaving {M4} — the healer's
        // own cell. No covered cell is available for the heal target, so take the neutral default
        // rather than returning M4 (two actors cannot share a cell).
        expect(defaultHealTargetSlot('M4', parsePattern('Pattern-Line-Support-Range-1'))).toBe('M3');
    });
});
```

⚠️ Add `import { parsePattern } from '../../targetingParser';` to the test file.

⚠️ **Verify each expected footprint before trusting these assertions.** If a case differs, confirm
the real footprint with `resolveCells(parsePattern('<pattern>'), '<anchor>')` and fix the **test's**
expectation — never the offset table. Report any divergence rather than silently adjusting.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/healingPlacement.test.ts`
Expected: FAIL — cannot resolve `../healingPlacement`.

- [ ] **Step 3: Implement the module**

Create `src/utils/calculators/healingPlacement.ts`:

```ts
import type { Position } from '../../types/encounters';
import type { ParsedPattern } from '../targetingParser';
import { resolveCells } from '../targeting/resolvePattern';
import { ATTACKER_SLOT_OPTIONS, resolvePlayerSlots } from './dpsEnemyPlacement';

/**
 * Default board slots for the healing calculator's positional run.
 *
 * Column 4 is the FRONT. Unlike the DPS calculator — where a 1v1 wants both sides front-and-centre
 * so patterns collapse to single-target — the healing calculator has a roster on both sides, so the
 * defaults spread out and the user places deliberately.
 *
 * ⚠️ The heal target deliberately gets NO front bias (owner ruling, 2026-08-12). Seeding it to the
 * front would keep it soaking damage by default and quietly preserve the old non-positional
 * premise; the explicit trade-off accepted instead is that a saved page may measure ~0 incoming
 * damage until its ships are placed.
 */
export const DEFAULT_HEALER_SLOT: Position = 'M2';

/** The neutral fallback when coverage cannot be computed — mid-board, NOT the front column. */
const NEUTRAL_HEAL_TARGET_SLOT: Position = 'M3';

/**
 * The heal target's default slot — **minimal autoplace** (owner decision 9, 2026-08-12).
 *
 * Seeds a cell the HEALER's own support footprint covers, because an off-footprint heal target
 * receives **nothing at all**: `resolveSupportRecipients` FILTERS the recipient list by the footprint
 * and never expands it, and a single-`ally` heal's base is just `[healTargetId]`. That zero is
 * game-faithful and deliberately not softened — so the defaults must simply not walk into it.
 *
 * Selection order:
 *   1. a covered cell that is neither the healer's own cell nor the FRONT column (decision 2's
 *      no-front-bias still holds — it is about enemy fire, an independent axis from ally coverage);
 *   2. any covered cell that is not the healer's own cell;
 *   3. `NEUTRAL_HEAL_TARGET_SLOT`.
 *
 * Returns the neutral default when `healerPattern` is absent (manual entry, no ship picked) or is
 * NOT a support pattern — a non-support pattern never filters ally recipients
 * (`supportFootprintAllyIds` returns `undefined`), so coverage is irrelevant there.
 *
 * DEFERRED (follow-up): the full multi-supporter footprint intersection. This considers the healer
 * only. Decision 8's placement warning is the safety net for everything this misses.
 */
export function defaultHealTargetSlot(
    healerSlot: Position = DEFAULT_HEALER_SLOT,
    healerPattern?: ParsedPattern
): Position {
    if (!healerPattern?.modifiers.support) return NEUTRAL_HEAL_TARGET_SLOT;

    const covered = resolveCells(healerPattern, healerSlot)
        .map((c) => c.position)
        .filter((p) => p !== healerSlot);

    return (
        covered.find((p) => !p.endsWith('4')) ?? covered[0] ?? NEUTRAL_HEAL_TARGET_SLOT
    );
}

/**
 * Default slot for the Nth healing-calc team ship, avoiding the healer's and heal target's
 * defaults so no two player ships start stacked. `resolvePlayerSlots` is still the authority at
 * sim time — a collision there silently ERASES the earlier actor from its cell.
 */
export function defaultHealingTeamSlot(index: number): Position {
    const order: readonly Position[] = ['M1', 'T2', 'T3', 'B2', 'B3', 'T1', 'B1', 'T4', 'B4', 'M4'];
    return order[index % order.length];
}

/** Default slot for the Nth enemy: front column first, so enemies start in contact. */
export function defaultEnemySlot(index: number): Position {
    const order: readonly Position[] = ['M4', 'T4', 'B4', 'M3', 'T3', 'B3', 'M2', 'T2', 'B2', 'M1'];
    return order[index % order.length];
}

/**
 * Resolve an ENEMY-side roster so no two enemies share a cell.
 *
 * Same contract and same hazard as `resolvePlayerSlots`: `resolvePositionalTarget` and
 * `footprintVictims` index actors into a `Map<Position, CombatActor>`, so on a collision the LATER
 * entry wins and the earlier enemy vanishes from that cell. Sides are independent boards, so the
 * player and enemy rosters are resolved separately.
 */
export function resolveEnemySlots(slots: ReadonlyArray<Position>): Position[] {
    return resolvePlayerSlots(slots);
}

export { ATTACKER_SLOT_OPTIONS as HEALING_SLOT_OPTIONS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/healingPlacement.test.ts`
Expected: all six PASS.

If `resolveEnemySlots(['M4','M4'])` returns `['M4','T1']` — matching `ATTACKER_SLOT_OPTIONS` order — the test is correct. If the order differs, fix the **test's** expectation to the module's real first-free slot rather than reordering the shared constant.

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/healingPlacement.ts \
        src/utils/calculators/__tests__/healingPlacement.test.ts
git commit -m "feat(healing): default board placement for the healing roster"
```

---

### Task 6: Make the healing run positional

The core of PR 3b. After this the healing calculator no longer exercises the dummy.

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts:142-258`
- Test: `src/utils/calculators/__tests__/healingPositionalEnemy.test.ts` (create)

**Interfaces:**
- Consumes: Task 4's widened types, Task 5's placement helpers, Task 1's `perRecipientHealApply`.
- Produces: `HealingSimulationInput` gains `healerPosition?: Position` and `healerTargeting?: ShipTargeting`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/calculators/__tests__/healingPositionalEnemy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';
import { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern, parseTarget } from '../../targetingParser';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3b_${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 10_000,
    defence: 2_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

/** A damage cast that also repairs 50% of the damage it dealt — the F7 rider path. */
const damageWithRider = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 50, basis: 'damage-dealt' },
                }),
            ],
        },
    ],
});

const enemy = (id: string, defence: number, hp: number) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 1, defence, hp, security: 100 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
});

const BASE = (o: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: damageWithRider(),
    selfBuffs: [],
    healTargetId: 'healer',
    enemies: [enemy('enemy-1', 1_000, 500_000)],
    rounds: 1,
    healerPosition: 'M3',
    healerTargeting: {
        active: { target: parseTarget('front'), pattern: parsePattern('Pattern-Base') },
    },
    ...o,
});

describe('SP-3b: the healing calculator fights a real positioned enemy', () => {
    it("the damage-dealt rider bases off the REAL enemy's defence, not ENEMY_DEFENSE", () => {
        idc = 0;
        const low = simulateHealing(BASE({ enemies: [enemy('enemy-1', 1_000, 500_000)] }));
        const high = simulateHealing(BASE({ enemies: [enemy('enemy-1', 9_000, 500_000)] }));

        // Anti-vacuity: the two candidate bases must actually differ in this fixture, or the
        // assertion pins nothing. A tougher enemy takes less damage, so the rider repairs less.
        expect(low.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(high.summary.totalDirectHeal).toBeGreaterThan(0);
        expect(low.summary.totalDirectHeal).not.toBe(high.summary.totalDirectHeal);
        expect(low.summary.totalDirectHeal).toBeGreaterThan(high.summary.totalDirectHeal);
    });

    it('a killable enemy stops contributing incoming damage', () => {
        idc = 0;
        // ⚠️ ANTI-VACUITY, load-bearing. The enemy must land at least one hit BEFORE dying, or
        // "no incoming damage after round 1" is trivially true and the test observes nothing.
        // Turn order is speed-driven, so the enemy is given speed 999 (> the healer's 300) to act
        // FIRST in round 1; it then dies to the healer's cast in that same round.
        // Window kept TIGHT (3 rounds): over a long window the focus kills everything and the
        // premise evaporates — SP-1's earned lesson.
        const glassCannon = {
            ...enemy('enemy-1', 0, 1),
            stats: {
                attack: 5_000,
                crit: 0,
                critDamage: 0,
                speed: 999,
                defence: 0,
                hp: 1,
                security: 100,
            },
        };
        const result = simulateHealing(BASE({ rounds: 3, enemies: [glassCannon] }));

        // Precondition: it DID hit in round 1. Without this the assertion below is vacuous.
        expect(result.rounds[0].incomingDamage).toBeGreaterThan(0);
        // And it died, so rounds 2-3 take nothing.
        const laterIncoming = result.rounds.slice(1).reduce((n, r) => n + r.incomingDamage, 0);
        expect(laterIncoming).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/healingPositionalEnemy.test.ts`
Expected: FAIL — `healerPosition` / `healerTargeting` are not on `HealingSimulationInput`.

- [ ] **Step 3: Add the new input fields**

In `src/utils/calculators/healingEngineAdapter.ts`, on `HealingSimulationInput`:

```ts
    /** The healer's board slot. Required for `isPositional`: it needs BOTH this and an opposing
     *  actor's position, else `selectTurnTarget` falls back to the vestigial dummy. */
    healerPosition?: Position;
    /** The healer's own parsed skill targeting (`parseShipTargeting`). Real patterns drive both
     *  the offensive cast AND — via the support footprint — which allies its heals reach. */
    healerTargeting?: ShipTargeting;
```

- [ ] **Step 4: Delete the dummy scalars and wire the real roster**

In `simulateHealing`, replace the `ENEMY_DEFENSE` / `ENEMY_HP` / `ENEMY_SECURITY` block (`:176-184`) and its F7 comment with:

```ts
    // SP-3: the dummy punching-bag scalars are GONE. The healer's `damage` cast now lands on a
    // real positioned enemy, which is exactly what F7's `basis:'damage-dealt'` riders needed — that
    // finding was conditional on the run being non-positional, not permanent.
    // `enemyDefense`/`enemyHp` still satisfy the engine's required input shape; they describe the
    // now-unreached legacy sink, never a real victim. `dpsEnemyTarget` goes false the moment a real
    // enemy roster is supplied (engine.ts:2302).
    const LEGACY_SINK_DEFENCE = 0;
    const LEGACY_SINK_HP = 1_000_000_000;
```

Then, in the `runCombat` call:

```ts
        enemyDefense: LEGACY_SINK_DEFENCE,
        enemyHp: LEGACY_SINK_HP,
```

**Delete `enemySecurity: ENEMY_SECURITY,` and `enemySpeed: 0,` outright** — each enemy now carries its
own `security` and `speed`. ✅ **VERIFIED: both are OPTIONAL** on `CombatEngineInput`
(`engine.ts:1180`, `:1186`), so dropping them compiles. Do not pass legacy-sink placeholders.

- [ ] **Step 5: Thread positions, targeting, and the new flag**

Still in the `runCombat` call:

```ts
        // Positional plumbing (SP-3). Both position AND target AND pattern are required: with a
        // target but no pattern the cast resolves onto the real enemy yet skips the per-victim
        // apply, so `perTargetDealt` comes back EMPTY while the damage number looks plausible.
        position: input.healerPosition ?? DEFAULT_HEALER_SLOT,
        target: input.healerTargeting?.active?.target ?? DEFAULT_FRONT_ENEMY_TARGET,
        pattern: input.healerTargeting?.active?.pattern ?? DEFAULT_BASE_PATTERN,
        chargedTarget: input.healerTargeting?.charged?.target,
        chargedPattern: input.healerTargeting?.charged?.pattern,
        // Heals apply to each recipient the caster's support pattern covers — WITHOUT
        // teamBattle's lowest-HP routing, which is not the game's rule (only Volk's passive is).
        perRecipientHealApply: true,
```

And map the enemy roster with positions resolved for collisions:

```ts
    const enemySlots = resolveEnemySlots(
        enemies.map((e, i) => e.position ?? defaultEnemySlot(i))
    );
    const engineEnemyAttackers = enemies.map((e, i) => {
        const aff = computeAffinityModifiers(e.affinity, healTargetAffinity);
        return {
            ...e,
            affinityDamageModifier: aff.damageModifier,
            affinityCritCap: aff.critCap,
            affinityCritPenalty: aff.critPenalty,
            position: enemySlots[i],
            // A kitless/manual enemy has no parsed targeting, so it would have NO ParsedTarget and
            // fall back to `legacyVictim` — the dummy — leaving SP-4 blocked. The synthetic
            // fallback keeps every enemy resolving onto a real player actor.
            target: e.target ?? DEFAULT_FRONT_ENEMY_TARGET,
            pattern: e.pattern ?? DEFAULT_BASE_PATTERN,
            chargedTarget: e.chargedTarget,
            chargedPattern: e.chargedPattern,
        };
    });
```

Import `DEFAULT_FRONT_ENEMY_TARGET` and `DEFAULT_BASE_PATTERN` from `./dpsEnemyPlacement`, and the placement helpers from `./healingPlacement`.

- [ ] **Step 6: Resolve player-side slots too**

Before `deriveTeamEngineActors`, resolve the whole player roster so no two player ships share a cell — the healer is `slots[0]` and keeps its slot:

```ts
    // resolvePlayerSlots is load-bearing, not tidiness: the positional maps are keyed by cell, so
    // on a collision the LATER actor silently ERASES the earlier one from that cell.
    const playerWanted: Position[] = [
        input.healerPosition ?? DEFAULT_HEALER_SLOT,
        ...(teamActors ?? []).map((t, i) => t.position ?? defaultHealingTeamSlot(i)),
    ];
    const playerSlots = resolvePlayerSlots(playerWanted);
    const positionedTeamActors = (teamActors ?? []).map((t, i) => ({
        ...t,
        position: playerSlots[i + 1],
    }));
```

Pass `positionedTeamActors` to `deriveTeamEngineActors` instead of `teamActors`, and use `playerSlots[0]` for the focus `position`.

- [ ] **Step 7: Run the new test**

Run: `npx vitest run src/utils/calculators/__tests__/healingPositionalEnemy.test.ts`
Expected: both PASS.

- [ ] **Step 8: Audit the golden churn**

```bash
npm test 2>&1 | tail -40
git status --short
```

Healing goldens **will** move. For each moved snapshot, name the cause: *the enemy now acts* / *the enemy can die* / *heals now land on a footprint* / *the rider bases off real defence*. Write the causes into the commit message.

⚠️ A move you cannot explain is a defect. Investigate before re-pinning. **Never `vitest -u`** — update snapshots only after individually reading each diff.

⚠️ Do **not** add a digit-parity assertion against a pre-change healing number. Adding actors changes the count and order of RNG draws (the rate gate keys on `ownerId`), so every later draw shifts even for a zero-damage addition.

- [ ] **Step 9: Surface `perTargetDealt` on the healing row**

`HealingRoundData` does **not** carry `perTargetDealt` today (verified — the type ends at
`enemyEffects` / `extraTurns`). It must, because it is the only non-silent proof that the positional
apply actually ran. Add to `HealingRoundData`:

```ts
    /** Per-victim damage this round, `attackerId → victimId → damage`, forwarded from RoundData.
     *  Present only on a positional run. This is the ONLY reliable proof the per-victim apply ran:
     *  with a target but no pattern the cast still resolves onto the real enemy and still produces a
     *  plausible damage number, while `perTargetDealt` comes back EMPTY (engine.ts:8344). */
    perTargetDealt?: Record<string, Record<string, number>>;
```

and in the `rows` mapping:

```ts
            ...(rd.perTargetDealt !== undefined ? { perTargetDealt: rd.perTargetDealt } : {}),
```

- [ ] **Step 10: Verify the dummy is no longer reached**

Add to `healingPositionalEnemy.test.ts`:

```ts
    it('credits damage per-victim against the REAL enemy, not the legacy sink', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        // A non-empty perTargetDealt is the positional-apply proof. Asserting the damage TOTAL
        // alone would pass even if the cast fell back to the legacy sink, because the legacy path
        // still credits a plausible cumulative number (SP-1's silent-failure lesson).
        const dealt = result.rounds[0].perTargetDealt;
        expect(dealt).toBeDefined();
        expect(Object.keys(dealt![FOCUS_ID_IN_ENGINE] ?? {})).toContain('enemy-1');
    });
```

where `const FOCUS_ID_IN_ENGINE = 'attacker';` sits beside the other fixture constants (the engine
keys the focus as `'attacker'`, never the page's ship id).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(healing): the healing calculator fights a real, positioned enemy

Positions, real parsed skill targeting, and real enemy hp/defence/security
replace the dummy punching-bag scalars. F7's damage-dealt rider blocker
dissolves: it was conditional on the run being non-positional.

Golden movement, each audited: <list the causes here>"
```

---

### Task 7: Re-derive the summary per recipient

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts:276-368`
- Test: `src/utils/calculators/__tests__/healingPerRecipientReport.test.ts` (create)

**Interfaces:**
- Consumes: `HealingRoundEngine.perRecipient` (Task 2).
- Produces:
  - `HealingRoundData.perRecipient?: Record<string, { directHeal: number; effectiveHealing: number; overheal: number }>`
  - `HealingSimulationResult.summary.perRecipient?: Record<string, { totalEffectiveHealing: number; totalOverheal: number }>`

(Shield is deliberately **not** on this axis: `credit(actor.id, 'shield', raw)` is source-keyed and
the shield pool already lands per-recipient via `grantShieldToTarget` — adding it here would imply a
recipient-side shield total this task does not compute.)

- [ ] **Step 1: Write the failing test**

Create `src/utils/calculators/__tests__/healingPerRecipientReport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { TeamActorInput } from '../../../types/calculator';
import { parsePattern, parseTarget } from '../../targetingParser';

const HEAL_TARGET_ID = 'heal-target';
const SECOND_ALLY_ID = 'ally-two';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3b_rep_${++idc}`,
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const HEALER: HealerStats = {
    hp: 50_000,
    attack: 0,
    defence: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 300,
};

/** Repairs 10% of the caster's HP to every ally the support pattern covers. */
const allyHealSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'heal', target: 'ally', config: { type: 'heal', pct: 10, basis: 'hp' } }),
            ],
        },
    ],
});

/** An enemy that hits hard enough to leave headroom for the repairs to land. */
const enemy = () => ({
    id: 'enemy-1',
    stats: {
        attack: 20_000,
        crit: 0,
        critDamage: 0,
        speed: 1,
        defence: 0,
        hp: 500_000,
        security: 100,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('all'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
});

// ⚠️ The two allies MUST carry DISTINCT ids AND distinct slots. With duplicate ids
// `Object.keys(...)` collapses to one entry and every "merged across the roster" assertion below
// passes byte-for-byte while observing nothing (the #318 vacuity class).
const ally = (id: string, position: 'M3' | 'M4'): TeamActorInput => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [] },
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: 60_000,
    },
    position,
});

// Pattern-Line-Support-Range-1 @ M2 covers {M2, M3}; extend to Range-3 @ M2 to cover M3 AND M4.
const BASE = (o: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: allyHealSkills(),
    selfBuffs: [],
    healTargetId: HEAL_TARGET_ID,
    enemies: [enemy()],
    rounds: 3,
    healerPosition: 'M2',
    healerTargeting: {
        active: {
            target: parseTarget('allies'),
            pattern: parsePattern('Pattern-Line-Support-Range-3'),
        },
    },
    teamActors: [ally(HEAL_TARGET_ID, 'M3'), ally(SECOND_ALLY_ID, 'M4')],
    ...o,
});

describe('SP-3b: per-recipient healing report', () => {
    it('reports a distinct entry per healed ally', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        const withData = result.rounds.find((r) => r.perRecipient !== undefined);
        expect(withData).toBeDefined();
        expect(Object.keys(withData!.perRecipient!)).toEqual(
            expect.arrayContaining([HEAL_TARGET_ID, SECOND_ALLY_ID])
        );
    });

    it('keeps the heal target as the primary row', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        // Every existing chart reads the top-level effectiveHealing. It must still describe the
        // configured heal target, NOT the team-wide sum, or the charts silently change meaning.
        const perRecipientTotal = result.summary.perRecipient![HEAL_TARGET_ID]
            .totalEffectiveHealing;
        expect(result.summary.totalEffectiveHealing).toBe(perRecipientTotal);
    });

    it('sums per-recipient effective healing to the team total', () => {
        idc = 0;
        const result = simulateHealing(BASE());
        const byRecipient = Object.values(result.summary.perRecipient!).reduce(
            (n, e) => n + e.totalEffectiveHealing,
            0
        );
        // Anti-vacuity: BOTH sides non-zero, and the second ally really did receive something —
        // otherwise this identity holds trivially on a single-recipient run.
        expect(byRecipient).toBeGreaterThan(0);
        expect(
            result.summary.perRecipient![SECOND_ALLY_ID].totalEffectiveHealing
        ).toBeGreaterThan(0);
        expect(byRecipient).toBeGreaterThan(result.summary.totalEffectiveHealing);
    });
});
```

⚠️ If `Pattern-Line-Support-Range-3 @ M2` does not cover both `M3` and `M4` in practice, confirm the
real footprint with `resolveCells(parsePattern('Pattern-Line-Support-Range-3'), 'M2')` and move the
allies onto covered cells. Fix the **fixture**, never the offset table.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/healingPerRecipientReport.test.ts`
Expected: FAIL — `perRecipient` is not on `HealingRoundData`.

- [ ] **Step 3: Surface the recipient axis on each row**

In the `rows` mapping, alongside the existing per-round fields:

```ts
            // Per-recipient breakdown (SP-3): keyed by the ally a repair LANDED ON. Follows the
            // "absent when empty" convention of perActorShield/perActorIncoming so a run with no
            // per-recipient data keeps the legacy row shape byte-identical.
            ...(() => {
                const out: Record<
                    string,
                    { directHeal: number; effectiveHealing: number; overheal: number }
                > = {};
                for (const [id, h] of hr?.perRecipient ?? []) {
                    if (h.directHeal === 0 && h.effectiveHeal === 0 && h.overheal === 0) continue;
                    out[id] = {
                        directHeal: Math.round(h.directHeal),
                        effectiveHealing: Math.round(h.effectiveHeal),
                        overheal: Math.round(h.overheal),
                    };
                }
                return Object.keys(out).length > 0 ? { perRecipient: out } : {};
            })(),
```

Declare the field on `HealingRoundData` with the same doc note.

- [ ] **Step 4: Accumulate the summary axis**

Add a raw accumulator beside the existing ones and round at presentation, exactly as the others do (raws accumulate UNROUNDED, rounded LAST):

```ts
    const perRecipientRaw = new Map<string, { effective: number; overheal: number }>();
```

Fold each round's entries in, then emit `summary.perRecipient` under the same "absent when empty" rule.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/utils/calculators/__tests__/healingPerRecipientReport.test.ts`
Expected: all three PASS.

- [ ] **Step 6: Full verification and commit**

```bash
npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20 && npm run audit
git add -A
git commit -m "feat(healing): per-recipient breakdown in the healing report"
```

Then open PR 3b following Task 3 Step 6's `gh pr create` shape, listing every audited golden cause in the body.

---

# PR 3c — UI: placement dropdowns + per-recipient report

**Branch:** `sp3c-healing-placement-ui` (base: `main` after 3b merges)

### Task 8: Slot dropdowns for every actor

**Files:**
- Modify: `src/pages/calculators/HealingCalculatorPage.tsx`
- Modify: `src/components/calculator/EnemyAttackersPanel.tsx`, `HealTargetPanel.tsx`, `HealerConfigCard.tsx`
- Create: `src/components/calculator/SlotSelect.tsx`
- Test: `src/components/calculator/__tests__/SlotSelect.test.tsx`

**Interfaces:**
- Produces: `SlotSelect: React.FC<{ value: Position; onChange: (p: Position) => void; label?: string; taken?: readonly Position[] }>`

⚠️ `src/components/ui/Select.tsx` is a **portal-based custom component, NOT a native `<select>`**. It
renders a labelled button plus a portalled option list, so `getAllByRole('option')` and
`fireEvent.change` do **not** work on it. The established pattern (`EnemyAttackersPanel.test.tsx:160-164`)
is: `fireEvent.click(screen.getByLabelText('<label>'))` to open, then
`fireEvent.click(screen.getByText('<option label>'))` to choose.

- [ ] **Step 1: Write the failing test**

Create `src/components/calculator/__tests__/SlotSelect.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotSelect } from '../SlotSelect';

describe('SlotSelect', () => {
    it('reflects the current slot', () => {
        render(<SlotSelect value="M4" onChange={() => {}} label="Slot" />);
        expect(screen.getByText('M4 (front)')).toBeInTheDocument();
    });

    it('reports the chosen slot', () => {
        const onChange = vi.fn();
        render(<SlotSelect value="M4" onChange={onChange} label="Slot" />);
        fireEvent.click(screen.getByLabelText('Slot'));
        fireEvent.click(screen.getByText('T1'));
        expect(onChange).toHaveBeenCalledWith('T1');
    });

    it('marks an already-taken slot so a collision is visible before it happens', () => {
        render(<SlotSelect value="M4" onChange={() => {}} label="Slot" taken={['T1']} />);
        fireEvent.click(screen.getByLabelText('Slot'));
        expect(screen.getByText('T1 (taken)')).toBeInTheDocument();
    });

    it('never marks the actor\'s OWN slot as taken', () => {
        render(<SlotSelect value="M4" onChange={() => {}} label="Slot" taken={['M4']} />);
        expect(screen.queryByText('M4 (taken)')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/calculator/__tests__/SlotSelect.test.tsx`
Expected: FAIL — cannot resolve `../SlotSelect`.

- [ ] **Step 3: Implement `SlotSelect`**

Create `src/components/calculator/SlotSelect.tsx`:

```tsx
import React from 'react';
import { Select } from '../ui/Select';
import type { Position } from '../../types/encounters';
import { HEALING_SLOT_OPTIONS } from '../../utils/calculators/healingPlacement';

interface Props {
    value: Position;
    onChange: (position: Position) => void;
    label?: string;
    /** Slots already occupied by OTHER actors on the same side — annotated, not disabled, so the
     *  user can still pick one and let `resolvePlayerSlots`/`resolveEnemySlots` shuffle. */
    taken?: readonly Position[];
    helpLabel?: string;
}

/** Column 4 is the FRONT of the board — annotate it so placement reads correctly without a board. */
const slotLabel = (p: Position, taken: readonly Position[], value: Position): string => {
    if (p !== value && taken.includes(p)) return `${p} (taken)`;
    return p.endsWith('4') ? `${p} (front)` : p;
};

export const SlotSelect: React.FC<Props> = ({
    value,
    onChange,
    label = 'Board slot',
    taken = [],
    helpLabel,
}) => (
    <Select
        label={label}
        helpLabel={helpLabel}
        value={value}
        onChange={(v) => onChange(v as Position)}
        options={HEALING_SLOT_OPTIONS.map((p) => ({
            value: p,
            label: slotLabel(p, taken, value),
        }))}
    />
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/calculator/__tests__/SlotSelect.test.tsx`
Expected: all four PASS.

If the "(front)" assertion fails, read the rendered text and align the **test** to the component's
actual label format — do not drop the front annotation, it is the only cue that column 4 is the front.

- [ ] **Step 5: Add `position` to the config state**

In `src/components/calculator/EnemyAttackersPanel.tsx`, add to `EnemyAttackerConfig`:

```ts
    /** Board slot. Column 4 is the FRONT. Seeded by defaultEnemySlot(index). */
    position: Position;
    /** Enemy's own max HP — it can now be destroyed. */
    hp: number;
    /** Enemy's own defence — the basis for the healer's damage-dealt riders. */
    defence: number;
    /** Enemy's own security — resists the healer's outbound debuffs. */
    security: number;
```

In `src/pages/calculators/HealingCalculatorPage.tsx`, extend the initial `enemies` state
(`:163-172`) and the healer / heal-target / team-ship state with `position`, seeded from
`DEFAULT_HEALER_SLOT`, `defaultHealTargetSlot()`, `defaultHealingTeamSlot(i)` and
`defaultEnemySlot(i)`.

- [ ] **Step 6: Render the controls**

In each of `HealerConfigCard.tsx`, `HealTargetPanel.tsx`, the team-ship card, and `EnemyCard`
(inside `EnemyAttackersPanel.tsx`), render:

```tsx
<SlotSelect
    value={enemy.position}
    onChange={(position) => onUpdate({ position })}
    taken={otherSlots}
    helpLabel="Column 4 is the front of the board."
/>
```

passing the other same-side actors' slots as `otherSlots`. In `EnemyCard`, add three `Input`
controls beside the existing stat inputs:

```tsx
<Input
    label="HP"
    type="number"
    value={enemy.hp}
    onChange={(e) => onUpdate({ hp: Number(e.target.value) })}
/>
<Input
    label="Defence"
    type="number"
    value={enemy.defence}
    onChange={(e) => onUpdate({ defence: Number(e.target.value) })}
/>
<Input
    label="Security"
    type="number"
    value={enemy.security}
    onChange={(e) => onUpdate({ security: Number(e.target.value) })}
    helpLabel="Resists debuffs your healer applies."
/>
```

Defaults: `hp: 40000`, `defence: 5000`, `security: 100` (spec decision 3 — an `hp` default of `0`
would destroy every enemy in round 1, and a `security` default of `0` would make the healer's
debuffs land strictly more often than before SP-3). Seed from the ship template when a ship is
picked, mirroring how `affinity` and `shipSkills` are already seeded in `onSelectShip`.

- [ ] **Step 7: Thread the slots into the sim**

In `HealingCalculatorPage.tsx`, pass `healerPosition`, each `TeamActorInput.position`, and each
`EnemyAttackerInput.position` / `.stats.hp` / `.stats.defence` / `.stats.security` through to
`simulateHealing`. Derive `healerTargeting` with `parseShipTargeting(selectedHealerShip)` when a
ship is picked, leaving it `undefined` for manual entry so the adapter's synthetic fallback applies.

Note the heal target's default slot is already handled in the adapter (`defaultHealTargetSlot`,
wired in Task 6) — do NOT re-implement it here. Only pass an explicit `position` when the user has
chosen one.

- [ ] **Step 8: The uncovered-placement warning (owner decision 8)**

**This is the safety net for the whole positional model, and it matters more than the autoplace.**
An ally standing on a cell that no supporter's footprint covers receives **exactly zero** healing —
owner-ruled game-faithful and deliberately never softened. A silent zero is indistinguishable from a
bug, so the UI must say so.

Still-live cases the autoplace cannot fix:
- A **caster-only footprint**: healer at `M4` with `Pattern-Line-Support-Range-1`, whose forward cell
  clips off-board, covers only the healer's own cell — no ally cell is coverable at all.
- Any ally the user places off-pattern deliberately or accidentally.

Add to `src/utils/calculators/healingPlacement.ts`:

```ts
/**
 * Player-side ally ids standing on a cell that NO supporter's footprint covers.
 *
 * A support cast anchors on the caster's own cell and `resolveSupportRecipients` FILTERS recipients
 * by that footprint, so an uncovered ally receives exactly zero. That zero is intended (owner ruling)
 * — this helper exists to make it VISIBLE, never to change it.
 *
 * A supporter is any player ship whose parsed ACTIVE pattern carries `modifiers.support`. Ships with
 * no resolvable support pattern contribute no coverage. When there is NO supporter at all, returns an
 * empty array: nothing is "uncovered" if nothing was ever going to cover it, and warning on every
 * ally in a damage-only team would be noise.
 */
export function uncoveredAllyIds(
    allies: ReadonlyArray<{ id: string; position: Position; pattern?: ParsedPattern }>
): string[] {
    const covered = new Set<Position>();
    let sawSupporter = false;
    for (const a of allies) {
        if (!a.pattern?.modifiers.support) continue;
        sawSupporter = true;
        try {
            for (const c of resolveCells(a.pattern, a.position)) covered.add(c.position);
        } catch {
            // Unknown pattern signature (no offset table) — contributes no coverage rather than
            // throwing. Same guard as defaultHealTargetSlot; see its comment.
        }
    }
    if (!sawSupporter) return [];
    return allies.filter((a) => !covered.has(a.position)).map((a) => a.id);
}
```

Tests for it (`healingPlacement.test.ts`):

```ts
describe('uncoveredAllyIds (decision 8)', () => {
    const line1 = parsePattern('Pattern-Line-Support-Range-1'); // @M2 covers {M2, M3}

    it('flags an ally off every supporter footprint', () => {
        expect(
            uncoveredAllyIds([
                { id: 'healer', position: 'M2', pattern: line1 },
                { id: 'covered', position: 'M3' },
                { id: 'stranded', position: 'B1' },
            ])
        ).toEqual(['stranded']);
    });

    it('flags the CASTER too when its own footprint covers nobody else', () => {
        // Line-Support-Range-1 @ M4 clips forward off-board → covers only {M4}.
        const ids = uncoveredAllyIds([
            { id: 'healer', position: 'M4', pattern: line1 },
            { id: 'stranded', position: 'M1' },
        ]);
        expect(ids).toEqual(['stranded']);
    });

    it('unions coverage across MULTIPLE supporters', () => {
        // A second supporter at B1 covers B2, rescuing an ally the healer cannot reach.
        expect(
            uncoveredAllyIds([
                { id: 'healer', position: 'M2', pattern: line1 },
                { id: 'support2', position: 'B1', pattern: line1 },
                { id: 'rescued', position: 'B2' },
            ])
        ).toEqual([]);
    });

    it('returns EMPTY when no ship has a support pattern (damage-only team)', () => {
        expect(
            uncoveredAllyIds([
                { id: 'a', position: 'M2' },
                { id: 'b', position: 'B1' },
            ])
        ).toEqual([]);
    });

    it('treats a NON-support pattern as contributing no coverage', () => {
        expect(
            uncoveredAllyIds([
                { id: 'a', position: 'M2', pattern: parsePattern('Pattern-Cone-Range-1') },
                { id: 'b', position: 'B1' },
            ])
        ).toEqual([]);
    });
});
```

⚠️ Verify each expected footprint with `resolveCells` before trusting these; if one differs, fix the
**test's** expectation and report it, never the offset table.

Then surface it in `HealingCalculatorPage.tsx`: resolve each player ship's pattern via
`parseShipTargeting(getShipById(shipId))` when a ship is picked, call `uncoveredAllyIds`, and render a
warning naming the affected ships. Use the `card` class or an existing UI primitive — **no emojis**,
plain text plus a warning colour class. Wording should state the consequence, not just the fact, e.g.
*"Aegis is outside every supporter's pattern and will receive no healing. Move it, or move a
supporter."*

- [ ] **Step 9: Two Minors carried from Task 6's review**

- **A default currently outranks an explicit placement.** The adapter nominates the heal target for
  slot priority unconditionally, whether its slot came from the user or from `defaultHealTargetSlot`.
  Measured: `resolvePlayerSlots(['M2','T2','T2'], [2])` → `['M2','T1','T2']`, i.e. an ally the user
  **explicitly** parked on `T2` is moved to make room for the heal target's **default** pick. Healing
  is unaffected, but the ally's cell silently changes, which can change which ship is front-most and
  therefore who the enemy targets. Fix: nominate the heal target only when its slot came from the
  default path, so explicit beats default. Once every ship has a dropdown-chosen slot this goes
  largely inert — but it is wrong while defaults still exist.
- **The crowded-board guard asserts a floor, not a value.** `healingPositionalEnemy.test.ts`'s crowded
  leg uses `toBeGreaterThan(0)`; pin the actual expected total instead, so a future partial regression
  that lands the heal on a different covered recipient is caught.

- [ ] **Step 10: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20
git add -A
git commit -m "feat(healing): slot dropdowns, enemy hp/defence/security, uncovered-placement warning"
```

Existing `HealingCalculatorPage` and `EnemyAttackersPanel` tests will need the new required config
fields added to their fixtures. That is expected mechanical churn, not a behavioural change.

⚠️ If any `.snap` moves, attribute it to a named cause and report it. This task is UI + config state;
the only sim-visible change is that positions and enemy HP/defence/security now reach the adapter, so
a moved healing golden means a fixture's board changed — explain it, never re-pin blind.

---

### Task 9: Per-recipient breakdown table, docs, changelog

**Files:**
- Create: `src/components/calculator/HealingRecipientBreakdown.tsx`
- Test: `src/components/calculator/__tests__/HealingRecipientBreakdown.test.tsx`
- Modify: `src/pages/calculators/HealingCalculatorPage.tsx`, `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts`

**Interfaces:**
- Produces: `HealingRecipientBreakdown: React.FC<{ recipients: RecipientRow[]; healTargetId: string; nameFor: (id: string) => string }>` where `RecipientRow = { id: string; effectiveHealing: number; overheal: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/calculator/__tests__/HealingRecipientBreakdown.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealingRecipientBreakdown } from '../HealingRecipientBreakdown';

const NAMES: Record<string, string> = {
    'heal-target': 'Aegis',
    'ally-two': 'Lionheart',
};

describe('HealingRecipientBreakdown', () => {
    it('shows a row per recipient with DISTINCT names', () => {
        render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => NAMES[id] ?? id}
                recipients={[
                    { id: 'heal-target', effectiveHealing: 12400, overheal: 800 },
                    { id: 'ally-two', effectiveHealing: 2050, overheal: 410 },
                ]}
            />
        );
        // ⚠️ Distinct names are load-bearing: with duplicates both assertions could match the
        // SAME rendered row and the test would pass while observing one recipient (#318 class).
        expect(screen.getByText('Aegis')).toBeInTheDocument();
        expect(screen.getByText('Lionheart')).toBeInTheDocument();
    });

    it('marks the heal target as the primary row', () => {
        render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => NAMES[id] ?? id}
                recipients={[
                    { id: 'ally-two', effectiveHealing: 2050, overheal: 410 },
                    { id: 'heal-target', effectiveHealing: 12400, overheal: 800 },
                ]}
            />
        );
        expect(screen.getByText('Primary')).toBeInTheDocument();
    });

    it('shows a team total row', () => {
        render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => NAMES[id] ?? id}
                recipients={[
                    { id: 'heal-target', effectiveHealing: 12400, overheal: 800 },
                    { id: 'ally-two', effectiveHealing: 2050, overheal: 410 },
                ]}
            />
        );
        expect(screen.getByText('Team total')).toBeInTheDocument();
        expect(screen.getByText('14,450')).toBeInTheDocument();
    });

    it('renders nothing when there is no per-recipient data', () => {
        const { container } = render(
            <HealingRecipientBreakdown
                healTargetId="heal-target"
                nameFor={(id) => id}
                recipients={[]}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/calculator/__tests__/HealingRecipientBreakdown.test.tsx`
Expected: FAIL — cannot resolve `../HealingRecipientBreakdown`.

- [ ] **Step 3: Implement with `DataTable`**

Create `src/components/calculator/HealingRecipientBreakdown.tsx`:

```tsx
import React from 'react';
import { DataTable, Column } from '../ui/tables/DataTable';
import { SectionHeader } from '../ui/SectionHeader';

export interface RecipientRow {
    id: string;
    effectiveHealing: number;
    overheal: number;
}

interface Props {
    recipients: RecipientRow[];
    healTargetId: string;
    nameFor: (id: string) => string;
}

interface DisplayRow extends RecipientRow {
    isPrimary: boolean;
    isTotal: boolean;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/**
 * Per-ally healing breakdown. Since SP-3 a heal follows the caster's support PATTERN, so several
 * allies can be repaired by one cast; the configured heal target stays the PRIMARY row because
 * every existing chart reads that actor's numbers.
 */
export const HealingRecipientBreakdown: React.FC<Props> = ({
    recipients,
    healTargetId,
    nameFor,
}) => {
    if (recipients.length === 0) return null;

    // Heal target first, then the rest in descending effective healing.
    const ordered = [...recipients].sort((a, b) => {
        if (a.id === healTargetId) return -1;
        if (b.id === healTargetId) return 1;
        return b.effectiveHealing - a.effectiveHealing;
    });

    const rows: DisplayRow[] = [
        ...ordered.map((r) => ({ ...r, isPrimary: r.id === healTargetId, isTotal: false })),
        {
            id: '__total__',
            effectiveHealing: ordered.reduce((n, r) => n + r.effectiveHealing, 0),
            overheal: ordered.reduce((n, r) => n + r.overheal, 0),
            isPrimary: false,
            isTotal: true,
        },
    ];

    const columns: Column<DisplayRow>[] = [
        {
            key: 'ship',
            label: 'Ship',
            render: (row) => (row.isTotal ? 'Team total' : nameFor(row.id)),
        },
        {
            key: 'role',
            label: '',
            render: (row) =>
                row.isPrimary ? <span className="text-xs text-primary">Primary</span> : null,
        },
        {
            key: 'effective',
            label: 'Effective healing',
            align: 'right',
            render: (row) => fmt(row.effectiveHealing),
        },
        {
            key: 'overheal',
            label: 'Overheal',
            align: 'right',
            render: (row) => fmt(row.overheal),
        },
    ];

    return (
        <div className="card">
            <SectionHeader title="Healing by ally" />
            <DataTable
                data={rows}
                columns={columns}
                getRowKey={(row) => row.id}
                rowClassName={(row) => (row.isTotal ? 'font-semibold' : '')}
            />
        </div>
    );
};
```

**No emojis** — plain text plus colour classes. If `text-primary` is not a class in this project,
substitute the accent class the surrounding calculator components already use.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/calculator/__tests__/HealingRecipientBreakdown.test.tsx`
Expected: all four PASS.

- [ ] **Step 5: Mount it on the page and update the docs**

Add the component to `HealingCalculatorPage`, then update `src/pages/DocumentationPage.tsx` to describe: placement, that heals now follow the caster's pattern, that enemies can die, and that a saved page may need re-placing.

- [ ] **Step 6: Add the changelog entry BEFORE committing**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES`:

```
The healing calculator now fights a real, positioned enemy team. Heals follow
your healer's actual targeting pattern, so they can reach several allies at
once, and the report breaks healing down per ally. Enemies have real HP and
defence and can be destroyed, which reduces the damage coming at you. Because
placement now matters, open a saved healing page and check where your ships are
standing — an unplaced heal target may not be taking any damage.
```

- [ ] **Step 7: Browser-verify**

```bash
npm start
```

Open `/healing`. Confirm: slot dropdowns render and persist; a collision auto-resolves; the per-recipient table populates; enemy HP/defence/security are editable; an AoE-pattern healer spreads healing across allies.

- [ ] **Step 8: Full verification and commit**

```bash
npx tsc --noEmit && npm run lint && npm test 2>&1 | tail -20 && npm run audit
git add -A
git commit -m "feat(healing): per-recipient breakdown table, docs, changelog"
```

Then open PR 3c.

---

## Post-merge

- [ ] Re-verify `main` green after each merge; delete each branch local + remote.
- [ ] Confirm no production caller reaches the dummy: `grep -rn "isDummyEnemy\|dpsEnemyTarget\|dummyEnemyIsVestigial" src/ | grep -v __tests__` — every remaining hit should be engine-internal, with no calculator adapter supplying an empty `enemyAttackers`.
- [ ] Update `[[project_dps_real_enemy_and_buff_timeline]]`: mark SP-3 shipped, record durable lessons, and note SP-4 is unblocked.
- [ ] File the deferred finding from spec §3.1: the battle sim's `teamBattle` → `lowestHpAllyId` routing applies to every player single-`ally` heal, though only Volk's passive should behave that way.
