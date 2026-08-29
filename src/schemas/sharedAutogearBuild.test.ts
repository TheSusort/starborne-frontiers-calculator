import { describe, it, expect } from 'vitest';
import type { SharedAutogearBuild } from '../types/communityRecommendation';
import { GEAR_SETS } from '../constants/gearSets';
import { validateSharedAutogearBuild } from './sharedAutogearBuild';

// Mirrors the schema's private MAX_ARRAY_LENGTH so the boundary tests move
// with it rather than drifting from a hardcoded magic number.
const MAX_ARRAY_LENGTH = 50;

const validBuild: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [
        { stat: 'crit', minLimit: 100, hardRequirement: true },
        { stat: 'critDamage' },
        { stat: 'effectiveHp', minLimit: 30000 },
    ],
    setPriorities: [
        { setName: 'CRITICAL', count: 4 },
        { setName: 'MARTYRDOM', count: 1, kind: 'implant' },
    ],
    statBonuses: [
        { stat: 'attack', percentage: 30, mode: 'additive' },
        { stat: 'speed', percentage: 50, mode: 'multiplier' },
    ],
    fleetBuffs: [{ stat: 'attack', percentage: 30 }],
    excludedImplantTypes: ['MARTYRDOM'],
    optimizeImplants: true,
};

describe('validateSharedAutogearBuild', () => {
    it('accepts a full valid build and round-trips it unchanged', () => {
        expect(validateSharedAutogearBuild(structuredClone(validBuild))).toEqual(validBuild);
    });

    it('accepts a derived limit stat (effectiveHp) as a stat priority', () => {
        const build = { ...structuredClone(validBuild), statPriorities: [{ stat: 'effectiveHp' }] };
        expect(validateSharedAutogearBuild(build)?.statPriorities[0].stat).toBe('effectiveHp');
    });

    it('rejects an unknown stat in statPriorities', () => {
        const build = { ...structuredClone(validBuild), statPriorities: [{ stat: 'defense' }] };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects a derived stat in statBonuses (bonuses are real stats only)', () => {
        const build = {
            ...structuredClone(validBuild),
            statBonuses: [{ stat: 'effectiveHp', percentage: 10, mode: 'additive' }],
        };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects an unknown gear set name', () => {
        const build = {
            ...structuredClone(validBuild),
            setPriorities: [{ setName: 'NOT_A_SET', count: 4 }],
        };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects an unknown ship role', () => {
        const build = { ...structuredClone(validBuild), shipRole: 'WIZARD' };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('does not treat inherited Object keys as valid stats', () => {
        const build = { ...structuredClone(validBuild), statPriorities: [{ stat: 'toString' }] };
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects a missing version', () => {
        const build = structuredClone(validBuild) as unknown as Record<string, unknown>;
        delete build.version;
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    it('rejects a future version', () => {
        expect(
            validateSharedAutogearBuild({ ...structuredClone(validBuild), version: 2 })
        ).toBeNull();
    });

    it('rejects wrong types', () => {
        expect(
            validateSharedAutogearBuild({ ...structuredClone(validBuild), optimizeImplants: 'yes' })
        ).toBeNull();
    });

    it('rejects null and non-objects', () => {
        expect(validateSharedAutogearBuild(null)).toBeNull();
        expect(validateSharedAutogearBuild('nope')).toBeNull();
        expect(validateSharedAutogearBuild(undefined)).toBeNull();
    });

    it('strips unknown top-level keys rather than failing', () => {
        const build = { ...structuredClone(validBuild), evil: 'payload' };
        const result = validateSharedAutogearBuild(build);
        expect(result).not.toBeNull();
        expect(result as unknown as Record<string, unknown>).not.toHaveProperty('evil');
    });

    describe('array cardinality bound', () => {
        // Cardinality guard on a trust boundary: any signed-in user can write
        // shared_config directly via PostgREST, and every element here is
        // otherwise individually valid, so shape checks alone don't stop an
        // oversized array from reaching every viewer's autogear panel.
        it(`accepts exactly ${MAX_ARRAY_LENGTH} stat priorities (the boundary itself)`, () => {
            const build = {
                ...structuredClone(validBuild),
                statPriorities: Array.from({ length: MAX_ARRAY_LENGTH }, () => ({ stat: 'crit' })),
            };
            expect(validateSharedAutogearBuild(build)).not.toBeNull();
        });

        it(`rejects ${MAX_ARRAY_LENGTH + 1} stat priorities`, () => {
            const build = {
                ...structuredClone(validBuild),
                statPriorities: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => ({
                    stat: 'crit',
                })),
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`rejects ${MAX_ARRAY_LENGTH + 1} set priorities`, () => {
            const build = {
                ...structuredClone(validBuild),
                setPriorities: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => ({
                    setName: 'CRITICAL',
                    count: 4,
                })),
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`rejects ${MAX_ARRAY_LENGTH + 1} stat bonuses`, () => {
            const build = {
                ...structuredClone(validBuild),
                statBonuses: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => ({
                    stat: 'attack',
                    percentage: 10,
                })),
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`rejects ${MAX_ARRAY_LENGTH + 1} fleet buffs`, () => {
            const build = {
                ...structuredClone(validBuild),
                fleetBuffs: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => ({
                    stat: 'attack',
                    percentage: 10,
                })),
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`rejects ${MAX_ARRAY_LENGTH + 1} excluded implant types`, () => {
            const build = {
                ...structuredClone(validBuild),
                excludedImplantTypes: Array.from(
                    { length: MAX_ARRAY_LENGTH + 1 },
                    () => 'MARTYRDOM'
                ),
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        // The regression this whole bound exists to catch: a legitimate build
        // ranking every real gear set must never be rejected. This is the case
        // the previous MAX_ARRAY_LENGTH of 20 got wrong (27 real GEAR_SETS keys).
        it('accepts a build with a set priority entry for every real gear set', () => {
            const setNames = Object.keys(GEAR_SETS);
            expect(setNames.length).toBeGreaterThan(20);
            const build = {
                ...structuredClone(validBuild),
                setPriorities: setNames.map((setName) => ({ setName, count: 4 })),
            };
            expect(validateSharedAutogearBuild(build)).not.toBeNull();
        });
    });
});
