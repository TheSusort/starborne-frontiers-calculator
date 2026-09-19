import { describe, it, expect } from 'vitest';
import {
    offFormulaStatBounds,
    runOffFormulaTuningPass,
    type ShipOptimizerConfig,
    type ShipOptimizerDeps,
} from '../../runShipOptimizer';
import { bandPriorities } from '../statBands';
import { AutogearAlgorithm } from '../../AutogearStrategy';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { LimitableStat } from '../../../../types/stats';

// The bounds are checked against the REAL optimizer and the REAL stat resolver: the whole claim
// is that no build this inventory permits falls outside them, which a mocked strategy or a
// hand-computed stat block cannot test.

const SLOT_MAIN: Array<[string, string, number]> = [
    ['weapon', 'attack', 1000],
    ['hull', 'hp', 10000],
    ['generator', 'defence', 2000],
    ['sensor', 'attack', 500],
    ['software', 'hacking', 0],
    ['thrusters', 'hp', 5000],
];

const piece = (
    slot: string,
    mainName: string,
    mainValue: number,
    id: string,
    subs: Array<[string, number]>
): GearPiece =>
    ({
        id,
        slot,
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: mainName, value: mainValue, type: 'flat' },
        subStats: subs.map(([name, value]) => ({ name, value, type: 'flat' })),
        setBonus: null,
    }) as unknown as GearPiece;

// Two pieces per slot with identical main stats, differing only in sub-stats. Every build fills
// all six slots, so the achievable range is closed-form: with k high-hacking pieces equipped,
// hacking = 50 (base) + 400k + 100(6 - k) = 650 + 300k. FLOOR = 650, CEILING = 2450. The
// low-hacking piece carries the attack that the DEBUFFER formula rewards, so the unconstrained
// pick is an interior mix rather than either endpoint.
const FLOOR = 650;
const CEILING = 2450;

const inventory: GearPiece[] = SLOT_MAIN.flatMap(([slot, mainName, mainValue]) => [
    piece(slot, mainName, mainValue, `${slot}-high`, [['hacking', 400]]),
    piece(slot, mainName, mainValue, `${slot}-low`, [
        ['hacking', 100],
        ['attack', 2000],
    ]),
]);

const ship = {
    id: 'probe-ship',
    name: 'Probe Ship',
    type: 'DEBUFFER',
    baseStats: {
        attack: 5000,
        crit: 50,
        critDamage: 150,
        hacking: 50,
        security: 120,
        defence: 3000,
        hp: 40000,
        speed: 110,
    },
    equipment: {},
    implants: {},
    refits: [],
} as unknown as Ship;

const config = {
    shipRole: 'DEBUFFER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    ignoreEquipped: false,
    ignoreUnleveled: true,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    selectedAlgorithm: AutogearAlgorithm.Genetic,
    optimizeImplants: false,
    includeCalibratedGear: false,
    assumeCalibrated: false,
    excludedImplantTypes: [],
    fleetBuffs: [],
    customFormula: undefined,
    arenaModifiers: null,
} as unknown as ShipOptimizerConfig;

const deps = {
    inventory,
    usedGearIds: new Set<string>(),
    getGearPiece: (id: string) => inventory.find((g) => g.id === id),
    upgradedGearGetter: (id: string) => inventory.find((g) => g.id === id),
    getEngineeringStatsForShipType: () => undefined,
    gearToShipMap: new Map<string, string>(),
    getShipById: () => undefined,
} as unknown as ShipOptimizerDeps;

const stat: LimitableStat = 'hacking';

describe('achievable-range bounds against the real inventory', () => {
    it('reports exactly the closed-form floor and ceiling the fixture admits', () => {
        const bounds = offFormulaStatBounds(ship, config, deps, stat);
        expect(bounds.floor).toBe(FLOOR);
        expect(bounds.ceiling).toBe(CEILING);
    });

    // The bound must be read off the pool the RUN may draw from, not the raw inventory. Locking
    // every high-hacking piece onto another ship removes them from this ship's pool, and the
    // ceiling has to fall with it.
    it('follows the eligible pool, not the raw inventory', () => {
        const owner = { id: 'other', equipmentLocked: true } as unknown as Ship;
        const narrowed: ShipOptimizerDeps = {
            ...deps,
            gearToShipMap: new Map(
                inventory.filter((g) => g.id.endsWith('-high')).map((g) => [g.id, 'other'])
            ),
            getShipById: () => owner,
        };
        const bounds = offFormulaStatBounds(ship, config, narrowed, stat);
        expect(bounds.ceiling).toBeLessThan(CEILING);
        expect(bounds.floor).toBe(FLOOR);
    });

    // `applySuggestionsToShip` leaves a slot no suggestion names on its current piece, so gear
    // the run will KEEP has to be inside the bounds. With `optimizeImplants` off — the default —
    // no implant is in the pool, and every landed value carries the equipped implant's substats.
    // A bound that cleared the implant slot anyway would sit a fixed amount below every real
    // build, making the lowest band unreachable by construction.
    it('keeps gear in slots the pool cannot fill, which every run also keeps', () => {
        const IMPLANT_HACKING = 77;
        const implant = piece('implant_major', 'attack', 0, 'implant-worn', [
            ['hacking', IMPLANT_HACKING],
        ]);
        const wearing: Ship = { ...ship, implants: { implant_major: implant.id } };
        const withImplant: ShipOptimizerDeps = {
            ...deps,
            getGearPiece: (id: string) =>
                id === implant.id ? implant : inventory.find((g) => g.id === id),
            upgradedGearGetter: (id: string) =>
                id === implant.id ? implant : inventory.find((g) => g.id === id),
        };

        const bounds = offFormulaStatBounds(wearing, config, withImplant, stat);
        expect(bounds.floor).toBe(FLOOR + IMPLANT_HACKING);
        expect(bounds.ceiling).toBe(CEILING + IMPLANT_HACKING);
    });

    // The point of the bounds: every band lies inside them, and a real optimizer run under any
    // band lands inside them too. A bound the optimizer can walk outside would band a range
    // that does not describe the search.
    it('brackets what the real optimizer reaches under every band', async () => {
        const bounds = offFormulaStatBounds(ship, config, deps, stat);
        const unconstrained = await runOffFormulaTuningPass(ship, config, deps, stat);
        expect(unconstrained.landed).toBeGreaterThanOrEqual(bounds.floor);
        expect(unconstrained.landed).toBeLessThanOrEqual(bounds.ceiling);

        for (const band of [
            { min: bounds.floor, max: bounds.floor },
            { min: bounds.ceiling, max: bounds.ceiling },
        ]) {
            const run = await runOffFormulaTuningPass(
                ship,
                { ...config, statPriorities: bandPriorities(stat, band) },
                deps,
                stat
            );
            expect(run.landed).toBeGreaterThanOrEqual(bounds.floor);
            expect(run.landed).toBeLessThanOrEqual(bounds.ceiling);
        }
    }, 60_000);
});
