import { describe, it, expect } from 'vitest';
import type { SharedAutogearBuild } from '../types/communityRecommendation';
import { GEAR_SETS } from '../constants/gearSets';
import { STATS, DERIVED_STAT_LABELS } from '../constants/stats';
import { IMPLANTS } from '../constants/implants';
import { SHIP_TYPES } from '../constants/shipTypes';
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

    // Real production shape: a legacy `set_priorities` entry with no recorded
    // piece count, e.g. `[{ setName: 'DECIMATION' }]` — count must not be
    // required, but when present it is still bounded/typed as before.
    describe('setPriority count is optional', () => {
        it('accepts a gear-set entry with no count', () => {
            const build = {
                ...structuredClone(validBuild),
                setPriorities: [{ setName: 'DECIMATION' }],
            };
            const result = validateSharedAutogearBuild(build);
            expect(result).not.toBeNull();
            expect(result?.setPriorities[0]).toEqual({ setName: 'DECIMATION' });
        });

        it('still rejects an out-of-range count when one is present', () => {
            const build = {
                ...structuredClone(validBuild),
                setPriorities: [{ setName: 'DECIMATION', count: 7 }],
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });
    });

    describe('setPriority kind/setName consistency', () => {
        // MARTYRDOM is an implant-only key (absent from GEAR_SETS): a set
        // priority naming it without `kind: 'implant'` must not silently
        // validate as a gear-set requirement.
        it('rejects an implant key with no kind', () => {
            const build = {
                ...structuredClone(validBuild),
                setPriorities: [{ setName: 'MARTYRDOM', count: 4 }],
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        // CRITICAL is a gear-set-only key (absent from IMPLANTS): tagging it
        // `kind: 'implant'` must not silently validate as an implant requirement.
        it('rejects a gear-set key tagged kind: implant', () => {
            const build = {
                ...structuredClone(validBuild),
                setPriorities: [{ setName: 'CRITICAL', count: 4, kind: 'implant' }],
            };
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });
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

    // The DB-side companion to the cardinality bound (issue #431). The client
    // bound stops an oversized payload from RENDERING; it cannot stop it from
    // being TRANSFERRED, because listForShip does `select('*')` and the row is
    // only rejected after it has been downloaded. A CHECK constraint
    // (20260901000001_bound_community_recommendation_payload_size.sql) rejects
    // it at write time instead.
    //
    // The two layers must not drift: if the client ever admits a payload the DB
    // refuses, a legitimate share fails with an opaque Postgres error. This
    // asserts the largest CLIENT-VALID payload stays well under the DB bound.
    describe('payload size bound (DB CHECK constraint companion)', () => {
        // Must match the CHECK in
        // 20260901000001_bound_community_recommendation_payload_size.sql.
        const DB_BYTE_BOUND = 65536;
        // Half the DB bound, as generic headroom. Both layers now count the same
        // thing — bytes of JSON text — so there is no conversion factor to
        // absorb; the DB's jsonb text form differs only by its `": "` / `", "`
        // separators. That parity depends on MAX_NUMBER_MAGNITUDE: Postgres
        // renders jsonb numbers as exponent-free `numeric`, so an unbounded
        // Number.MAX_VALUE would arrive as 23 bytes and be served back as 309.
        // Measured on postgres:16 — the payload below is 17,221 bytes of JSON
        // and 18,581 as jsonb text (1.08x), both well inside the bound.
        // If this assertion ever fails, raise the DB bound; do not shave the
        // margin.
        const TEXT_BYTE_CEILING = DB_BYTE_BOUND / 2;

        // Longest keys, every optional field present, and numbers at the largest
        // magnitude the schema now admits — a genuinely reachable maximum, not a
        // synthetic one.
        const longest = (record: object): string =>
            Object.keys(record).reduce((a, b) => (b.length > a.length ? b : a));

        // Mirrors MAX_NUMBER_MAGNITUDE in the schema. Written out rather than
        // exported so the test fails if the schema's window is widened without
        // re-measuring the byte count above.
        const MAX_NUMBER = 1e12;

        const maximalBuild = () => {
            const stat = longest(STATS);
            const limitStat = longest({ ...STATS, ...DERIVED_STAT_LABELS });
            const implant = longest(IMPLANTS);
            const fill = <T>(make: () => T) => Array.from({ length: MAX_ARRAY_LENGTH }, make);
            return {
                version: 1 as const,
                shipRole: longest(SHIP_TYPES),
                statPriorities: fill(() => ({
                    stat: limitStat,
                    weight: MAX_NUMBER,
                    minLimit: MAX_NUMBER,
                    maxLimit: MAX_NUMBER,
                    hardRequirement: true,
                })),
                setPriorities: fill(() => ({
                    setName: implant,
                    count: 6,
                    kind: 'implant' as const,
                })),
                statBonuses: fill(() => ({
                    stat,
                    percentage: MAX_NUMBER,
                    mode: 'multiplier' as const,
                })),
                fleetBuffs: fill(() => ({ stat, percentage: MAX_NUMBER })),
                excludedImplantTypes: fill(() => implant),
                optimizeImplants: true,
            };
        };

        // Without this the size assertion below would prove nothing: an INVALID
        // maximal payload is one the client already rejects, so its size says
        // nothing about whether the two layers agree.
        it('the maximal payload is actually client-valid', () => {
            expect(validateSharedAutogearBuild(maximalBuild())).not.toBeNull();
        });

        it(`the maximal client-valid payload stays under ${TEXT_BYTE_CEILING} bytes`, () => {
            const bytes = new TextEncoder().encode(JSON.stringify(maximalBuild())).length;
            expect(bytes).toBeLessThan(TEXT_BYTE_CEILING);
        });
    });

    // Extreme-magnitude numbers are a payload amplifier, not just odd data:
    // Postgres renders jsonb numbers as exponent-free `numeric`, so 23 bytes of
    // `1.7976931348623157e+308` are served back to every viewer as 309, and a
    // tiny magnitude expands the same way. Bounding the window is what keeps the
    // client's byte count and the DB's within a hair of each other.
    describe('number magnitude bound', () => {
        const withWeight = (weight: unknown) => ({
            ...structuredClone(validBuild),
            statPriorities: [{ stat: 'crit', weight }],
        });

        it('accepts the largest allowed magnitude (1e12)', () => {
            expect(validateSharedAutogearBuild(withWeight(1e12))).not.toBeNull();
        });

        it('accepts the smallest allowed magnitude, and zero', () => {
            expect(validateSharedAutogearBuild(withWeight(1e-6))).not.toBeNull();
            expect(validateSharedAutogearBuild(withWeight(0))).not.toBeNull();
        });

        it('accepts a negative value inside the window', () => {
            expect(validateSharedAutogearBuild(withWeight(-250))).not.toBeNull();
        });

        it('rejects Number.MAX_VALUE — the 309-byte rendering', () => {
            expect(validateSharedAutogearBuild(withWeight(Number.MAX_VALUE))).toBeNull();
        });

        it('rejects a magnitude just over the ceiling', () => {
            expect(validateSharedAutogearBuild(withWeight(1e12 + 1))).toBeNull();
            expect(validateSharedAutogearBuild(withWeight(-(1e12 + 1)))).toBeNull();
        });

        it('rejects a non-zero magnitude below the floor', () => {
            expect(validateSharedAutogearBuild(withWeight(1e-7))).toBeNull();
            expect(validateSharedAutogearBuild(withWeight(Number.MIN_VALUE))).toBeNull();
        });

        // Plain z.number() lets Infinity through; JSON.stringify turns it into
        // null, but a value handed straight to validateSharedAutogearBuild (the
        // read path parses jsonb into live JS objects) would carry it.
        it('rejects Infinity and NaN', () => {
            expect(validateSharedAutogearBuild(withWeight(Infinity))).toBeNull();
            expect(validateSharedAutogearBuild(withWeight(-Infinity))).toBeNull();
            expect(validateSharedAutogearBuild(withWeight(NaN))).toBeNull();
        });

        it('bounds statBonus and fleetBuff percentages too, not just priorities', () => {
            const bonus = {
                ...structuredClone(validBuild),
                statBonuses: [{ stat: 'attack', percentage: Number.MAX_VALUE, mode: 'additive' }],
            };
            expect(validateSharedAutogearBuild(bonus)).toBeNull();

            const fleet = {
                ...structuredClone(validBuild),
                fleetBuffs: [{ stat: 'attack', percentage: Number.MAX_VALUE }],
            };
            expect(validateSharedAutogearBuild(fleet)).toBeNull();
        });

        it('bounds every numeric field on a stat priority', () => {
            for (const field of ['weight', 'minLimit', 'maxLimit']) {
                const build = {
                    ...structuredClone(validBuild),
                    statPriorities: [{ stat: 'crit', [field]: Number.MAX_VALUE }],
                };
                expect(validateSharedAutogearBuild(build)).toBeNull();
            }
        });
    });
});
