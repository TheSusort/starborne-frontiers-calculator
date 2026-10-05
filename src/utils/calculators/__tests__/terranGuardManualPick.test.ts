/**
 * A Terran Guard picked by hand in a calculator has no applier to snapshot, so it keeps its
 * holder-relative reading: Terran Guard II is +10% of the holder's own defence.
 *
 * Measured through the DPS calculator with Panon's real charged ("deals 140% damage with
 * additional damage equal to 100% of its defense"): a defence-6000 Panon holding a manual
 * Terran Guard II deals exactly what a defence-6600 Panon with no buff deals.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { simulateDPS, type DPSSimulationInput } from '../dpsSimulator';
import { parseBuffEffects } from '../buffParser';
import { BUFFS } from '../../../constants/buffs';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { realKit } from '../../combat/__testutils__/realKitBoard';
import type { SelectedGameBuff } from '../../../types/calculator';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const manualPick = (name: string): SelectedGameBuff => {
    const entry = BUFFS.find((b) => b.name === name)!;
    return {
        id: `manual-${name}`,
        buffName: name,
        stacks: 1,
        isStackable: false,
        parsedEffects: parseBuffEffects(name, entry.description),
    };
};

const panonCharged = (defence: number, selfBuffs: SelectedGameBuff[]): number => {
    const input: DPSSimulationInput = {
        attack: 3000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 1,
        startCharged: true,
        enemyDefense: 2000,
        enemyHp: 1e9,
        rounds: 1,
        selfBuffs,
        enemyDebuffs: [],
        hacking: 0,
        enemySecurity: 0,
        defence,
        hp: 30000,
        shipSkills: { slots: realKit('Panon').slots.filter((s) => s.slot === 'charged') },
    };
    return simulateDPS(input).summary.totalDamage;
};

describe('Terran Guard picked by hand (no applier)', () => {
    it('Terran Guard II is +10% of the holder’s own defence', () => {
        const withPick = panonCharged(6000, [manualPick('Terran Guard II')]);
        expect(withPick).toBeGreaterThan(panonCharged(6000, []));
        expect(withPick).toBeCloseTo(panonCharged(6600, []), 6);
    });
});
