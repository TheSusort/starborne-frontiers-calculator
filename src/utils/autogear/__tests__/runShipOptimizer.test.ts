import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    findOptimalGearForShip,
    buildOffFormulaTuningConfig,
    runOffFormulaTuningPass,
    defaultAutogearShipConfig,
    type ShipOptimizerConfig,
} from '../runShipOptimizer';
import { bandPriorities } from '../simRerank/statBands';
import { shipFinalStats } from '../../ship/combatStats';
import { resolveLimitStatValue } from '../priorityScore';
import { AutogearAlgorithm } from '../AutogearStrategy';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type {
    StatPriority,
    SetPriority,
    StatBonus,
    FleetBuff,
    CustomFormula,
} from '../../../types/autogear';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { EngineeringStat } from '../../../types/stats';

// Typed with explicit parameters (rather than inferred from a zero-arg arrow) so
// `mock.calls[n]` is a tuple indexable at every argument position `findOptimalGear` takes —
// an inferred `() => ...` would type every call as `[]` and hide an argument silently dropped
// or reordered.
const findOptimalGear = vi.fn(
    async (
        _ship: Ship,
        _priorities: StatPriority[],
        _inventory: GearPiece[],
        _getGearForShip: (id: string) => GearPiece | undefined,
        _getEngineeringStatsForShipType: (type: ShipTypeName) => EngineeringStat | undefined,
        _shipRole?: ShipTypeName,
        _setPriorities?: SetPriority[],
        _statBonuses?: StatBonus[],
        _tryToCompleteSets?: boolean,
        _arenaModifiers?: Record<string, number> | null,
        _fleetBuffs?: FleetBuff[],
        _customFormula?: CustomFormula
    ) => ({
        suggestions: [],
        hardRequirementsMet: true,
        attempts: 1,
    })
);
const setProgressCallback = vi.fn();

vi.mock('../getStrategy', () => ({
    getAutogearStrategy: () => ({
        findOptimalGear,
        setProgressCallback,
    }),
}));

const ship = { id: 'focus', name: 'Focus', type: 'DEBUFFER', implants: {} } as unknown as Ship;

const gear = (overrides: Partial<GearPiece>): GearPiece => ({
    id: 'gear-1',
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: null,
    subStats: [],
    setBonus: null,
    ...overrides,
});

const baseConfig: ShipOptimizerConfig = {
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
};

const baseDeps = {
    inventory: [] as GearPiece[],
    usedGearIds: new Set<string>(),
    getGearPiece: (id: string) => baseDeps.inventory.find((g) => g.id === id),
    upgradedGearGetter: (id: string) => baseDeps.inventory.find((g) => g.id === id),
    getEngineeringStatsForShipType: () => undefined,
    gearToShipMap: new Map<string, string>(),
    getShipById: (): Ship | undefined => undefined,
};

beforeEach(() => {
    findOptimalGear.mockClear();
    setProgressCallback.mockClear();
});

describe('findOptimalGearForShip', () => {
    it('excludes gear already claimed by another ship in the same batch', async () => {
        const inventory = [gear({ id: 'a' }), gear({ id: 'b' })];
        await findOptimalGearForShip(ship, baseConfig, {
            ...baseDeps,
            inventory,
            usedGearIds: new Set(['a']),
        });
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory.map((g) => g.id)).toEqual(['b']);
    });

    it('excludes equipped gear on another ship when ignoreEquipped is set', async () => {
        const inventory = [gear({ id: 'a' }), gear({ id: 'b' })];
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, ignoreEquipped: true },
            {
                ...baseDeps,
                inventory,
                gearToShipMap: new Map([['a', 'someone-else']]),
                getShipById: (id: string) =>
                    id === 'someone-else'
                        ? ({ id: 'someone-else', equipmentLocked: false } as Ship)
                        : undefined,
            }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory.map((g) => g.id)).toEqual(['b']);
    });

    it('keeps gear equipped on an unlocked ship when ignoreEquipped is off', async () => {
        const inventory = [gear({ id: 'a' })];
        await findOptimalGearForShip(ship, baseConfig, {
            ...baseDeps,
            inventory,
            gearToShipMap: new Map([['a', 'someone-else']]),
            getShipById: (id: string) =>
                id === 'someone-else'
                    ? ({ id: 'someone-else', equipmentLocked: false } as Ship)
                    : undefined,
        });
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory.map((g) => g.id)).toEqual(['a']);
    });

    it('excludes gear locked to another ship', async () => {
        const inventory = [gear({ id: 'a' })];
        await findOptimalGearForShip(ship, baseConfig, {
            ...baseDeps,
            inventory,
            gearToShipMap: new Map([['a', 'someone-else']]),
            getShipById: (id: string) =>
                id === 'someone-else'
                    ? ({ id: 'someone-else', equipmentLocked: true } as Ship)
                    : undefined,
        });
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory).toHaveLength(0);
    });

    it('forwards the exact role, priorities, and formula the config names — nothing borrowed from elsewhere', async () => {
        const statPriorities: StatPriority[] = [{ stat: 'attack', minLimit: 100 }];
        const setPriorities: SetPriority[] = [{ setName: 'Bruiser', count: 2 }];
        const statBonuses: StatBonus[] = [{ stat: 'crit', percentage: 20 }];
        const fleetBuffs: FleetBuff[] = [{ stat: 'attack', percentage: 10 }];
        const config: ShipOptimizerConfig = {
            ...baseConfig,
            shipRole: 'ATTACKER',
            statPriorities,
            setPriorities,
            statBonuses,
            tryToCompleteSets: true,
            fleetBuffs,
            arenaModifiers: { attack: 1.1 },
        };
        await findOptimalGearForShip(ship, config, baseDeps);

        const call = findOptimalGear.mock.calls[0];
        expect(call[5]).toBe('ATTACKER'); // shipRole
        expect(call[1]).toBe(statPriorities);
        expect(call[6]).toBe(setPriorities);
        expect(call[7]).toBe(statBonuses);
        expect(call[8]).toBe(true); // tryToCompleteSets
        expect(call[9]).toEqual({ attack: 1.1 }); // arenaModifiers
        expect(call[10]).toBe(fleetBuffs);
        expect(call[11]).toBeUndefined(); // customFormula
    });

    it('a Custom-mode config (shipRole null) forwards its formula instead of a role name', async () => {
        const customFormula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, shipRole: null, customFormula },
            baseDeps
        );
        const call = findOptimalGear.mock.calls[0];
        expect(call[5]).toBeUndefined(); // shipRole
        expect(call[11]).toBe(customFormula);
    });

    it('always resets the shared strategy singleton progress callback, even with none supplied', async () => {
        await findOptimalGearForShip(ship, baseConfig, baseDeps);
        expect(setProgressCallback).toHaveBeenCalledTimes(1);

        const onProgress = vi.fn();
        await findOptimalGearForShip(ship, baseConfig, { ...baseDeps, onProgress });
        expect(setProgressCallback).toHaveBeenLastCalledWith(onProgress);
    });

    it('returns the same gear getter the run scored through, for a caller computing display stats', async () => {
        const inventory = [gear({ id: 'a' })];
        const { getGearForShip } = await findOptimalGearForShip(ship, baseConfig, {
            ...baseDeps,
            inventory,
        });
        expect(getGearForShip('a')?.id).toBe('a');
    });

    it('excludes gear calibrated for another ship unless includeCalibratedGear is set', async () => {
        const inventory = [
            gear({ id: 'a', calibration: { shipId: 'someone-else' } }),
            gear({ id: 'b', calibration: { shipId: ship.id } }),
            gear({ id: 'c' }),
        ];
        await findOptimalGearForShip(ship, baseConfig, { ...baseDeps, inventory });
        const excluded = findOptimalGear.mock.calls[0][2];
        expect(excluded.map((g) => g.id).sort()).toEqual(['b', 'c']);

        findOptimalGear.mockClear();
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, includeCalibratedGear: true },
            { ...baseDeps, inventory }
        );
        const included = findOptimalGear.mock.calls[0][2];
        expect(included.map((g) => g.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('excludes gear whose set bonus has a count-0 set priority', async () => {
        const inventory = [
            gear({ id: 'a', setBonus: 'ATTACK' }),
            gear({ id: 'b', setBonus: 'DEFENSE' }),
        ];
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, setPriorities: [{ setName: 'ATTACK', count: 0 }] },
            { ...baseDeps, inventory }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory.map((g) => g.id)).toEqual(['b']);
    });

    it('excludes unleveled gear when ignoreUnleveled is set and useUpgradedStats is off', async () => {
        const inventory = [gear({ id: 'a', level: 0 }), gear({ id: 'b', level: 10 })];
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, ignoreUnleveled: true, useUpgradedStats: false },
            { ...baseDeps, inventory }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory.map((g) => g.id)).toEqual(['b']);
    });

    it('bypasses the ignoreUnleveled filter when useUpgradedStats is on, scoring via the upgraded getter', async () => {
        const stored = gear({
            id: 'a',
            level: 0,
            mainStat: { name: 'attack', value: 100, type: 'flat' },
        });
        const upgraded: GearPiece = {
            ...stored,
            mainStat: { name: 'attack', value: 999, type: 'flat' },
        };
        const inventory = [stored];
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, ignoreUnleveled: true, useUpgradedStats: true },
            {
                ...baseDeps,
                inventory,
                upgradedGearGetter: (id: string) => (id === 'a' ? upgraded : undefined),
            }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory).toHaveLength(1);
        expect(passedInventory[0].mainStat?.value).toBe(999);
    });

    it('excludes implant types the ship has blacklisted, when optimizeImplants is on', async () => {
        const inventory = [
            gear({ id: 'imp-a', slot: 'implant_major', setBonus: 'MARTYRDOM' }),
            gear({ id: 'imp-b', slot: 'implant_major', setBonus: 'HASTE' }),
        ];
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, optimizeImplants: true, excludedImplantTypes: ['MARTYRDOM'] },
            { ...baseDeps, inventory }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory.map((g) => g.id)).toEqual(['imp-b']);
    });

    it('trims implant candidates to the top scorers per slot when optimizeImplants is on and priorities are set', async () => {
        const implants = Array.from({ length: 30 }, (_, i) =>
            gear({
                id: `imp-${i}`,
                slot: 'implant_major',
                setBonus: 'MARTYRDOM',
                subStats: [{ name: 'attack', value: i, type: 'flat' }],
            })
        );
        await findOptimalGearForShip(
            ship,
            {
                ...baseConfig,
                optimizeImplants: true,
                statPriorities: [{ stat: 'attack', minLimit: 0 }],
            },
            { ...baseDeps, inventory: implants }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        // 30 implants sharing one setBonus: filterTopImplantsPerSlot's K = max(20, ceil(30*0.25)).
        expect(passedInventory).toHaveLength(20);
    });

    it('keeps every implant candidate when optimizeImplants is on but no priorities or bonuses rank them', async () => {
        const implants = Array.from({ length: 30 }, (_, i) =>
            gear({ id: `imp-${i}`, slot: 'implant_major', setBonus: 'MARTYRDOM' })
        );
        await findOptimalGearForShip(
            ship,
            { ...baseConfig, optimizeImplants: true },
            { ...baseDeps, inventory: implants }
        );
        const passedInventory = findOptimalGear.mock.calls[0][2];
        expect(passedInventory).toHaveLength(30);
    });
});

describe('buildOffFormulaTuningConfig', () => {
    // Hard requirement #3: hardRequirement is honoured only by GeneticStrategy, so a band that
    // does not force Genetic silently degrades to a soft penalty that will not hold a build
    // inside the range. Deleting the forcing line in buildOffFormulaTuningConfig fails this.
    it('forces Genetic even when the ship is configured for a different algorithm', () => {
        const shipConfig = {
            ...defaultAutogearShipConfig('ATTACKER'),
            selectedAlgorithm: AutogearAlgorithm.TwoPass,
        };
        const config = buildOffFormulaTuningConfig(
            ship,
            shipConfig,
            null,
            'hacking',
            bandPriorities('hacking', { min: 100, max: 200 })
        );
        expect(config.selectedAlgorithm).toBe(AutogearAlgorithm.Genetic);
    });

    it("drops the ship's own priority on the tuned stat before appending the band constraint, so the two cannot fight", () => {
        const shipConfig = {
            ...defaultAutogearShipConfig('ATTACKER'),
            statPriorities: [
                { stat: 'hacking' as const, weight: 5 },
                { stat: 'attack' as const, weight: 3 },
            ],
        };
        const constraint = bandPriorities('hacking', { min: 100, max: 200 });
        const config = buildOffFormulaTuningConfig(ship, shipConfig, null, 'hacking', constraint);
        expect(config.statPriorities).toEqual([{ stat: 'attack', weight: 3 }, ...constraint]);
    });

    it("scores under the tuned ship's own configured role, not a compared role", () => {
        const shipConfig = defaultAutogearShipConfig('SUPPORTER');
        const config = buildOffFormulaTuningConfig(ship, shipConfig, null, 'hp', []);
        expect(config.shipRole).toBe('SUPPORTER');
    });
});

describe('runOffFormulaTuningPass', () => {
    const tunedShip = {
        id: 'tuning-ship',
        name: 'Tuning Ship',
        type: 'ATTACKER',
        baseStats: {
            hp: 12345,
            attack: 100,
            defence: 200,
            hacking: 150,
            security: 100,
            speed: 100,
            crit: 0,
            critDamage: 0,
        },
        equipment: {},
        implants: {},
        refits: [],
    } as unknown as Ship;

    it("reads the landed value through the run's own getGearForShip, not the raw getGearPiece", async () => {
        const result = await runOffFormulaTuningPass(tunedShip, baseConfig, baseDeps, 'hp');

        // findOptimalGear (mocked) always returns no suggestions, so the built ship's equipment
        // stays empty either way — this cross-checks the returned `landed` against the SAME
        // resolution `resolveLimitStatValue`/`shipFinalStats` would produce independently,
        // rather than asserting a guessed constant.
        const expectedFinal = shipFinalStats(tunedShip, {
            getGearPiece: baseDeps.getGearPiece,
            getEngineeringStatsForShipType: baseDeps.getEngineeringStatsForShipType,
        });
        expect(result.landed).toBeCloseTo(resolveLimitStatValue(expectedFinal, 'hp'), 5);
        expect(result.suggestions).toEqual([]);
    });
});
