import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findOptimalGearForShip, type ShipOptimizerConfig } from '../runShipOptimizer';
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
});
