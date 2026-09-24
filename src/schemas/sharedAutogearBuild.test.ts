import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import type { SharedAutogearBuild } from '../types/communityRecommendation';
import type { CustomFormula } from '../types/autogear';
import type { Ship } from '../types/ship';
import { GEAR_SETS } from '../constants/gearSets';
import { STATS, DERIVED_STAT_LABELS } from '../constants/stats';
import { IMPLANTS } from '../constants/implants';
import { SHIP_TYPES } from '../constants/shipTypes';
import {
    deriveBasis,
    triggerProse,
    type ExcludedCarrier,
} from '../utils/autogear/offFormula/basisDerivation';
import { csvAvailable, loadShipSkillRecords } from '../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../scripts/lib/shipDataSnapshot';
import { validateSharedAutogearBuild } from './sharedAutogearBuild';

// Mirrors the schema's private MAX_ARRAY_LENGTH so the boundary tests move
// with it rather than drifting from a hardcoded magic number.
const MAX_ARRAY_LENGTH = 50;

// Mirrors the schema's private custom-formula bounds, same reason as MAX_ARRAY_LENGTH above.
const MAX_FORMULA_ROWS = 8;
const MAX_BASIS_TERMS = 5;
const MAX_EXCLUDED_NOTES = 3;
const MAX_EXCLUDED_NOTE_LENGTH = 120;

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

    it('accepts a derived stat in statBonuses', () => {
        const build = {
            ...structuredClone(validBuild),
            statBonuses: [{ stat: 'effectiveHp', percentage: 10, mode: 'additive' }],
        };
        expect(validateSharedAutogearBuild(build)?.statBonuses[0].stat).toBe('effectiveHp');
    });

    // Fleet buffs model a real in-game buff on a real stat, unlike stat bonuses.
    it('rejects a derived stat in fleetBuffs', () => {
        const build = {
            ...structuredClone(validBuild),
            fleetBuffs: [{ stat: 'effectiveHp', percentage: 10 }],
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
            validateSharedAutogearBuild({ ...structuredClone(validBuild), version: 3 })
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

        // `maximalBuild` above predates `customFormula` and stays version 1, so it says
        // nothing about the new field's contribution to the bound. A version-2 build with a
        // full-size formula is the genuinely reachable maximum for THAT shape.
        const maximalCustomFormulaBuild = () => {
            const basisStat = 'critDamage'; // longest real basis-eligible stat key
            return {
                ...maximalBuild(),
                version: 2 as const,
                customFormula: {
                    seededFrom: longest(SHIP_TYPES),
                    rows: Array.from({ length: MAX_FORMULA_ROWS }, () => ({
                        stat: longest({ ...STATS, ...DERIVED_STAT_LABELS }),
                        kind: 'core' as const,
                        direction: 'max' as const,
                        importance: 2 as const,
                        percentage: MAX_NUMBER,
                        basis: Array.from({ length: MAX_BASIS_TERMS }, () => ({
                            stat: basisStat,
                            weight: MAX_NUMBER,
                        })),
                        excludedNote: Array.from({ length: MAX_EXCLUDED_NOTES }, () =>
                            'x'.repeat(MAX_EXCLUDED_NOTE_LENGTH)
                        ),
                    })),
                },
            };
        };

        it('the maximal custom-formula payload is actually client-valid', () => {
            expect(validateSharedAutogearBuild(maximalCustomFormulaBuild())).not.toBeNull();
        });

        it(`the maximal custom-formula payload stays under ${TEXT_BYTE_CEILING} bytes`, () => {
            const bytes = new TextEncoder().encode(
                JSON.stringify(maximalCustomFormulaBuild())
            ).length;
            expect(bytes).toBeLessThan(TEXT_BYTE_CEILING);
        });

        // `roleBasis` is a new top-level field (#544 Task 5), additive to every shape above —
        // this combines it with the already-maximal custom-formula build to measure its own
        // worst-case contribution, even though a real build pairs roleBasis with a role, not
        // a customFormula.
        const maximalRoleBasisBuild = () => ({
            ...maximalCustomFormulaBuild(),
            roleBasis: {
                produces: 'repair' as const,
                terms: Array.from({ length: MAX_BASIS_TERMS }, () => ({
                    stat: 'critDamage' as const, // longest real basis-eligible stat key
                    weight: MAX_NUMBER,
                })),
            },
        });

        it('the maximal roleBasis payload is actually client-valid', () => {
            expect(validateSharedAutogearBuild(maximalRoleBasisBuild())).not.toBeNull();
        });

        // Measured in Node via JSON.stringify (not against postgres, unlike the v1 figure
        // above) — the payload below is 23,360 bytes of JSON, still well inside the bound.
        // `maximalCustomFormulaBuild()` alone (no roleBasis) is 23,091 of that. If this
        // assertion ever fails, raise the DB bound; do not shave the margin.
        it(`the maximal roleBasis payload stays under ${TEXT_BYTE_CEILING} bytes`, () => {
            const bytes = new TextEncoder().encode(JSON.stringify(maximalRoleBasisBuild())).length;
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

describe('validateSharedAutogearBuild — version 2, custom formula builds', () => {
    const cobaltFormula: CustomFormula = {
        rows: [
            {
                stat: 'directDamage',
                kind: 'core',
                direction: 'max',
                importance: 1,
                basis: [{ stat: 'attack', weight: 1.5 }],
            },
        ],
        seededFrom: 'ATTACKER',
    };

    const v2Build = (overrides: Partial<SharedAutogearBuild> = {}): SharedAutogearBuild => ({
        version: 2,
        shipRole: null,
        statPriorities: [],
        setPriorities: [],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
        customFormula: cobaltFormula,
        ...overrides,
    });

    it('round-trips a custom formula with a basis', () => {
        const build = v2Build();
        expect(validateSharedAutogearBuild(structuredClone(build))).toEqual(build);
    });

    it('reads a version 1 row, which has no customFormula and a non-null role', () => {
        const legacy = structuredClone({
            version: 1 as const,
            shipRole: 'ATTACKER' as const,
            statPriorities: [],
            setPriorities: [],
            statBonuses: [],
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
        });
        const result = validateSharedAutogearBuild(legacy);
        expect(result).toMatchObject({ shipRole: 'ATTACKER' });
        expect(result?.customFormula).toBeUndefined();
    });

    it('rejects a shared build with neither a role nor a usable formula', () => {
        expect(
            validateSharedAutogearBuild(v2Build({ shipRole: null, customFormula: { rows: [] } }))
        ).toBeNull();
    });

    it('rejects a null role when every row is structurally valid but unusable', () => {
        const build = v2Build({
            shipRole: null,
            customFormula: {
                rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
            },
        });
        // Sanity: this row alone IS usable.
        expect(validateSharedAutogearBuild(build)).not.toBeNull();

        // `hpRegen` is a real STATS key (so the row schema accepts it) but has no
        // MULTIPLIER_NORMALIZERS entry, so `isUsableRow` rejects it — a row can pass every
        // field check and still not be usable.
        const unusable = {
            ...structuredClone(build),
            customFormula: { rows: [{ stat: 'hpRegen', kind: 'core', direction: 'max' }] },
        };
        expect(validateSharedAutogearBuild(unusable)).toBeNull();
    });

    it('accepts a null role backed only by a bonus row (no core row required)', () => {
        const build = v2Build({
            shipRole: null,
            customFormula: { rows: [{ stat: 'hp', kind: 'bonus', direction: 'max' }] },
        });
        expect(validateSharedAutogearBuild(build)).not.toBeNull();
    });

    it('keeps a non-null role valid even with an empty/unusable formula', () => {
        expect(
            validateSharedAutogearBuild(
                v2Build({ shipRole: 'ATTACKER', customFormula: { rows: [] } })
            )
        ).not.toBeNull();
    });

    it('rejects an unknown seededFrom role', () => {
        const build = v2Build({
            customFormula: { ...cobaltFormula, seededFrom: 'WIZARD' },
        });
        expect(validateSharedAutogearBuild(build)).toBeNull();
    });

    describe('basis validation on the way in, not only at score time', () => {
        const buildWithBasis = (basis: Array<{ stat: string; weight: number }>): unknown =>
            v2Build({
                shipRole: 'ATTACKER',
                customFormula: {
                    rows: [{ stat: 'hp', kind: 'core', direction: 'max', basis: basis as never }],
                },
            });

        it('rejects a basis term naming an unrecognised stat', () => {
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'nonsense', weight: 1 }]))
            ).toBeNull();
        });

        // directDamage/effectiveHp have a MULTIPLIER_NORMALIZERS entry but are derived
        // stats, not basis terms — the wrong predicate would let them through silently.
        it('rejects a basis term naming a derived stat (directDamage/effectiveHp)', () => {
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'directDamage', weight: 1 }]))
            ).toBeNull();
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'effectiveHp', weight: 1 }]))
            ).toBeNull();
        });

        it('rejects a negative basis weight', () => {
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'attack', weight: -1 }]))
            ).toBeNull();
        });

        it('rejects a non-finite basis weight', () => {
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'attack', weight: Infinity }]))
            ).toBeNull();
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'attack', weight: NaN }]))
            ).toBeNull();
        });

        it('accepts a well-formed basis', () => {
            expect(
                validateSharedAutogearBuild(buildWithBasis([{ stat: 'attack', weight: 1.5 }]))
            ).not.toBeNull();
        });
    });

    describe('custom formula cardinality bounds', () => {
        const rowWithBasis = (basisCount: number) => ({
            stat: 'hp' as const,
            kind: 'core' as const,
            direction: 'max' as const,
            basis: Array.from({ length: basisCount }, () => ({
                stat: 'attack' as const,
                weight: 1,
            })),
        });

        it(`accepts exactly ${MAX_FORMULA_ROWS} formula rows`, () => {
            const build = v2Build({
                shipRole: 'ATTACKER',
                customFormula: {
                    rows: Array.from({ length: MAX_FORMULA_ROWS }, () => rowWithBasis(1)),
                },
            });
            expect(validateSharedAutogearBuild(build)).not.toBeNull();
        });

        it(`rejects ${MAX_FORMULA_ROWS + 1} formula rows`, () => {
            const build = v2Build({
                shipRole: 'ATTACKER',
                customFormula: {
                    rows: Array.from({ length: MAX_FORMULA_ROWS + 1 }, () => rowWithBasis(1)),
                },
            });
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`accepts exactly ${MAX_BASIS_TERMS} basis terms on one row`, () => {
            const build = v2Build({
                shipRole: 'ATTACKER',
                customFormula: { rows: [rowWithBasis(MAX_BASIS_TERMS)] },
            });
            expect(validateSharedAutogearBuild(build)).not.toBeNull();
        });

        it(`rejects ${MAX_BASIS_TERMS + 1} basis terms on one row`, () => {
            const build = v2Build({
                shipRole: 'ATTACKER',
                customFormula: { rows: [rowWithBasis(MAX_BASIS_TERMS + 1)] },
            });
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`rejects ${MAX_EXCLUDED_NOTES + 1} excludedNote entries`, () => {
            const build = v2Build({
                shipRole: 'ATTACKER',
                customFormula: {
                    rows: [
                        {
                            stat: 'hp',
                            kind: 'core',
                            direction: 'max',
                            excludedNote: Array.from({ length: MAX_EXCLUDED_NOTES + 1 }, () => 'x'),
                        },
                    ],
                },
            });
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        it(`rejects an excludedNote string over ${MAX_EXCLUDED_NOTE_LENGTH} characters`, () => {
            const build = v2Build({
                shipRole: 'ATTACKER',
                customFormula: {
                    rows: [
                        {
                            stat: 'hp',
                            kind: 'core',
                            direction: 'max',
                            excludedNote: ['x'.repeat(MAX_EXCLUDED_NOTE_LENGTH + 1)],
                        },
                    ],
                },
            });
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });
    });

    describe('roleBasis', () => {
        const withRoleBasis = (roleBasis: unknown) =>
            v2Build({
                shipRole: 'ATTACKER',
                customFormula: undefined,
                roleBasis: roleBasis as never,
            });

        it('round-trips a role build carrying a roleBasis', () => {
            const build = withRoleBasis({
                produces: 'damage',
                terms: [{ stat: 'attack', weight: 1.5 }],
            });
            expect(validateSharedAutogearBuild(structuredClone(build))).toEqual(build);
        });

        it('reads a version 1 row unaffected by roleBasis existing', () => {
            const legacy = structuredClone({
                version: 1 as const,
                shipRole: 'ATTACKER' as const,
                statPriorities: [],
                setPriorities: [],
                statBonuses: [],
                fleetBuffs: [],
                excludedImplantTypes: [],
                optimizeImplants: false,
            });
            const result = validateSharedAutogearBuild(legacy);
            expect(result).toMatchObject({ shipRole: 'ATTACKER' });
            expect(result?.roleBasis).toBeUndefined();
        });

        it('rejects an unrecognised produces axis', () => {
            expect(
                validateSharedAutogearBuild(
                    withRoleBasis({ produces: 'poison', terms: [{ stat: 'attack', weight: 1 }] })
                )
            ).toBeNull();
        });

        it('rejects a basis term naming an unrecognised stat', () => {
            expect(
                validateSharedAutogearBuild(
                    withRoleBasis({ produces: 'damage', terms: [{ stat: 'nonsense', weight: 1 }] })
                )
            ).toBeNull();
        });

        it('rejects a basis term naming a derived stat (directDamage/effectiveHp)', () => {
            expect(
                validateSharedAutogearBuild(
                    withRoleBasis({
                        produces: 'damage',
                        terms: [{ stat: 'directDamage', weight: 1 }],
                    })
                )
            ).toBeNull();
        });

        it('rejects a negative basis weight', () => {
            expect(
                validateSharedAutogearBuild(
                    withRoleBasis({ produces: 'damage', terms: [{ stat: 'attack', weight: -1 }] })
                )
            ).toBeNull();
        });

        it('rejects a non-finite basis weight', () => {
            expect(
                validateSharedAutogearBuild(
                    withRoleBasis({
                        produces: 'damage',
                        terms: [{ stat: 'attack', weight: Infinity }],
                    })
                )
            ).toBeNull();
        });

        it('rejects an empty terms array', () => {
            expect(
                validateSharedAutogearBuild(withRoleBasis({ produces: 'damage', terms: [] }))
            ).toBeNull();
        });

        it('rejects a roleBasis whose only term weighs 0 — usableBasisTerms would drop it at score time', () => {
            expect(
                validateSharedAutogearBuild(
                    withRoleBasis({ produces: 'damage', terms: [{ stat: 'attack', weight: 0 }] })
                )
            ).toBeNull();
        });

        it(`accepts exactly ${MAX_BASIS_TERMS} roleBasis terms`, () => {
            const build = withRoleBasis({
                produces: 'repair',
                terms: Array.from({ length: MAX_BASIS_TERMS }, () => ({
                    stat: 'hp' as const,
                    weight: 1,
                })),
            });
            expect(validateSharedAutogearBuild(build)).not.toBeNull();
        });

        it(`rejects ${MAX_BASIS_TERMS + 1} roleBasis terms`, () => {
            const build = withRoleBasis({
                produces: 'repair',
                terms: Array.from({ length: MAX_BASIS_TERMS + 1 }, () => ({
                    stat: 'hp' as const,
                    weight: 1,
                })),
            });
            expect(validateSharedAutogearBuild(build)).toBeNull();
        });

        // A Custom build can carry a leftover roleBasis (a player applies a role's equation,
        // then switches the ship to Custom mode) — it is inert there (only a hosting role's
        // scorer reads it) rather than corrupt, so it must not block an otherwise-valid
        // role-less share. `v2Build`'s default `cobaltFormula` has a usable row
        // (`directDamage`, kind core/direction max), unlike this suite's separate
        // byte-ceiling fixture (`maximalCustomFormulaBuild`'s row stat is
        // `defensePenetration`, the longest STATS/DERIVED_STAT_LABELS key for that
        // measurement — it has no MULTIPLIER_NORMALIZERS entry and was never a usable row,
        // so forcing shipRole: null onto THAT fixture fails on "no usable formula", not on
        // roleBasis).
        it('accepts a leftover roleBasis on an otherwise-valid role-less Custom build', () => {
            const build = v2Build({
                shipRole: null,
                roleBasis: { produces: 'damage', terms: [{ stat: 'attack', weight: 1.5 }] },
            });
            expect(validateSharedAutogearBuild(structuredClone(build))).not.toBeNull();
        });
    });
});

// Gitignored reference data (docs/ship-skills.csv, docs/ship-data.json) exists on dev machines
// but not every checkout — skip rather than fail where it's absent, matching the other
// real-corpus suites (e.g. offFormulaStats.test.ts).
describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'MAX_EXCLUDED_NOTES / MAX_EXCLUDED_NOTE_LENGTH against the real corpus',
    () => {
        interface Datum {
            name: string;
            role: string;
            hp: number;
            attack: number;
            defense: number;
            hacking: number;
            security: number;
            speed: number;
            critRate: number;
            critDamage: number;
        }

        const asShip = (rec: ReturnType<typeof loadShipSkillRecords>[number], d: Datum): Ship =>
            ({
                id: rec.name.toLowerCase(),
                name: rec.name,
                type: d.role,
                baseStats: {
                    attack: d.attack,
                    crit: d.critRate,
                    critDamage: d.critDamage,
                    hacking: d.hacking,
                    security: d.security,
                    defence: d.defense,
                    hp: d.hp,
                    speed: d.speed,
                },
                equipment: {},
                implants: {},
                refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
                activeSkillText: rec.active,
                chargeSkillText: rec.charge,
                chargeSkillCharge: rec.chargeCharge,
                firstPassiveSkillText: rec.passives[0],
                secondPassiveSkillText: rec.passives[1],
                thirdPassiveSkillText: rec.passives[2],
                activeTarget: 'front',
                activePattern: 'Pattern-Base',
                chargedTarget: 'front',
                chargedPattern: 'Pattern-Base',
            }) as unknown as Ship;

        const corpus = (): Ship[] => {
            const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
            const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
            return loadShipSkillRecords()
                .map((rec) => {
                    const d = byName.get(rec.name.toLowerCase());
                    return d ? asShip(rec, d) : null;
                })
                .filter((s): s is Ship => s !== null);
        };

        // Mirrors `OffFormulaNotice.tsx`'s private `excludedClauseText`/`PRODUCES_LABEL`/
        // `percentBasisLabel` (not exported — exporting a plain function from a component file
        // trips `react-refresh/only-export-components`), the same reason the bounds above mirror
        // this schema's private caps. Only the LENGTH of the real copy matters for this tripwire,
        // and this reproduces it exactly enough to measure that.
        const CLAUSE_VERB: Record<ExcludedCarrier['produces'], string> = {
            damage: 'deals damage equal to',
            repair: 'repairs',
            shield: 'shields for',
        };
        const percentBasisLabel = (stat: ExcludedCarrier['stat']): string =>
            stat === 'hp' ? 'max HP' : stat === 'shield' ? 'its shield pool' : stat;
        const excludedClauseText = (carrier: ExcludedCarrier): string =>
            `${CLAUSE_VERB[carrier.produces]} ${carrier.pct}% of ${percentBasisLabel(
                carrier.stat
            )} ${triggerProse(carrier.trigger)}`;

        // A ship's excluded-carrier set (`deriveBasis(...).excluded`) does not depend on the
        // `produces` argument (see `basisDerivation.ts`'s doc on `excludedCarriers`), so one
        // call per ship covers its whole passive-carrier set — the same set `handleApply` in
        // `OffFormulaNotice.tsx` filters and writes into a row's `excludedNote`, which is what
        // crosses into a shared build and hits this schema's caps.
        it(`stays under MAX_EXCLUDED_NOTES (${MAX_EXCLUDED_NOTES}) and MAX_EXCLUDED_NOTE_LENGTH (${MAX_EXCLUDED_NOTE_LENGTH})`, () => {
            let maxCount = 0;
            let maxCountShip = '';
            let maxLength = 0;
            let maxLengthShip = '';

            for (const ship of corpus()) {
                const excluded = deriveBasis(ship, 'damage').excluded;
                if (excluded.length > maxCount) {
                    maxCount = excluded.length;
                    maxCountShip = ship.name;
                }
                for (const carrier of excluded) {
                    const length = excludedClauseText(carrier).length;
                    if (length > maxLength) {
                        maxLength = length;
                        maxLengthShip = ship.name;
                    }
                }
            }

            // Non-vacuity: some ship must actually carry at least one excluded note, or a
            // detector regression returning [] for every ship would pass this test too.
            expect(maxCount).toBeGreaterThan(0);

            // The tripwire itself: a data refresh adding a third passive carrier to one ship,
            // or lengthening a trigger's prose, breaks Share with no other failing test unless
            // this catches it first.
            expect(maxCount, `${maxCountShip} carries the most excluded notes`).toBeLessThanOrEqual(
                MAX_EXCLUDED_NOTES
            );
            expect(
                maxLength,
                `${maxLengthShip} carries the longest excluded note`
            ).toBeLessThanOrEqual(MAX_EXCLUDED_NOTE_LENGTH);
        });
    }
);
