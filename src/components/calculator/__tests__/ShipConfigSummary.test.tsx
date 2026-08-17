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
import {
    simulateDPS,
    type DPSSimulationResult,
    type RoundStatsSnapshot,
} from '../../../utils/calculators/dpsSimulator';
import { setupKeyedTestRng } from '../../../utils/calculators/rateAccumulator';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import {
    dotKit,
    realEnemyInput,
} from '../../../utils/calculators/__testutils__/dpsRealEnemyFixture';

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

const renderSummary = (
    result: DPSSimulationResult,
    affinity: { critCap: number; critPenalty: number } = { critCap: 100, critPenalty: 0 }
) =>
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
            critCap={affinity.critCap}
            critPenalty={affinity.critPenalty}
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

    it('clamps each turn before averaging crit, not the average after the fact', () => {
        // Turns at crit 70 and crit 140, both at critDamage 200.
        // Clamp-per-turn (correct): (min(100,70) + min(100,140)) / 2 = (70 + 100) / 2 = 85.
        //   calculateCritMultiplier: 1 + (85/100 * 200)/100 = 1 + 1.7 = 2.70x.
        // Clamp-after-average (the old, wrong behaviour): raw average (70 + 140)/2 = 105 →
        //   clamp to 100 → 1 + (100/100 * 200)/100 = 1 + 2 = 3.00x.
        // The two disagree, so which one renders proves which averaging strategy is live.
        renderSummary(
            simResult([
                snapshot({ crit: 70, critDamage: 200 }),
                snapshot({ crit: 140, critDamage: 200 }),
            ])
        );

        expect(screen.getByText('2.70x')).toBeInTheDocument();
        expect(screen.queryByText('3.00x')).not.toBeInTheDocument();
    });

    it('honours a disadvantaged-matchup crit cap AND penalty, not the plain 100 cap', () => {
        // Disadvantage modifiers (computeAffinityModifiers): critCap 75, critPenalty 25.
        // Snapshot crit 100, critDamage 200: min(75, max(0, 100 - 25)) = min(75, 75) = 75%.
        // calculateCritMultiplier: 1 + (75/100 * 200)/100 = 1 + 1.5 = 2.50x.
        // A cap-only (no-penalty) reading would show 100% and 1 + (100/100*200)/100 = 3.00x —
        // the two disagree, so which one renders proves the penalty is applied, not just the cap.
        renderSummary(simResult([snapshot({ crit: 100, critDamage: 200 })]), {
            critCap: 75,
            critPenalty: 25,
        });

        expect(screen.getByText(/75% \/ 200%/)).toBeInTheDocument();
        expect(screen.getByText('2.50x')).toBeInTheDocument();
        expect(screen.queryByText('3.00x')).not.toBeInTheDocument();
    });

    it('shows the Direct breakdown row from a real simulateDPS run, not a hand-built literal', () => {
        // The hand-built `simResult()` literal above stays green through the exact defect class
        // #324 introduced (a `> 0`-guarded row silently zeroed on the positional path), so this
        // one assertion drives a REAL run through the same real-enemy fixture the calculator and
        // chart suites use.
        setupKeyedTestRng(12345);
        const result = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));
        expect(result.summary.totalDirectDamage).toBeGreaterThan(0);

        renderSummary(result);

        const directLabel = screen.getByText('Direct');
        expect(directLabel.nextElementSibling?.textContent).toBe(
            result.summary.totalDirectDamage.toLocaleString()
        );
    });
});
