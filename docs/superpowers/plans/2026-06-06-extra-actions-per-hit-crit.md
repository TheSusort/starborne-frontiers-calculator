# Extra Actions + Per-Hit Crit Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last two DPS-side mechanic gaps: extra actions (queue re-insertion, full extra turn) and per-hit crit checks for multi-hit skills, plus a Chakara passive-damage lock test.

**Architecture:** Per-hit crits replace the single per-turn `roundCrit` draw with N deterministic gate draws (N = the firing skill's hit count) and a blended crit multiplier — algebraically identical for single-hit skills, so zero golden churn is EXPECTED. Extra actions ride a new `extra-action` ability type through the existing parse → gate → turn pipeline; the engine's per-round turn queue becomes a mutable array re-inserting the granting actor at its speed position.

**Tech Stack:** TypeScript, Vitest, existing combat engine (`src/utils/combat/`), skill parser (`src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`).

**Spec:** `docs/superpowers/specs/2026-06-06-extra-actions-per-hit-crit-design.md` — read it first. Game-verified rules there are binding.

---

## Project conventions (read before any task)

- **Pre-commit hook runs the full suite (~2 min). NEVER `--no-verify` for code commits.** Docs-only commits may use it.
- **Golden parity suite** (`src/utils/calculators/__tests__/dpsGoldenParity.test.ts`, 19 scenarios) is the referee. ZERO churn allowed in this plan — if ANY existing snapshot changes, STOP, investigate, and hand-verify before proceeding; do not rationalize churn. NEVER run `vitest -u`. New scenarios self-write their snapshot on first run; then hand-verify the values.
- **Changelog:** there is ONE evolving DPS entry in `UNRELEASED_CHANGES` (`src/constants/changelog.ts`). EDIT THAT ENTRY IN PLACE — do not add a new entry.
- **docs/ is gitignored** — use `git add -f` for files under `docs/`.
- **No RegExp lookbehind** anywhere in `src/` (iOS Safari 15 in browserslist).
- The engine core never compares against the literal `'attacker'` — key on ids.
- Run a single test file: `npx vitest run <path>`. Full suite: `npm test`.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 0.1:** Create the branch and commit the spec + plan onto it:

```bash
git checkout -b feat/combat-engine-extra-actions-per-hit-crit
git add -f docs/superpowers/plans/2026-06-06-extra-actions-per-hit-crit.md
git commit --no-verify -m "docs: implementation plan for extra actions + per-hit crits"
```

(The spec is already committed on main and carried by the branch.)

---

### Task 1: Per-hit crit draws + blended crit multiplier

**Files:**
- Modify: `src/utils/combat/events.ts` (~line 36, the `ability-performed` variant)
- Modify: `src/utils/combat/playerTurn.ts:920-929` (draw site) and `:1050-1080` (multiplier + emit)
- Test: `src/utils/combat/__tests__/perHitCrit.test.ts` (create)

**Background:** Today line 927 draws ONE binary `roundCrit` per turn from the per-actor accumulator gate (`activeCritGate`/`chargedCritGate`), and line 1054 applies the full crit multiplier to the whole turn. `damageNoCrit` comes from the UNGATED firing skill (line 590: `damageInputsFromSkill(firingSkill).noCrit`). The hit count is available the same way (`damageInputsFromSkill` returns `hits`, defaulting 1 — including when the skill has NO damage ability, which today still draws once; keep that schedule).

**Key invariant (zero-churn proof):** for `hits === 1`, exactly one draw happens (same as today) and the blended multiplier `1 + (critHits/hits) × critDamage/100` equals today's binary `roundCrit ? 1 + critDamage/100 : 1`. For `noCrit`, zero draws happen (same as today: the gate does not advance). The only behavioral change is multi-hit skills WITHOUT noCrit — no existing golden fixture has one (verified: the only `hits:` fixture is scenario 3, `hits: 3, noCrit: true`).

**Gate semantics note:** before writing test expectations, read `makeRateGate` (grep `makeRateGate` in `src/utils/combat/` — it's the deterministic accumulator). Hand-compute the expected crit pattern from its actual accumulate-and-fire rule; do not guess. The tests below use crit rates of 100/0/50 where the pattern is unambiguous, but confirm the 50% alternation phase against the real implementation.

- [ ] **Step 1.1: Write the failing tests**

Create `src/utils/combat/__tests__/perHitCrit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { CombatEvent } from '../events';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ph${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const multiHitSkills = (hits: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100, hits } }),
            ],
        },
    ],
});

const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 0,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

const collectEvents = (input: DPSSimulationInput): CombatEvent[] => {
    const events: CombatEvent[] = [];
    const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
    const bus = {
        on: (type: string, fn: (e: CombatEvent) => void) => {
            const arr = listeners.get(type) ?? [];
            arr.push(fn);
            listeners.set(type, arr);
        },
        emit: (e: CombatEvent) => {
            events.push(e);
            for (const fn of listeners.get(e.type) ?? []) fn(e);
        },
    };
    simulateDPS({ ...input, bus: bus as never });
    return events;
};

describe('per-hit crit checks', () => {
    it('100% crit on a 3-hit skill: every hit crits, full crit multiplier', () => {
        const result = simulateDPS({ ...BASE, shipSkills: multiHitSkills(3) });
        // attack 10000 × 300% multiplier × (1 + 3/3 × 100/100) = 60000/round, 0 defense
        expect(result.rounds[0].totalRoundDamage).toBe(60000);
        expect(result.rounds[0].didCrit).toBe(true);
    });

    it('0% crit on a 3-hit skill: no hit crits', () => {
        const result = simulateDPS({ ...BASE, crit: 0, shipSkills: multiHitSkills(3) });
        expect(result.rounds[0].totalRoundDamage).toBe(30000);
        expect(result.rounds[0].didCrit).toBe(false);
    });

    it('50% crit on a 2-hit skill: exactly one hit crits per turn (accumulator)', () => {
        const result = simulateDPS({ ...BASE, crit: 50, shipSkills: multiHitSkills(2) });
        // Per turn: two draws at 0.5 → accumulator fires on the second draw each turn.
        // attack 10000 × 200% × (1 + 1/2 × 100/100) = 30000 every round.
        for (const row of result.rounds) {
            expect(row.totalRoundDamage).toBe(30000);
            expect(row.didCrit).toBe(true);
        }
    });

    it('emits critHits on ability-performed when hits crit', () => {
        const events = collectEvents({ ...BASE, shipSkills: multiHitSkills(3) });
        const performed = events.filter((e) => e.type === 'ability-performed');
        expect(performed.length).toBeGreaterThan(0);
        for (const e of performed) {
            expect(e).toMatchObject({ didCrit: true, critHits: 3 });
        }
    });

    it('single-hit skill: no critHits beyond 1, didCrit matches schedule', () => {
        const events = collectEvents({ ...BASE, crit: 50, shipSkills: multiHitSkills(1) });
        const performed = events.filter(
            (e) => e.type === 'ability-performed' && e.didCrit
        ) as Extract<CombatEvent, { type: 'ability-performed' }>[];
        for (const e of performed) expect(e.critHits).toBe(1);
    });
});
```

NOTE: adjust the `collectEvents` bus shape to the real `CombatEventBus` interface (read `src/utils/combat/events.ts` — there may be a `createEventBus` export to reuse instead of the hand-rolled object; prefer reusing it).

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run src/utils/combat/__tests__/perHitCrit.test.ts`
Expected: FAIL — multi-hit rounds compute `60000` only if every hit crits via per-hit logic; today the single roundCrit gives 3-hit damage `multiplier×3 × (1+1.0)` = also 60000 at 100% crit… **so the 100%/0% tests may PASS today.** The 50%-crit 2-hit test MUST fail today (today: roundCrit alternates true/false per turn → damage alternates 40000/20000; after: constant 30000). The `critHits` event tests must fail (field absent).

- [ ] **Step 1.3: Implement — events.ts**

In the `ability-performed` variant of `CombatEvent` add after `didCrit?: boolean;`:

```ts
          /** Number of individual hits that crit this cast (per-hit crit checks).
           *  Present only when > 0; `didCrit` stays the any-hit binary. */
          critHits?: number;
```

- [ ] **Step 1.4: Implement — playerTurn.ts draw site**

Replace lines 923-929 (the `roundCrit` declaration and its comment):

```ts
    // Per-hit crit checks (game-verified 2026-06-06): each hit of a multi-hit skill
    // draws the deterministic crit gate INDIVIDUALLY. Draw count = the UNGATED firing
    // skill's hit count (schedule is cast-based like the old single draw — gating
    // never changes the number of draws; a skill with no damage ability keeps the
    // legacy hits=1 default → one draw, unchanged schedule). A noCrit attack draws
    // nothing (the gate does not advance — unchanged). Decided AFTER the modifier
    // fold-in so the draws use the final effective crit rate; modifierCtx above
    // deliberately keeps the probability-based estimate (see spec).
    const drawHits = damageNoCrit ? 0 : damageInputsFromSkill(firingSkill).hits;
    const critGate = action === 'charged' ? chargedCritGate : activeCritGate;
    let critHits = 0;
    for (let h = 0; h < drawHits; h++) {
        if (critGate(effectiveCrit / 100)) critHits += 1;
    }
    // Any-hit binary: feeds ctx self-crit gates, the RoundData row, and didCrit.
    const roundCrit = critHits > 0;
```

(`chargedCritGate`/`activeCritGate` are destructured from `runtime` earlier in the function — check the existing destructure near the top and reuse those locals.)

- [ ] **Step 1.5: Implement — playerTurn.ts multiplier + emit**

Replace lines 1052-1054 (the `damageCritMultiplier` declaration and comment):

```ts
    // Blended per-hit crit multiplier: critHits of drawHits hits crit, each at the
    // full (1 + critDamage) multiplier. Algebraically identical to splitting the
    // skill multiplier + secondary + conditional bonus evenly across hits and
    // critting each hit individually — so totals match per-hit expectation without
    // restructuring the damage assembly. drawHits 0 (noCrit) → fraction 0 →
    // multiplier 1 (the "cannot critically hit" path, unchanged).
    const critFraction = drawHits > 0 ? critHits / drawHits : 0;
    const damageCritMultiplier = 1 + critFraction * (effectiveCritDamage / 100);
```

In the `ability-performed` emit (lines 1071-1080) add after `didCrit: roundCrit,`:

```ts
        ...(critHits > 0 ? { critHits } : {}),
```

- [ ] **Step 1.6: Run the new tests**

Run: `npx vitest run src/utils/combat/__tests__/perHitCrit.test.ts`
Expected: PASS (all 5).

- [ ] **Step 1.7: Verify ZERO golden churn**

Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected: PASS, 19/19, **no snapshot writes** (check the vitest summary says "0 written"/"0 updated"). If any scenario churns, STOP — the single-hit identity is broken; debug before continuing.

- [ ] **Step 1.8: Run adjacent suites**

Run: `npx vitest run src/utils/combat/ src/utils/calculators/`
Expected: PASS. `engine.events.test.ts` assertions on `ability-performed` may fail if they use exact-equality on event objects that now carry `critHits` — update those assertions (test-only change; the field is additive and correct).

- [ ] **Step 1.9: Commit**

```bash
git add src/utils/combat/events.ts src/utils/combat/playerTurn.ts src/utils/combat/__tests__/perHitCrit.test.ts src/utils/combat/__tests__/engine.events.test.ts
git commit -m "feat: per-hit crit checks for multi-hit skills (blended crit multiplier, critHits event field)"
```

---

### Task 2: on-crit triggers fire once per critting hit

**Files:**
- Modify: `src/utils/combat/triggers.ts:128-132` (the `on-crit` case)
- Test: `src/utils/combat/__tests__/perHitCrit.test.ts` (extend) and/or `src/utils/combat/__tests__/triggers.test.ts` (follow its existing listener-test pattern)

- [ ] **Step 2.1: Write the failing test** (append to `perHitCrit.test.ts`):

```ts
    it('on-crit follow-up fires once PER CRITTING HIT (3-hit @100% crit → 3 enqueues/turn)', () => {
        // Reactive charge-on-crit: +1 charge per crit event. chargeCount 6 so the
        // cadence makes the per-turn gain visible: 3 gains/turn → charged on round 3
        // (2 turns × 3 + the active-turn bank).
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100, hits: 3 } }),
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-crit',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                    ],
                },
            ],
        };
        const result = simulateDPS({ ...BASE, chargeCount: 6, shipSkills: skills });
        // Hand-verify the charge column: each active turn banks +1 (cadence) and the
        // 3 crit events add +3 via the executor. Assert the first charged round
        // arrives EARLIER than the no-trigger cadence (round 7) — compute the exact
        // round by reading the charge column and lock it.
        const firstCharged = result.rounds.find((rw) => rw.action === 'charged')?.round;
        expect(firstCharged).toBeDefined();
        expect(firstCharged!).toBeLessThan(7);
        expect(result.rounds.map((rw) => `${rw.round}:${rw.action}:${rw.charges}`)).toMatchSnapshot();
    });
```

The snapshot self-writes on first run — **hand-verify the charge arithmetic** (per active turn: +1 bank at turn time, +3 from the three on-crit intents drained post-turn-body) before accepting it.

- [ ] **Step 2.2: Run to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/perHitCrit.test.ts -t "PER CRITTING HIT"`
Expected: FAIL — today the single ability-performed event with didCrit enqueues ONE intent per turn, so charging is slower than asserted.

- [ ] **Step 2.3: Implement** — in `registerReactiveListeners`, replace the `on-crit` case:

```ts
                case 'on-crit':
                    bus.on('ability-performed', (e) => {
                        if (e.actorId !== ownerId) return;
                        // Per-critting-hit (game-verified): 2 of 3 hits crit → the
                        // follow-up fires twice. Events without critHits fall back
                        // to the didCrit binary (one enqueue).
                        const n = e.critHits ?? (e.didCrit ? 1 : 0);
                        for (let i = 0; i < n; i++) enqueue(intent);
                    });
                    break;
```

- [ ] **Step 2.4: Run tests**

Run: `npx vitest run src/utils/combat/__tests__/perHitCrit.test.ts src/utils/combat/__tests__/triggers.test.ts`
Expected: PASS. Then re-verify goldens (Step 1.7 command) — scenario 17 has an on-crit reactive ability but its fixture is single-hit → `critHits` is 1 on crit turns → one enqueue, unchanged. Zero churn expected.

- [ ] **Step 2.5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/perHitCrit.test.ts
git commit -m "feat: on-crit triggers fire once per critting hit"
```

---

### Task 3: Golden scenario 20 — multi-hit crit + on-crit follow-up

**Files:**
- Modify: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts` (append after scenario 19)

- [ ] **Step 3.1:** Append a new scenario locking per-hit semantics end-to-end:

```ts
    // Scenario 20: per-hit crits — 3-hit active at 50% crit with an on-crit-charged
    // debuff follow-up. Locks the per-hit draw schedule, the blended crit multiplier,
    // and per-critting-hit trigger frequency. Added with the per-hit-crit increment
    // (2026-06-06); hand-verified.
    snap('per-hit crits (multi-hit + on-crit follow-up)', () => ({
        ...BASE,
        chargeCount: 4,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 90, hits: 3 },
                        }),
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-crit',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
            ],
        },
    }));
```

- [ ] **Step 3.2:** Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts`
Expected: 20 passing, exactly ONE new snapshot written (scenario 20), 19 untouched.

- [ ] **Step 3.3: HAND-VERIFY the new snapshot.** Open the snap file, walk rounds 1-3: BASE crit 50 → per-turn draws 3 × 0.5 (confirm the accumulator pattern from `makeRateGate`); damage per active round = `15000 × (90×3)/100 × (1 + (critHits/3) × 150/100) × defense/pen factors`; charge column = +1 bank + critHits per active turn. Write the arithmetic into the PR description notes file or commit message.

- [ ] **Step 3.4: Commit**

```bash
git add src/utils/calculators/__tests__/dpsGoldenParity.test.ts "src/utils/calculators/__tests__/__snapshots__/dpsGoldenParity.test.ts.snap"
git commit -m "test: golden scenario 20 locks per-hit crit draws + per-critting-hit triggers (hand-verified)"
```

---

### Task 4: `extra-action` ability type + parser detection

**Files:**
- Modify: `src/types/abilities.ts` (AbilityType union ~line 5, AbilityConfig union ~line 128)
- Modify: `src/utils/skillTextParser.ts` (new `parseExtraAction` near `parseChargeGain` ~line 845)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (`abilitiesFromText`, after the charge block ~line 770)
- Test: `src/utils/__tests__/skillTextParser.test.ts`, `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 4.1: Write the failing parser tests** (append to `skillTextParser.test.ts`, following its existing describe/import style):

```ts
describe('parseExtraAction', () => {
    // Real texts from docs/ship-skills.csv (tags included where the source has them).
    it('Nuqtu: charged, gated on enemy having 3+ buffs', () => {
        const r = parseExtraAction(
            'This Unit deals <unit-damage>200% damage</unit-damage>, including additional Damage equal to <unit-damage>80%</unit-damage> of its Defense, and an extra 40% for each buff on the enemy. If the target has 3 or more buffs, this Unit grants itself 1 extra End Of Round Action.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            conditions: [
                {
                    subject: 'enemy-buff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 3,
                },
            ],
        });
    });

    it('Sustainer: gated on self having no debuffs', () => {
        const r = parseExtraAction(
            'This Unit deals <unit-damage>205% damage</unit-damage> with an additional <unit-damage>30%</unit-damage> for each buff on it. If this Unit has no debuffs, it gains one extra action.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            conditions: [
                { subject: 'self-debuff', derivable: true, countComparator: 'eq', countThreshold: 0 },
            ],
        });
    });

    it('Tormenter: gated on self HP below 50%', () => {
        const r = parseExtraAction(
            'This Unit deals <unit-damage>180% damage</unit-damage> with a guaranteed critical hit. If its HP is below 50%, it <unit-aid>gains 1 Extra Action</unit-aid>.'
        );
        expect(r).toEqual({
            oncePerRound: false,
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 50,
                    hpSubject: 'self',
                },
            ],
        });
    });

    it('Liberator: unconditional, once per round', () => {
        const r = parseExtraAction(
            'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.'
        );
        expect(r).toEqual({ oncePerRound: true, conditions: [] });
    });

    it('Tygr: enemy-debuff presence approximation, once per round', () => {
        const r = parseExtraAction(
            "This Unit's attacks do not break <unit-skill>Stasis</unit-skill> and deal 30% more damage to enemies with <unit-skill>Stasis</unit-skill> or <unit-skill>Disable</unit-skill>. After damaging an enemy affected by <unit-skill>Stasis</unit-skill>, once per round, give one extra action."
        );
        expect(r).toEqual({
            oncePerRound: true,
            conditions: [
                { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 },
            ],
        });
    });

    it('disqualified: Sokol on-kill', () => {
        expect(
            parseExtraAction(
                'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn and grants one extra end of round action upon a kill, once per round.'
            )
        ).toBeNull();
    });

    it('disqualified: Harvester ally-destroyed', () => {
        expect(
            parseExtraAction(
                'When an allied Unit is destroyed, this Unit gains 1 extra end of round action and <unit-skill>Speed Up I</unit-skill> for 6 turns.'
            )
        ).toBeNull();
    });

    it('disqualified: Tithonus purge-count', () => {
        expect(
            parseExtraAction(
                'This Unit <unit-aid>gains 1 extra action</unit-aid> after it <unit-aid>purges</unit-aid> at least 4 <unit-aid>buffs</unit-aid> with a single skill.'
            )
        ).toBeNull();
    });

    it('no false positive on unrelated text', () => {
        expect(parseExtraAction('This Unit deals 150% damage.')).toBeNull();
        expect(parseExtraAction(null)).toBeNull();
    });
});
```

NOTE on Liberator: its sentence also contains "When an enemy dies" (the ALLY-charge clause). Clause scoping decides: the extra-action clause is "and once per round, this unit gains 1 extra action" — but `splitSentences` splits on `.`/`;`, so the whole "When an enemy dies, … gains 1 extra action" is ONE sentence and the disqualifier `when an enemy dies` WOULD match it. **Resolve by splitting the clause further at `, and ` boundaries before disqualifying** — see implementation Step 4.3. The test locks the correct outcome; let the test drive the comma-clause refinement.

- [ ] **Step 4.2: Run to verify failure**

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t parseExtraAction`
Expected: FAIL — `parseExtraAction` not exported.

- [ ] **Step 4.3: Implement `parseExtraAction`** in `src/utils/skillTextParser.ts`, after `parseChargeGain` (~line 893). `countGateCondition` and `splitSentences` are module-local in the same file; `Condition` is already imported:

```ts
// --- Extra actions ("extra End Of Round Action" / "extra action") --------------------

// Phrasings we deliberately DO NOT parse (annotation-only seams): on-kill (the enemy's
// death ends the sim), ally-destroyed (Phase 4 trigger), purge-count (purges are not
// modeled). The user can still add the ability manually in the editor. Reference:
// docs/ship-skills.csv (Sokol, Harvester, Tithonus).
const EXTRA_ACTION_DISQUALIFY_RE =
    /upon a kill|when an enemy dies|killing an enemy|allied unit is destroyed|ally is destroyed|purg/i;

// "gains/grants (itself) one|1|a|an extra (End Of Round) action" — incl. Tygr's
// imperative "give one extra action". Lookbehind-free.
const EXTRA_ACTION_RE =
    /\b(?:gains?|grants?|give)\s+(?:itself\s+)?(?:one|1|an?)\s+extra\s+(?:end\s+of\s+round\s+)?action\b/i;

// Tormenter: "If its HP is below 50%" — the unit's OWN HP (selfHpPct is fixed 100
// under DPS assumptions, so this correctly never fires until defense modeling lands).
const EXTRA_ACTION_SELF_HP_RE = /\b(?:its|this unit'?s?)\s+hp\s+is\s+below\s+(\d+)\s*%/i;

export interface ExtraActionParse {
    oncePerRound: boolean;
    conditions: Condition[];
}

/**
 * Parses an extra-action grant from skill text (game rule: a full extra turn,
 * re-inserted into the round's turn queue by speed). Clause-scoped: condition and
 * once-per-round detection run on the comma-subclause containing the match, so a
 * disqualifying phrase in a DIFFERENT subclause (Liberator's "When an enemy dies, …,
 * and once per round, this unit gains 1 extra action") can't suppress the grant.
 * Returns null for the annotation-only phrasings (EXTRA_ACTION_DISQUALIFY_RE).
 */
export function parseExtraAction(text: string | null | undefined): ExtraActionParse | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/<br\s*\/?>/gi, '. ');
    if (!EXTRA_ACTION_RE.test(plain)) return null;
    const sentence = splitSentences(plain).find((s) => EXTRA_ACTION_RE.test(s)) ?? plain;
    // Sub-clause scoping: split the sentence at ", and " / "; " boundaries and keep
    // the parts from the first one mentioning the grant — conditions that PRECEDE the
    // grant verb in the same sub-clause ("If the target has 3 or more buffs, this Unit
    // grants itself …") stay attached because they share the comma-clause.
    const parts = sentence.split(/,\s+and\s+/i);
    const clause = parts.find((p) => EXTRA_ACTION_RE.test(p)) ?? sentence;
    if (EXTRA_ACTION_DISQUALIFY_RE.test(clause)) return null;

    const conditions: Condition[] = [];
    const countGate = countGateCondition(clause);
    if (countGate) conditions.push(countGate);
    const hpMatch = EXTRA_ACTION_SELF_HP_RE.exec(clause);
    if (hpMatch) {
        conditions.push({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: parseInt(hpMatch[1], 10),
            hpSubject: 'self',
        });
    }
    // Tygr: "After damaging an enemy affected by Stasis" — approximated as
    // enemy-has-any-debuff (enemy-debuff conditions are name-agnostic by design in
    // evaluateCondition; see the §5 note added with this increment).
    if (/affected by stasis/i.test(clause)) {
        conditions.push({
            subject: 'enemy-debuff',
            derivable: true,
            countComparator: 'gte',
            countThreshold: 1,
        });
    }
    return { oncePerRound: /once per round/i.test(clause), conditions };
}
```

**Iterate on the clause-splitting against the 9 tests** — Nuqtu's condition sentence is "If the target has 3 or more buffs, this Unit grants itself 1 extra End Of Round Action." (no ", and") → clause = whole sentence → countGate attaches. Liberator's split isolates "once per round, this unit gains 1 extra action" → disqualifier in the earlier part doesn't fire. Tormenter has no ", and" → whole sentence. Tygr: "After damaging an enemy affected by Stasis, once per round, give one extra action." → no ", and" → whole sentence (Stasis + once-per-round both detected). Sokol: "…grants one extra end of round action upon a kill, once per round." — "upon a kill" is INSIDE the grant clause → disqualified. Harvester/Tithonus likewise.

- [ ] **Step 4.4:** Add the type to `src/types/abilities.ts`:

In `AbilityType` (after `'charge'`):
```ts
    | 'extra-action'
```
In `AbilityConfig` (after the charge variant):
```ts
    // A full extra turn: the engine re-inserts the granting actor into the round's
    // remaining turn queue at its speed position (game-verified 2026-06-06).
    | { type: 'extra-action'; oncePerRound: boolean }
```

Run `npx tsc --noEmit` (or `npm run lint`) — exhaustive `Record<AbilityType, …>` maps and switches will now error. Fix them all in this step (at minimum `src/components/skills/AbilityTypePicker.tsx` TYPE_LABELS, `src/components/skills/abilityDefaults.ts` makeDefaultConfig + DEFAULT_TARGETS — full editor work is Task 5; here just make the maps compile):

- `TYPE_LABELS`: `'extra-action': 'Extra Action',`
- `makeDefaultConfig`: `case 'extra-action': return { type: 'extra-action', oncePerRound: false };`
- `DEFAULT_TARGETS`: `'extra-action': 'self',`
- Grep for other exhaustive sites: `grep -rn "Record<AbilityType" src/ --include="*.ts*"` and `grep -rn "case 'charge'" src/ --include="*.ts*"` — handle each the same way.

- [ ] **Step 4.5: Wire into `abilitiesFromText`** (`buildShipAbilities.ts`, after the charge-ability block ~line 772). Import `parseExtraAction` at top:

```ts
    const extra = parseExtraAction(text);
    if (extra) {
        // Raw-text anchor, matching the charge block's convention (text.search) —
        // stripUnitTags is module-local to skillTextParser and NOT exported.
        const extraPos = text.search(/extra\s+(?:end\s+of\s+round\s+)?action/i);
        out.push({
            ability: {
                id: nextId(),
                type: 'extra-action',
                target: 'self',
                trigger: 'on-cast',
                conditions: extra.conditions,
                config: { type: 'extra-action', oncePerRound: extra.oncePerRound },
                autoFilled: true,
            },
            pos: extraPos >= 0 ? extraPos : MAX_POS,
        });
    }
```

NOTE: `pos` anchors index into the RAW text elsewhere (charge uses `text.search`) — match the existing convention: use `text.search(/extra\s+(?:end\s+of\s+round\s+)?action/i)` on the raw text (the phrase contains no tags in the sources; Tormenter's is inside `<unit-aid>` but the inner text matches the same regex). Verify against the Tormenter test below.

- [ ] **Step 4.6: buildShipAbilities tests** (append to `buildShipAbilities.test.ts`, following its fixture style):

```ts
describe('extra-action abilities', () => {
    it('parses Liberator third passive into an extra-action ability', () => {
        const ship = makeShip({
            refits: [1, 2, 3, 4],
            thirdPassiveSkillText:
                'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.',
        });
        const skills = buildShipAbilities(ship);
        const passive = skills.slots.find((s) => s.slot === 'passive');
        const extraAbility = passive?.abilities.find((a) => a.type === 'extra-action');
        expect(extraAbility).toMatchObject({
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'extra-action', oncePerRound: true },
        });
    });

    it('parses Nuqtu charged skill into a gated extra-action ability', () => {
        const ship = makeShip({
            chargeSkillText:
                'This Unit deals <unit-damage>200% damage</unit-damage>, including additional Damage equal to <unit-damage>80%</unit-damage> of its Defense, and an extra 40% for each buff on the enemy. If the target has 3 or more buffs, this Unit grants itself 1 extra End Of Round Action.',
            chargeSkillCharge: 4,
        });
        const skills = buildShipAbilities(ship);
        const charged = skills.slots.find((s) => s.slot === 'charged');
        const extraAbility = charged?.abilities.find((a) => a.type === 'extra-action');
        expect(extraAbility?.conditions).toEqual([
            { subject: 'enemy-buff', derivable: true, countComparator: 'gte', countThreshold: 3 },
        ]);
    });
});
```

(Adapt `makeShip` to the file's existing ship-fixture helper — read the top of the test file first; there is one.)

- [ ] **Step 4.7:** Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts src/utils/abilities/ && npm run lint`
Expected: PASS, no lint warnings. Also run the goldens (no parser fixture feeds them — hand-built abilities — zero churn).

- [ ] **Step 4.8: Commit**

```bash
git add src/types/abilities.ts src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts src/components/skills/AbilityTypePicker.tsx src/components/skills/abilityDefaults.ts src/utils/__tests__/skillTextParser.test.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat: extra-action ability type parsed from skill text (Nuqtu/Sustainer/Tormenter/Liberator/Tygr; on-kill/ally-destroyed/purge phrasings annotation-only)"
```

---

### Task 5: Editor surface for `extra-action`

**Files:**
- Modify: `src/components/skills/AbilityTypePicker.tsx` (CATEGORIES)
- Modify: `src/components/skills/AbilityCard.tsx` (summary + edit fields)
- Test: `src/components/skills/__tests__/` (follow existing patterns — check what AbilityCard/SkillEditorModal tests exist and extend minimally)

- [ ] **Step 5.1:** In `AbilityTypePicker.tsx` CATEGORIES, change the Charge row:

```ts
    { label: 'Charge & Turns', types: ['charge', 'extra-action'] },
```

- [ ] **Step 5.2:** In `AbilityCard.tsx`: read the file's per-type rendering structure first (the `ability.type === 'charge'` block at ~line 595 is the closest model). Add:
  - A summary line for extra-action (e.g. `+1 extra action` plus `once per round` when set).
  - An edit control: a `Checkbox` (from `src/components/ui/` — never raw input) bound to `config.oncePerRound`.
  Follow the file's existing onChange/config-update plumbing exactly.

- [ ] **Step 5.3:** Check `src/components/skills/__tests__/` for AbilityCard/type-picker tests that enumerate types; extend them to cover the new type (render an extra-action card; toggle oncePerRound).

- [ ] **Step 5.4:** Run: `npx vitest run src/components/skills/ && npm run lint`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/skills/
git commit -m "feat: extra-action ability editing in the skill editor"
```

---

### Task 6: `extraActionsFromSkill` helper + player-turn output

**Files:**
- Modify: `src/utils/abilities/applyAbilities.ts` (new helper next to `accumulatorsFromSkill` ~line 250)
- Modify: `src/utils/combat/playerTurn.ts` (PlayerTurnResult ~line 61; collect grants after `gatedPassive` ~line 1005; return them)
- Test: `src/utils/abilities/__tests__/applyAbilities.test.ts`

- [ ] **Step 6.1: Failing test** (append to `applyAbilities.test.ts`):

```ts
describe('extraActionsFromSkill', () => {
    it('collects on-cast extra-action abilities; skips other types and non-cast triggers', () => {
        const skill: Skill = {
            slot: 'active',
            abilities: [
                {
                    id: 'x1',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: true },
                },
                {
                    id: 'x2',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-ally-destroyed',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: false },
                },
                {
                    id: 'x3',
                    type: 'charge',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'charge', amount: 1 },
                },
            ],
        };
        expect(extraActionsFromSkill(skill)).toEqual([{ abilityId: 'x1', oncePerRound: true }]);
        expect(extraActionsFromSkill(undefined)).toEqual([]);
    });
});
```

- [ ] **Step 6.2:** Run; expect FAIL (not exported).

- [ ] **Step 6.3: Implement** in `applyAbilities.ts`:

```ts
/** An extra-action grant collected from a (pre-gated) skill. The engine re-inserts
 *  the granting actor into the round's remaining turn queue once per descriptor,
 *  enforcing oncePerRound per actor per round. */
export interface ExtraActionGrant {
    abilityId: string;
    oncePerRound: boolean;
}

/** `extra-action` abilities on the skill that fire on cast. Conditions are already
 *  hard-gated by gateFiringAbilities (failing entries were dropped); non-on-cast
 *  triggers (annotation-only seams) are skipped defensively. */
export function extraActionsFromSkill(skill: Skill | undefined): ExtraActionGrant[] {
    if (!skill) return [];
    const out: ExtraActionGrant[] = [];
    for (const ability of skill.abilities) {
        if (ability.config.type !== 'extra-action') continue;
        if (ability.trigger !== 'on-cast') continue;
        out.push({ abilityId: ability.id, oncePerRound: ability.config.oncePerRound });
    }
    return out;
}
```

- [ ] **Step 6.4: playerTurn.ts** — import `extraActionsFromSkill` (extend the existing `applyAbilities` import block at line 12-22). Add to `PlayerTurnResult` (after `detonationDamage`):

```ts
    /** Extra-action grants this turn fired (pre-gated). The ENGINE owns queue
     *  re-insertion + the oncePerRound/backstop bookkeeping. */
    extraActionGrants: ExtraActionGrant[];
```

After the `passiveMultiplier` computation (~line 1005), collect:

```ts
    // Extra-action grants (game-verified: a full extra turn; the engine re-inserts
    // this actor into the round's remaining queue by speed). Sourced from the FIRING
    // skill + the always-active passive slot, both pre-gated by gateFiringAbilities.
    const extraActionGrants = [
        ...extraActionsFromSkill(gatedSkill),
        ...extraActionsFromSkill(gatedPassive),
    ];
```

Add `extraActionGrants,` to the returned result object (find the `return {` near the end of `runPlayerTurn`).

- [ ] **Step 6.5:** Run: `npx vitest run src/utils/abilities/ src/utils/combat/ src/utils/calculators/`
Expected: PASS, zero golden churn (the new result field is engine-internal; RoundData untouched).

- [ ] **Step 6.6: Commit**

```bash
git add src/utils/abilities/applyAbilities.ts src/utils/abilities/__tests__/applyAbilities.test.ts src/utils/combat/playerTurn.ts
git commit -m "feat: player turns surface gated extra-action grants"
```

---

### Task 7: Engine queue re-insertion + caps + `RoundData.extraTurns`

**Files:**
- Modify: `src/utils/combat/engine.ts` (loop at line 869; constants near `MAX_INTENT_GENERATIONS`; row literal at ~line 1213)
- Modify: `src/utils/calculators/dpsSimulator.ts` (RoundData interface ~line 90)
- Test: `src/utils/combat/__tests__/extraActions.test.ts` (create)

- [ ] **Step 7.1: Write the failing tests.** Create `src/utils/combat/__tests__/extraActions.test.ts` (reuse the `ab`/BASE/event-tap helpers pattern from `perHitCrit.test.ts`; extract shared helpers into a small local module ONLY if both files need them — otherwise duplicate, the suites stay independent):

```ts
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ea${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Liberator-style: plain active damage + passive once-per-round extra action. */
const extraActionSkills = (oncePerRound = true): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'extra-action',
                    target: 'self',
                    config: { type: 'extra-action', oncePerRound },
                }),
            ],
        },
    ],
});

const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 0,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

describe('extra actions', () => {
    it('once-per-round passive doubles each round (two full focus turns)', () => {
        const result = simulateDPS({ ...BASE, shipSkills: extraActionSkills() });
        for (const row of result.rounds) {
            expect(row.totalRoundDamage).toBe(20000); // 2 × (10000 × 100%)
            expect(row.extraTurns).toBe(1);
        }
        // Baseline sanity: no extra-action ability → 10000/round, extraTurns absent.
        const baseline = simulateDPS({
            ...BASE,
            shipSkills: {
                slots: [extraActionSkills().slots[0]],
            },
        });
        expect(baseline.rounds[0].totalRoundDamage).toBe(10000);
        expect(baseline.rounds[0].extraTurns).toBeUndefined();
    });

    it('faster granter acts again immediately; slower granter re-enters after the enemy', () => {
        const turnStarts: string[] = [];
        const bus = makeTapBus((e) => {
            if (e.type === 'turn-started') turnStarts.push(e.actorId);
        });
        simulateDPS({
            ...BASE,
            rounds: 1,
            speed: 100,
            enemySpeed: 50,
            shipSkills: extraActionSkills(),
            bus,
        });
        expect(turnStarts).toEqual(['attacker', 'attacker', 'enemy']);

        const slowStarts: string[] = [];
        simulateDPS({
            ...BASE,
            rounds: 1,
            speed: 40,
            enemySpeed: 50,
            shipSkills: extraActionSkills(),
            bus: makeTapBus((e) => {
                if (e.type === 'turn-started') slowStarts.push(e.actorId);
            }),
        });
        expect(slowStarts).toEqual(['enemy', 'attacker', 'attacker']);
    });

    it('oncePerRound caps re-grants from the extra turn itself', () => {
        // The passive re-fires on the extra turn; without the cap this would insert
        // a third turn. Locked by the 2-turn assertions above; this asserts the cap
        // key resets per round (extra turn happens EVERY round, not just round 1).
        const result = simulateDPS({ ...BASE, rounds: 3, shipSkills: extraActionSkills() });
        expect(result.rounds.map((r) => r.extraTurns)).toEqual([1, 1, 1]);
    });

    it('un-capped unconditional grant hits the backstop and throws', () => {
        expect(() =>
            simulateDPS({ ...BASE, shipSkills: extraActionSkills(false) })
        ).toThrow(/extra/i);
    });

    it('per-turn ticking: a 1-turn self-buff from the regular turn is gone on the extra turn', () => {
        // Active grants itself a 1-turn +100% attack buff ability; the passive grants
        // the extra action. Turn 1 damage is unbuffed (same-turn application decrements
        // at post-turn... verify against the engine's same-turn decrement rule) — the
        // REAL assertion: turn 2's damage equals turn 1's (the buff did NOT persist
        // into the extra turn), i.e. round total = 2 × turn-1 damage.
        // Build the buff via the abilityBuff helper pattern used in dpsGoldenParity
        // scenario 'ability buffs/debuffs unconditioned' — read that fixture and mirror it.
        // Assert totalRoundDamage === 2 × (single-turn damage with the same buff timing
        // from a no-extra-action baseline run).
    });
});
```

Implement `makeTapBus` per the real `CombatEventBus` interface (check `src/utils/combat/events.ts` for a factory to reuse). Flesh out the per-turn ticking test against the actual same-turn decrement semantics (read the Post-Turn comment at engine.ts:1106 — same-turn applications DO decrement at the owner's post turn) — the buff timing baseline must come from a comparison run, not hand-waving.

- [ ] **Step 7.2:** Run; expect FAIL (`extraTurns` undefined, single turn per round).

- [ ] **Step 7.3: Implement — engine.ts.** Add at engine.ts module scope (note: `MAX_INTENT_GENERATIONS` is defined in triggers.ts and only IMPORTED into engine.ts — this new constant is engine-local, so define it near the top of engine.ts alongside that import):

```ts
/** Backstop for pathological extra-action loops (a non-once-per-round grant whose
 *  conditions stay true re-fires on the extra turn it granted). Real texts are
 *  self-limited (charged-skill grants consume charges; passive grants are once per
 *  round), so any round needing more than this is a config/parser bug. */
const MAX_EXTRA_TURNS_PER_ROUND = 8;
```

Replace the loop header at line 869 and add the grant plumbing:

```ts
        // Per-round extra-action bookkeeping: oncePerRound abilities fire at most once
        // per actor per round (key `${actorId}:${abilityId}`); total insertions are
        // backstopped. The queue is MUTABLE within the round — grants splice the
        // granting actor back in at its speed position among the REMAINING actors
        // (game-verified: re-added to the turn queue; acts immediately only when
        // fastest remaining). Equal-speed remaining actors keep their place (they were
        // already in line) — deterministic, consistent with the accepted Phase-2
        // tiebreak simplification.
        const extraActionFired = new Set<string>();
        let extraTurnInsertions = 0;
        const processExtraActionGrants = (
            qi: number,
            granter: CombatActor,
            grants: ExtraActionGrant[]
        ): void => {
            for (const g of grants) {
                const key = `${granter.id}:${g.abilityId}`;
                if (g.oncePerRound && extraActionFired.has(key)) continue;
                if (g.oncePerRound) extraActionFired.add(key);
                extraTurnInsertions += 1;
                if (extraTurnInsertions > MAX_EXTRA_TURNS_PER_ROUND) {
                    throw new Error(
                        `combat round ${r}: extra-action insertions exceeded ` +
                            `MAX_EXTRA_TURNS_PER_ROUND (${MAX_EXTRA_TURNS_PER_ROUND}) — ` +
                            `an extra-action grant is re-firing without bound`
                    );
                }
                let insertAt = qi + 1;
                while (
                    insertAt < queue.length &&
                    queue[insertAt].stats.speed >= granter.stats.speed
                ) {
                    insertAt += 1;
                }
                queue.splice(insertAt, 0, granter);
            }
        };

        for (let qi = 0; qi < queue.length; qi++) {
            const actor = queue[qi];
```

(Close the loop with the matching brace — the body is otherwise unchanged. `buildTurnQueue` already returns a fresh array each round, so splicing is safe.)

In the ATTACKER branch, after `lastTurnCtxByActor.set(actor.id, turn.turnCtx);` (line 922):

```ts
                // Extra-action grants from this turn re-insert the attacker into the
                // remaining queue (full extra turn — charge cadence, post-turn
                // decrement, and triggers all run again on the inserted iteration).
                processExtraActionGrants(qi, actor, turn.extraActionGrants);
```

In the WALKED TEAM branch, after `lastTurnCtxByActor.set(actor.id, teamTurn.turnCtx);` (line 974):

```ts
                processExtraActionGrants(qi, actor, teamTurn.extraActionGrants);
```

Import `ExtraActionGrant` from `../abilities/applyAbilities`.

- [ ] **Step 7.4: RoundData field.** In `dpsSimulator.ts` `RoundData` (after `teamDamage?`):

```ts
    /** Number of EXTRA focus-actor turns this round (extra actions). Set only when
     *  ≥ 1 — undefined preserves the legacy RoundData shape (golden snapshots). */
    extraTurns?: number;
```

In engine.ts row literal (after the `teamDamage` spread line 1228):

```ts
            ...(focusTurns.length > 1 ? { extraTurns: focusTurns.length - 1 } : {}),
```

- [ ] **Step 7.5:** Run: `npx vitest run src/utils/combat/__tests__/extraActions.test.ts`
Expected: PASS. Then FULL goldens + combat suite: `npx vitest run src/utils/combat/ src/utils/calculators/` — zero churn (no existing fixture has an extra-action ability; the loop rewrite is behavior-preserving for static queues).

- [ ] **Step 7.6: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/calculators/dpsSimulator.ts src/utils/combat/__tests__/extraActions.test.ts
git commit -m "feat: extra actions re-insert the granting actor into the turn queue (speed-ordered, once-per-round caps, backstop)"
```

---

### Task 8: Golden scenario 21 — extra action end-to-end

**Files:**
- Modify: `src/utils/calculators/__tests__/dpsGoldenParity.test.ts`

- [ ] **Step 8.1:** Append:

```ts
    // Scenario 21: extra actions — Liberator-style once-per-round passive grant with
    // a charged cadence (the extra turn ADVANCES the cadence: banks a charge on
    // active turns, fires the charged skill when full — full-normal-turn rule).
    // Added with the extra-actions increment (2026-06-06); hand-verified.
    snap('extra action (once-per-round passive, charged cadence)', () => ({
        ...BASE,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 250 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'extra-action',
                            target: 'self',
                            config: { type: 'extra-action', oncePerRound: true },
                        }),
                    ],
                },
            ],
        },
    }));
```

- [ ] **Step 8.2:** Run the golden suite; exactly one new snapshot written, 20 untouched.

- [ ] **Step 8.3: HAND-VERIFY:** with chargeCount 3 (BASE) and two turns/round, charges bank +1 per ACTIVE turn; trace the action column round-by-round (e.g. r1: active+active → 2 charges… verify when the charged skill fires WITHIN a round — the extra turn can itself be the charged turn) and check the damage arithmetic for two rounds minimum, including the crit gate draws (BASE crit 50 — two draws/round now, one per turn). Write the trace into the commit message.

- [ ] **Step 8.4: Commit**

```bash
git add src/utils/calculators/__tests__/dpsGoldenParity.test.ts "src/utils/calculators/__tests__/__snapshots__/dpsGoldenParity.test.ts.snap"
git commit -m "test: golden scenario 21 locks extra-action turns + cadence interaction (hand-verified)"
```

---

### Task 9: Chakara passive-damage lock test

**Files:**
- Modify: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`

- [ ] **Step 9.1:** Append (verifying the already-working behavior, per spec §4):

```ts
    it('Chakara third passive: round-start damage proc parses as a passive damage ability', () => {
        const ship = makeShip({
            refits: [1, 2, 3, 4],
            thirdPassiveSkillText:
                'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.',
        });
        const skills = buildShipAbilities(ship);
        const passive = skills.slots.find((s) => s.slot === 'passive');
        const dmg = passive?.abilities.find((a) => a.type === 'damage');
        expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 60 } });
    });
```

- [ ] **Step 9.2:** Run; expected PASS immediately (locks the status quo). If the buffs' lowest-speed condition gap shows up as a missing buff ability, that is OUT OF SCOPE — note it in `docs/skill-model-coverage.md` §6 in Task 10.

- [ ] **Step 9.3: Commit**

```bash
git add src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "test: lock Chakara round-start damage proc parsing (passive payload hit)"
```

---

### Task 10: UI marker, docs, coverage doc, changelog

**Files:**
- Modify: `src/components/calculator/DPSRoundChart.tsx` (~line 112, next to the didCrit marker)
- Modify: `src/pages/DocumentationPage.tsx` (DPS section)
- Modify: `docs/skill-model-coverage.md` (§5 + §6)
- Modify: `src/constants/changelog.ts` (the ONE evolving DPS entry)

- [ ] **Step 10.1: DPSRoundChart tooltip:** read the tooltip block around line 112 (`roundData?.didCrit && (…)`); add a sibling line rendered when `roundData?.extraTurns`:

```tsx
{roundData?.extraTurns ? (
    <div className="text-xs text-theme-text-secondary">
        +{roundData.extraTurns} extra turn{roundData.extraTurns > 1 ? 's' : ''}
    </div>
) : null}
```

Match the surrounding markup/classes exactly (no emojis — project convention).

- [ ] **Step 10.2: DocumentationPage:** find the DPS calculator section; add one short paragraph: multi-hit skills crit-check per hit (on-crit effects fire per critting hit), and "extra action" skills (Nuqtu, Sustainer, Liberator, Tygr, Tormenter) grant a full additional turn re-entering the turn order by speed.

- [ ] **Step 10.3: Coverage doc** (`docs/skill-model-coverage.md`):
  - §5 (game-verified rules): add the three verified rules — extra action = full normal turn, re-inserted into the queue by speed (immediate only when fastest remaining); durations tick per turn taken; per-hit crit checks with on-crit firing per critting hit.
  - §5: note the Tygr approximation (enemy-debuff presence stands in for named-Stasis — enemy-debuff conditions are name-agnostic by design).
  - §6 (backlog): REMOVE item 7 (per-hit crits — now implemented); ADD: Sokol on-kill / Harvester ally-destroyed / Tithonus purge-count extra actions (annotation-only seams, Phase 4); ADD Chakara lowest-speed buff condition if Step 9.2 surfaced it.

- [ ] **Step 10.4: Changelog:** edit the ONE evolving DPS entry in `UNRELEASED_CHANGES` in place — append plain-English mention of extra actions and per-hit crits. DO NOT add a new entry.

- [ ] **Step 10.5:** Run: `npm run lint && npx vitest run src/components/`
Expected: clean.

- [ ] **Step 10.6: Commit**

```bash
git add src/components/calculator/DPSRoundChart.tsx src/pages/DocumentationPage.tsx src/constants/changelog.ts
git add -f docs/skill-model-coverage.md
git commit -m "feat: extra-turn marker in round tooltip; docs + coverage + changelog for extra actions / per-hit crits"
```

---

### Task 11: Full verification + audit + PR

- [ ] **Step 11.1:** Full suite: `npm test` — expected all green (~1280+ tests).
- [ ] **Step 11.2:** `npm run lint` — zero warnings.
- [ ] **Step 11.3:** Audit sweep: `npm run audit:skills` — confirm the extra-action ships now parse (spot-check Liberator/Nuqtu/Tygr in the report; Sokol/Harvester/Tithonus absent by design). No unexpected new findings.
- [ ] **Step 11.4:** Golden inventory check: `git diff main --stat -- "*.snap"` shows ONLY additions (scenarios 20, 21) — zero modified lines in pre-existing snapshot entries.
- [ ] **Step 11.5:** Live verification WITH THE USER (do not skip; coordinate in-session): dev server on localhost:3002 (reuse the running Vite instance — the user's 212-ship fleet lives on that origin; pages with 200+ ships exceed snapshot token limits, use `evaluate_script`; ShipSelector option clicks need full pointerdown→click MouseEvent sequences). Verify: **Liberator** (extra turn every round, dashed combined line if teamed), **Nuqtu** (extra action only when enemy-buff count ≥3 configured), an **Enforcer-style multi-hit on-crit ship** (per-hit crit frequency), and **Chakara** (60% proc present).
- [ ] **Step 11.6:** Push and open the PR (merge commit convention, branch kept):

```bash
git push -u origin feat/combat-engine-extra-actions-per-hit-crit
gh pr create --title "feat: extra actions + per-hit crit checks (DPS increments 1+2)" --body "..."
```

PR body: summarize the two mechanics, the verified game rules, the zero-churn golden result + two new hand-verified scenarios, and the annotation-only seams. End with the standard generated-with footer.
- [ ] **Step 11.7:** Wait for CodeRabbit; triage findings (fix or skip-with-reason, reply in-thread), wait for its re-review, merge when clean.

---

## KNOWN-DIFF register (golden policy)

| Change | Expected churn | Why |
|---|---|---|
| Per-hit crit draws | **NONE** | Single-hit: 1 draw + identical multiplier. Multi-hit fixtures: only scenario 3, which is noCrit (0 draws before and after). |
| Blended crit multiplier | **NONE** | `1 + (critHits/hits)×cd` ≡ binary multiplier at hits=1. |
| `critHits` event field | **NONE** in snapshots | Events aren't snapshotted; `engine.events.test` assertion updates are test-code-only. |
| on-crit per-critting-hit | **NONE** | Scenario 17's on-crit fixture is single-hit → critHits ≤ 1. |
| Queue loop rewrite (for-of → indexed) | **NONE** | Behavior-identical for static queues. |
| `RoundData.extraTurns` | **NONE** | Conditional spread — absent without extra turns (teamDamage pattern). |
| New scenarios 20, 21 | additions only | Self-written, then hand-verified per Tasks 3/8. |

Any deviation from "NONE" = stop and investigate; do not regenerate.
