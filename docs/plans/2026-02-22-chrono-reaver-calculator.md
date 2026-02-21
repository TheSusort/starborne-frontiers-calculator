# Chrono Reaver Calculator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a calculator page that simulates Chrono Reaver (CR) implant charge mechanics turn-by-turn, showing efficiency, waste, and DPS impact across configurable ship setups.

**Architecture:** Pure client-side calculator with no database or persistence. A utility module handles the simulation logic (pure functions), and a page component handles inputs, timeline display, and summary metrics. Follows the existing card-based multi-config calculator pattern (like DefenseCalculatorPage).

**Tech Stack:** React 18, TypeScript, TailwindCSS, Vite

---

### Task 1: Chrono Reaver Simulation Utility — Tests

**Files:**
- Create: `src/utils/calculators/chronoReaver.ts`
- Create: `src/utils/calculators/__tests__/chronoReaver.test.ts`

**Step 1: Write the failing tests**

Create `src/utils/calculators/__tests__/chronoReaver.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { simulateChronoReaver, type CRSimulationInput, type CRRoundData } from '../chronoReaver';

describe('simulateChronoReaver', () => {
    describe('no CR (baseline)', () => {
        it('fires charged every N+1 rounds for N charges', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'none',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 10,
            });

            // Without CR: 4 active rounds then 1 charged, repeating
            // r1:active, r2:active, r3:active, r4:active(4c), r5:charged
            // r6:active, r7:active, r8:active, r9:active(4c), r10:charged
            expect(result.rounds).toHaveLength(10);
            expect(result.rounds[4].action).toBe('charged');
            expect(result.rounds[9].action).toBe('charged');
            expect(result.rounds[0].action).toBe('active');
        });

        it('calculates correct damage totals', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'none',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 5,
            });

            // 4 active (150 each) + 1 charged (350) = 950
            expect(result.rounds[4].totalDamage).toBe(950);
        });
    });

    describe('legendary CR (procs every 2nd turn)', () => {
        it('matches expected pattern for 4 charges', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // r1: active → 1c
            // r2: active → 2c + CR → 3c
            // r3: active → 4c
            // r4: charged → 0c + CR → 1c
            // r5: active → 2c
            // r6: active → 3c + CR → 4c
            // r7: charged → 0c
            expect(result.rounds[0]).toMatchObject({ action: 'active', endCharges: 1, crProc: false });
            expect(result.rounds[1]).toMatchObject({ action: 'active', endCharges: 3, crProc: true });
            expect(result.rounds[2]).toMatchObject({ action: 'active', endCharges: 4, crProc: false });
            expect(result.rounds[3]).toMatchObject({ action: 'charged', endCharges: 1, crProc: true });
            expect(result.rounds[4]).toMatchObject({ action: 'active', endCharges: 2, crProc: false });
            expect(result.rounds[5]).toMatchObject({ action: 'active', endCharges: 4, crProc: true });
            expect(result.rounds[6]).toMatchObject({ action: 'charged', endCharges: 0, crProc: false });
        });
    });

    describe('epic CR (procs every 3rd turn)', () => {
        it('matches expected pattern for 4 charges', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'epic',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 8,
            });

            // r1: active → 1c
            // r2: active → 2c
            // r3: active → 3c + CR → 4c
            // r4: charged → 0c
            // r5: active → 1c
            // r6: active → 2c + CR → 3c
            // r7: active → 4c
            // r8: charged → 0c
            expect(result.rounds[0]).toMatchObject({ action: 'active', endCharges: 1, crProc: false });
            expect(result.rounds[1]).toMatchObject({ action: 'active', endCharges: 2, crProc: false });
            expect(result.rounds[2]).toMatchObject({ action: 'active', endCharges: 4, crProc: true });
            expect(result.rounds[3]).toMatchObject({ action: 'charged', endCharges: 0, crProc: false });
            expect(result.rounds[4]).toMatchObject({ action: 'active', endCharges: 1, crProc: false });
            expect(result.rounds[5]).toMatchObject({ action: 'active', endCharges: 3, crProc: true });
            expect(result.rounds[6]).toMatchObject({ action: 'active', endCharges: 4, crProc: false });
            expect(result.rounds[7]).toMatchObject({ action: 'charged', endCharges: 0, crProc: false });
        });
    });

    describe('wasted procs', () => {
        it('detects wasted proc when active fills to max on a proc turn', () => {
            // 3 charges, legendary CR
            // r8: active → 3c (max) + CR → WASTED
            const result = simulateChronoReaver({
                chargesRequired: 3,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 9,
            });

            // r1: active → 1c
            // r2: active → 2c + CR → 3c
            // r3: charged → 0c
            // r4: active → 1c + CR → 2c
            // r5: active → 3c
            // r6: charged → 0c + CR → 1c
            // r7: active → 2c
            // r8: active → 3c + CR → WASTED (already at max)
            // r9: charged → 0c
            expect(result.rounds[7]).toMatchObject({ action: 'active', endCharges: 3, crProc: true, wastedProc: true });
            expect(result.summary.wastedProcs).toBe(1);
        });
    });

    describe('summary metrics', () => {
        it('calculates avg damage per round', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'none',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 10,
            });

            // 10 rounds: 8 active (150) + 2 charged (350) = 1900 / 10 = 190
            expect(result.summary.avgDamagePerRound).toBe(190);
        });

        it('calculates charged attack frequency', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // 2 charged attacks in 7 rounds = every 3.5 rounds
            expect(result.summary.chargedFrequency).toBe(3.5);
        });

        it('calculates DPS increase vs no CR', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // With CR: 5 active (750) + 2 charged (700) = 1450 / 7 ≈ 207.14
            // Without CR: baseline is 190 per round (from test above, over enough rounds)
            // Increase should be > 0
            expect(result.summary.dpsIncreasePercent).toBeGreaterThan(0);
        });

        it('counts total procs and wasted procs', () => {
            const result = simulateChronoReaver({
                chargesRequired: 4,
                crRarity: 'legendary',
                activeSkillPercent: 150,
                chargedSkillPercent: 350,
                rounds: 7,
            });

            // Legendary procs on r2, r4, r6 = 3 procs in 7 rounds
            expect(result.summary.totalProcs).toBe(3);
            expect(result.summary.wastedProcs).toBe(0);
        });
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/utils/calculators/__tests__/chronoReaver.test.ts`
Expected: FAIL — module `../chronoReaver` not found

**Step 3: Commit**

```bash
git add src/utils/calculators/__tests__/chronoReaver.test.ts
git commit -m "test: add Chrono Reaver simulation tests"
```

---

### Task 2: Chrono Reaver Simulation Utility — Implementation

**Files:**
- Create: `src/utils/calculators/chronoReaver.ts`
- Test: `src/utils/calculators/__tests__/chronoReaver.test.ts` (from Task 1)

**Step 1: Implement the simulation**

Create `src/utils/calculators/chronoReaver.ts`:

```typescript
export type CRRarity = 'none' | 'epic' | 'legendary';

export interface CRSimulationInput {
    chargesRequired: number; // 2-4
    crRarity: CRRarity;
    activeSkillPercent: number;
    chargedSkillPercent: number;
    rounds: number;
}

export interface CRRoundData {
    round: number;
    startCharges: number;
    action: 'active' | 'charged';
    crProc: boolean;
    wastedProc: boolean;
    endCharges: number;
    damage: number;
    totalDamage: number;
}

export interface CRSummary {
    avgDamagePerRound: number;
    chargedFrequency: number; // "every X rounds"
    totalProcs: number;
    wastedProcs: number;
    dpsIncreasePercent: number;
}

export interface CRSimulationResult {
    rounds: CRRoundData[];
    summary: CRSummary;
}

function isCRProcTurn(round: number, rarity: CRRarity): boolean {
    if (rarity === 'none') return false;
    if (rarity === 'legendary') return round % 2 === 0;
    if (rarity === 'epic') return round % 3 === 0;
    return false;
}

export function simulateChronoReaver(input: CRSimulationInput): CRSimulationResult {
    const { chargesRequired, crRarity, activeSkillPercent, chargedSkillPercent, rounds: numRounds } = input;

    const roundData: CRRoundData[] = [];
    let charges = 0;
    let totalDamage = 0;

    for (let r = 1; r <= numRounds; r++) {
        const startCharges = charges;
        let action: 'active' | 'charged';
        let damage: number;

        if (charges >= chargesRequired) {
            action = 'charged';
            damage = chargedSkillPercent;
            charges = 0;
        } else {
            action = 'active';
            damage = activeSkillPercent;
            charges += 1;
        }

        const crProc = isCRProcTurn(r, crRarity);
        let wastedProc = false;

        if (crProc) {
            if (charges < chargesRequired) {
                charges += 1;
            } else {
                wastedProc = true;
            }
        }

        totalDamage += damage;

        roundData.push({
            round: r,
            startCharges,
            action,
            crProc,
            wastedProc,
            endCharges: charges,
            damage,
            totalDamage,
        });
    }

    // Calculate summary
    const chargedCount = roundData.filter((r) => r.action === 'charged').length;
    const totalProcs = roundData.filter((r) => r.crProc).length;
    const wastedProcs = roundData.filter((r) => r.wastedProc).length;

    // Baseline: no CR
    const baselineResult = crRarity !== 'none'
        ? simulateChronoReaver({ ...input, crRarity: 'none' })
        : null;
    const baselineAvg = baselineResult
        ? baselineResult.summary.avgDamagePerRound
        : totalDamage / numRounds;

    const avgDamagePerRound = totalDamage / numRounds;
    const dpsIncreasePercent = baselineResult
        ? ((avgDamagePerRound - baselineAvg) / baselineAvg) * 100
        : 0;

    return {
        rounds: roundData,
        summary: {
            avgDamagePerRound,
            chargedFrequency: chargedCount > 0 ? numRounds / chargedCount : 0,
            totalProcs,
            wastedProcs,
            dpsIncreasePercent,
        },
    };
}
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- src/utils/calculators/__tests__/chronoReaver.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/utils/calculators/chronoReaver.ts
git commit -m "feat: add Chrono Reaver charge simulation utility"
```

---

### Task 3: SEO Config

**Files:**
- Modify: `src/constants/seo.ts` (add entry after `speed` on line 120)

**Step 1: Add SEO config**

Add after the `speed` entry (before the closing `} as const;` on line 121):

```typescript
    chronoReaver: {
        title: 'Chrono Reaver Calculator',
        description:
            'Simulate Chrono Reaver implant charge mechanics in Starborne Frontiers. Compare Epic vs Legendary efficiency, wasted procs, and DPS impact across different ships.',
        keywords:
            'chrono reaver, implant calculator, charge mechanics, ultimate implant, starborne frontiers',
    },
```

**Step 2: Commit**

```bash
git add src/constants/seo.ts
git commit -m "feat: add Chrono Reaver SEO config"
```

---

### Task 4: Calculator Page Component

**Files:**
- Create: `src/pages/calculators/ChronoReaverCalculatorPage.tsx`

**Step 1: Create the page**

Create `src/pages/calculators/ChronoReaverCalculatorPage.tsx`:

```typescript
import React, { useState, useMemo } from 'react';
import { CloseIcon, PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { simulateChronoReaver, type CRRarity, type CRSimulationResult } from '../../utils/calculators/chronoReaver';

interface ShipConfig {
    id: string;
    name: string;
    chargesRequired: number;
    crRarity: CRRarity;
    activeSkillPercent: number;
    chargedSkillPercent: number;
    rounds: number;
}

const DEFAULT_CONFIG: Omit<ShipConfig, 'id' | 'name'> = {
    chargesRequired: 4,
    crRarity: 'legendary',
    activeSkillPercent: 150,
    chargedSkillPercent: 350,
    rounds: 20,
};

const CR_RARITY_OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'epic', label: 'Epic' },
    { value: 'legendary', label: 'Legendary' },
];

const ChronoReaverCalculatorPage: React.FC = () => {
    const [configs, setConfigs] = useState<ShipConfig[]>([
        { id: '1', name: 'Ship 1', ...DEFAULT_CONFIG },
    ]);
    const [nextId, setNextId] = useState(2);

    const results = useMemo(() => {
        const map = new Map<string, CRSimulationResult>();
        configs.forEach((config) => {
            map.set(
                config.id,
                simulateChronoReaver({
                    chargesRequired: config.chargesRequired,
                    crRarity: config.crRarity,
                    activeSkillPercent: config.activeSkillPercent,
                    chargedSkillPercent: config.chargedSkillPercent,
                    rounds: config.rounds,
                })
            );
        });
        return map;
    }, [configs]);

    const addConfig = () => {
        setConfigs([
            ...configs,
            { id: nextId.toString(), name: `Ship ${nextId}`, ...DEFAULT_CONFIG },
        ]);
        setNextId(nextId + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs(configs.filter((c) => c.id !== id));
    };

    const updateConfig = (id: string, field: keyof Omit<ShipConfig, 'id'>, value: string | number) => {
        setConfigs(
            configs.map((c) => (c.id === id ? { ...c, [field]: value } : c))
        );
    };

    // Find config with highest avg damage per round
    const bestConfig = configs.reduce<ShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestResult = results.get(best.id);
        const currentResult = results.get(current.id);
        if (!bestResult || !currentResult) return best;
        return currentResult.summary.avgDamagePerRound > bestResult.summary.avgDamagePerRound
            ? current
            : best;
    }, null);

    return (
        <>
            <Seo {...SEO_CONFIG.chronoReaver} />
            <PageLayout
                title="Chrono Reaver Calculator"
                description="Simulate Chrono Reaver charge mechanics to compare efficiency across ships and rarities"
                action={{
                    label: 'Add Ship',
                    onClick: addConfig,
                    variant: 'primary',
                }}
            >
                <div className="space-y-6">
                    {configs.map((config) => {
                        const result = results.get(config.id);
                        if (!result) return null;
                        const isBest = bestConfig?.id === config.id && configs.length > 1;

                        return (
                            <div
                                key={config.id}
                                className={`p-4 bg-dark border ${isBest ? 'border-primary' : 'border-dark-border'}`}
                            >
                                {/* Header */}
                                <div className="flex justify-between items-center mb-4">
                                    <Input
                                        value={config.name}
                                        onChange={(e) => updateConfig(config.id, 'name', e.target.value)}
                                        className="font-bold"
                                    />
                                    <Button
                                        variant="danger"
                                        onClick={() => removeConfig(config.id)}
                                        aria-label="Remove ship"
                                    >
                                        <CloseIcon />
                                    </Button>
                                </div>

                                {/* Inputs */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                                    <Input
                                        label="Charges Required"
                                        type="number"
                                        value={config.chargesRequired}
                                        onChange={(e) => {
                                            const val = Math.min(4, Math.max(2, parseInt(e.target.value) || 2));
                                            updateConfig(config.id, 'chargesRequired', val);
                                        }}
                                    />
                                    <Select
                                        label="CR Rarity"
                                        options={CR_RARITY_OPTIONS}
                                        value={config.crRarity}
                                        onChange={(val) => updateConfig(config.id, 'crRarity', val)}
                                    />
                                    <Input
                                        label="Active Skill %"
                                        type="number"
                                        value={config.activeSkillPercent}
                                        onChange={(e) =>
                                            updateConfig(config.id, 'activeSkillPercent', parseInt(e.target.value) || 0)
                                        }
                                    />
                                    <Input
                                        label="Charged Skill %"
                                        type="number"
                                        value={config.chargedSkillPercent}
                                        onChange={(e) =>
                                            updateConfig(config.id, 'chargedSkillPercent', parseInt(e.target.value) || 0)
                                        }
                                    />
                                    <Input
                                        label="Rounds"
                                        type="number"
                                        value={config.rounds}
                                        onChange={(e) =>
                                            updateConfig(config.id, 'rounds', Math.max(1, parseInt(e.target.value) || 1))
                                        }
                                    />
                                </div>

                                {/* Summary Metrics */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                    <StatCard
                                        title="Avg Damage % / Round"
                                        value={`${result.summary.avgDamagePerRound.toFixed(1)}%`}
                                        color={isBest ? 'green' : undefined}
                                    />
                                    <StatCard
                                        title="Charged Frequency"
                                        value={
                                            result.summary.chargedFrequency > 0
                                                ? `Every ${result.summary.chargedFrequency.toFixed(1)} rounds`
                                                : 'Never'
                                        }
                                        color="blue"
                                    />
                                    <StatCard
                                        title="Wasted CR Procs"
                                        value={
                                            config.crRarity === 'none'
                                                ? 'N/A'
                                                : `${result.summary.wastedProcs} / ${result.summary.totalProcs}`
                                        }
                                        color={result.summary.wastedProcs > 0 ? 'red' : 'green'}
                                    />
                                    <StatCard
                                        title="DPS Increase vs No CR"
                                        value={
                                            config.crRarity === 'none'
                                                ? 'Baseline'
                                                : `+${result.summary.dpsIncreasePercent.toFixed(1)}%`
                                        }
                                        color={result.summary.dpsIncreasePercent > 0 ? 'green' : undefined}
                                    />
                                </div>

                                {/* Turn Timeline Table */}
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-dark-border text-gray-400">
                                                <th className="px-2 py-1 text-left">Round</th>
                                                <th className="px-2 py-1 text-left">Charges</th>
                                                <th className="px-2 py-1 text-left">Action</th>
                                                <th className="px-2 py-1 text-left">CR</th>
                                                <th className="px-2 py-1 text-left">End</th>
                                                <th className="px-2 py-1 text-right">Damage</th>
                                                <th className="px-2 py-1 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.rounds.map((round) => (
                                                <tr
                                                    key={round.round}
                                                    className={`border-b border-dark-border/50 ${
                                                        round.action === 'charged'
                                                            ? 'bg-primary/10 text-primary'
                                                            : ''
                                                    }`}
                                                >
                                                    <td className="px-2 py-1">{round.round}</td>
                                                    <td className="px-2 py-1">{round.startCharges}</td>
                                                    <td className="px-2 py-1 capitalize font-medium">
                                                        {round.action}
                                                    </td>
                                                    <td className="px-2 py-1">
                                                        {round.crProc ? (
                                                            round.wastedProc ? (
                                                                <span className="text-red-400 font-medium">
                                                                    WASTED
                                                                </span>
                                                            ) : (
                                                                <span className="text-green-400">+1</span>
                                                            )
                                                        ) : (
                                                            <span className="text-gray-600">-</span>
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-1">{round.endCharges}</td>
                                                    <td className="px-2 py-1 text-right">{round.damage}%</td>
                                                    <td className="px-2 py-1 text-right font-medium">
                                                        {round.totalDamage}%
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {isBest && (
                                    <div className="text-primary text-sm mt-2 text-center">
                                        Best configuration
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Explanation */}
                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">How Chrono Reaver Works</h2>
                        <p className="mb-2">
                            The Chrono Reaver is an ultimate implant that grants +1 charge to your
                            ship's charged skill on proc turns. Legendary procs every other turn,
                            Epic procs every third turn.
                        </p>
                        <p className="mb-2">
                            <strong>Wasted procs</strong> occur when the CR procs on the same turn
                            your active attack naturally fills the last charge. Since charges can't
                            exceed the maximum, the extra charge is lost.
                        </p>
                        <p>
                            Ships with different charge requirements have different CR efficiency.
                            Add multiple configurations to compare.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ChronoReaverCalculatorPage;
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/pages/calculators/ChronoReaverCalculatorPage.tsx
git commit -m "feat: add Chrono Reaver calculator page component"
```

---

### Task 5: Wire Up Route and Navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ui/layout/Sidebar.tsx`

**Step 1: Add lazy import in App.tsx**

After the `SpeedCalculatorPage` lazy import (line 52), add:

```typescript
const ChronoReaverCalculatorPage = lazy(
    () => import('./pages/calculators/ChronoReaverCalculatorPage')
);
```

**Step 2: Add route in App.tsx**

After the Speed Calculator route block (after line 220), add:

```typescript
                                                        <Route
                                                            path="/chrono-reaver"
                                                            element={
                                                                <ChronoReaverCalculatorPage />
                                                            }
                                                        />
```

**Step 3: Add nav item in Sidebar.tsx**

In the Calculators children array (after line 267, the Speed Calculator entry), add:

```typescript
                    { path: '/chrono-reaver', label: 'Chrono Reaver' },
```

**Step 4: Verify dev server loads the page**

Run: `npm start` (should already be running)
Navigate to: `http://localhost:5173/chrono-reaver`
Expected: Page renders with default config, timeline table shows 20 rounds

**Step 5: Commit**

```bash
git add src/App.tsx src/components/ui/layout/Sidebar.tsx
git commit -m "feat: wire up Chrono Reaver calculator route and navigation"
```

---

### Task 6: Manual Testing and Polish

**Step 1: Test all scenarios**

Verify in browser:
1. Default state (4 charges, legendary) — charged attacks on rounds 4 and 7
2. Switch to Epic — charged attacks shift
3. Switch to None — baseline every-5-rounds pattern
4. Set charges to 3 with legendary — wasted proc appears (red WASTED text)
5. Set charges to 2 — verify fast cycles
6. Add second ship config — compare side by side
7. Remove a config — verify it's removed
8. Best config gets green border highlight

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass including new chrono reaver tests

**Step 3: Run lint**

Run: `npm run lint`
Expected: No errors (max-warnings: 0)

**Step 4: Fix any lint issues if needed, then final commit**

```bash
git add -A
git commit -m "feat: Chrono Reaver calculator - complete implementation"
```
