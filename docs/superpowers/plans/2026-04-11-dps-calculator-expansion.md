# DPS Calculator Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the DPS calculator with multi-round simulation, active/charged skill cycles, and DoT support (corrosion, inferno, bombs).

**Architecture:** New simulation engine in `src/utils/calculators/dpsSimulator.ts` following the `chronoReaver.ts` pattern. Shared `Buff` type extracted to `src/types/calculator.ts`. New `DPSRoundChart` component for cumulative damage visualization. Existing `DPSCalculatorPage` restructured with Advanced accordion and wired to the simulation engine.

**Tech Stack:** React 18, TypeScript, Vitest, Recharts, existing UI components (`CollapsibleAccordion`, `Input`, `Select`, `Button`, `BaseChart`)

**Spec:** `docs/superpowers/specs/2026-04-11-dps-calculator-expansion-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/calculator.ts` | Create | Shared `Buff` and `DoTApplicationConfig` types |
| `src/utils/calculators/dpsSimulator.ts` | Create | Round-by-round simulation engine |
| `src/utils/calculators/__tests__/dpsSimulator.test.ts` | Create | Simulation engine unit tests |
| `src/components/calculator/DPSRoundChart.tsx` | Create | Cumulative damage line chart |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Modify | New shared inputs, restructured ship cards, wire up simulation |

---

### Task 1: Extract shared types to `src/types/calculator.ts`

**Files:**
- Create: `src/types/calculator.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// src/types/calculator.ts
export interface Buff {
    id: string;
    stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage';
    value: number;
}

export interface DoTApplicationConfig {
    corrosionStacks: number;
    corrosionTier: 0 | 3 | 6 | 9;
    infernoStacks: number;
    infernoTier: 0 | 15 | 30 | 45;
    bombStacks: number;
    bombTier: 0 | 100 | 200 | 300;
    bombCountdown: number;
}

export const DEFAULT_DOT_CONFIG: DoTApplicationConfig = {
    corrosionStacks: 0,
    corrosionTier: 0,
    infernoStacks: 0,
    infernoTier: 0,
    bombStacks: 0,
    bombTier: 0,
    bombCountdown: 2,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types/calculator.ts
git commit -m "feat: add shared calculator types (Buff, DoTApplicationConfig)"
```

---

### Task 2: Build the simulation engine with TDD

**Files:**
- Create: `src/utils/calculators/dpsSimulator.ts`
- Create: `src/utils/calculators/__tests__/dpsSimulator.test.ts`
- Read: `src/utils/autogear/priorityScore.ts` (for `calculateCritMultiplier` at line 72, `calculateDamageReduction` at line 7)

#### Step group A: Active-only baseline

- [ ] **Step 1: Write test — active-only ship with no DoTs produces expected direct damage**

In `src/utils/calculators/__tests__/dpsSimulator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { DEFAULT_DOT_CONFIG } from '../../../types/calculator';

describe('simulateDPS', () => {
    const baseInput = {
        attack: 15000,
        crit: 100,
        critDamage: 150,
        defensePenetration: 0,
        activeMultiplier: 100,
        chargedMultiplier: 0,
        chargeCount: 0,
        activeDoTs: { ...DEFAULT_DOT_CONFIG },
        chargedDoTs: { ...DEFAULT_DOT_CONFIG },
        enemyDefense: 0,
        enemyHp: 500000,
        rounds: 3,
        buffs: [],
    };

    describe('active-only ship (no charged, no DoTs)', () => {
        it('produces identical direct damage each round', () => {
            const result = simulateDPS({ ...baseInput, enemyDefense: 0 });

            expect(result.rounds).toHaveLength(3);
            // Every round is active
            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
            // All rounds have same direct damage
            const dmg = result.rounds[0].directDamage;
            expect(dmg).toBeGreaterThan(0);
            expect(result.rounds[1].directDamage).toBe(dmg);
            expect(result.rounds[2].directDamage).toBe(dmg);
            // No DoT damage
            expect(result.rounds.every((r) => r.corrosionDamage === 0)).toBe(true);
            expect(result.rounds.every((r) => r.infernoDamage === 0)).toBe(true);
            expect(result.rounds.every((r) => r.bombDamage === 0)).toBe(true);
        });

        it('calculates correct summary totals', () => {
            const result = simulateDPS({ ...baseInput, rounds: 5 });

            const perRound = result.rounds[0].directDamage;
            expect(result.summary.totalDamage).toBe(perRound * 5);
            expect(result.summary.avgDamagePerRound).toBe(perRound);
            expect(result.summary.totalDirectDamage).toBe(perRound * 5);
            expect(result.summary.totalCorrosionDamage).toBe(0);
            expect(result.summary.totalInfernoDamage).toBe(0);
            expect(result.summary.totalBombDamage).toBe(0);
        });

        it('applies defense reduction to direct damage', () => {
            const noDef = simulateDPS({ ...baseInput, enemyDefense: 0 });
            const withDef = simulateDPS({ ...baseInput, enemyDefense: 15000 });

            expect(withDef.rounds[0].directDamage).toBeLessThan(noDef.rounds[0].directDamage);
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `simulateDPS` is not exported from `../dpsSimulator`

- [ ] **Step 3: Implement the simulation engine**

Create `src/utils/calculators/dpsSimulator.ts`:

```typescript
import {
    calculateCritMultiplier,
    calculateDamageReduction,
} from '../autogear/priorityScore';
import { Buff, DoTApplicationConfig } from '../../types/calculator';

export interface DPSSimulationInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
    enemyDefense: number;
    enemyHp: number;
    rounds: number;
    buffs: Buff[];
}

export interface RoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    directDamage: number;
    corrosionDamage: number;
    infernoDamage: number;
    bombDamage: number;
    totalRoundDamage: number;
    cumulativeDamage: number;
    activeCorrosionStacks: number;
    activeInfernoStacks: number;
    activeBombCount: number;
}

export interface DPSSimulationSummary {
    totalDamage: number;
    avgDamagePerRound: number;
    totalDirectDamage: number;
    totalCorrosionDamage: number;
    totalInfernoDamage: number;
    totalBombDamage: number;
}

export interface DPSSimulationResult {
    rounds: RoundData[];
    summary: DPSSimulationSummary;
}

// Tracks DoT stacks grouped by their tier (damage %).
// Active and charged skills may apply the same DoT type at different tiers,
// so we must track stacks per tier to calculate damage correctly.
interface DoTEntry {
    stacks: number;
    tier: number; // the % value (3/6/9 for corrosion, 15/30/45 for inferno)
}

interface PendingBomb {
    countdown: number;
    damagePerStack: number;
    stacks: number;
}

function calculateBuffTotals(buffs: Buff[]) {
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs
        .filter((b) => b.stat === 'crit')
        .reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);
    return { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff };
}

function addDoTStacks(entries: DoTEntry[], stacks: number, tier: number): void {
    const existing = entries.find((e) => e.tier === tier);
    if (existing) {
        existing.stacks += stacks;
    } else {
        entries.push({ stacks, tier });
    }
}

function tickDoTEntries(entries: DoTEntry[], baseValue: number): number {
    return entries.reduce(
        (sum, e) => sum + e.stacks * (e.tier / 100) * baseValue,
        0
    );
}

function totalStacks(entries: DoTEntry[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

export function simulateDPS(input: DPSSimulationInput): DPSSimulationResult {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        activeMultiplier,
        chargedMultiplier,
        chargeCount,
        activeDoTs,
        chargedDoTs,
        enemyDefense,
        enemyHp,
        rounds: numRounds,
        buffs,
    } = input;

    const { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff } =
        calculateBuffTotals(buffs);

    // Pre-calculate effective stats
    const effectiveAttack = attack * (1 + attackBuff / 100);
    const effectiveCrit = Math.min(100, crit + critBuff);
    const effectiveCritDamage = critDamage + critDamageBuff;

    const critMultiplier = calculateCritMultiplier({
        attack: effectiveAttack,
        crit: effectiveCrit,
        critDamage: effectiveCritDamage,
        hp: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        speed: 0,
        healModifier: 0,
    });

    const effectiveDefense = enemyDefense * (1 - defensePenetration / 100);
    const damageReduction =
        effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

    const hasChargedSkill = chargedMultiplier > 0 && chargeCount >= 1;

    // Mutable state — DoTs tracked per-tier for correct mixed-tier damage
    let charges = 0;
    let cumulativeDamage = 0;
    const corrosionEntries: DoTEntry[] = [];
    const infernoEntries: DoTEntry[] = [];
    const pendingBombs: PendingBomb[] = [];

    // Accumulators for summary
    let totalDirectDamage = 0;
    let totalCorrosionDamage = 0;
    let totalInfernoDamage = 0;
    let totalBombDamage = 0;

    const roundData: RoundData[] = [];

    for (let r = 1; r <= numRounds; r++) {
        // Step 1: Determine action
        let action: 'active' | 'charged';
        let multiplier: number;
        let dotsConfig: DoTApplicationConfig;

        if (hasChargedSkill && charges >= chargeCount) {
            action = 'charged';
            multiplier = chargedMultiplier;
            dotsConfig = chargedDoTs;
            charges = 0;
        } else {
            action = 'active';
            multiplier = activeMultiplier;
            dotsConfig = activeDoTs;
            if (hasChargedSkill) {
                charges += 1;
            }
        }

        // Step 2: Calculate direct hit damage
        const baseDamage =
            effectiveAttack * critMultiplier * (1 - damageReduction / 100);
        const directDamage =
            baseDamage *
            (multiplier / 100) *
            (1 + outgoingDamageBuff / 100);

        // Step 3: Apply new DoT stacks (per-tier tracking)
        if (dotsConfig.corrosionTier > 0 && dotsConfig.corrosionStacks > 0) {
            addDoTStacks(corrosionEntries, dotsConfig.corrosionStacks, dotsConfig.corrosionTier);
        }
        if (dotsConfig.infernoTier > 0 && dotsConfig.infernoStacks > 0) {
            addDoTStacks(infernoEntries, dotsConfig.infernoStacks, dotsConfig.infernoTier);
        }
        if (dotsConfig.bombTier > 0 && dotsConfig.bombStacks > 0) {
            pendingBombs.push({
                countdown: Math.max(1, dotsConfig.bombCountdown),
                damagePerStack: effectiveAttack * (dotsConfig.bombTier / 100),
                stacks: dotsConfig.bombStacks,
            });
        }

        // Step 4: Tick corrosion — bypasses defense, based on enemyHp
        const corrosionDamage = tickDoTEntries(corrosionEntries, enemyHp);

        // Step 5: Tick inferno — bypasses defense, based on effectiveAttack
        const infernoDamage = tickDoTEntries(infernoEntries, effectiveAttack);

        // Step 6: Check bomb timers — bypasses defense
        let bombDamage = 0;
        for (let i = pendingBombs.length - 1; i >= 0; i--) {
            pendingBombs[i].countdown -= 1;
            if (pendingBombs[i].countdown <= 0) {
                bombDamage +=
                    pendingBombs[i].stacks * pendingBombs[i].damagePerStack;
                pendingBombs.splice(i, 1);
            }
        }

        // Step 7: Sum damage
        const totalRoundDamage =
            directDamage + corrosionDamage + infernoDamage + bombDamage;
        cumulativeDamage += totalRoundDamage;

        totalDirectDamage += directDamage;
        totalCorrosionDamage += corrosionDamage;
        totalInfernoDamage += infernoDamage;
        totalBombDamage += bombDamage;

        roundData.push({
            round: r,
            action,
            charges,
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            bombDamage: Math.round(bombDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            activeCorrosionStacks: totalStacks(corrosionEntries),
            activeInfernoStacks: totalStacks(infernoEntries),
            activeBombCount: pendingBombs.length,
        });
    }

    return {
        rounds: roundData,
        summary: {
            totalDamage: Math.round(cumulativeDamage),
            avgDamagePerRound: Math.round(cumulativeDamage / numRounds),
            totalDirectDamage: Math.round(totalDirectDamage),
            totalCorrosionDamage: Math.round(totalCorrosionDamage),
            totalInfernoDamage: Math.round(totalInfernoDamage),
            totalBombDamage: Math.round(totalBombDamage),
        },
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: All 3 active-only tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "feat: add DPS simulation engine with active-only support"
```

#### Step group B: Active + Charged cycle

- [ ] **Step 6: Write tests for charged skill cycle**

Add to the test file:

```typescript
    describe('active + charged cycle', () => {
        it('fires charged after chargeCount active rounds', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 150,
                chargedMultiplier: 350,
                chargeCount: 3,
                rounds: 8,
            });

            // r1: active (charges->1), r2: active (->2), r3: active (->3)
            // r4: charged (->0), r5: active (->1), r6: active (->2), r7: active (->3)
            // r8: charged (->0)
            expect(result.rounds[0].action).toBe('active');
            expect(result.rounds[1].action).toBe('active');
            expect(result.rounds[2].action).toBe('active');
            expect(result.rounds[3].action).toBe('charged');
            expect(result.rounds[3].charges).toBe(0);
            expect(result.rounds[6].action).toBe('active');
            expect(result.rounds[7].action).toBe('charged');
        });

        it('charged damage is higher when chargedMultiplier > activeMultiplier', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 150,
                chargedMultiplier: 350,
                chargeCount: 3,
                rounds: 4,
            });

            const activeDmg = result.rounds[0].directDamage;
            const chargedDmg = result.rounds[3].directDamage;
            expect(chargedDmg).toBeGreaterThan(activeDmg);
            // Ratio should be roughly 350/150
            expect(chargedDmg / activeDmg).toBeCloseTo(350 / 150, 1);
        });
    });

    describe('charged skill guard', () => {
        it('skips charging when chargedMultiplier is 0', () => {
            const result = simulateDPS({
                ...baseInput,
                chargedMultiplier: 0,
                chargeCount: 3,
                rounds: 5,
            });

            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
        });

        it('skips charging when chargeCount is 0', () => {
            const result = simulateDPS({
                ...baseInput,
                chargedMultiplier: 200,
                chargeCount: 0,
                rounds: 5,
            });

            expect(result.rounds.every((r) => r.action === 'active')).toBe(true);
        });
    });
```

- [ ] **Step 7: Run tests — verify new tests pass (implementation already handles this)**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "test: add charged skill cycle and guard tests"
```

#### Step group C: DoT — Corrosion

- [ ] **Step 9: Write corrosion tests**

```typescript
    describe('corrosion', () => {
        it('accumulates stacks and ticks each round', () => {
            const result = simulateDPS({
                ...baseInput,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    corrosionTier: 3,
                    corrosionStacks: 1,
                },
                rounds: 3,
            });

            // r1: apply 1 stack, tick 1 stack = 1 * 0.03 * 500000 = 15000
            expect(result.rounds[0].corrosionDamage).toBe(15000);
            expect(result.rounds[0].activeCorrosionStacks).toBe(1);
            // r2: apply 1 more, tick 2 stacks = 2 * 0.03 * 500000 = 30000
            expect(result.rounds[1].corrosionDamage).toBe(30000);
            expect(result.rounds[1].activeCorrosionStacks).toBe(2);
            // r3: 3 stacks = 45000
            expect(result.rounds[2].corrosionDamage).toBe(45000);
        });

        it('is not affected by enemy defense', () => {
            const noDef = simulateDPS({
                ...baseInput,
                enemyDefense: 0,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    corrosionTier: 6,
                    corrosionStacks: 2,
                },
                rounds: 1,
            });
            const withDef = simulateDPS({
                ...baseInput,
                enemyDefense: 15000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    corrosionTier: 6,
                    corrosionStacks: 2,
                },
                rounds: 1,
            });

            expect(noDef.rounds[0].corrosionDamage).toBe(
                withDef.rounds[0].corrosionDamage
            );
        });
    });
```

- [ ] **Step 10: Run tests — verify they pass**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: All corrosion tests PASS

- [ ] **Step 11: Commit**

```bash
git add src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "test: add corrosion DoT tests"
```

#### Step group D: DoT — Inferno

- [ ] **Step 12: Write inferno tests**

```typescript
    describe('inferno', () => {
        it('deals damage based on attacker attack per stack', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    infernoTier: 30,
                    infernoStacks: 1,
                },
                rounds: 2,
            });

            // r1: 1 stack * 0.30 * 10000 = 3000
            expect(result.rounds[0].infernoDamage).toBe(3000);
            // r2: 2 stacks * 0.30 * 10000 = 6000
            expect(result.rounds[1].infernoDamage).toBe(6000);
        });

        it('scales with attack buff but not outgoing damage buff', () => {
            const withAtkBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    infernoTier: 30,
                    infernoStacks: 1,
                },
                buffs: [{ id: '1', stat: 'attack', value: 50 }],
                rounds: 1,
            });

            // effectiveAttack = 10000 * 1.5 = 15000
            // 1 stack * 0.30 * 15000 = 4500
            expect(withAtkBuff.rounds[0].infernoDamage).toBe(4500);

            const withOutgoingBuff = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    infernoTier: 30,
                    infernoStacks: 1,
                },
                buffs: [{ id: '1', stat: 'outgoingDamage', value: 50 }],
                rounds: 1,
            });

            // Outgoing damage should NOT affect inferno
            // 1 stack * 0.30 * 10000 = 3000
            expect(withOutgoingBuff.rounds[0].infernoDamage).toBe(3000);
        });
    });
```

- [ ] **Step 13: Run tests — verify they pass**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "test: add inferno DoT tests"
```

#### Step group E: DoT — Bombs

- [ ] **Step 15: Write bomb tests**

```typescript
    describe('bombs', () => {
        it('detonates after countdown reaches 0', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    bombTier: 100,
                    bombStacks: 1,
                    bombCountdown: 2,
                },
                rounds: 4,
            });

            // r1: apply bomb (countdown 2), tick countdown to 1 -> no explosion
            expect(result.rounds[0].bombDamage).toBe(0);
            // r2: apply bomb (countdown 2), tick r1 bomb to 0 -> explodes (1 * 10000)
            //     r2 bomb ticks to 1
            expect(result.rounds[1].bombDamage).toBe(10000);
            // r3: apply bomb (countdown 2), tick r2 bomb to 0 -> explodes (1 * 10000)
            expect(result.rounds[2].bombDamage).toBe(10000);
        });

        it('is not affected by defense or outgoing damage buff', () => {
            const noDef = simulateDPS({
                ...baseInput,
                attack: 10000,
                enemyDefense: 0,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    bombTier: 200,
                    bombStacks: 1,
                    bombCountdown: 1,
                },
                rounds: 1,
            });
            const withDef = simulateDPS({
                ...baseInput,
                attack: 10000,
                enemyDefense: 15000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    bombTier: 200,
                    bombStacks: 1,
                    bombCountdown: 1,
                },
                rounds: 1,
            });

            expect(noDef.rounds[0].bombDamage).toBe(withDef.rounds[0].bombDamage);
        });
    });
```

- [ ] **Step 16: Run tests — verify they pass**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git add src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "test: add bomb DoT tests"
```

#### Step group F: Mixed DoTs and edge cases

- [ ] **Step 18: Write mixed DoT and edge case tests**

```typescript
    describe('mixed DoTs on active vs charged', () => {
        it('applies correct DoT config based on action type', () => {
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 100,
                chargedMultiplier: 200,
                chargeCount: 2,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    infernoTier: 15,
                    infernoStacks: 1,
                },
                chargedDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    corrosionTier: 9,
                    corrosionStacks: 3,
                },
                rounds: 3,
            });

            // r1: active -> +1 inferno stack, 0 corrosion stacks
            expect(result.rounds[0].activeInfernoStacks).toBe(1);
            expect(result.rounds[0].activeCorrosionStacks).toBe(0);
            // r2: active -> +1 inferno stack
            expect(result.rounds[1].activeInfernoStacks).toBe(2);
            expect(result.rounds[1].activeCorrosionStacks).toBe(0);
            // r3: charged -> +3 corrosion stacks, no new inferno
            expect(result.rounds[2].action).toBe('charged');
            expect(result.rounds[2].activeInfernoStacks).toBe(2);
            expect(result.rounds[2].activeCorrosionStacks).toBe(3);
        });

        it('calculates mixed-tier corrosion damage correctly', () => {
            // Active applies corrosion tier I (3%), charged applies corrosion tier III (9%)
            const result = simulateDPS({
                ...baseInput,
                activeMultiplier: 100,
                chargedMultiplier: 200,
                chargeCount: 2,
                enemyHp: 100000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    corrosionTier: 3,
                    corrosionStacks: 1,
                },
                chargedDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    corrosionTier: 9,
                    corrosionStacks: 1,
                },
                rounds: 4,
            });

            // r1: active -> 1 stack at 3%. tick: 1*0.03*100000 = 3000
            expect(result.rounds[0].corrosionDamage).toBe(3000);
            // r2: active -> 2 stacks at 3%. tick: 2*0.03*100000 = 6000
            expect(result.rounds[1].corrosionDamage).toBe(6000);
            // r3: charged -> 2 stacks at 3% + 1 stack at 9%.
            //     tick: (2*0.03 + 1*0.09)*100000 = 15000
            expect(result.rounds[2].corrosionDamage).toBe(15000);
            // r4: active -> 3 stacks at 3% + 1 stack at 9%.
            //     tick: (3*0.03 + 1*0.09)*100000 = 18000
            expect(result.rounds[3].corrosionDamage).toBe(18000);
        });
    });

    describe('round 1 DoT ticking', () => {
        it('DoTs deal damage on the turn they are applied', () => {
            const result = simulateDPS({
                ...baseInput,
                attack: 10000,
                activeDoTs: {
                    ...DEFAULT_DOT_CONFIG,
                    infernoTier: 30,
                    infernoStacks: 2,
                },
                rounds: 1,
            });

            // Applied on r1, should tick on r1
            expect(result.rounds[0].infernoDamage).toBe(6000); // 2 * 0.30 * 10000
        });
    });
```

- [ ] **Step 19: Run tests — verify they pass**

Run: `npm test -- --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 20: Commit**

```bash
git add src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "test: add mixed DoT, mixed-tier, and round-1 ticking tests"
```

---

### Task 3: Build the round-by-round chart component

**Files:**
- Create: `src/components/calculator/DPSRoundChart.tsx`
- Read: `src/components/ui/charts/BaseChart.tsx` (for chart wrapper pattern)
- Read: `src/hooks/useThemeColors.ts` (for color theming)

- [ ] **Step 1: Create `DPSRoundChart.tsx`**

```typescript
import React from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
} from 'recharts';
import { BaseChart } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';

// Color palette for ship lines
const LINE_COLORS = [
    '#ec8c37', // primary/orange
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ef4444', // red
    '#06b6d4', // cyan
    '#f97316', // orange alt
];

interface ShipSimResult {
    id: string;
    name: string;
    result: DPSSimulationResult;
}

interface DPSRoundChartProps {
    ships: ShipSimResult[];
    rounds: number;
    height?: number;
}

interface ChartDataPoint {
    round: number;
    [key: string]: number; // ship cumulative damage keyed by ship id
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{
        name: string;
        value: number;
        color: string;
        dataKey: string;
    }>;
    label?: number;
    shipMap: Map<string, ShipSimResult>;
}

const RoundTooltip: React.FC<CustomTooltipProps> = ({
    active,
    payload,
    label,
    shipMap,
}) => {
    if (!active || !payload || !label) return null;

    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
            <p className="font-bold mb-1">Round {label}</p>
            {payload.map((entry) => {
                const ship = shipMap.get(entry.dataKey);
                const roundData = ship?.result.rounds[label - 1];
                return (
                    <div key={entry.dataKey} className="mb-1">
                        <p style={{ color: entry.color }} className="font-medium">
                            {entry.name}: {entry.value.toLocaleString()}
                        </p>
                        {roundData && (
                            <div className="text-xs text-theme-text-secondary pl-2">
                                <span>Direct: {roundData.directDamage.toLocaleString()}</span>
                                {roundData.corrosionDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#6bcc6b' }}>
                                        Corr: {roundData.corrosionDamage.toLocaleString()}
                                    </span>
                                )}
                                {roundData.infernoDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#e67e22' }}>
                                        Inf: {roundData.infernoDamage.toLocaleString()}
                                    </span>
                                )}
                                {roundData.bombDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#e74c3c' }}>
                                        Bomb: {roundData.bombDamage.toLocaleString()}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export const DPSRoundChart: React.FC<DPSRoundChartProps> = ({
    ships,
    rounds,
    height = 400,
}) => {
    const colors = useThemeColors();

    if (ships.length === 0) return null;

    // Build chart data: one point per round with cumulative damage per ship
    const chartData: ChartDataPoint[] = [];
    for (let r = 1; r <= rounds; r++) {
        const point: ChartDataPoint = { round: r };
        ships.forEach((ship) => {
            const roundData = ship.result.rounds[r - 1];
            point[ship.id] = roundData ? roundData.cumulativeDamage : 0;
        });
        chartData.push(point);
    }

    // Build lookup map for tooltip
    const shipMap = new Map(ships.map((s) => [s.id, s]));

    return (
        <BaseChart height={height}>
            <LineChart data={chartData}>
                <XAxis
                    dataKey="round"
                    label={{
                        value: 'Round',
                        position: 'insideBottom',
                        offset: -5,
                        fill: colors.text,
                    }}
                    tick={{ fill: colors.text }}
                />
                <YAxis
                    tickFormatter={(v) =>
                        v >= 1000000
                            ? `${(v / 1000000).toFixed(1)}M`
                            : v >= 1000
                              ? `${(v / 1000).toFixed(0)}k`
                              : v.toString()
                    }
                    label={{
                        value: 'Cumulative Damage',
                        angle: -90,
                        position: 'insideLeft',
                        offset: 10,
                        fill: colors.text,
                    }}
                    tick={{ fill: colors.text }}
                />
                <Tooltip
                    content={
                        <RoundTooltip shipMap={shipMap} />
                    }
                />
                <Legend />
                {ships.map((ship, i) => (
                    <Line
                        key={ship.id}
                        type="monotone"
                        dataKey={ship.id}
                        name={ship.name}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                    />
                ))}
            </LineChart>
        </BaseChart>
    );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/calculator/DPSRoundChart.tsx
git commit -m "feat: add DPS round-by-round cumulative damage chart"
```

---

### Task 4: Restructure `DPSCalculatorPage` — shared inputs, expanded ShipConfig, Advanced accordion

**Files:**
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx`
- Read: `src/types/calculator.ts` (for `Buff`, `DoTApplicationConfig`, `DEFAULT_DOT_CONFIG`)
- Read: `src/components/ui/CollapsibleAccordion.tsx` (wraps content in expandable panel — requires external toggle button)

This task rewires the entire page. Do it in one pass since the changes are tightly coupled.

- [ ] **Step 1: Update imports**

At the top of `DPSCalculatorPage.tsx`, update imports:

1. Add `useMemo` to the React import: `import React, { useState, useEffect, useMemo, useRef } from 'react';`
2. Add: `import { Buff, DoTApplicationConfig, DEFAULT_DOT_CONFIG } from '../../types/calculator';`
3. Add: `import { simulateDPS, DPSSimulationResult } from '../../utils/calculators/dpsSimulator';`
4. Add: `import { DPSRoundChart } from '../../components/calculator/DPSRoundChart';`
5. Add: `import { CollapsibleAccordion } from '../../components/ui/CollapsibleAccordion';`

Remove:
- The local `Buff` interface (lines 71-75) — now imported from `src/types/calculator.ts`
- The `calculateDPSWithDefense` function (lines 19-68) — replaced by simulation engine

**Keep** the URL param cleanup `useEffect` at lines 155-162. **Remove** the two DPS recalculation `useEffect` hooks at lines 165-186 and 189-207.

- [ ] **Step 2: Update ShipConfig interface and defaults**

Replace the `ShipConfig` interface (lines 78-87) with:

```typescript
interface ShipConfig {
    id: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
    advancedOpen: boolean;
}
```

Note: `dps` field is removed — damage is derived from simulation results. `skillMultiplier` is renamed to `activeMultiplier`.

Add new shared state alongside existing `enemyDefense`:

```typescript
const [enemyHp, setEnemyHp] = useState(500000);
const [rounds, setRounds] = useState(20);
```

Update default config in `getInitialConfig` (line 131-143) and `addConfig` (line 211-219):

```typescript
{
    id: '1',
    name: 'Ship 1',
    attack: 15000,
    crit: 100,
    critDamage: 125,
    defensePenetration: 0,
    activeMultiplier: 100,
    chargedMultiplier: 0,
    chargeCount: 0,
    activeDoTs: { ...DEFAULT_DOT_CONFIG },
    chargedDoTs: { ...DEFAULT_DOT_CONFIG },
    advancedOpen: false,
}
```

For `?shipId=` initialization (line 115-127), set `activeMultiplier: 100` instead of `skillMultiplier: 100`.

- [ ] **Step 3: Replace DPS calculation with simulation and update best-config logic**

Replace all uses of `calculateDPSWithDefense` with a `useMemo` block. Remove both DPS recalculation `useEffect` hooks (lines 165-207). Remove the `dps` field from all `ShipConfig` usage.

```typescript
const simResults = useMemo(() => {
    const map = new Map<string, DPSSimulationResult>();
    configs.forEach((config) => {
        map.set(
            config.id,
            simulateDPS({
                attack: config.attack,
                crit: config.crit,
                critDamage: config.critDamage,
                defensePenetration: config.defensePenetration,
                activeMultiplier: config.activeMultiplier,
                chargedMultiplier: config.chargedMultiplier,
                chargeCount: config.chargeCount,
                activeDoTs: config.activeDoTs,
                chargedDoTs: config.chargedDoTs,
                enemyDefense,
                enemyHp,
                rounds,
                buffs,
            })
        );
    });
    return map;
}, [configs, enemyDefense, enemyHp, rounds, buffs]);
```

Replace the `bestConfig` logic (lines 308-316) to use total damage from simulation:

```typescript
const bestConfig = configs.reduce<ShipConfig | null>((best, current) => {
    if (!best) return current;
    const bestDmg = simResults.get(best.id)?.summary.totalDamage ?? 0;
    const currentDmg = simResults.get(current.id)?.summary.totalDamage ?? 0;
    return currentDmg > bestDmg ? current : best;
}, null);

const secondBestConfig = configs
    .filter((config) => config.id !== bestConfig?.id)
    .reduce<ShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestDmg = simResults.get(best.id)?.summary.totalDamage ?? 0;
        const currentDmg = simResults.get(current.id)?.summary.totalDamage ?? 0;
        return currentDmg > bestDmg ? current : best;
    }, null);

const bestDmg = simResults.get(bestConfig?.id ?? '')?.summary.totalDamage;
const secondBestDmg = simResults.get(secondBestConfig?.id ?? '')?.summary.totalDamage;
const bestVsSecondPercentage =
    bestDmg && secondBestDmg
        ? ((bestDmg - secondBestDmg) / secondBestDmg) * 100
        : null;
```

- [ ] **Step 4: Update `updateConfig` signature and add `updateDoTConfig` helper**

Replace the `updateConfig` function (lines 248-286). Expand the field union to include new fields, and remove the DPS recalculation inside it (simulation is now derived via `useMemo`):

```typescript
const updateConfig = (
    id: string,
    field:
        | 'name'
        | 'attack'
        | 'crit'
        | 'critDamage'
        | 'defensePenetration'
        | 'activeMultiplier'
        | 'chargedMultiplier'
        | 'chargeCount'
        | 'advancedOpen',
    value: string | number | boolean
) => {
    setConfigs((prev) =>
        prev.map((config) =>
            config.id === id ? { ...config, [field]: value } : config
        )
    );
};

const updateDoTConfig = (
    configId: string,
    dotField: 'activeDoTs' | 'chargedDoTs',
    key: keyof DoTApplicationConfig,
    value: number
) => {
    setConfigs((prev) =>
        prev.map((c) =>
            c.id === configId
                ? { ...c, [dotField]: { ...c[dotField], [key]: value } }
                : c
        )
    );
};
```

Also simplify `addConfig` — remove DPS calculation, just add the config:

```typescript
const addConfig = () => {
    const newConfig: ShipConfig = {
        id: nextId.toString(),
        name: `Ship ${nextId}`,
        attack: 15000,
        crit: 100,
        critDamage: 150,
        defensePenetration: 0,
        activeMultiplier: 100,
        chargedMultiplier: 0,
        chargeCount: 0,
        activeDoTs: { ...DEFAULT_DOT_CONFIG },
        chargedDoTs: { ...DEFAULT_DOT_CONFIG },
        advancedOpen: false,
    };
    setConfigs([...configs, newConfig]);
    setNextId(nextId + 1);
};
```

- [ ] **Step 5: Update the shared inputs card**

Replace the "Enemy Defense" card (lines 354-365) with a "Combat Settings" card:

```tsx
<div className="card">
    <h3 className="text-lg font-bold mb-4">Combat Settings</h3>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input
            label="Enemy Defense"
            type="number"
            value={enemyDefense}
            onChange={(e) => setEnemyDefense(parseInt(e.target.value) || 0)}
        />
        <Input
            label="Enemy HP"
            type="number"
            value={enemyHp}
            onChange={(e) => setEnemyHp(parseInt(e.target.value) || 0)}
        />
        <Input
            label="Rounds"
            type="number"
            min="1"
            max="50"
            value={rounds}
            onChange={(e) =>
                setRounds(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))
            }
        />
    </div>
    <p className="text-sm text-theme-text-secondary mt-2">
        Shared combat settings applied to all ship configurations
    </p>
</div>
```

- [ ] **Step 6: Restructure ship config cards with Advanced accordion**

Add tier option constants outside the component (above `DPSCalculatorPage`):

```typescript
const CORROSION_TIER_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '3', label: 'I (3%)' },
    { value: '6', label: 'II (6%)' },
    { value: '9', label: 'III (9%)' },
];

const INFERNO_TIER_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '15', label: 'I (15%)' },
    { value: '30', label: 'II (30%)' },
    { value: '45', label: 'III (45%)' },
];

const BOMB_TIER_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '100', label: 'I (100%)' },
    { value: '200', label: 'II (200%)' },
    { value: '300', label: 'III (300%)' },
];
```

Replace the ship config card body (lines 427-593). The card structure is:

1. **Header** (name + remove button) — unchanged
2. **Base stats** (Attack, Crit Rate, Crit Damage, Def Pen) — keep these always visible. **Remove** the old "Skill Multiplier" input from this area (lines 512-524) — it moves into the Advanced accordion as "Active Multiplier"
3. **Advanced accordion toggle button + CollapsibleAccordion** — new
4. **Results area** — updated to show simulation results

The accordion toggle button and `CollapsibleAccordion`:

```tsx
{/* Advanced accordion */}
<button
    className="w-full flex justify-between items-center p-2 mt-4 bg-dark-lighter border border-dark-border hover:bg-dark-lighter/80"
    onClick={() => updateConfig(config.id, 'advancedOpen', !config.advancedOpen)}
>
    <span className="font-semibold text-sm">Advanced</span>
    <span className="text-theme-text-secondary text-xs">
        {config.advancedOpen ? '▼' : '▶'}
    </span>
</button>
<CollapsibleAccordion isOpen={config.advancedOpen}>
    {/* Skills section */}
    <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
        Skills
    </div>
    <div className="grid grid-cols-3 gap-4 mb-4">
        <Input
            label="Active (%)"
            type="number"
            min="0"
            value={config.activeMultiplier}
            onChange={(e) =>
                updateConfig(config.id, 'activeMultiplier', parseInt(e.target.value) || 0)
            }
        />
        <Input
            label="Charged (%)"
            type="number"
            min="0"
            value={config.chargedMultiplier}
            onChange={(e) =>
                updateConfig(config.id, 'chargedMultiplier', parseInt(e.target.value) || 0)
            }
        />
        <Input
            label="Charge Count"
            type="number"
            min="0"
            value={config.chargeCount}
            onChange={(e) =>
                updateConfig(config.id, 'chargeCount', parseInt(e.target.value) || 0)
            }
        />
    </div>

    {/* DoTs — Active Skill */}
    <div className="text-xs font-semibold text-orange-400 uppercase tracking-wide mb-2">
        DoTs — Active Skill
    </div>
    <div className="space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-4">
            <Select
                label="Corrosion Tier"
                options={CORROSION_TIER_OPTIONS}
                value={String(config.activeDoTs.corrosionTier)}
                onChange={(v) => updateDoTConfig(config.id, 'activeDoTs', 'corrosionTier', parseInt(v))}
            />
            <Input
                label="Stacks / use"
                type="number"
                min="0"
                value={config.activeDoTs.corrosionStacks}
                onChange={(e) => updateDoTConfig(config.id, 'activeDoTs', 'corrosionStacks', parseInt(e.target.value) || 0)}
            />
        </div>
        <div className="grid grid-cols-2 gap-4">
            <Select
                label="Inferno Tier"
                options={INFERNO_TIER_OPTIONS}
                value={String(config.activeDoTs.infernoTier)}
                onChange={(v) => updateDoTConfig(config.id, 'activeDoTs', 'infernoTier', parseInt(v))}
            />
            <Input
                label="Stacks / use"
                type="number"
                min="0"
                value={config.activeDoTs.infernoStacks}
                onChange={(e) => updateDoTConfig(config.id, 'activeDoTs', 'infernoStacks', parseInt(e.target.value) || 0)}
            />
        </div>
        <div className="grid grid-cols-3 gap-4">
            <Select
                label="Bomb Tier"
                options={BOMB_TIER_OPTIONS}
                value={String(config.activeDoTs.bombTier)}
                onChange={(v) => updateDoTConfig(config.id, 'activeDoTs', 'bombTier', parseInt(v))}
            />
            <Input
                label="Stacks / use"
                type="number"
                min="0"
                value={config.activeDoTs.bombStacks}
                onChange={(e) => updateDoTConfig(config.id, 'activeDoTs', 'bombStacks', parseInt(e.target.value) || 0)}
            />
            <Input
                label="Countdown"
                type="number"
                min="1"
                value={config.activeDoTs.bombCountdown}
                onChange={(e) => updateDoTConfig(config.id, 'activeDoTs', 'bombCountdown', Math.max(1, parseInt(e.target.value) || 1))}
            />
        </div>
    </div>

    {/* DoTs — Charged Skill */}
    <div className="text-xs font-semibold text-purple-400 uppercase tracking-wide mb-2">
        DoTs — Charged Skill
    </div>
    <div className="space-y-3">
        {/* Same structure as active DoTs but using chargedDoTs */}
        <div className="grid grid-cols-2 gap-4">
            <Select
                label="Corrosion Tier"
                options={CORROSION_TIER_OPTIONS}
                value={String(config.chargedDoTs.corrosionTier)}
                onChange={(v) => updateDoTConfig(config.id, 'chargedDoTs', 'corrosionTier', parseInt(v))}
            />
            <Input
                label="Stacks / use"
                type="number"
                min="0"
                value={config.chargedDoTs.corrosionStacks}
                onChange={(e) => updateDoTConfig(config.id, 'chargedDoTs', 'corrosionStacks', parseInt(e.target.value) || 0)}
            />
        </div>
        <div className="grid grid-cols-2 gap-4">
            <Select
                label="Inferno Tier"
                options={INFERNO_TIER_OPTIONS}
                value={String(config.chargedDoTs.infernoTier)}
                onChange={(v) => updateDoTConfig(config.id, 'chargedDoTs', 'infernoTier', parseInt(v))}
            />
            <Input
                label="Stacks / use"
                type="number"
                min="0"
                value={config.chargedDoTs.infernoStacks}
                onChange={(e) => updateDoTConfig(config.id, 'chargedDoTs', 'infernoStacks', parseInt(e.target.value) || 0)}
            />
        </div>
        <div className="grid grid-cols-3 gap-4">
            <Select
                label="Bomb Tier"
                options={BOMB_TIER_OPTIONS}
                value={String(config.chargedDoTs.bombTier)}
                onChange={(v) => updateDoTConfig(config.id, 'chargedDoTs', 'bombTier', parseInt(v))}
            />
            <Input
                label="Stacks / use"
                type="number"
                min="0"
                value={config.chargedDoTs.bombStacks}
                onChange={(e) => updateDoTConfig(config.id, 'chargedDoTs', 'bombStacks', parseInt(e.target.value) || 0)}
            />
            <Input
                label="Countdown"
                type="number"
                min="1"
                value={config.chargedDoTs.bombCountdown}
                onChange={(e) => updateDoTConfig(config.id, 'chargedDoTs', 'bombCountdown', Math.max(1, parseInt(e.target.value) || 1))}
            />
        </div>
    </div>
</CollapsibleAccordion>
```

- [ ] **Step 7: Update results area in each ship card**

Replace the existing DPS display (lines 527-590) with simulation results. The `isBest` variable is derived from `bestConfig`:

```tsx
{(() => {
    const sim = simResults.get(config.id);
    if (!sim) return null;
    const isBest = bestConfig?.id === config.id;
    const hasDoTs =
        sim.summary.totalCorrosionDamage > 0 ||
        sim.summary.totalInfernoDamage > 0 ||
        sim.summary.totalBombDamage > 0;

    return (
        <div className="mt-4 pt-4 border-t border-dark-border">
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Crit Multiplier:</span>
                <span>
                    {calculateCritMultiplier({
                        attack: config.attack,
                        crit: config.crit,
                        critDamage: config.critDamage,
                        hp: 0, defence: 0, hacking: 0,
                        security: 0, speed: 0, healModifier: 0,
                    }).toFixed(2)}x
                </span>
            </div>
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Avg Damage / Round:</span>
                <span className={isBest ? 'text-primary font-bold' : ''}>
                    {sim.summary.avgDamagePerRound.toLocaleString()}
                </span>
            </div>
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">
                    Total Damage ({rounds} rounds):
                </span>
                <span className={isBest ? 'text-primary font-bold' : ''}>
                    {sim.summary.totalDamage.toLocaleString()}
                </span>
            </div>
            {hasDoTs && (
                <div className="grid grid-cols-4 gap-1 mt-2">
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-theme-text-secondary">Direct</div>
                        <div className="text-xs">{sim.summary.totalDirectDamage.toLocaleString()}</div>
                    </div>
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-green-400">Corrosion</div>
                        <div className="text-xs text-green-400">
                            {sim.summary.totalCorrosionDamage.toLocaleString()}
                        </div>
                    </div>
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-orange-400">Inferno</div>
                        <div className="text-xs text-orange-400">
                            {sim.summary.totalInfernoDamage.toLocaleString()}
                        </div>
                    </div>
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-red-400">Bomb</div>
                        <div className="text-xs text-red-400">
                            {sim.summary.totalBombDamage.toLocaleString()}
                        </div>
                    </div>
                </div>
            )}
            {isBest && configs.length > 1 && (
                <div className="text-sm mt-2 text-center">
                    <span className="text-primary">Best ship configuration</span>
                    {bestVsSecondPercentage !== null && (
                        <span className="text-green-500 ml-2">
                            +{bestVsSecondPercentage.toFixed(2)}% vs #2
                        </span>
                    )}
                </div>
            )}
            {!isBest && bestConfig && (
                <div className="flex justify-between mt-2">
                    <span className="text-theme-text-secondary">Compared to best:</span>
                    <span className="text-red-500">
                        {(((sim.summary.totalDamage - (simResults.get(bestConfig.id)?.summary.totalDamage ?? 0)) /
                            (simResults.get(bestConfig.id)?.summary.totalDamage ?? 1)) * 100
                        ).toFixed(2)}%
                    </span>
                </div>
            )}
        </div>
    );
})()}
```

- [ ] **Step 8: Add the round-by-round chart section**

Between the ship config cards grid and the existing "DPS Comparison" section (line 596), add:

```tsx
<div className="card">
    <h3 className="text-lg font-bold mb-2">Damage Over Time</h3>
    <p className="text-sm text-theme-text-secondary mb-4">
        Cumulative damage comparison across rounds. Burst ships climb fast
        then plateau; DoT ships ramp up over time.
    </p>
    <DPSRoundChart
        ships={configs
            .map((config) => ({
                id: config.id,
                name: config.name,
                result: simResults.get(config.id)!,
            }))
            .filter((s) => s.result)}
        rounds={rounds}
    />
</div>
```

- [ ] **Step 9: Update the "About DPS Calculation" section**

Replace the explanation text at the bottom (lines 637-655) to mention the simulation, DoTs, and charged skills:

```tsx
<div className="card">
    <h2 className="text-xl font-bold mb-4">About the Simulation</h2>
    <p className="mb-2">
        The simulator models combat round-by-round. Each round, your ship
        fires either its active or charged skill (if configured). Damage
        is calculated as:
    </p>
    <p className="mb-2 font-mono bg-dark-lighter p-2 text-sm">
        Direct = Attack × CritMultiplier × (1 - DamageReduction%) × SkillMultiplier% × (1 + OutgoingDmg%)
    </p>
    <p className="mb-2">
        DoT effects (corrosion, inferno, bombs) bypass enemy defense entirely.
        Corrosion deals a percentage of the target's HP per stack. Inferno
        and bombs deal a percentage of the attacker's attack stat. Bombs
        detonate after a countdown period.
    </p>
    <p>
        All DoTs stack permanently and tick on the turn they are applied.
    </p>
</div>
```

- [ ] **Step 10: Verify the dev server runs and test manually**

Run: `npm start`

Open the DPS calculator page. Verify:
1. Default view: base stats + collapsed Advanced + results showing avg/total damage
2. Open Advanced: Skills and DoT inputs visible
3. Add a second ship with DoTs configured — chart shows diverging lines
4. Existing heatmap/table/defense pen charts still work
5. Ship loaded via `?shipId=` still works
6. Best config highlighting uses total damage

- [ ] **Step 11: Run all tests**

Run: `npm test -- --reporter verbose 2>&1 | tail -30`
Expected: All tests pass (including new simulation tests)

- [ ] **Step 12: Run lint**

Run: `npm run lint`
Expected: 0 warnings, 0 errors

- [ ] **Step 13: Commit**

```bash
git add src/pages/calculators/DPSCalculatorPage.tsx
git commit -m "feat: restructure DPS calculator with simulation engine, Advanced accordion, and round chart"
```

---

### Task 5: Final verification and cleanup

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 2: Manual smoke test**

Open dev server and verify:
- Default ship config (no advanced) shows same damage behavior as before
- Adding charged skill shows active/charged cycle in chart
- Adding corrosion shows ramping damage in chart
- Adding inferno shows ramping damage based on attack
- Adding bombs shows spike damage at countdown intervals
- Buffs affect direct damage and inferno/bomb (attack buff only for DoTs)
- Enemy defense affects direct damage but NOT DoTs
- Multiple ships compare correctly in chart

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```

(Only if fixes were needed.)
