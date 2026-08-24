# Engine-Backed Defense Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Defense calculator's 22-line static formula with an engine-backed
survivability run that reports **Measured EHP** — the damage a ship actually absorbed before dying —
driven by the ship's parsed skills through the ability model.

**Architecture:** A thin defense-named boundary (`defenseSurvivabilitySim.ts`) maps a defense input
onto `simulateHealing` with `healTargetId: 'healer'`, so the engine's focus actor *is* the bombarded
ship. No second engine adapter. The boundary owns the EHP arithmetic and the survived-vs-died
policy, so both are unit-testable without rendering a page.

**Tech Stack:** TypeScript, React 18, Vitest + React Testing Library, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-08-24-defense-calculator-ability-model-design.md`
**Issue:** #358

## Global Constraints

- **Measured EHP = Σ `incomingDamage` over elapsed rounds. Nothing is added to it.**
  `incomingDamage` is GROSS — it already contains everything the shield pool and Barrier soaked.
  `incoming + shieldAbsorbed + barrierAbsorbed` double-counts every point of mitigation.
- **The golden suite stays byte-identical.** Any golden churn is a STOP — report it, never run
  `vitest -u` / `vitest --update`.
- **Never assert the intake identity against its own derivation.** The HP term is *defined* as
  `incoming − shieldAbsorbed − barrierAbsorbed − convertedToShield`; asserting those five terms
  against each other is tautological and passes with every term wrong.
- `modifier.isMultiplicative` is a **NO-OP** — never surface it as a live toggle.
- Do **not** call the sim in render. Memoize on configs + enemies + team actors + rounds.
- **UI components:** use `src/components/ui/` primitives only (`Button`, `Input`, `Select`,
  `Checkbox`, the `card` class, `CollapsibleForm`). Never raw `<button>` for a standard action,
  never hand-rolled card/modal markup. See CLAUDE.md § UI Components.
- **No emojis in UI text.** Plain text plus colour classes.
- `PERCENTAGE_ONLY_STATS` are stored as integers (crit `70`, not `0.70`). Fixtures must match.
- Validation gate per task: `npm run lint` (0 warnings) · `npx tsc --noEmit` · `npm test`
  (full suite) · `npm run audit:skills` (0 findings).
- Commit normally — **no `--no-verify`** for code commits. `docs/` is gitignored, so plan/spec
  edits need `git add -f`.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/utils/combat/engine.ts` | Add `convertedToShield` to `HealingRoundEngine` + populate it | 1 |
| `src/utils/calculators/healingEngineAdapter.ts` | Surface `convertedToShield` on `HealingRoundData` | 1 |
| `src/utils/calculators/defenseSurvivabilitySim.ts` | **NEW** — the boundary: input mapping, EHP arithmetic, survived policy | 2 |
| `src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts` | **NEW** — the two weight-bearing tests + supporting cases | 2 |
| `src/types/calculator.ts` | `DefenseShipConfig` gains `shipSkills` + engine stats | 3 |
| `src/pages/calculators/DefenseCalculatorPage.tsx` | Build `shipSkills` on ship-select; wire sim; shared panels; ranking | 3, 5 |
| `src/components/calculator/DefenseShipCard.tsx` | `SkillSlotList`; measured-EHP results block | 4, 6 |
| `src/components/calculator/DefenseSettingsPanel.tsx` | Host the rounds control | 5 |
| `src/pages/DocumentationPage.tsx` | In-app docs | 7 |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` entry | 7 |

---

### Task 1: Surface `convertedToShield` on the healing round row

Shield Converter damage is tracked in `ActorIntake` but never leaves the engine, so the intake
breakdown cannot reconcile. Purely additive — no behaviour change, goldens byte-identical.

**Files:**
- Modify: `src/utils/combat/engine.ts` (~1685-1700 interface; ~12417-12425 assembly)
- Modify: `src/utils/calculators/healingEngineAdapter.ts` (~153-240 interface; ~790-865 row build)
- Test: `src/utils/calculators/__tests__/healingEngineAdapter.test.ts`

**Interfaces:**
- Consumes: `ActorIntake.convertedToShield` (already exists, `engine.ts:1682`)
- Produces: `HealingRoundEngine.convertedToShield: number` and
  `HealingRoundData.convertedToShield: number` — Task 2 reads the latter.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/calculators/__tests__/healingEngineAdapter.test.ts`, inside the
`describe('simulateHealing adapter', ...)` block:

```typescript
    it('surfaces convertedToShield on the round row (0 without a converter)', () => {
        idCounter = 0;
        // No Shield Converter anywhere → the field must be PRESENT and 0, not absent.
        // Task 2's breakdown reads it unconditionally; an absent field would read as NaN.
        const result = simulateHealing(
            BASE({
                rounds: 1,
                healer: { ...HEALER, hp: 10000, defence: 0 },
                enemies: [
                    {
                        id: 'e1',
                        stats: { attack: 2000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                    },
                ],
            })
        );
        expect('convertedToShield' in result.rounds[0]).toBe(true);
        expect(result.rounds[0].convertedToShield).toBe(0);
        expect(result.rounds[0].incomingDamage).toBe(2000);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/healingEngineAdapter.test.ts -t "convertedToShield"`

Expected: FAIL — `expect('convertedToShield' in result.rounds[0]).toBe(true)` receives `false`.

- [ ] **Step 3: Add the field to `HealingRoundEngine`**

In `src/utils/combat/engine.ts`, in `interface HealingRoundEngine` (right after the
`barrierAbsorbed: number;` at ~line 1694):

```typescript
    /** Per-round direct-hit damage nullified by `Shield Converter` and turned into Shield, for the
     *  heal target. Netted against `incomingDamage` for display exactly as `barrierAbsorbed` is —
     *  the hit ARRIVED (the attacker keeps its damage-dealt credit) but was converted rather than
     *  applied. Surfaced so the intake breakdown's four terms close; without it a Shield Converter
     *  ship shows an unexplained residual. */
    convertedToShield: number;
```

- [ ] **Step 4: Populate it at the assembly site**

In `src/utils/combat/engine.ts`, in the `if (healTarget) { … healingRounds.push({ … })` block
(~line 12424), immediately after the `barrierAbsorbed:` line:

```typescript
                convertedToShield: healTargetIntake?.convertedToShield ?? 0,
```

- [ ] **Step 5: Add the field to `HealingRoundData`**

In `src/utils/calculators/healingEngineAdapter.ts`, in `interface HealingRoundData`, immediately
after the `barrierAbsorbed: number;` declaration and its comment:

```typescript
    /** Direct-hit damage nullified by `Shield Converter` and turned into Shield. A FOURTH mitigation
     *  channel alongside shieldAbsorbed/barrierAbsorbed, and like them already contained in
     *  `incomingDamage` — never add these together. */
    convertedToShield: number;
```

- [ ] **Step 6: Thread it through the row build**

In `src/utils/calculators/healingEngineAdapter.ts`, alongside the existing raw reads (~line 794):

```typescript
        const convertedToShieldRaw = hr?.convertedToShield ?? 0;
```

and in the pushed row object, immediately after the `barrierAbsorbed:` line (~line 860):

```typescript
            convertedToShield: Math.round(convertedToShieldRaw),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/healingEngineAdapter.test.ts -t "convertedToShield"`

Expected: PASS.

- [ ] **Step 8: Verify the goldens are byte-identical**

Run: `npm test`

Expected: full suite green, **zero** snapshot writes. If any golden churns, STOP and report — this
change is additive and must not move a single number.

- [ ] **Step 9: Validate and commit**

```bash
npm run lint && npx tsc --noEmit && npm run audit:skills
git add src/utils/combat/engine.ts src/utils/calculators/healingEngineAdapter.ts src/utils/calculators/__tests__/healingEngineAdapter.test.ts
git commit -m "feat(sim): surface convertedToShield on the healing round row (#358)"
```

---

### Task 2: The `defenseSurvivabilitySim` boundary

**Files:**
- Create: `src/utils/calculators/defenseSurvivabilitySim.ts`
- Test: `src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts`

**Interfaces:**
- Consumes: `simulateHealing`, `HealingSimulationResult`, `HealerStats`, `EnemyAttackerInput`
  (`healingEngineAdapter.ts`); `HealingRoundData.convertedToShield` (Task 1); `TeamActorInput`
  (`types/calculator.ts`); `ShipSkills` (`types/abilities.ts`).
- Produces:
  - `interface DefenderStats` — `{ hp, defence, security, attack, crit, critDamage, speed, hacking, healModifier }`
  - `interface DefenseSimulationInput` — `{ defender, shipSkills, selfBuffs, chargeCount, startCharged, affinity?, role?, faction?, position?, targeting?, teamActors?, enemies, rounds, bus? }`
  - `interface DefenseIntakeBreakdown` — `{ toHp, toShield, toBarrier, toConversion, gross }`
  - `interface DefenseSurvivabilityRound` — `{ round, incomingDamage, shieldAbsorbed, barrierAbsorbed, convertedToShield, hpPct, shieldPool }`
  - `interface DefenseSurvivabilityResult` — `{ measuredEHP, survived, destroyedRound?, elapsedRounds, breakdown, rounds }`
  - `function simulateDefenseSurvivability(input: DefenseSimulationInput): DefenseSurvivabilityResult`

Task 5 and Task 6 consume `simulateDefenseSurvivability` and `DefenseSurvivabilityResult`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import {
    simulateDefenseSurvivability,
    DefenseSimulationInput,
    DefenderStats,
} from '../defenseSurvivabilitySim';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `d${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const skills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

const DEFENDER: DefenderStats = {
    hp: 100_000,
    defence: 0, // defence 0 keeps incoming arithmetic exact and readable
    security: 70,
    attack: 0, // attack 0 so the defender cannot kill an enemy and shorten its own window
    crit: 0,
    critDamage: 0,
    speed: 100,
    hacking: 200,
    healModifier: 0,
};

const BASE = (overrides: Partial<DefenseSimulationInput> = {}): DefenseSimulationInput => ({
    defender: DEFENDER,
    shipSkills: { slots: [] },
    selfBuffs: [],
    chargeCount: 0,
    startCharged: false,
    enemies: [],
    rounds: 5,
    ...overrides,
});

/** One attacker, `attack` per round, no kit — the pressure source for every case below. */
const attacker = (attack: number) => ({
    id: 'e1',
    stats: { attack, crit: 0, critDamage: 0, speed: 50, hp: 1_000_000, defence: 0 },
    chargeCount: 0,
    startCharged: false,
});

describe('simulateDefenseSurvivability', () => {
    // ── THE DOUBLE-COUNT TRIPWIRE ────────────────────────────────────────────
    // A SHIELDED fixture is mandatory here. On an unshielded run shieldAbsorbed is 0, so the
    // correct formula and the double-counting one agree and the bug ships green.
    it('measured EHP is GROSS intake — it does NOT add shield/barrier absorption on top', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                enemies: [attacker(5_000)],
                // Self-shield each turn → a real, non-zero shieldAbsorbed to double-count.
                shipSkills: skills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );

        const gross = result.rounds.reduce((s, r) => s + r.incomingDamage, 0);
        const absorbed = result.rounds.reduce(
            (s, r) => s + r.shieldAbsorbed + r.barrierAbsorbed + r.convertedToShield,
            0
        );

        // The fixture must actually exercise the trap, or this test proves nothing.
        expect(absorbed).toBeGreaterThan(0);

        expect(result.measuredEHP).toBe(gross);
        // The explicit negative: the inflated formula must NOT be what we report.
        expect(result.measuredEHP).not.toBe(gross + absorbed);
    });

    // ── SURVIVED VS DESTROYED, BOTH WAYS ─────────────────────────────────────
    it('survivor: survived true, no destroyedRound, EHP is the absorbed total', () => {
        idCounter = 0;
        // 1000/round vs 100k HP over 3 rounds — cannot die.
        const result = simulateDefenseSurvivability(
            BASE({ rounds: 3, enemies: [attacker(1_000)] })
        );
        expect(result.survived).toBe(true);
        expect(result.destroyedRound).toBeUndefined();
        expect(result.measuredEHP).toBe(3_000);
        expect(result.elapsedRounds).toBe(3);
    });

    it('casualty: survived false and destroyedRound is set', () => {
        idCounter = 0;
        // 60k/round vs 100k HP, defence 0 → dead in round 2.
        const result = simulateDefenseSurvivability(
            BASE({ rounds: 5, enemies: [attacker(60_000)] })
        );
        expect(result.survived).toBe(false);
        expect(result.destroyedRound).toBe(2);
        // EHP counts only the rounds that actually elapsed, not the configured window.
        expect(result.measuredEHP).toBe(120_000);
    });

    // ── BREAKDOWN RECONCILED AGAINST AN INDEPENDENT SIGNAL ───────────────────
    // NOT `toHp + toShield + toBarrier + toConversion === gross` — toHp is DEFINED by that
    // subtraction, so that assertion is tautological. Cross-check against the HP trajectory
    // instead, on a run with NO healing of any kind (healing legitimately breaks the
    // reconciliation, and a team-supported fixture here would invite "fixing" correct code).
    it('breakdown toHp reconciles with the HP trajectory on a heal-free run', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({ rounds: 3, enemies: [attacker(10_000)] })
        );
        expect(result.breakdown.gross).toBe(30_000);
        expect(result.breakdown.toShield).toBe(0);
        expect(result.breakdown.toBarrier).toBe(0);
        expect(result.breakdown.toConversion).toBe(0);
        expect(result.breakdown.toHp).toBe(30_000);

        // Independent signal: the LAST round's entering HP% reflects the two rounds of damage
        // already taken (20k of 100k → 80%), so the derived HP loss and the engine's own HP bar
        // agree without either being computed from the other.
        expect(result.rounds[2].hpPct).toBe(80);
    });

    it('a shielded run splits the breakdown: some to shield, the rest to HP', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                enemies: [attacker(5_000)],
                shipSkills: skills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(result.breakdown.toShield).toBeGreaterThan(0);
        expect(result.breakdown.toHp).toBeLessThan(result.breakdown.gross);
        expect(result.breakdown.toHp).toBeGreaterThanOrEqual(0);
    });

    it('no enemies: zero pressure, survived, EHP 0', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(BASE({ rounds: 3, enemies: [] }));
        expect(result.measuredEHP).toBe(0);
        expect(result.survived).toBe(true);
        expect(result.breakdown.gross).toBe(0);
    });

    // ── BARRIER IS ITS OWN CHANNEL ───────────────────────────────────────────
    it('Barrier blocks into toBarrier, never into toShield', () => {
        idCounter = 0;
        // Barrier ('Is invulnerable to damage.', constants/buffs.ts:790) is full immunity and never
        // drains the shield pool — barrierAbsorbed and shieldAbsorbed are separate channels.
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 2,
                enemies: [attacker(5_000)],
                shipSkills: skills([
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: {
                            type: 'buff',
                            buffName: 'Barrier',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 'recurring',
                        },
                    }),
                ]),
            })
        );
        expect(result.breakdown.toBarrier).toBeGreaterThan(0);
        expect(result.breakdown.toShield).toBe(0);
        // Gross still counts the blocked hits: they ARRIVED, they were just nullified.
        expect(result.breakdown.gross).toBeGreaterThanOrEqual(result.breakdown.toBarrier);
    });

    // ── MODIFIER ABILITIES REACH THE ENGINE ──────────────────────────────────
    it('an incomingDamage modifier aura reduces damage taken', () => {
        idCounter = 0;
        // `modifier` abilities are NOT SkillEffects, so the pre-ability-model flat auto-fill path
        // could not see them at all (spec §1.1 gap 2). This proves the ability model carries them.
        // NOTE: `isMultiplicative` is a documented NO-OP — set false, never surface it as a toggle.
        const mkRun = (abilities: Ability[]) =>
            simulateDefenseSurvivability(
                BASE({ rounds: 3, enemies: [attacker(5_000)], shipSkills: skills(abilities) })
            );

        idCounter = 0;
        const plain = mkRun([]);
        idCounter = 0;
        const warded = mkRun([
            ab({
                type: 'modifier',
                target: 'self',
                config: {
                    type: 'modifier',
                    channel: 'incomingDamage',
                    value: -50,
                    isMultiplicative: false,
                },
            }),
        ]);

        expect(plain.breakdown.gross).toBeGreaterThan(0);
        expect(warded.breakdown.gross).toBeLessThan(plain.breakdown.gross);
    });

    // ── THE NON-VACUOUS PROOF THE ABILITY MODEL CHANGED THE ANSWER ───────────
    // This is the test that closes #358. Under the old flat `buildSkillBuffAutoFill` path both runs
    // below were IDENTICAL — that path cannot express a gate, so it applied every parsed buff
    // unconditionally. If these two numbers match, the ability model is not reaching the engine and
    // the epic has demonstrated nothing.
    it('a conditionally-gated defence buff does NOT apply while its condition is unmet', () => {
        // Non-zero base defence: a PERCENTAGE defence buff on `defence: 0` multiplies zero and the
        // whole comparison collapses to zero-vs-zero.
        const armoured = { ...DEFENDER, defence: 5_000 };
        const defenseUp = {
            type: 'buff' as const,
            buffName: 'Defense Up II', // '+30% Defense' — constants/buffs.ts:51
            parsedEffects: { defense: 30 },
            stacks: 1,
            isStackable: false,
            duration: 'recurring' as const,
        };

        idCounter = 0;
        const ungated = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                defender: armoured,
                enemies: [attacker(20_000)],
                shipSkills: skills([ab({ type: 'buff', target: 'self', config: defenseUp })]),
            })
        );

        idCounter = 0;
        const gated = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                defender: armoured,
                enemies: [attacker(20_000)],
                shipSkills: skills([
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: defenseUp,
                        // The defender starts at 100% HP, so "self HP below 30%" is unmet.
                        conditions: [
                            {
                                subject: 'hp-threshold',
                                hpSubject: 'self',
                                hpComparator: 'below',
                                hpPercent: 30,
                                derivable: true,
                            },
                        ],
                    }),
                ]),
            })
        );

        // The ungated run is genuinely mitigating, or the comparison proves nothing.
        expect(ungated.breakdown.gross).toBeGreaterThan(0);
        // Gate unmet → no Defense Up → each hit lands harder → strictly more damage taken.
        expect(gated.breakdown.gross).toBeGreaterThan(ungated.breakdown.gross);
    });
});
```

**If the gate test's two runs come back equal, STOP and report.** That is the epic's central claim
failing, not a fixture to loosen — do not weaken the assertion to `toBeGreaterThanOrEqual`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts`

Expected: FAIL — cannot resolve `../defenseSurvivabilitySim`.

- [ ] **Step 3: Write the boundary**

Create `src/utils/calculators/defenseSurvivabilitySim.ts`:

```typescript
import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { AffinityName } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { FactionKey } from '../../constants/factions';
import type { Position } from '../../types/encounters';
import type { ShipTargeting } from '../targetingParser';
import type { CombatEventBus } from '../combat/events';
import { simulateHealing, EnemyAttackerInput } from './healingEngineAdapter';

/** The ship under test. Mirrors the stat fields `HealerStats` needs, named for the defender. */
export interface DefenderStats {
    hp: number;
    defence: number;
    security: number;
    /** The defender's own offence. It DOES take its own turns (see the module note below). */
    attack: number;
    crit: number;
    critDamage: number;
    speed: number;
    hacking: number;
    /** The defender's REAL heal modifier — a defender with self-repair must actually repair.
     *  Zeroing this would silently understate every sustain tank. */
    healModifier: number;
}

export interface DefenseSimulationInput {
    defender: DefenderStats;
    shipSkills: ShipSkills;
    selfBuffs: SelectedGameBuff[];
    chargeCount: number;
    startCharged: boolean;
    affinity?: AffinityName;
    role?: ShipTypeName;
    faction?: FactionKey;
    position?: Position;
    targeting?: ShipTargeting;
    /** Optional supporting allies (healers, protectors). */
    teamActors?: TeamActorInput[];
    enemies: EnemyAttackerInput[];
    rounds: number;
    bus?: CombatEventBus;
}

/** Where the gross incoming damage went. `toHp` is DERIVED by subtraction — see the note on
 *  `gross` before writing any test against these four terms. */
export interface DefenseIntakeBreakdown {
    /** Landed on the HP bar. Derived: gross − toShield − toBarrier − toConversion. */
    toHp: number;
    toShield: number;
    toBarrier: number;
    toConversion: number;
    /** Σ incomingDamage. GROSS — already contains the three mitigation terms above. This is the
     *  measured-EHP figure; adding the others to it double-counts every point of mitigation. */
    gross: number;
}

export interface DefenseSurvivabilityRound {
    round: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
    convertedToShield: number;
    /** HP% ENTERING the round. */
    hpPct: number;
    /** Shield pool ENTERING the round. */
    shieldPool: number;
}

export interface DefenseSurvivabilityResult {
    /** Σ incomingDamage over the ELAPSED rounds. When `survived` is true this is a LOWER BOUND on
     *  the ship's durability, not a death threshold — the UI must render survivors distinctly. */
    measuredEHP: number;
    survived: boolean;
    destroyedRound?: number;
    elapsedRounds: number;
    breakdown: DefenseIntakeBreakdown;
    rounds: DefenseSurvivabilityRound[];
}

/**
 * Runs a survivability window for one defender and reduces it to a measured effective-HP figure.
 *
 * Implemented over `simulateHealing` with `healTargetId: 'healer'`, which makes the engine's focus
 * actor the bombarded ship. That reuses the whole healing harness — roster normalisation, board
 * placement, affinity matchups, enemy-actor construction — rather than standing up a second
 * 950-line adapter that would drift from it.
 *
 * ACCEPTED CONSEQUENCE: the focus actor takes its own turns, so the defender casts at the attackers.
 * Its self-shields and self-buffs therefore fire on its own turn (correct), and a defender that
 * kills attackers reduces its own incoming pressure (real game behaviour). Measured EHP is
 * consequently not a pure-defence number.
 */
export function simulateDefenseSurvivability(
    input: DefenseSimulationInput
): DefenseSurvivabilityResult {
    const healingResult = simulateHealing({
        healer: {
            hp: input.defender.hp,
            attack: input.defender.attack,
            defence: input.defender.defence,
            crit: input.defender.crit,
            critDamage: input.defender.critDamage,
            // The defender's own offence is incidental to the survivability question.
            defensePenetration: 0,
            healModifier: input.defender.healModifier,
            hacking: input.defender.hacking,
            speed: input.defender.speed,
        },
        chargeCount: input.chargeCount,
        startCharged: input.startCharged,
        shipSkills: input.shipSkills,
        selfBuffs: input.selfBuffs,
        // The defender IS the bombarded actor.
        healTargetId: 'healer',
        healTargetAffinity: input.affinity,
        healTargetSecurity: input.defender.security,
        healerRole: input.role,
        healerFaction: input.faction,
        teamActors: input.teamActors,
        enemies: input.enemies,
        rounds: input.rounds,
        healerPosition: input.position,
        healerTargeting: input.targeting,
        bus: input.bus,
    });

    const rounds: DefenseSurvivabilityRound[] = healingResult.rounds.map((r) => ({
        round: r.round,
        incomingDamage: r.incomingDamage,
        shieldAbsorbed: r.shieldAbsorbed,
        barrierAbsorbed: r.barrierAbsorbed,
        convertedToShield: r.convertedToShield,
        hpPct: r.targetHpPct,
        shieldPool: r.targetShieldPool,
    }));

    // GROSS. Not gross + absorbed — `incomingDamage` already contains the mitigation terms.
    const gross = rounds.reduce((sum, r) => sum + r.incomingDamage, 0);
    const toShield = rounds.reduce((sum, r) => sum + r.shieldAbsorbed, 0);
    const toBarrier = rounds.reduce((sum, r) => sum + r.barrierAbsorbed, 0);
    const toConversion = rounds.reduce((sum, r) => sum + r.convertedToShield, 0);

    const destroyedRound = healingResult.summary.destroyedRound;

    return {
        measuredEHP: gross,
        survived: destroyedRound === undefined,
        ...(destroyedRound !== undefined ? { destroyedRound } : {}),
        elapsedRounds: rounds.length,
        breakdown: {
            // Clamped at 0: the three mitigation terms are rounded independently upstream, so a
            // fully-absorbed round can round to a hair over gross.
            toHp: Math.max(0, gross - toShield - toBarrier - toConversion),
            toShield,
            toBarrier,
            toConversion,
            gross,
        },
        rounds,
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts`

Expected: PASS, 9 tests.

If the `destroyedRound`/`hpPct` numbers in the fixtures disagree with the engine, do **not** relax
the assertion to `toBeGreaterThan`. Read the actual round rows, confirm the engine's behaviour is
right, and correct the expected constant — keeping every assertion exact.

- [ ] **Step 5: Full suite + validate**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run audit:skills
```

Expected: green, no golden churn (this task adds a new module and touches no existing path).

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/defenseSurvivabilitySim.ts src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts
git commit -m "feat(calculators): add defense survivability boundary over the combat engine (#358)"
```

---

### Task 3: `DefenseShipConfig` carries `shipSkills` and engine stats

**Files:**
- Modify: `src/types/calculator.ts` (`DefenseShipConfig`, ~line 266)
- Modify: `src/pages/calculators/DefenseCalculatorPage.tsx` (`getInitialConfig`, `addConfig`,
  `selectShipForConfig`)
- Test: `src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `buildShipAbilitiesWithEquipment(ship, getGearPiece)` from
  `src/utils/abilities/buildShipAbilitiesWithEquipment`; `buildDefaultShipSkills()` from
  `src/utils/abilities/configToSimInputs`.
- Produces: `DefenseShipConfig` with `shipSkills: ShipSkills` plus `attack`, `crit`, `critDamage`,
  `speed`, `hacking`, `chargeCount`, `startCharged`, `position?`, `affinity?`, `role?`, `faction?`.
  Tasks 4-6 read these.

- [ ] **Step 1: Write the failing test**

Create `src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx` if it does not exist. Follow
the render-harness conventions of the nearest existing page test — inspect
`src/pages/calculators/__tests__/` and copy the provider wrapper that page tests already use rather
than inventing one. The assertion to add:

```typescript
    it('a blank config starts with default ship skills, not an empty kit', () => {
        renderDefenseCalculatorPage();
        // The Advanced section hosts the skill editor; a blank config still has editable slots.
        fireEvent.click(screen.getByText(/Show Advanced/i));
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Charged')).toBeInTheDocument();
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx`

Expected: FAIL — no `Active` / `Charged` slot rows (no `SkillSlotList` yet; Task 4 adds it).

- [ ] **Step 3: Extend the type**

In `src/types/calculator.ts`, replace the `DefenseShipConfig` interface with:

```typescript
/** A defender config for the engine-backed Defense Calculator. Carries `shipSkills` so the combat
 *  engine walks the ship's real kit, plus the offensive/turn stats the engine needs because the
 *  defender TAKES ITS OWN TURNS (its self-shields fire on its turn; see
 *  `simulateDefenseSurvivability`). `effectiveHP`/`damageReduction` remain the STATIC formula
 *  baseline displayed next to the measured figure. */
export interface DefenseShipConfig {
    id: string;
    shipId?: string;
    name: string;
    hp: number;
    defense: number;
    security: number;
    effectiveHP?: number;
    damageReduction?: number;
    buffs: SelectedGameBuff[];
    shipSkills: ShipSkills;
    attack: number;
    crit: number;
    critDamage: number;
    speed: number;
    hacking: number;
    /** The defender's REAL heal modifier. Load-bearing: a defender with self-repair must actually
     *  repair, and a hardcoded 0 here silently understates every sustain tank. */
    healModifier: number;
    chargeCount: number;
    startCharged: boolean;
    /** Board slot. Absent → the adapter places the defender itself. */
    position?: Position;
    affinity?: AffinityName;
    role?: ShipTypeName;
    faction?: FactionKey;
}
```

Add any imports `src/types/calculator.ts` is missing (`ShipSkills`, `Position`, `AffinityName`,
`ShipTypeName`, `FactionKey`) — check the file's existing import block first, most are already there
for `HealerShipConfig` and `EnemyShipConfig`.

- [ ] **Step 4: Run `tsc` to enumerate every construction site**

Run: `npx tsc --noEmit`

Expected: errors at each `DefenseShipConfig` literal — `getInitialConfig` (two returns), `addConfig`,
and any test fixture. Use this list as the work list for Step 5; do not guess at the sites.

- [ ] **Step 5: Fill the new fields at every construction site**

In `src/pages/calculators/DefenseCalculatorPage.tsx`, add these imports:

```typescript
import { buildShipAbilitiesWithEquipment } from '../../utils/abilities/buildShipAbilitiesWithEquipment';
import { buildDefaultShipSkills } from '../../utils/abilities/configToSimInputs';
import { asFactionKey } from '../../constants/factions';
```

(Confirm `asFactionKey`'s exact export path by grepping — `HealingCalculatorPage.tsx` imports it and
is the reference.)

Extract a shared helper above the component so the three construction sites cannot drift:

```typescript
/** Engine stats + kit for a defender built from a real ship. Shared by the URL-param initial
 *  config and the ship-picker, which previously duplicated the stat mapping. */
const defenderFieldsFromShip = (
    ship: Ship,
    final: ReturnType<typeof calculateTotalStats>['final'],
    getGearPiece: Parameters<typeof buildShipAbilitiesWithEquipment>[1]
) => ({
    shipId: ship.id,
    name: ship.name,
    hp: Math.round(final.hp),
    defense: Math.round(final.defence),
    security: Math.round(final.security ?? 0),
    attack: Math.round(final.attack ?? 0),
    crit: Math.round(final.crit ?? 0),
    critDamage: Math.round(final.critDamage ?? 0),
    speed: Math.round(final.speed ?? 0),
    hacking: Math.round(final.hacking ?? 0),
    healModifier: Math.round(final.healModifier ?? 0),
    chargeCount: ship.chargeSkillCharge ?? 0,
    startCharged: false,
    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
    affinity: ship.affinity,
    role: ship.type,
    faction: asFactionKey(ship.faction),
});
```

Blank configs (`addConfig`, and the no-`shipId` fallback in `getInitialConfig`) get:

```typescript
            shipSkills: buildDefaultShipSkills(),
            attack: 0,
            crit: 0,
            critDamage: 0,
            speed: 100,
            hacking: 0,
            healModifier: 0,
            chargeCount: 0,
            startCharged: false,
```

`selectShipForConfig` spreads `defenderFieldsFromShip(...)` into the updated config, keeping its
existing `damageReduction` / `effectiveHP` / `buffs: mergeAutoFill(...)` lines unchanged. **Leave
the `buildSkillBuffAutoFill` call in place for now** — Task 6 removes it once the measured figure is
the headline, and removing it here would drop the static baseline's buffs mid-stack.

- [ ] **Step 6: Verify `tsc` is clean**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 7: Full suite + validate, then commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run audit:skills
git add src/types/calculator.ts src/pages/calculators/DefenseCalculatorPage.tsx
git commit -m "feat(calculators): DefenseShipConfig carries shipSkills and engine stats (#358)"
```

(The Step 1 test still fails until Task 4 — that is expected; note it in the task report.)

---

### Task 4: `SkillSlotList` in the defense card

**Files:**
- Modify: `src/components/calculator/DefenseShipCard.tsx`
- Test: `src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx` (the Task 3 Step 1 test)

**Interfaces:**
- Consumes: `DefenseShipConfig.shipSkills` (Task 3); `SkillSlotList` from
  `src/components/skills/SkillSlotList` — props `{ shipSkills, hasPassive, ship?, onChange }`.
- Produces: a new `onShipSkillsChange: (shipSkills: ShipSkills) => void` prop on
  `DefenseShipCardProps`, wired by Task 5.

- [ ] **Step 1: Confirm the Task 3 test still fails for the right reason**

Run: `npx vitest run src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx`

Expected: FAIL on the missing `Active` / `Charged` rows — not on a render crash.

- [ ] **Step 2: Add the prop and render the editor**

In `src/components/calculator/DefenseShipCard.tsx`:

Add to `DefenseShipCardProps`:

```typescript
    onShipSkillsChange: (shipSkills: ShipSkills) => void;
```

Import `SkillSlotList` and `ShipSkills`, and **remove** the `ShipSkillList` import.

Inside the `<CollapsibleForm isVisible={advancedOpen}>`, above the existing "Ship Buffs" heading:

```tsx
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                        Skills
                    </div>
                    <SkillSlotList
                        shipSkills={config.shipSkills}
                        hasPassive={!!selectedShip}
                        ship={selectedShip}
                        onChange={onShipSkillsChange}
                    />
```

Delete the whole `{selectedShip && ( … Skill Reference … )}` block, including the `skillRefOpen`
state and the now-unused `ChevronDownIcon` usage inside it. `SkillSlotList`'s editor modal already
shows per-slot skill text via its `ship` prop, so keeping both is two views of one thing.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx`

Expected: PASS.

- [ ] **Step 4: Validate and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run audit:skills
git add src/components/calculator/DefenseShipCard.tsx src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx
git commit -m "feat(calculators): render the skill editor in the defense card (#358)"
```

---

### Task 5: Page wires the survivability sim

**Files:**
- Modify: `src/pages/calculators/DefenseCalculatorPage.tsx`
- Modify: `src/components/calculator/DefenseSettingsPanel.tsx`
- Test: `src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx`

**Interfaces:**
- Consumes: `simulateDefenseSurvivability`, `DefenseSurvivabilityResult` (Task 2);
  `EnemyAttackersPanel` + `EnemyAttackerConfig` (`components/calculator/EnemyAttackersPanel`);
  `TeamPanel` (`components/calculator/TeamPanel`); `defaultEnemySlot`
  (`utils/calculators/healingPlacement`).
- Produces: `simResults: Map<string, DefenseSurvivabilityResult>` keyed by config id, consumed by
  Task 6's card props and the `isBest` ranking.

- [ ] **Step 1: Write the failing test**

Add to `src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx`:

```typescript
    it('reports a measured EHP once an attacker applies pressure', async () => {
        renderDefenseCalculatorPage();
        fireEvent.click(screen.getByText(/Combat Settings/i));
        fireEvent.click(screen.getByRole('button', { name: /Add Enemy/i }));
        expect(await screen.findByText(/Measured EHP/i)).toBeInTheDocument();
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx -t "measured EHP"`

Expected: FAIL — no `Add Enemy` control and no `Measured EHP` text.

- [ ] **Step 3: Add the rounds control to `DefenseSettingsPanel`**

Add to `DefenseSettingsPanelProps`:

```typescript
    rounds: number;
    onRoundsChange: (rounds: number) => void;
```

Inside the `CollapsibleForm`, above the `GameBuffPicker`:

```tsx
                <Input
                    label="Rounds"
                    type="number"
                    min={1}
                    max={50}
                    value={rounds}
                    onChange={(e) =>
                        onRoundsChange(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))
                    }
                    helpLabel="Length of the survivability window"
                />
```

Import `Input` from `../ui/Input`.

- [ ] **Step 4: Add enemy, team and rounds state to the page**

In `src/pages/calculators/DefenseCalculatorPage.tsx`, mirror the healing page's state shape:

```typescript
    const [rounds, setRounds] = useState(20);
    const [enemies, setEnemies] = useState<EnemyAttackerConfig[]>([]);
    const [teamShips, setTeamShips] = useState<TeamShipConfig[]>([]);
    const [enemyPanelOpen, setEnemyPanelOpen] = useState(false);
    const [teamPanelOpen, setTeamPanelOpen] = useState(false);
```

Copy the enemy add/remove/select/update handlers and the `TeamShipConfig` handlers from
`HealingCalculatorPage.tsx` verbatim — they are page-local and identical in shape. Do **not**
re-derive them; drift between the two pages is the failure mode here.

- [ ] **Step 5: Map UI configs to adapter inputs**

Add the `enemyInputs` and `teamActors` memos, copied from `HealingCalculatorPage.tsx:543` and
`:616` unchanged (they map `EnemyAttackerConfig → EnemyAttackerInput` and
`TeamShipConfig → TeamActorInput`, and both mappings are already correct).

- [ ] **Step 6: Run the sim, memoized**

```typescript
    const simResults = useMemo(() => {
        const map = new Map<string, DefenseSurvivabilityResult>();
        configs.forEach((config) => {
            map.set(
                config.id,
                simulateDefenseSurvivability({
                    defender: {
                        hp: config.hp,
                        defence: config.defense,
                        security: config.security,
                        attack: config.attack,
                        crit: config.crit,
                        critDamage: config.critDamage,
                        speed: config.speed,
                        hacking: config.hacking,
                        // The defender's REAL heal modifier — a self-repairing tank must repair.
                        healModifier: config.healModifier,
                    },
                    shipSkills: config.shipSkills,
                    selfBuffs: [...globalBuffs, ...config.buffs],
                    chargeCount: config.chargeCount,
                    startCharged: config.startCharged,
                    affinity: config.affinity,
                    role: config.role,
                    faction: config.faction,
                    position: config.position,
                    teamActors,
                    enemies: enemyInputs,
                    rounds,
                })
            );
        });
        return map;
    }, [configs, globalBuffs, teamActors, enemyInputs, rounds]);
```

If `final.healModifier` is not a field on the stats breakdown, grep how
`HealingCalculatorPage.tsx` sources the healer's `healModifier` and mirror it — do NOT hardcode 0
here. A self-repairing defender that reports 0 heal modifier silently under-reports its own
survivability, which is exactly the class of silent understatement this epic exists to remove.

- [ ] **Step 7: Render the panels**

Add `<EnemyAttackersPanel …>` and `<TeamPanel …>` next to the existing `<DefenseSettingsPanel …>`,
passing the handlers from Step 4. Pass `rounds` / `onRoundsChange={setRounds}` to
`DefenseSettingsPanel`. For `TeamPanel`, pass `showSharedBuffs={false}` (the defense page has its
own global buff picker) and `enemyAffinity` from the first enemy's affinity, defaulting to
`'antimatter'`.

- [ ] **Step 8: Switch `isBest` to measured EHP**

Replace the `bestShip` / `bestEffectiveHP` reducers with ones reading
`simResults.get(c.id)?.measuredEHP ?? 0`. Keep `mergedBuffTotals` and `computeBuffedStats` — Task 6
still displays the static baseline, and `DamageReductionChart` / `SecurityEHPChart` still consume
them unchanged.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx`

Expected: PASS (the `Measured EHP` text arrives with Task 6's card block — if this test needs Task
6 to pass, say so in the report and land the two together rather than weakening the assertion).

- [ ] **Step 10: Validate and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run audit:skills
git add src/pages/calculators/DefenseCalculatorPage.tsx src/components/calculator/DefenseSettingsPanel.tsx src/pages/calculators/__tests__/DefenseCalculatorPage.test.tsx
git commit -m "feat(calculators): run the survivability sim on the defense page (#358)"
```

---

### Task 6: Measured-EHP results block

**Files:**
- Modify: `src/components/calculator/DefenseShipCard.tsx`
- Modify: `src/pages/calculators/DefenseCalculatorPage.tsx` (pass `result` to the card)
- Test: `src/components/calculator/__tests__/DefenseShipCard.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `DefenseSurvivabilityResult` (Task 2), passed as a new optional `result` prop.
- Produces: the final card UI. No downstream consumers.

- [ ] **Step 1: Write the failing tests**

Create `src/components/calculator/__tests__/DefenseShipCard.test.tsx`, following the render
conventions of the nearest existing card test in that directory:

```typescript
    it('marks a survivor distinctly and shows the absorbed total as a lower bound', () => {
        renderCard({
            result: {
                measuredEHP: 30_000,
                survived: true,
                elapsedRounds: 3,
                breakdown: { toHp: 30_000, toShield: 0, toBarrier: 0, toConversion: 0, gross: 30_000 },
                rounds: [],
            },
        });
        expect(screen.getByText(/Measured EHP/i)).toBeInTheDocument();
        expect(screen.getByText('30,000')).toBeInTheDocument();
        // A survivor's number is a lower bound, never a death threshold.
        expect(screen.getByText(/Survived/i)).toBeInTheDocument();
    });

    it('names the round a casualty died in', () => {
        renderCard({
            result: {
                measuredEHP: 120_000,
                survived: false,
                destroyedRound: 2,
                elapsedRounds: 2,
                breakdown: { toHp: 120_000, toShield: 0, toBarrier: 0, toConversion: 0, gross: 120_000 },
                rounds: [],
            },
        });
        expect(screen.getByText(/Destroyed round 2/i)).toBeInTheDocument();
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/calculator/__tests__/DefenseShipCard.test.tsx`

Expected: FAIL — no `result` prop, no `Measured EHP` text.

- [ ] **Step 3: Render the block**

Add `result?: DefenseSurvivabilityResult;` to `DefenseShipCardProps`, and render above the existing
static rows:

```tsx
                {result && (
                    <div className="mt-4 pt-4 border-t border-dark-border">
                        <div className="flex justify-between items-baseline">
                            <span className="text-theme-text-secondary">Measured EHP:</span>
                            <span className={isBest ? 'text-primary font-bold' : 'font-bold'}>
                                {Math.round(result.measuredEHP).toLocaleString()}
                            </span>
                        </div>
                        <div className="text-xs mt-1">
                            {result.survived ? (
                                <span className="text-green-400">
                                    Survived all {result.elapsedRounds} rounds — absorbed at least
                                    this much
                                </span>
                            ) : (
                                <span className="text-red-500">
                                    Destroyed round {result.destroyedRound}
                                </span>
                            )}
                        </div>
                        <div className="mt-2 text-xs text-theme-text-secondary space-y-1">
                            <div className="flex justify-between">
                                <span>To hull</span>
                                <span>{result.breakdown.toHp.toLocaleString()}</span>
                            </div>
                            {result.breakdown.toShield > 0 && (
                                <div className="flex justify-between">
                                    <span>Absorbed by shield</span>
                                    <span>{result.breakdown.toShield.toLocaleString()}</span>
                                </div>
                            )}
                            {result.breakdown.toBarrier > 0 && (
                                <div className="flex justify-between">
                                    <span>Blocked by Barrier</span>
                                    <span>{result.breakdown.toBarrier.toLocaleString()}</span>
                                </div>
                            )}
                            {result.breakdown.toConversion > 0 && (
                                <div className="flex justify-between">
                                    <span>Converted to shield</span>
                                    <span>{result.breakdown.toConversion.toLocaleString()}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
```

Relabel the existing static row from `Effective HP:` to `Formula EHP:` and add a `helpLabel`-style
caption noting it ignores shields and conditional gating. Pass `result={simResults.get(config.id)}`
from the page.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/calculator/__tests__/DefenseShipCard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Confirm the end-to-end path, not just the boundary**

The gate proof, the Barrier case and the modifier case all live in Task 2 at the boundary level. What
this task must additionally confirm is that the *page* path reaches them — the config the page builds
from a real ship carries gated abilities through to the sim.

Run the app and check one real imported ship end to end:

```bash
npm start
```

Open the Defense calculator, pick a ship with a conditional defensive buff, add an enemy attacker,
and confirm: the Advanced section lists its real skill slots, Measured EHP is non-zero, and the
breakdown rows appear. Report the ship name and the two EHP figures (measured vs formula) as raw
data in the task report — a screenshot-free numeric claim is fine, but it must be a number you
actually read off the page, not an expectation.

- [ ] **Step 6: Validate and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run audit:skills
git add src/components/calculator/DefenseShipCard.tsx src/pages/calculators/DefenseCalculatorPage.tsx src/components/calculator/__tests__/DefenseShipCard.test.tsx src/utils/calculators/__tests__/defenseSurvivabilitySim.test.ts
git commit -m "feat(calculators): report measured EHP with an intake breakdown (#358)"
```

---

### Task 7: Documentation and changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Find the defense calculator's docs section**

Run: `grep -n "Defense Calculator" src/pages/DocumentationPage.tsx`

- [ ] **Step 2: Rewrite that section**

Cover: the calculator now runs the real combat engine off the ship's parsed skills; Measured EHP is
the damage absorbed before destruction; a survivor's figure is a lower bound, not a limit; the
Formula EHP shown beside it is the old static estimate and ignores shields and conditional buffs;
enemy attackers, ally support and the round window are shared across all configs; and — per the
spec's accepted consequence — the defender takes its own turns, so a high-attack ship that kills
attackers reduces its own incoming pressure and scores better than its defensive kit alone justifies.

No emojis. Match the surrounding section's component usage.

- [ ] **Step 3: Add the changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES`:

```typescript
    'The Defense calculator now runs the real combat engine using each ship\'s own skills. It reports Measured EHP — how much damage the ship actually absorbed before being destroyed — including shields, Barrier and self-repair, alongside the old formula estimate. You can configure enemy attackers, supporting allies and the length of the fight.',
```

- [ ] **Step 4: Validate and commit**

```bash
npm run lint && npx tsc --noEmit && npm test
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs: engine-backed defense calculator (#358)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §3.2 `convertedToShield` gap | 1 |
| §3 measurement rule, §3.1 double-count trap | 2 (tripwire test) |
| §3.3 survivors | 2 (policy), 6 (distinct rendering) |
| §4 `defenseSurvivabilitySim.ts` boundary | 2 |
| §4 `healModifier` real value | 3 (config field) + 5 Step 6 (threaded) |
| §4 `DefenseShipConfig` fields | 3 |
| §4 `SkillSlotList` replaces Skill Reference | 4 |
| §4 both ship-select sites | 3 (shared `defenderFieldsFromShip` helper) |
| §4 static formula untouched, charts untouched | 3, 5 Step 8 |
| §4.1 memoization | 5 Step 6 |
| §6.1 double-count tripwire | 2 |
| §6.1 non-vacuous ability-model proof | 2 (gate test) |
| §6.2 breakdown reconciliation (non-tautological) | 2 |
| §6.2 survived/destroyed both ways | 2 |
| §6.2 Barrier non-zero | 2 |
| §6.2 `modifier` ability affects EHP | 2 |
| §6.3 golden gate | Global Constraints + 1 Step 8 |
| §7 PR sequence | Tasks map 1:1 (PR3 = Tasks 3-4, PR4 = Tasks 5-6) |

Every spec requirement has a task. All nine Task 2 tests are literal code against verified
primitives: `hp-threshold` / `hpSubject: 'self'` (`types/abilities.ts:508-522`), `Defense Up II`
`'+30% Defense'` (`constants/buffs.ts:51`), `Barrier` `'Is invulnerable to damage.'`
(`constants/buffs.ts:790`, and `BARRIER_BUFFS` in `combat/barrierBuffs.ts:9`),
`ModifierChannel: 'incomingDamage'` (`types/abilities.ts:687`), and
`config: { type: 'shield', pct, basis: 'hp' }` (as used in `healingShieldPenetration.test.ts:54`).

**Two fixture traps are called out inline rather than left to be discovered:** a percentage defence
buff on `defence: 0` multiplies zero (so the gate test overrides to `defence: 5_000`), and the
double-count tripwire is vacuous on an unshielded fixture (so it asserts `absorbed > 0` before
comparing).

**Placeholder scan:** clean. Task 3 Step 1 and Task 6 Step 1 point at "the nearest existing page/card
test" for the render harness rather than inventing a provider wrapper — that is a deliberate
instruction to follow the established pattern, not a missing detail. Every other code step is
complete and literal. No "TBD", no "handle edge cases", no "similar to Task N".

**Type consistency:** `DefenseSurvivabilityResult` fields (`measuredEHP`, `survived`,
`destroyedRound`, `elapsedRounds`, `breakdown`, `rounds`) are used identically in Tasks 2, 5 and 6.
`DefenseIntakeBreakdown` fields (`toHp`, `toShield`, `toBarrier`, `toConversion`, `gross`) match
across the boundary, the card and both test files. `convertedToShield` is spelled identically in
`ActorIntake`, `HealingRoundEngine`, `HealingRoundData` and `DefenseSurvivabilityRound`.
