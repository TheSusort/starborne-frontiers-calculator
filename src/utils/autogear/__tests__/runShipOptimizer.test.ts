import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    findOptimalGearForShip,
    defaultAutogearShipConfig,
    toSavedAutogearConfig,
    resetShipConfigPatch,
    useAutogearShipConfigs,
    type AutogearShipConfig,
    type ShipOptimizerConfig,
} from '../runShipOptimizer';
import { AutogearAlgorithm } from '../AutogearStrategy';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type {
    StatPriority,
    SetPriority,
    StatBonus,
    FleetBuff,
    CustomFormula,
    RoleBasis,
} from '../../../types/autogear';
import type { EngineeringStat } from '../../../types/stats';
import type { ShipTypeName } from '../../../constants/shipTypes';

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
        _customFormula?: CustomFormula,
        _roleBasis?: RoleBasis
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

    it('forwards config.roleBasis to the strategy as the 13th positional argument', async () => {
        const roleBasis: RoleBasis = { produces: 'damage', terms: [{ stat: 'attack', weight: 1 }] };
        await findOptimalGearForShip(ship, { ...baseConfig, roleBasis }, baseDeps);
        expect(findOptimalGear.mock.calls[0][12]).toBe(roleBasis);
    });

    it('forwards undefined when config carries no roleBasis', async () => {
        await findOptimalGearForShip(ship, baseConfig, baseDeps);
        expect(findOptimalGear.mock.calls[0][12]).toBeUndefined();
    });
});

// `AutogearPage.tsx` built `SavedAutogearConfig` by hand-enumerating `AutogearShipConfig`'s
// fields at the `saveConfig` call site — a layer that silently drops any field added to either
// type. `roleBasis` was exactly such a field (#544): present on both types, read by the scorer,
// never actually reaching storage. `toSavedAutogearConfig` is the single place that mapping now
// lives, so a future field only needs adding here once, and this test is the tripwire that a
// field was wired into BOTH `AutogearShipConfig` and `toSavedAutogearConfig`.
describe('toSavedAutogearConfig', () => {
    const roleBasis: RoleBasis = {
        produces: 'repair',
        terms: [{ stat: 'hp', weight: 1 }],
    };

    const fullShipConfig: AutogearShipConfig = {
        shipRole: 'SUPPORTER',
        statPriorities: [{ stat: 'hp' }],
        setPriorities: [{ setName: 'Vanguard', count: 2 }],
        statBonuses: [{ stat: 'hp', percentage: 10 }],
        ignoreEquipped: true,
        ignoreUnleveled: false,
        useUpgradedStats: true,
        tryToCompleteSets: true,
        showSecondaryRequirements: true,
        optimizeImplants: true,
        includeCalibratedGear: true,
        assumeCalibrated: true,
        useArenaModifiers: true,
        excludedImplantTypes: ['implant-1'],
        fleetBuffs: [{ stat: 'attack', percentage: 20 }],
        customFormula: { rows: [{ stat: 'hp', kind: 'core', direction: 'max' }] },
        roleBasis,
    };

    it('round-trips roleBasis (and every other field) into the persisted shape', () => {
        const saved = toSavedAutogearConfig('ship-1', fullShipConfig);
        expect(saved.shipId).toBe('ship-1');
        expect(saved.shipRole).toBe('SUPPORTER');
        expect(saved.roleBasis).toBe(roleBasis);
        expect(saved.customFormula).toBe(fullShipConfig.customFormula);
        expect(saved.statPriorities).toBe(fullShipConfig.statPriorities);
        expect(saved.statBonuses).toBe(fullShipConfig.statBonuses);
        expect(saved.fleetBuffs).toBe(fullShipConfig.fleetBuffs);
    });

    it('omits roleBasis when the ship config carries none', () => {
        const saved = toSavedAutogearConfig('ship-1', defaultAutogearShipConfig('ATTACKER'));
        expect(saved.roleBasis).toBeUndefined();
    });
});

// #544 I6: `AutogearPage`'s "Reset to role defaults" handler hand-enumerates the patch it writes
// per branch (a role config vs. a Custom-mode config) — the third time such a hand-written list
// has silently missed `roleBasis` (`toSavedAutogearConfig`'s own doc names the first two). Both
// branches are exercised here so a field missing from either one fails this test directly,
// instead of surfacing later as an equation that survives a reset.
describe('resetShipConfigPatch', () => {
    const roleBasis: RoleBasis = { produces: 'damage', terms: [{ stat: 'attack', weight: 2 }] };

    it('clears roleBasis on a role config, alongside every other field defaultAutogearShipConfig sets', () => {
        const config: AutogearShipConfig = {
            ...defaultAutogearShipConfig('SUPPORTER'),
            statPriorities: [{ stat: 'hp' }],
            roleBasis,
        };
        const patch = resetShipConfigPatch(config);
        expect(patch.roleBasis).toBeUndefined();
        expect(patch).toEqual(defaultAutogearShipConfig('ATTACKER'));
    });

    it('clears roleBasis on a Custom-mode config too, without touching shipRole', () => {
        const config: AutogearShipConfig = {
            ...defaultAutogearShipConfig('ATTACKER'),
            shipRole: null,
            customFormula: { rows: [{ stat: 'hp', kind: 'core', direction: 'max' }] },
            roleBasis,
        };
        const patch = resetShipConfigPatch(config);
        expect(patch.roleBasis).toBeUndefined();
        expect(patch.shipRole).toBeUndefined();
    });

    it('re-seeds a Custom-mode formula from its origin role', () => {
        const config: AutogearShipConfig = {
            ...defaultAutogearShipConfig('ATTACKER'),
            shipRole: null,
            customFormula: { rows: [], seededFrom: 'SUPPORTER' },
            roleBasis,
        };
        const patch = resetShipConfigPatch(config);
        expect(patch.customFormula?.rows.length).toBeGreaterThan(0);
    });
});

// `updateShipConfig` used to merge from `getShipConfig(shipId)`, which closes over the render's
// own `shipConfigs` — inside a functional `setShipConfigs` updater. Two `updateShipConfig` calls
// for the same ship in one event both read that same pre-update `shipConfigs`, so the second
// call's merge silently dropped whatever the first call had just written. The fix merges from
// `prev[shipId]` inside the updater itself.
describe('useAutogearShipConfigs — updateShipConfig merges from the latest state', () => {
    const ship: Ship = { id: 'ship-1', type: 'ATTACKER' } as unknown as Ship;
    const getShipById = (id: string) => (id === ship.id ? ship : undefined);

    it('keeps both calls’ fields when two updateShipConfig calls for one ship happen in the same act()', () => {
        const { result } = renderHook(() => useAutogearShipConfigs(getShipById));

        act(() => {
            result.current.updateShipConfig(ship.id, { ignoreEquipped: true });
            result.current.updateShipConfig(ship.id, { tryToCompleteSets: true });
        });

        const config = result.current.getShipConfig(ship.id);
        expect(config.ignoreEquipped).toBe(true);
        expect(config.tryToCompleteSets).toBe(true);
    });

    it('still falls back to defaultAutogearShipConfig(ship.type) for a ship with no prior config', () => {
        const { result } = renderHook(() => useAutogearShipConfigs(getShipById));

        act(() => {
            result.current.updateShipConfig(ship.id, { ignoreEquipped: true });
        });

        const config = result.current.getShipConfig(ship.id);
        expect(config).toEqual({ ...defaultAutogearShipConfig('ATTACKER'), ignoreEquipped: true });
    });
});
