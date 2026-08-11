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
import type {
    DPSSimulationResult,
    RoundStatsSnapshot,
} from '../../../utils/calculators/dpsSimulator';
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
