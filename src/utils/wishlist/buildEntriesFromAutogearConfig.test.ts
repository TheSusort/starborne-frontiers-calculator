import { describe, expect, it } from 'vitest';
import { makeShip } from '../gear/fastPotential/__tests__/fixtures';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { STATS } from '../../constants/stats';
import type { SavedAutogearConfig } from '../../types/autogear';
import type { StatName } from '../../types/stats';
import {
    buildEntriesFromAutogearConfig,
    wantedSets,
    wantedStats,
} from './buildEntriesFromAutogearConfig';

const config = (overrides: Partial<SavedAutogearConfig> = {}): SavedAutogearConfig => ({
    shipId: 's1',
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    ignoreEquipped: false,
    ignoreUnleveled: false,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    ...overrides,
});

const attacker = makeShip({ id: 's1', name: 'Lionheart', type: 'ATTACKER' });
const defender = makeShip({ id: 's2', name: 'Bulwark', type: 'DEFENDER' });

describe('wantedStats', () => {
    it('falls back to the role seed without a config', () => {
        // ATTACKER's seed is directDamage; defensePenetration cannot roll as a substat.
        expect(wantedStats(attacker, null)).toEqual(['attack', 'crit', 'critDamage']);
        expect(wantedStats(defender, null)).toEqual(['hp', 'defence']);
    });

    it('reads a custom formula instead of the role seed, skipping minimised rows', () => {
        const stats = wantedStats(
            attacker,
            config({
                customFormula: {
                    rows: [
                        { stat: 'hacking', kind: 'core', direction: 'max' },
                        { stat: 'speed', kind: 'core', direction: 'min' },
                        {
                            stat: 'effectiveHp',
                            kind: 'core',
                            direction: 'max',
                            basis: [{ stat: 'security', weight: 1 }],
                        },
                    ],
                },
            })
        );
        expect(stats).toEqual(['hp', 'defence', 'hacking', 'security']);
    });

    it('adds stat priorities and bonuses, expanded, and drops stats no substat rolls', () => {
        const stats = wantedStats(
            defender,
            config({
                statPriorities: [{ stat: 'speed' }, { stat: 'hpRegen' }],
                statBonuses: [{ stat: 'critMultiplier', percentage: 50 }],
            })
        );
        expect(stats).toEqual(['hp', 'defence', 'crit', 'critDamage', 'speed']);
    });

    it('uses the config role when it has no custom formula', () => {
        expect(wantedStats(attacker, config({ shipRole: 'DEFENDER' }))).toEqual(['hp', 'defence']);
    });
});

describe('wantedSets', () => {
    it('gives an attacker the Attack and Critical sets', () => {
        const sets = wantedSets(attacker, null);
        expect(sets).toContain('ATTACK');
        expect(sets).toContain('CRITICAL');
        expect(sets).toContain('PIERCER');
        expect(sets).not.toContain('FORTITUDE');
    });

    it('takes set priorities, excluding implant priorities and unknown names', () => {
        const sets = wantedSets(
            defender,
            config({
                setPriorities: [
                    { setName: 'BOOST', count: 4 },
                    { setName: 'ARCANE_SIEGE', count: 1, kind: 'implant' },
                    { setName: 'NOT_A_SET', count: 2 },
                ],
            })
        );
        expect(sets[0]).toBe('BOOST');
        expect(sets).not.toContain('ARCANE_SIEGE');
        expect(sets).not.toContain('NOT_A_SET');
    });

    it('does not add sets for stat priorities or bonuses', () => {
        const sets = wantedSets(defender, config({ statPriorities: [{ stat: 'speed' }] }));
        expect(sets).not.toContain('SPEED');
    });

    it('drops a set whose priority count is 0, from either path', () => {
        // ATTACK is a formula-stat set for an attacker; BOOST is an effect-only priority.
        const sets = wantedSets(
            attacker,
            config({
                setPriorities: [
                    { setName: 'ATTACK', count: 0 },
                    { setName: 'BOOST', count: 0 },
                ],
            })
        );
        expect(sets).not.toContain('ATTACK');
        expect(sets).not.toContain('BOOST');
        expect(sets).toContain('CRITICAL');
    });
});

describe('buildEntriesFromAutogearConfig', () => {
    it('builds a top and bottom row targeting the ship in its group', () => {
        const { top, bottom } = buildEntriesFromAutogearConfig(attacker, null);
        expect(top.filters.slot).toEqual(['weapon', 'hull', 'generator']);
        expect(top.filters.mainStat).toBeUndefined();
        expect(bottom.filters.slot).toEqual(['sensor', 'software', 'thrusters']);
        for (const entry of [top, bottom]) {
            expect(entry.target).toEqual({ kind: 'ship', shipId: 's1' });
            expect(entry.group).toBe('Lionheart');
            expect(entry.source).toBe('autogear');
            expect(entry.filters.subStats?.map((s) => s.name)).toEqual([
                'attack',
                'crit',
                'critDamage',
            ]);
        }
    });

    it('limits bottom-row main stats to stats those slots can roll', () => {
        const { bottom } = buildEntriesFromAutogearConfig(
            attacker,
            config({ statPriorities: [{ stat: 'hacking' }, { stat: 'speed' }] })
        );
        const bottomRollable = new Set(
            (['sensor', 'software', 'thrusters'] as const).flatMap(
                (slot) => GEAR_SLOTS[slot].availableMainStats as readonly StatName[]
            )
        );
        const names = bottom.filters.mainStat?.map((s) => s.name) ?? [];
        expect(names).toEqual(['attack', 'crit', 'critDamage', 'speed', 'hacking']);
        names.forEach((n) => expect(bottomRollable.has(n)).toBe(true));
    });

    it('omits the main-stat filter when no wanted stat fits the bottom row', () => {
        const { bottom } = buildEntriesFromAutogearConfig(
            attacker,
            config({ customFormula: { rows: [] } })
        );
        expect(bottom.filters.mainStat).toBeUndefined();
        expect(bottom.filters.subStats).toBeUndefined();
    });

    it('emits only stat types the entry form can represent', () => {
        const { top, bottom } = buildEntriesFromAutogearConfig(
            attacker,
            config({
                statPriorities: [
                    { stat: 'hp' },
                    { stat: 'defence' },
                    { stat: 'hacking' },
                    { stat: 'security' },
                    { stat: 'speed' },
                ],
            })
        );
        for (const stat of [...(top.filters.subStats ?? []), ...(bottom.filters.mainStat ?? [])]) {
            expect(stat.type).toBeDefined();
            expect(STATS[stat.name].maxValue[stat.type!]).toBeGreaterThan(0);
        }
        expect(top.filters.subStats?.find((s) => s.name === 'hp')?.type).toBe('percentage');
        expect(top.filters.subStats?.find((s) => s.name === 'speed')?.type).toBe('flat');
    });

    it('applies the chosen substat minimum, clamped to the stat count', () => {
        const two = buildEntriesFromAutogearConfig(attacker, null, { subStatsMin: 2 });
        expect(two.top.filters.subStatsMin).toBe(2);
        expect(two.bottom.filters.subStatsMin).toBe(2);
        // All of them is the default meaning, so no minimum is stored.
        const all = buildEntriesFromAutogearConfig(attacker, null, { subStatsMin: 9 });
        expect(all.top.filters.subStatsMin).toBeUndefined();
        const zero = buildEntriesFromAutogearConfig(attacker, null, { subStatsMin: 0 });
        expect(zero.top.filters.subStatsMin).toBe(1);
    });

    it('uses the chosen sets, and no set filter when none are chosen', () => {
        const picked = buildEntriesFromAutogearConfig(attacker, null, { sets: ['ATTACK'] });
        expect(picked.top.filters.setBonus).toEqual(['ATTACK']);
        const none = buildEntriesFromAutogearConfig(attacker, null, { sets: [] });
        expect(none.top.filters.setBonus).toBeUndefined();
    });

    it('caps names and the group at 64 characters', () => {
        const long = makeShip({ id: 's3', name: 'X'.repeat(80), type: 'ATTACKER' });
        const { top } = buildEntriesFromAutogearConfig(long, null);
        expect(top.name.length).toBe(64);
        expect(top.group?.length).toBe(64);
    });
});
