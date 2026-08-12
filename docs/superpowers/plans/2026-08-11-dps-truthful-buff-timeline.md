# SP-2 — Truthful Buff Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DPS calculator's displayed buff numbers and per-round status chips come from the combat engine's own live state instead of a parallel static conversion, then delete the static path.

**Architecture:** The engine already emits everything needed and no engine emission changes. `runCombat` emits `stats-snapshot` (once per actor TURN, at turn start) and `status-snapshot` (once per actor at the ROUND TAIL). `simulateDPS` already wraps `input.bus` in an emit-only collector (added by SP-1 for `ship-destroyed`/`hp-changed`); this plan extends that same collector to also capture both snapshot types, filtered to the focus actor and the real enemy roster, and hangs them on `RoundData` rows. A new pure module turn-weight-averages the stat snapshots for the summary panel; the round-tail status names become chips in the existing `DPSBuffPanel`. The page's static `configShipSkillsToSimInputs` preview path then has no consumer and is deleted.

**Tech Stack:** TypeScript, React 18, Vitest + React Testing Library, TailwindCSS.

## Global Constraints

- **No engine change.** The only edit under `src/utils/combat/` in this plan is a doc comment in `events.ts` (Task 4). If any task seems to need an engine change, stop and report — the sequencing (SP-1 first) exists precisely so SP-2 needs none.
- **Zero golden movement.** `npm test` must show no snapshot updates. `src/utils/calculators/__tests__/__snapshots__/dpsGoldenParity.test.ts.snap` is 8900 lines of full `simulateDPS` results; an unconditionally-attached `RoundData` field would rewrite all of it. That is why the collection is behind an opt-in input flag (Task 1). **Never run `vitest -u`.**
- **Percentage stats are integers** (`crit: 70` means 70%, not 0.70) — `PERCENTAGE_ONLY_STATS` convention. Fixtures must match.
- **No emojis in UI text** — plain text plus colour classes.
- **UI components:** use `src/components/ui/` primitives; never hand-roll cards, modals or inputs. Status chips reuse the existing chip markup already in `ShipConfigSummary.tsx:96`.
- **Determinism in tests:** the engine is NOT deterministic (`rateAccumulator.ts` uses `Math.random`). Every sim test calls `setupKeyedTestRng(12345); resetRateGateRng();` in `beforeEach`, as `dpsRealEnemy.integration.test.ts:64-69` does.
- **Changelog:** add a plain-English line to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` before the final commit (Task 7).

## Spec deviations (deliberate — flagged for the reviewer)

The spec is `docs/superpowers/specs/2026-08-11-dps-real-enemy-and-buff-timeline-epic-design.md`, section "SP-2". All four LOCKED decisions are honoured. Three Component-level details differ, each verified against the running code:

1. **Opt-in flag instead of "optional throughout".** The spec assumed optional fields leave goldens untouched. They do not: a focus stats snapshot exists in *every* round of *every* run, so the field would always be present and `dpsGoldenParity.test.ts.snap` (whole-result snapshot) would gain thousands of lines. `collectStatusTimeline?: boolean` keeps the goldens byte-identical, which turns "zero golden movement" into the proof that SP-2 is display-only.
2. **Chips land in `DPSBuffPanel`, not `RoundTooltip`.** The panel is the existing per-round status surface (hover-driven, already renders `activeSelfBuffs` / `activeEnemyDebuffs` / DoT state). The tooltip is already dense. The spec's intent — "no new page surface" — is better served by the panel.
3. **`enemyStatuses` is keyed by actor id, not collapsed to one entry.** SP-1 follow-up #318 fixed exactly this shape defect in `finalHpPct` (it read `enemyAttackers[0]`). A roster is not its first member.

**Also corrected:** the spec's Testing item 1 says the DPS chips were "assembled by ACCUMULATING buff-applied/debuff-applied ... no removal path". That is the *battle simulator's* history (see the `status-snapshot` doc in `events.ts:518`), not the DPS panel's. Verified by probe: `RoundData.activeSelfBuffs` / `activeEnemyDebuffs` come from `playerTurn`'s live per-turn view and already drop expired statuses. What the round-tail snapshot genuinely adds is (a) a *round-tail* instant rather than a *focus-turn* instant — these legitimately differ, e.g. a self-buff granted on the focus's own turn is live at the next turn-start snapshot but already gone at that round's tail — and (b) two channels the DPS UI has never had: the attacker's own DEBUFFS and the enemy's own BUFFS, both newly reachable because SP-1 made the enemy a real, acting actor. Task 6 covers (b) and is explicitly droppable.

## Ground truth from probing (do not re-derive)

Run against `simulateDPS` with a real positioned enemy, an active damage kit that also applies `Attack Down` (enemy) and `Attack Up` (self):

```text
STATS  [{attacker,r1,20000},{enemy-1,r1,5000},{attacker,r2,26000},{enemy-1,r2,5000},{attacker,r3,26000},...]
STATUS [{attacker,r1,buffs:["Attack Up"],debuffs:[]},{enemy,r1,[],[]},{enemy-1,r1,[],debuffs:["Attack Down"]}, ...]
```

- `stats-snapshot` fires for `attacker` **at turn start**, so round 1 reads the *pre-cast* attack (20000) and rounds 2+ read the buffed one (26000). This is intended (each snapshot describes the stats that turn's damage was dealt under) and must be stated in the module doc, or a reviewer will read round 1 as a bug.
- With a once-per-round `extra-action` passive the focus emits **two** `stats-snapshot` events in the same round — confirmed: `[{attacker,r2,20000},{attacker,r2,26000}]`. That is the weighting rule made real.
- `status-snapshot` fires for **three** actor ids: `attacker`, `enemy` (the vestigial dummy — always empty lists), and `enemy-1` (the real enemy, carrying `debuffNames: ["Attack Down"]`). Filtering to the focus id + the real enemy roster drops the dummy for free.
- **`enemy-1` carrying its own debuff names is SP-2's whole premise, and it already works with zero engine change** — this is what SP-1 unblocked (`ownerDebuffNamesFor` reads `snapshot(undefined, targetId)` keyed by the actor id; the DPS dummy keyed its debuffs under the global `__enemy__` sentinel instead).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/calculators/dpsSimulator.ts` | modify | New input flag, three new optional `RoundData` fields, collector extension |
| `src/utils/calculators/roundStatsAverage.ts` | create | Pure turn-weighted average over `RoundData[]` |
| `src/components/calculator/ShipConfigSummary.tsx` | modify | Crit multiplier + buffed-stat row from the engine average; loses `attackerBuffTotals` |
| `src/components/calculator/ShipConfigCard.tsx` | modify | Stops threading `attackerBuffTotals` |
| `src/pages/calculators/DPSCalculatorPage.tsx` | modify | Deletes three memos + one prop; passes `collectStatusTimeline: true` |
| `src/components/calculator/DPSBuffPanel.tsx` | modify | "End of Round" chip section |
| `src/utils/abilities/configToSimInputs.ts` | modify | Delete `configShipSkillsToSimInputs` (keep the two builders) |
| `src/utils/abilities/buffAbilityConverters.ts` | modify | Delete 4 now-dead exports + 1 private helper |
| `src/types/calculator.ts` | modify | Delete `AttackerBuffTotals` (no remaining reference) |
| `src/utils/combat/events.ts` | modify | Doc-comment reword on both snapshot events |
| `src/constants/changelog.ts` | modify | `UNRELEASED_CHANGES` entry |
| `src/pages/DocumentationPage.tsx` | modify | In-app docs for the new summary line + chips |
| `src/utils/calculators/__tests__/dpsStatusTimeline.integration.test.ts` | create | Collector behaviour |
| `src/utils/calculators/__tests__/roundStatsAverage.test.ts` | create | Weighting unit tests |
| `src/components/calculator/__tests__/ShipConfigSummary.test.tsx` | create | Summary reads the average |
| `src/components/calculator/__tests__/DPSBuffPanel.test.tsx` | create | Chip rendering |

---

### Task 1: Collect the snapshot timeline onto `RoundData`

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts` (input type ~`:106`, `RoundData` ~`:126-227`, collector `:360-384`, attach near `:510`)
- Test: `src/utils/calculators/__tests__/dpsStatusTimeline.integration.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type RoundStatsSnapshot = Extract<CombatEvent, { type: 'stats-snapshot' }>['stats']` — `{ attack, defence, crit, critDamage, defensePenetration, speed, hacking, security, currentHp, maxHp, shieldPool }`, all `number`.
  - `export interface RoundActorStatuses { buffNames: string[]; debuffNames: string[] }`
  - `RoundData.focusStatsSnapshots?: RoundStatsSnapshot[]`
  - `RoundData.focusStatuses?: RoundActorStatuses`
  - `RoundData.enemyStatuses?: Record<string, RoundActorStatuses>`
  - `DPSSimulationInput.collectStatusTimeline?: boolean`

- [ ] **Step 1: Write the failing test**

Create `src/utils/calculators/__tests__/dpsStatusTimeline.integration.test.ts`:

```ts
/**
 * SP-2 Task 1: simulateDPS collects the engine's LOG-ONLY snapshot events onto RoundData.
 *
 * Non-vacuity anchors:
 *  - `enemy-1` carrying its own `Attack Down` proves the SP-1 premise (a real enemy keys its
 *    debuffs under its OWN id; the pre-SP-1 dummy keyed them under the `__enemy__` sentinel and
 *    this assertion would come back empty).
 *  - The extra-action case proves the per-TURN (not per-round) granularity the weighting rule needs.
 *  - The with-bus/without-bus equality proves the collector is a pure tap (Phase 3 emit-only
 *    contract): the sim's own numbers must not move because someone is watching.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';

const realEnemy = () => [
    {
        id: 'enemy-1',
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 150,
            speed: 40,
            defence: 1000,
            hp: 400000,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: DEFAULT_ENEMY_SLOT,
    },
];

/** Active slot: damage + a self buff + an enemy debuff, all on-cast. */
const kit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
                {
                    id: 'a2',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down',
                        parsedEffects: { attack: -30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                        // 'apply' is the guaranteed verb — an 'inflict' debuff can be RESISTED,
                        // which would make this fixture flaky against the landing-chance roll.
                        application: 'apply',
                    },
                },
                {
                    id: 'a3',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up',
                        parsedEffects: { attack: 30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                    },
                },
            ],
        },
    ],
});

/** Same kit plus a once-per-round extra action, so the focus takes TWO turns per round. */
const kitWithExtraAction = (): ShipSkills => ({
    slots: [
        ...kit().slots,
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'p1',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: true },
                },
            ],
        },
    ],
});

const baseInput = (): DPSSimulationInput => ({
    attack: 20000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 10000,
    enemyHp: 500000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 300000,
    hacking: 500,
    shipSkills: kit(),
    position: DEFAULT_ATTACKER_SLOT,
    enemyAttackers: realEnemy(),
});

describe('SP-2 status timeline collection', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('attaches one focus stats snapshot per focus turn when the flag is set', () => {
        const result = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        expect(result.rounds).toHaveLength(3);
        for (const round of result.rounds) {
            expect(round.focusStatsSnapshots).toHaveLength(1);
        }
        // Turn-START semantics: round 1's snapshot predates the cast that grants Attack Up, so it
        // reads the raw base attack; rounds 2+ read it buffed (+30%).
        expect(result.rounds[0].focusStatsSnapshots![0].attack).toBe(20000);
        expect(result.rounds[1].focusStatsSnapshots![0].attack).toBe(26000);
    });

    it('records TWO focus snapshots in a round where an extra action grants a second turn', () => {
        const result = simulateDPS({
            ...baseInput(),
            shipSkills: kitWithExtraAction(),
            collectStatusTimeline: true,
        });

        expect(result.rounds[0].focusStatsSnapshots).toHaveLength(2);
    });

    it('records the real enemy debuff names under the enemy actor id, not the dummy', () => {
        const result = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        // SP-1 is what makes this non-empty. Keyed by actor id — the dummy ('enemy') must not
        // appear at all, since it is not in the real roster.
        expect(result.rounds[0].enemyStatuses).toBeDefined();
        expect(Object.keys(result.rounds[0].enemyStatuses!)).toEqual(['enemy-1']);
        expect(result.rounds[0].enemyStatuses!['enemy-1'].debuffNames).toContain('Attack Down');
        expect(result.rounds[0].enemyStatuses).not.toHaveProperty('enemy');
    });

    it('records the focus actor round-tail buff names', () => {
        const result = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        expect(result.rounds[0].focusStatuses?.buffNames).toContain('Attack Up');
    });

    it('attaches nothing when the flag is absent (goldens stay byte-identical)', () => {
        const result = simulateDPS(baseInput());

        for (const round of result.rounds) {
            expect(round.focusStatsSnapshots).toBeUndefined();
            expect(round.focusStatuses).toBeUndefined();
            expect(round.enemyStatuses).toBeUndefined();
        }
    });

    it('does not change any damage number when collecting', () => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
        const off = simulateDPS(baseInput());
        setupKeyedTestRng(12345);
        resetRateGateRng();
        const on = simulateDPS({ ...baseInput(), collectStatusTimeline: true });

        expect(on.summary).toEqual(off.summary);
        expect(on.rounds.map((r) => r.totalRoundDamage)).toEqual(
            off.rounds.map((r) => r.totalRoundDamage)
        );
        expect(on.rounds.map((r) => r.cumulativeDamage)).toEqual(
            off.rounds.map((r) => r.cumulativeDamage)
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/dpsStatusTimeline.integration.test.ts`

Expected: FAIL. TypeScript errors on `collectStatusTimeline` / `focusStatsSnapshots` / `focusStatuses` / `enemyStatuses` not existing on their types (vitest reports these as transform-time errors), and the assertions on those fields fail. The last two tests ("attaches nothing", "does not change any damage number") will PASS already — that is correct and expected; they are regression fences, not drivers.

- [ ] **Step 3: Add the types**

In `src/utils/calculators/dpsSimulator.ts`, the `CombatEventBus` import at `:17` becomes:

```ts
import type { CombatEventBus, CombatEvent } from '../combat/events';
```

Add these exported types immediately above `export interface RoundData {` (~`:126`):

```ts
/** SP-2: one focus-actor turn-start stat reading. Derived from the engine's `stats-snapshot`
 *  payload rather than redeclared, so a stat added to the event cannot silently go missing here. */
export type RoundStatsSnapshot = Extract<CombatEvent, { type: 'stats-snapshot' }>['stats'];

/** SP-2: one actor's ROUND-TAIL status names (post decrement + drain). */
export interface RoundActorStatuses {
    buffNames: string[];
    debuffNames: string[];
}
```

Add to `DPSSimulationInput`, after the `bus?` field (~`:106`):

```ts
    /** SP-2: opt in to the display-only status timeline (`focusStatsSnapshots`, `focusStatuses`,
     *  `enemyStatuses` on each RoundData row). OFF by default and deliberately so: a focus stats
     *  snapshot exists in every round of every run, so attaching it unconditionally would rewrite
     *  the whole 8900-line `dpsGoldenParity` snapshot with display payload. Collection is a pure
     *  emit-only tap — no sim number depends on it, in either position. */
    collectStatusTimeline?: boolean;
```

Add to `RoundData`, after the `perActorIncoming` field (~`:217`):

```ts
    /** SP-2: every focus-actor `stats-snapshot` of this round, in turn order — 2+ entries when an
     *  extra action gave the focus a second turn, which is exactly what makes the summary's
     *  turn-weighted average expressible. Each reading is taken at TURN START, so it describes the
     *  stats that turn's damage was dealt under; round 1 therefore reads PRE-cast (an on-cast
     *  self-buff first appears in the next snapshot). Populated only under
     *  `collectStatusTimeline` — display-only, never read by the sim. */
    focusStatsSnapshots?: RoundStatsSnapshot[];
    /** SP-2: the focus actor's ROUND-TAIL status names — what it still carries after every
     *  decrement and drain. Distinct from `activeSelfBuffs`, which is the focus's own TURN-time
     *  view: a self-buff granted on the focus's own turn shows in both, but one that expires at
     *  the round tail shows only in the turn-time list. Populated only under
     *  `collectStatusTimeline`, and only when at least one name is present. */
    focusStatuses?: RoundActorStatuses;
    /** SP-2: round-tail status names per REAL enemy actor id (the vestigial dummy is filtered out —
     *  it keys its debuffs under the `__enemy__` sentinel and always reports empty). Keyed by id
     *  rather than collapsed to one entry: a roster is not its first member (the defect #318 fixed
     *  in `finalHpPct`). Populated only under `collectStatusTimeline`, and only for actors carrying
     *  at least one name. */
    enemyStatuses?: Record<string, RoundActorStatuses>;
```

- [ ] **Step 4: Extend the collector**

In `simulateDPS`, replace the block from `const realEnemyIds = new Set(...)` through the end of the `collectingBus` declaration (`:363-384`) with:

```ts
    const realEnemyIds = new Set((input.enemyAttackers ?? []).map((e) => e.id));
    const realEnemyDeathRound = new Map<string, number>();
    /** Last `hp-changed` percentage seen per real enemy. Integer-granular and only emitted on
     *  change, so a missing entry legitimately means "untouched" → 100. */
    const realEnemyHpPct = new Map<string, number>();

    // SP-2 display timeline, keyed by round. Collected only under the opt-in flag so the goldens
    // (whole-result snapshots) stay byte-identical for every existing caller.
    const collectTimeline = input.collectStatusTimeline === true;
    const focusStatsByRound = new Map<number, RoundStatsSnapshot[]>();
    const focusStatusByRound = new Map<number, RoundActorStatuses>();
    const enemyStatusByRound = new Map<number, Record<string, RoundActorStatuses>>();

    // Always a wrapper now (SP-1 built it only when a real enemy was present). `runCombat` treats
    // an external bus as a WRITE-ONLY tap that fans out before its own reactive listeners
    // (engine.ts:1695-1709), so wrapping is observation, never mutation — and forwarding to
    // `input.bus` last preserves the caller's view of the stream.
    const collectingBus: CombatEventBus = {
        on: () => {},
        emit: (e) => {
            if (
                e.type === 'ship-destroyed' &&
                realEnemyIds.has(e.actorId) &&
                !realEnemyDeathRound.has(e.actorId)
            ) {
                realEnemyDeathRound.set(e.actorId, e.round);
            }
            if (e.type === 'hp-changed' && realEnemyIds.has(e.targetId)) {
                realEnemyHpPct.set(e.targetId, e.newPct);
            }
            if (collectTimeline) {
                if (e.type === 'stats-snapshot' && e.actorId === FOCUS_ACTOR_ID) {
                    const forRound = focusStatsByRound.get(e.round);
                    if (forRound) forRound.push(e.stats);
                    else focusStatsByRound.set(e.round, [e.stats]);
                }
                if (e.type === 'status-snapshot') {
                    const statuses = { buffNames: e.buffNames, debuffNames: e.debuffNames };
                    if (e.actorId === FOCUS_ACTOR_ID) {
                        focusStatusByRound.set(e.round, statuses);
                    } else if (realEnemyIds.has(e.actorId)) {
                        const byId = enemyStatusByRound.get(e.round) ?? {};
                        byId[e.actorId] = statuses;
                        enemyStatusByRound.set(e.round, byId);
                    }
                }
            }
            input.bus?.emit(e);
        },
    };
```

Note the deleted `realEnemyIds.size > 0 ? … : input.bus` ternary — the wrapper is now unconditional. Nothing downstream reads `collectingBus` other than the `bus: collectingBus` argument to `runCombat`, so no other edit is needed there.

- [ ] **Step 5: Attach the collected rows**

In `simulateDPS`, immediately after the existing `if (perRoundFocusDamage) { … }` block and before the `return {` (~`:512`), insert:

```ts
    // Hang the display timeline on the REPORTED rows (post-kill-trim) — a round the run never
    // reported gets nothing, and each field stays absent when it has nothing to say, so a caller
    // that renders `?? []` shows an empty section rather than an empty-object artifact.
    if (collectTimeline) {
        for (const row of reportedRounds) {
            const stats = focusStatsByRound.get(row.round);
            if (stats && stats.length > 0) row.focusStatsSnapshots = stats;

            const focus = focusStatusByRound.get(row.round);
            if (focus && (focus.buffNames.length > 0 || focus.debuffNames.length > 0)) {
                row.focusStatuses = focus;
            }

            const enemies = enemyStatusByRound.get(row.round);
            if (enemies) {
                const carrying = Object.entries(enemies).filter(
                    ([, s]) => s.buffNames.length > 0 || s.debuffNames.length > 0
                );
                if (carrying.length > 0) row.enemyStatuses = Object.fromEntries(carrying);
            }
        }
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/dpsStatusTimeline.integration.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Verify no golden moved and types are clean**

Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts && npx tsc --noEmit && git status --short`

Expected: golden test PASSES with no snapshot written, `tsc` silent, and `git status` shows **no** modification to `src/utils/calculators/__tests__/__snapshots__/dpsGoldenParity.test.ts.snap`. If the `.snap` is modified, the flag gating is wrong — do not commit, fix the gate.

- [ ] **Step 8: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsStatusTimeline.integration.test.ts
git commit -m "feat(dps): collect the engine status timeline onto RoundData (SP-2 task 1)"
```

---

### Task 2: Turn-weighted average module

**Files:**
- Create: `src/utils/calculators/roundStatsAverage.ts`
- Test: `src/utils/calculators/__tests__/roundStatsAverage.test.ts` (create)

**Interfaces:**
- Consumes: `RoundData`, `RoundStatsSnapshot` from Task 1.
- Produces: `export function averageFocusStats(rounds: RoundData[]): RoundStatsSnapshot | undefined`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/calculators/__tests__/roundStatsAverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { averageFocusStats } from '../roundStatsAverage';
import type { RoundData, RoundStatsSnapshot } from '../dpsSimulator';

const snapshot = (over: Partial<RoundStatsSnapshot> = {}): RoundStatsSnapshot => ({
    attack: 10000,
    defence: 1000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 0,
    speed: 100,
    hacking: 200,
    security: 100,
    currentHp: 300000,
    maxHp: 300000,
    shieldPool: 0,
    ...over,
});

/** Minimal RoundData row — only the fields the average reads matter. */
const row = (snapshots?: RoundStatsSnapshot[]): RoundData =>
    ({
        round: 1,
        action: 'active',
        charges: 0,
        chargeCount: 0,
        didCrit: false,
        enemyHpPct: 100,
        directDamage: 0,
        corrosionDamage: 0,
        infernoDamage: 0,
        detonationDamage: 0,
        totalRoundDamage: 0,
        cumulativeDamage: 0,
        activeCorrosionStacks: 0,
        activeInfernoStacks: 0,
        activeBombCount: 0,
        activeSelfBuffs: [],
        activeEnemyDebuffs: [],
        resistedEnemyDebuffs: [],
        appliedDoTs: [],
        dotsLanded: true,
        activeDoTStates: [],
        ...(snapshots ? { focusStatsSnapshots: snapshots } : {}),
    }) satisfies RoundData;

describe('averageFocusStats', () => {
    it('returns undefined when no round carries a snapshot', () => {
        expect(averageFocusStats([row(), row()])).toBeUndefined();
    });

    it('returns undefined for an empty run', () => {
        expect(averageFocusStats([])).toBeUndefined();
    });

    it('averages a buff that lands mid-run to strictly between the two values', () => {
        const avg = averageFocusStats([
            row([snapshot({ attack: 10000 })]),
            row([snapshot({ attack: 13000 })]),
            row([snapshot({ attack: 13000 })]),
        ]);

        expect(avg!.attack).toBeCloseTo(12000, 6);
        expect(avg!.attack).toBeGreaterThan(10000);
        expect(avg!.attack).toBeLessThan(13000);
    });

    it('weights each TURN equally, so an extra action counts twice', () => {
        // Round 1: one turn at 10000. Round 2: two turns at 13000 (extra action).
        // Turn-weighted = (10000 + 13000 + 13000) / 3 = 12000.
        // Round-weighted would have been (10000 + 13000) / 2 = 11500 — the number this must NOT be.
        const avg = averageFocusStats([
            row([snapshot({ attack: 10000 })]),
            row([snapshot({ attack: 13000 }), snapshot({ attack: 13000 })]),
        ]);

        expect(avg!.attack).toBeCloseTo(12000, 6);
        expect(avg!.attack).not.toBeCloseTo(11500, 6);
    });

    it('averages every stat on the snapshot, not just attack', () => {
        const avg = averageFocusStats([
            row([snapshot({ crit: 0, critDamage: 100, defence: 0, shieldPool: 0 })]),
            row([snapshot({ crit: 100, critDamage: 200, defence: 2000, shieldPool: 5000 })]),
        ]);

        expect(avg!.crit).toBe(50);
        expect(avg!.critDamage).toBe(150);
        expect(avg!.defence).toBe(1000);
        expect(avg!.shieldPool).toBe(2500);
    });

    it('ignores rounds with no snapshot rather than counting them as zero', () => {
        const avg = averageFocusStats([row([snapshot({ attack: 10000 })]), row(), row()]);

        expect(avg!.attack).toBe(10000);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/roundStatsAverage.test.ts`
Expected: FAIL — `Failed to resolve import "../roundStatsAverage"`.

- [ ] **Step 3: Write the module**

Create `src/utils/calculators/roundStatsAverage.ts`:

```ts
import type { RoundData, RoundStatsSnapshot } from './dpsSimulator';

/**
 * Turn-weighted average of the focus attacker's live stats across a simulated run (SP-2).
 *
 * Each focus TURN weighs equally — not each round. `stats-snapshot` fires per turn, so a round in
 * which an extra action granted a second turn contributes two readings, and it should: the reading
 * is taken at turn start and describes the stats under which that turn's damage was dealt, so an
 * extra action legitimately earns extra weight. Turn-blocked turns (Stasis/Disable) still emit
 * `turn-started` and therefore still snapshot; they are included, matching the engine's
 * unconditional `turnsTaken` increment.
 *
 * Turn-START timing also means the FIRST reading of a run predates that turn's own cast — a ship
 * whose active skill buffs itself shows its unbuffed attack in round 1 and the buffed one after.
 * That is the honest description of the opening turn, not an off-by-one.
 *
 * Returns undefined when no round carries a snapshot (a run simulated without
 * `collectStatusTimeline`), so a caller renders nothing rather than a spurious zero.
 */
export function averageFocusStats(rounds: RoundData[]): RoundStatsSnapshot | undefined {
    const turns = rounds.flatMap((r) => r.focusStatsSnapshots ?? []);
    if (turns.length === 0) return undefined;

    const mean = (pick: (s: RoundStatsSnapshot) => number): number =>
        turns.reduce((sum, s) => sum + pick(s), 0) / turns.length;

    // Written out key by key deliberately: the return type makes a stat added to the engine's
    // snapshot payload a COMPILE error here, where a generic key-walk would silently drop it.
    return {
        attack: mean((s) => s.attack),
        defence: mean((s) => s.defence),
        crit: mean((s) => s.crit),
        critDamage: mean((s) => s.critDamage),
        defensePenetration: mean((s) => s.defensePenetration),
        speed: mean((s) => s.speed),
        hacking: mean((s) => s.hacking),
        security: mean((s) => s.security),
        currentHp: mean((s) => s.currentHp),
        maxHp: mean((s) => s.maxHp),
        shieldPool: mean((s) => s.shieldPool),
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/roundStatsAverage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/roundStatsAverage.ts src/utils/calculators/__tests__/roundStatsAverage.test.ts
git commit -m "feat(dps): turn-weighted average of the focus stat timeline (SP-2 task 2)"
```

---

### Task 3: The summary reads the engine, not the static conversion

Removing the `attackerBuffTotals` prop breaks the summary, the card and the page in one stroke — they compile only together, so this is one task.

**Files:**
- Modify: `src/components/calculator/ShipConfigSummary.tsx` (`:2`, `:25`, `:39`, `:59-69`, new row after `:122`)
- Modify: `src/components/calculator/ShipConfigCard.tsx` (`:38`, `:79`, `:311`, and the `AttackerBuffTotals` import)
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx` (`:20`, `:266-325`, `:708`, and the `simulateDPS` call ~`:350`)
- Test: `src/components/calculator/__tests__/ShipConfigSummary.test.tsx` (create)

**Interfaces:**
- Consumes: `averageFocusStats` (Task 2), `RoundData.focusStatsSnapshots` (Task 1).
- Produces: `ShipConfigSummaryProps` and `ShipConfigCardProps` no longer carry `attackerBuffTotals`.

- [ ] **Step 1: Write the failing test**

Create `src/components/calculator/__tests__/ShipConfigSummary.test.tsx`:

```tsx
/**
 * SP-2 Task 3: the summary's buffed numbers come from the engine's per-turn stat snapshots.
 *
 * The crit multiplier is the assertion with teeth: `calculateCritMultiplier` is
 * `1 + (min(crit,100)/100 * critDamage) / 100` — a pure function of crit and critDamage — so
 * feeding a snapshot that differs from the config's base stats proves which source the component
 * read. Base 50/150 gives 1.75x; snapshot 100/200 gives 3.00x. They cannot coincide.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShipConfigSummary } from '../ShipConfigSummary';
import type { DPSShipConfig } from '../../../types/calculator';
import type { DPSSimulationResult, RoundStatsSnapshot } from '../../../utils/calculators/dpsSimulator';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';

const config = (): DPSShipConfig => ({
    id: '1',
    name: 'Ship 1',
    attack: 10000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 200,
    defence: 0,
    hp: 0,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    allyChargePerRound: 0,
    shipSkills: buildDefaultShipSkills(),
});

const snapshot = (over: Partial<RoundStatsSnapshot> = {}): RoundStatsSnapshot => ({
    attack: 20000,
    defence: 0,
    crit: 100,
    critDamage: 200,
    defensePenetration: 0,
    speed: 100,
    hacking: 200,
    security: 100,
    currentHp: 0,
    maxHp: 0,
    shieldPool: 0,
    ...over,
});

const simResult = (snapshots?: RoundStatsSnapshot[]): DPSSimulationResult => ({
    rounds: [
        {
            round: 1,
            action: 'active',
            charges: 0,
            chargeCount: 0,
            didCrit: false,
            enemyHpPct: 100,
            directDamage: 1000,
            corrosionDamage: 0,
            infernoDamage: 0,
            detonationDamage: 0,
            totalRoundDamage: 1000,
            cumulativeDamage: 1000,
            activeCorrosionStacks: 0,
            activeInfernoStacks: 0,
            activeBombCount: 0,
            activeSelfBuffs: [],
            activeEnemyDebuffs: [],
            resistedEnemyDebuffs: [],
            appliedDoTs: [],
            dotsLanded: true,
            activeDoTStates: [],
            ...(snapshots ? { focusStatsSnapshots: snapshots } : {}),
        },
    ],
    summary: {
        totalDamage: 1000,
        avgDamagePerRound: 1000,
        survived: true,
        finalHpPct: 90,
        totalDirectDamage: 1000,
        totalCorrosionDamage: 0,
        totalInfernoDamage: 0,
        totalDetonationDamage: 0,
        totalSecondaryDamage: 0,
        totalConditionalDamage: 0,
    },
});

const renderSummary = (result: DPSSimulationResult) =>
    render(
        <ShipConfigSummary
            config={config()}
            simResult={result}
            isBest={false}
            isComparing={false}
            rounds={1}
            bestTotalDamage={undefined}
            bestVsSecondLabel={null}
            teamActors={[]}
            enemySpeed={50}
        />
    );

describe('ShipConfigSummary buffed stats', () => {
    it('derives the crit multiplier from the engine snapshot, not the config base stats', () => {
        renderSummary(simResult([snapshot()]));

        // 100% crit at 200% crit damage → 1 + (1 * 200)/100 = 3.00x. From the base stats
        // (50 crit / 150 cd) it would read 1.75x.
        expect(screen.getByText('3.00x')).toBeInTheDocument();
    });

    it('shows the turn-weighted buffed stat line', () => {
        renderSummary(simResult([snapshot({ attack: 20000 }), snapshot({ attack: 30000 })]));

        // (20000 + 30000) / 2 = 25000
        expect(screen.getByText(/25,000/)).toBeInTheDocument();
    });

    it('falls back to the config base stats and hides the line when no snapshot exists', () => {
        renderSummary(simResult());

        // 50% crit at 150% crit damage → 1 + (0.5 * 150)/100 = 1.75x
        expect(screen.getByText('1.75x')).toBeInTheDocument();
        expect(screen.queryByText(/Avg Buffed/)).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/calculator/__tests__/ShipConfigSummary.test.tsx`
Expected: FAIL — the component still requires the `attackerBuffTotals` prop (TS error) and renders `1.25x` for the first case.

- [ ] **Step 3: Rewrite the summary's stat derivation**

In `src/components/calculator/ShipConfigSummary.tsx`:

Change the import on `:2` from `import { DPSShipConfig, AttackerBuffTotals } from '../../types/calculator';` to:

```ts
import { DPSShipConfig } from '../../types/calculator';
```

Add after the `DPSSimulationResult` import (`:3`):

```ts
import { averageFocusStats } from '../../utils/calculators/roundStatsAverage';
```

Delete `attackerBuffTotals: AttackerBuffTotals;` from `ShipConfigSummaryProps` (`:25`) and `attackerBuffTotals,` from the destructured params (`:39`).

Replace the `critMultiplier` block (`:59-69`) with:

```tsx
    // SP-2: the buffed stats behind these numbers come from the engine's own per-turn
    // `stats-snapshot` readings, turn-weighted across the run — one authority, not a second static
    // conversion that could disagree with the damage number printed beside it. Undefined only when
    // the run was simulated without the timeline; then the config's unbuffed base stats are the
    // honest fallback.
    const avgStats = averageFocusStats(simResult.rounds);
    const critMultiplier = calculateCritMultiplier({
        attack: avgStats?.attack ?? config.attack,
        // The engine's fold can exceed 100 (the affinity cap is applied at the hit, not in the
        // fold), so keep clamping for display as this line always has.
        crit: Math.min(100, avgStats?.crit ?? config.crit),
        critDamage: avgStats?.critDamage ?? config.critDamage,
        hp: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        speed: 0,
        healModifier: 0,
    });
```

Insert this row immediately after the Crit Multiplier row (after `:122`'s closing `</div>`):

```tsx
            {avgStats && (
                <div className="flex justify-between mb-2">
                    <span className="text-theme-text-secondary">
                        Avg Buffed Attack / Crit / Crit DMG:
                    </span>
                    <span>
                        {Math.round(avgStats.attack).toLocaleString()} /{' '}
                        {Math.round(avgStats.crit)}% / {Math.round(avgStats.critDamage)}%
                    </span>
                </div>
            )}
```

- [ ] **Step 4: Stop threading the prop through the card**

In `src/components/calculator/ShipConfigCard.tsx`: delete `attackerBuffTotals: AttackerBuffTotals;` (`:38`), delete `attackerBuffTotals,` from the destructured params (`:79`), delete the `attackerBuffTotals={attackerBuffTotals}` JSX prop (`:311`), and drop `AttackerBuffTotals` from the `types/calculator` import at the top of the file (leave the other names in that import untouched).

- [ ] **Step 5: Delete the page's static preview memos and opt into the timeline**

In `src/pages/calculators/DPSCalculatorPage.tsx`:

1. Delete `configShipSkillsToSimInputs,` from the import block at `:20` (keep `buildDefaultShipSkills` / any sibling imports from that module).
2. Delete the whole `globalAttackerBuffTotals` memo (`:266-279`), the `convertedMap` memo with its comment (`:281-292`), and the `mergedAttackerBuffTotals` memo (`:294-325`). All three become unreachable once the prop is gone; `teamAttackerBuffs` (`:196`) stays — it is also used elsewhere.
3. Delete the `attackerBuffTotals={mergedAttackerBuffTotals.get(config.id)!}` prop at `:708`.
4. In the `simulateDPS({ … })` call, add `collectStatusTimeline: true,` immediately after `enemyType,` (~`:375`), with this comment:

```ts
                    // SP-2: opt into the display-only status timeline — the summary's buffed stats
                    // and the per-round chips both read it. Off by default so goldens stay clean.
                    collectStatusTimeline: true,
```

If step 2 leaves `teamAttackerBuffs` unused (check with `npx tsc --noEmit`), delete it too — but only if the compiler says so.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/calculator/__tests__/ShipConfigSummary.test.tsx && npx tsc --noEmit && npx eslint src/pages/calculators/DPSCalculatorPage.tsx src/components/calculator/ShipConfigCard.tsx src/components/calculator/ShipConfigSummary.tsx`

Expected: 3 tests PASS, `tsc` silent, eslint clean (no unused-variable errors — those mean a memo or import survived).

- [ ] **Step 7: Verify the page still renders end to end**

Run: `npx vitest run src/pages/calculators/__tests__/DPSCalculatorPage.realEnemy.test.tsx`
Expected: PASS, unchanged. This is the only page-level test; if it fails, the prop deletion broke the render tree.

- [ ] **Step 8: Commit**

```bash
git add src/components/calculator/ShipConfigSummary.tsx src/components/calculator/ShipConfigCard.tsx src/pages/calculators/DPSCalculatorPage.tsx src/components/calculator/__tests__/ShipConfigSummary.test.tsx
git commit -m "feat(dps): the summary's buffed stats come from the engine, not a static conversion (SP-2 task 3)"
```

---

### Task 4: Retire the dead static conversion path

**Files:**
- Modify: `src/utils/abilities/configToSimInputs.ts` (delete `configShipSkillsToSimInputs`, `:33-48`)
- Modify: `src/utils/abilities/buffAbilityConverters.ts` (delete `abilityToSelectedBuff`, `buildStaticBuffContext`, `staticGateConditions`, `buffAbilitiesToSelectedBuffs`, `selectedBuffsToBuffAbilities`)
- Modify: `src/types/calculator.ts` (delete `AttackerBuffTotals`, `:230-234`)
- Modify: `src/utils/combat/events.ts` (doc comments only)
- Modify: `src/utils/abilities/__tests__/configToSimInputs.test.ts`, `src/utils/abilities/__tests__/buffAbilityConverters.test.ts` (drop the tests for deleted exports)

**Interfaces:**
- Consumes: Task 3 removed the last production caller.
- Produces: nothing new. `selectedBuffToAbility` and the private `isEnemyTarget` **stay** — `buildShipAbilities.ts:3145` still calls the former. `buildDefaultShipSkills` / `buildEmptyShipSkills` stay.

- [ ] **Step 1: Confirm the deletions really are dead**

Run:

```bash
grep -rn --include="*.ts" --include="*.tsx" "configShipSkillsToSimInputs\|buildStaticBuffContext\|buffAbilitiesToSelectedBuffs\|selectedBuffsToBuffAbilities\|abilityToSelectedBuff\|AttackerBuffTotals" src | grep -v "__tests__"
```

Expected after Task 3: hits ONLY inside `src/utils/abilities/buffAbilityConverters.ts`, `src/utils/abilities/configToSimInputs.ts`, `src/types/calculator.ts` (the declarations themselves and their internal cross-references), plus a comment mention at `buildShipAbilities.ts:3475`. Any other production hit means Task 3 is incomplete — stop and fix that first, do not delete.

- [ ] **Step 2: Delete from `configToSimInputs.ts`**

Delete the `configShipSkillsToSimInputs` function and its whole preceding comment block (from `// Single seam for the page preview` through the closing brace), and the now-unused imports so the file's import block becomes exactly:

```ts
import { ShipSkills } from '../../types/abilities';
```

`buildDefaultShipSkills` and `buildEmptyShipSkills` and their comments remain untouched.

- [ ] **Step 3: Delete from `buffAbilityConverters.ts`**

Delete: `abilityToSelectedBuff` (with its preceding comment block), `buildStaticBuffContext` (with its comment block), `staticGateConditions` (with its comment block), `buffAbilitiesToSelectedBuffs`, and `selectedBuffsToBuffAbilities`.

Keep `isEnemyTarget` and `selectedBuffToAbility`. Trim the surviving comment above `isEnemyTarget` so it no longer claims to be shared with a deleted function — replace its first two lines with:

```ts
// Enemy-target classifier for selectedBuffToAbility: which AbilityTarget values are enemy-side, so
// a manual buff pick converted for an enemy-facing slot produces a debuff config (application verb,
// resistibility) instead of falling through to the 'buff' branch. Wave 5 (Task A2): the two
```

The import block becomes:

```ts
import { Ability, ShipSkills, AbilityTarget } from '../../types/abilities';
import { SelectedGameBuff } from '../../types/calculator';
```

Then confirm with `npx tsc --noEmit` — if `ShipSkills` is now unused there, drop it too.

- [ ] **Step 4: Delete `AttackerBuffTotals`**

In `src/types/calculator.ts`, delete the `AttackerBuffTotals` interface (`:230-234`). Leave `DefenseBuffTotals` — the Defense calculator still uses it.

- [ ] **Step 5: Prune the tests for deleted exports**

In `src/utils/abilities/__tests__/configToSimInputs.test.ts`: delete the entire `describe('configShipSkillsToSimInputs', …)` block (`:44` to its close) and any imports it alone used. Keep the `buildEmptyShipSkills` / `buildDefaultShipSkills` describes.

In `src/utils/abilities/__tests__/buffAbilityConverters.test.ts`: delete the `describe('abilityToSelectedBuff', …)`, `describe('buildStaticBuffContext', …)` and `describe('buffAbilitiesToSelectedBuffs', …)` blocks plus any block testing `selectedBuffsToBuffAbilities`, and trim the import list to what remains. Keep `describe('selectedBuffToAbility', …)` — but note the "round-trips application from a debuff ability back to the selected buff" case (`:154`) calls `abilityToSelectedBuff`; delete that one case with the rest and leave the other `selectedBuffToAbility` cases intact.

- [ ] **Step 6: Reword the two event doc contracts**

In `src/utils/combat/events.ts`, in the `stats-snapshot` doc comment (~`:487-493`), replace the sentence:

```text
 *  Exists SOLELY so `buildCombatLog` can attach a `statsSnapshot` to the turn view-model; folding
 *  it into any subscribed/aggregated path would be a bug.
```

with:

```text
 *  Two display-only consumers: `buildCombatLog` attaches it to the turn view-model, and
 *  `simulateDPS`'s emit-only collector turn-weights it into the DPS summary's buffed-stat average
 *  (SP-2). Aggregating it for DISPLAY is fine. What would be a bug is subscribing a combat
 *  listener to it, or letting a consumer feed anything back into combat state — the log-only
 *  contract is about influence, not about arithmetic.
```

In the `status-snapshot` doc comment (~`:513-522`), append after "the assembler prefers it over accumulation":

```text
 *  `simulateDPS` reads the same event for the DPS calculator's per-round chips (SP-2), filtered to
 *  the focus actor and the REAL enemy roster — the vestigial dummy also emits here, but it keys its
 *  debuffs under the `__enemy__` sentinel rather than its actor id, so its lists are always empty.
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/utils/abilities && npx tsc --noEmit && npx eslint src/utils/abilities src/types/calculator.ts src/utils/combat/events.ts`
Expected: all abilities tests PASS, `tsc` silent, eslint clean.

- [ ] **Step 8: Commit**

```bash
git add src/utils/abilities src/types/calculator.ts src/utils/combat/events.ts
git commit -m "refactor(dps): retire the static buff-conversion preview path (SP-2 task 4)"
```

---

### Task 5: End-of-round status chips (locked scope)

Spec locked decision 3 scopes this to the focus attacker's buffs and the enemy's debuffs.

**Files:**
- Modify: `src/components/calculator/DPSBuffPanel.tsx`
- Test: `src/components/calculator/__tests__/DPSBuffPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `RoundData.focusStatuses`, `RoundData.enemyStatuses` (Task 1).
- Produces: nothing imported elsewhere.

- [ ] **Step 1: Write the failing test**

Create `src/components/calculator/__tests__/DPSBuffPanel.test.tsx`:

```tsx
/**
 * SP-2 Task 5: the panel's "End of Round" section reads the engine's round-tail status snapshot.
 *
 * Distinct from the existing "Your Buffs" / "Enemy Debuffs" sections above it, which are the
 * focus's TURN-time view. The two legitimately differ — a self-buff granted on the focus's own turn
 * is live at its next turn-start but can be gone by that round's tail — so the fixture below
 * deliberately gives the two channels different names.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DPSBuffPanel } from '../DPSBuffPanel';
import type { RoundData } from '../../../utils/calculators/dpsSimulator';

const row = (over: Partial<RoundData>): RoundData => ({
    round: 1,
    action: 'active',
    charges: 0,
    chargeCount: 0,
    didCrit: false,
    enemyHpPct: 100,
    directDamage: 0,
    corrosionDamage: 0,
    infernoDamage: 0,
    detonationDamage: 0,
    totalRoundDamage: 0,
    cumulativeDamage: 0,
    activeCorrosionStacks: 0,
    activeInfernoStacks: 0,
    activeBombCount: 0,
    activeSelfBuffs: [],
    activeEnemyDebuffs: [],
    resistedEnemyDebuffs: [],
    appliedDoTs: [],
    dotsLanded: true,
    activeDoTStates: [],
    ...over,
});

const renderPanel = (roundData: RoundData | null) =>
    render(
        <DPSBuffPanel
            ships={[{ name: 'Ship 1', color: '#fff', totalDamage: 100, roundData }]}
            totalRounds={3}
            hoveredRound={1}
        />
    );

describe('DPSBuffPanel end-of-round chips', () => {
    it('lists the focus buffs still standing at the round tail', () => {
        renderPanel(row({ focusStatuses: { buffNames: ['Fortitude'], debuffNames: [] } }));

        expect(screen.getByText('End of Round')).toBeInTheDocument();
        expect(screen.getByText('Fortitude')).toBeInTheDocument();
    });

    it('lists enemy debuffs still standing, merged across the enemy roster without duplicates', () => {
        renderPanel(
            row({
                enemyStatuses: {
                    'enemy-1': { buffNames: [], debuffNames: ['Attack Down', 'Slow'] },
                    'enemy-2': { buffNames: [], debuffNames: ['Attack Down'] },
                },
            })
        );

        expect(screen.getAllByText('Attack Down')).toHaveLength(1);
        expect(screen.getByText('Slow')).toBeInTheDocument();
    });

    it('renders no End of Round section when the round carries no snapshot', () => {
        renderPanel(row({}));

        expect(screen.queryByText('End of Round')).not.toBeInTheDocument();
    });

    it('does not confuse the turn-time list with the round-tail list', () => {
        renderPanel(
            row({
                activeSelfBuffs: [{ buffName: 'Turn Time Only', stacks: 1, parsedEffects: {} }],
                focusStatuses: { buffNames: ['Round Tail Only'], debuffNames: [] },
            })
        );

        expect(screen.getByText('Turn Time Only')).toBeInTheDocument();
        expect(screen.getByText('Round Tail Only')).toBeInTheDocument();
    });
});
```

If `ActiveBuff` requires more fields than `{ buffName, stacks, parsedEffects }`, read its definition in `src/utils/combat/statusEngine.ts` and fill the required ones — do not cast to `any`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/calculator/__tests__/DPSBuffPanel.test.tsx`
Expected: FAIL — "Unable to find an element with the text: End of Round" on the first two cases; the third and fourth partly pass.

- [ ] **Step 3: Add the section**

In `src/components/calculator/DPSBuffPanel.tsx`, add a chip component above `ShipSection`:

```tsx
/** Plain status-name chip. Mirrors the turn-order chip in ShipConfigSummary so the two
 *  name-list surfaces in the DPS calculator look like one thing. */
const StatusChip: React.FC<{ name: string; tone: 'self' | 'enemy' }> = ({ name, tone }) => (
    <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-dark-lighter ${
            tone === 'enemy' ? 'text-red-400' : 'text-theme-text-primary'
        }`}
    >
        {name}
    </span>
);
```

Inside `ShipSection`, after the existing `const activeDoTStates = …` line, add:

```tsx
    // SP-2: the ROUND-TAIL view — what each side still carries after every decrement and drain.
    // The lists above are the focus's TURN-time view; a status that expired at the round tail
    // legitimately appears there and not here.
    const endOfRoundSelfBuffs = roundData?.focusStatuses?.buffNames ?? [];
    // Merged across the enemy roster and de-duplicated: with the single enemy the page ships this
    // is just that enemy's list, and reading only the first entry is the shape #318 had to fix.
    const endOfRoundEnemyDebuffs = [
        ...new Set(Object.values(roundData?.enemyStatuses ?? {}).flatMap((s) => s.debuffNames)),
    ];
    const hasEndOfRound = endOfRoundSelfBuffs.length > 0 || endOfRoundEnemyDebuffs.length > 0;
```

Include `hasEndOfRound` in the empty check by replacing the `isEmpty` line with:

```tsx
    const isEmpty =
        selfBuffs.length === 0 &&
        !hasDebuffs &&
        !hasDoTs &&
        activeDoTStates.length === 0 &&
        !hasEndOfRound;
```

Then render, immediately before the `{isEmpty && …}` line:

```tsx
            {hasEndOfRound && (
                <>
                    <div className="text-xs text-theme-text-secondary mt-2 mb-1">End of Round</div>
                    {endOfRoundSelfBuffs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {endOfRoundSelfBuffs.map((name) => (
                                <StatusChip key={`eor-self-${name}`} name={name} tone="self" />
                            ))}
                        </div>
                    )}
                    {endOfRoundEnemyDebuffs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {endOfRoundEnemyDebuffs.map((name) => (
                                <StatusChip key={`eor-enemy-${name}`} name={name} tone="enemy" />
                            ))}
                        </div>
                    )}
                </>
            )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/calculator/__tests__/DPSBuffPanel.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/calculator/DPSBuffPanel.tsx src/components/calculator/__tests__/DPSBuffPanel.test.tsx
git commit -m "feat(dps): per-round end-of-round status chips from the engine snapshot (SP-2 task 5)"
```

---

### Task 6: Your debuffs and enemy buffs (SCOPE EXTENSION — droppable)

**This task widens spec locked decision 3** ("focus attacker's buffs + enemy's debuffs"). It exists because SP-1 made the enemy a real actor that takes turns and can debuff you, and because a picked enemy ship's own kit can buff it — two states the DPS UI has never been able to show, and both of which move the damage number. It is last and self-contained so it can be dropped without unpicking Tasks 1-5. **Ask the owner before implementing.** The data is already collected by Task 1 either way.

**Files:**
- Modify: `src/components/calculator/DPSBuffPanel.tsx`
- Modify: `src/components/calculator/__tests__/DPSBuffPanel.test.tsx`

**Interfaces:**
- Consumes: `RoundData.focusStatuses.debuffNames`, `RoundData.enemyStatuses[*].buffNames` (Task 1).

- [ ] **Step 1: Write the failing test**

Append to `src/components/calculator/__tests__/DPSBuffPanel.test.tsx`:

```tsx
describe('DPSBuffPanel end-of-round chips — both directions', () => {
    it('lists debuffs the enemy put on YOU', () => {
        renderPanel(row({ focusStatuses: { buffNames: [], debuffNames: ['Attack Down'] } }));

        expect(screen.getByText('End of Round')).toBeInTheDocument();
        expect(screen.getByText('Attack Down')).toBeInTheDocument();
    });

    it('lists the enemy own buffs', () => {
        renderPanel(
            row({ enemyStatuses: { 'enemy-1': { buffNames: ['Shield Up'], debuffNames: [] } } })
        );

        expect(screen.getByText('Shield Up')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/calculator/__tests__/DPSBuffPanel.test.tsx`
Expected: FAIL on both new cases — "Unable to find an element with the text: End of Round" / "Shield Up".

- [ ] **Step 3: Extend the section**

In `ShipSection` in `src/components/calculator/DPSBuffPanel.tsx`, add beside the two lists Task 5 introduced:

```tsx
    // SP-1 made the enemy a real actor that takes turns, so it can now debuff YOU — and a picked
    // enemy ship's own kit can buff itself. Neither state had any surface in this calculator before.
    const endOfRoundSelfDebuffs = roundData?.focusStatuses?.debuffNames ?? [];
    const endOfRoundEnemyBuffs = [
        ...new Set(Object.values(roundData?.enemyStatuses ?? {}).flatMap((s) => s.buffNames)),
    ];
```

Replace the `hasEndOfRound` line with:

```tsx
    const hasEndOfRound =
        endOfRoundSelfBuffs.length > 0 ||
        endOfRoundEnemyDebuffs.length > 0 ||
        endOfRoundSelfDebuffs.length > 0 ||
        endOfRoundEnemyBuffs.length > 0;
```

And add these two blocks inside the existing `{hasEndOfRound && (<>…</>)}` fragment, after the enemy-debuff row. Both use `tone="enemy"` — each is a state working against your damage output:

```tsx
                    {endOfRoundSelfDebuffs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {endOfRoundSelfDebuffs.map((name) => (
                                <StatusChip key={`eor-self-debuff-${name}`} name={name} tone="enemy" />
                            ))}
                        </div>
                    )}
                    {endOfRoundEnemyBuffs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {endOfRoundEnemyBuffs.map((name) => (
                                <StatusChip key={`eor-enemy-buff-${name}`} name={name} tone="enemy" />
                            ))}
                        </div>
                    )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/calculator/__tests__/DPSBuffPanel.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/calculator/DPSBuffPanel.tsx src/components/calculator/__tests__/DPSBuffPanel.test.tsx
git commit -m "feat(dps): show incoming debuffs and enemy buffs in the round chips (SP-2 task 6)"
```

---

### Task 7: Documentation, changelog, and full verification

**Files:**
- Modify: `src/pages/DocumentationPage.tsx` (DPS Calculator card, ~`:2261-2330`)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`, `:8`)

- [ ] **Step 1: Add the in-app docs paragraph**

In `src/pages/DocumentationPage.tsx`, insert this paragraph into the DPS Calculator card immediately after the "Board slots:" paragraph (which ends `since each is simulated on its own.`):

```tsx
                                    <p className="text-theme-text mb-2">
                                        <span className="text-primary">Buffed stats:</span> the crit
                                        multiplier and the average buffed attack/crit shown for each
                                        config are read from the simulation itself, averaged over
                                        every turn your ship takes &mdash; so a buff that only lands
                                        halfway through the fight counts for the part of the fight
                                        it was up, and an extra action counts as the extra turn it
                                        is. Hovering a round in the chart also lists what each side
                                        still carries at the end of that round, which is what makes
                                        an expired or cleansed effect visibly disappear.
                                    </p>
```

If Task 6 was skipped, change "what each side still carries" to "which of your buffs and which enemy debuffs are still standing".

- [ ] **Step 2: Add the changelog entry**

In `src/constants/changelog.ts`, add as a new first element of `UNRELEASED_CHANGES`:

```ts
    'DPS calculator: the buffed stats shown for each config now come from the simulation rather than a separate estimate. The crit multiplier and a new average buffed attack/crit line are read from your ship’s live stats on every turn it takes and averaged across the run, so a buff that only lands partway through counts for the part of the fight it was actually up, and conditional buffs count only in the rounds their condition held. Hovering a round in the chart now also lists the buffs and debuffs still standing at the end of that round — including debuffs the enemy has put on you, now that it fights back.',
```

Drop the final clause if Task 6 was skipped.

- [ ] **Step 3: Run the full suite**

Run: `npm test 2>&1 | tail -30`

Expected: all tests pass. Then confirm nothing was re-pinned:

```bash
git status --short -- '*.snap'
```

Expected: **empty output.** A modified `.snap` means the timeline leaked into a golden — investigate before proceeding, do not accept the new snapshot.

- [ ] **Step 4: Lint and typecheck**

Run: `npx tsc --noEmit && npm run lint`
Expected: both silent/clean.

- [ ] **Step 5: Verify in the browser**

The DPS page carries unverified-in-UI commits from SP-1 and #318 already; this is the pass that clears them together with SP-2.

Run the dev server (port 3000) and open the DPS calculator. Confirm: the summary shows an "Avg Buffed Attack / Crit / Crit DMG" line whose attack exceeds the config's base attack when the ship's kit self-buffs; hovering a round in the cumulative chart shows the "End of Round" chips in the side panel; and a config with no buffs at all shows the crit multiplier it always did, with no stray empty section.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs(dps): document the engine-sourced buffed stats and round chips (SP-2 task 7)"
```

---

## Acceptance checklist (map to the spec's Testing section)

| Spec test | Where it lands |
|---|---|
| 1. Chips reflect removal | Task 5 test 4 (turn-time vs round-tail are distinct channels) + Task 1's round-tail collection. **Note the spec correction above** — the DPS chips never accumulated; the round-tail snapshot is what makes an expiry visible at the correct instant. |
| 2. Enemy debuff chips populate with no engine change | Task 1 test 3 (`enemyStatuses['enemy-1'].debuffNames` contains `Attack Down`, dummy absent) |
| 3. Weighting | Task 2 tests 3 and 4 (mid-run buff lands strictly between; extra action weights its second turn, explicitly asserting the round-weighted number is NOT produced) |
| 4. Summary equals the engine | Task 3 test 1 (crit multiplier derivable only from the snapshot) |
| 5. No double-count / collector is inert | Task 1 test 6 (identical summary and per-round damage with and without the flag) + zero `.snap` movement across the whole suite |
| 6. Full `npm test` + `npm run lint` | Task 7 steps 3-4 |
