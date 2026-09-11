import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import { AutogearAlgorithm } from '../../../utils/autogear/AutogearStrategy';
import type { Ship } from '../../../types/ship';
import type { BaseStats } from '../../../types/stats';
import type { AutogearSettings } from '../AutogearSettings';

type SettingsProps = ComponentProps<typeof AutogearSettings>;

export const testShip: Ship = {
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    baseStats: {
        hp: 22000,
        attack: 6250,
        defence: 5000,
        speed: 130,
        hacking: 0,
        security: 0,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    level: 60,
    rank: 6,
    equipment: {},
    refits: [],
    implants: {},
};

export const testShipStats: BaseStats = { ...testShip.baseStats };

/**
 * Every required member of AutogearSettingsProps, callbacks as spies. Spread overrides
 * on top for the props a given test actually cares about.
 *
 * The `SettingsProps` return type is what makes this worth having: if AutogearSettings
 * gains a required prop, `tsc --noEmit` fails here once rather than in every test.
 */
export const makeSettingsProps = (overrides: Partial<SettingsProps> = {}): SettingsProps => ({
    selectedShip: testShip,
    selectedShipStats: testShipStats,
    selectedShipRole: null,
    selectedAlgorithm: AutogearAlgorithm.Genetic,
    priorities: [],
    ignoreEquipped: false,
    ignoreUnleveled: true,
    showSecondaryRequirements: false,
    setPriorities: [],
    statBonuses: [],
    useUpgradedStats: false,
    tryToCompleteSets: false,
    optimizeImplants: false,
    includeCalibratedGear: false,
    assumeCalibrated: false,
    fleetBuffs: [],
    customFormula: undefined,
    onShipSelect: vi.fn(),
    onRoleSelect: vi.fn(),
    onAlgorithmSelect: vi.fn(),
    onAddPriority: vi.fn(),
    onUpdatePriority: vi.fn(),
    onRemovePriority: vi.fn(),
    onFindOptimalGear: vi.fn(),
    onIgnoreEquippedChange: vi.fn(),
    onIgnoreUnleveledChange: vi.fn(),
    onToggleSecondaryRequirements: vi.fn(),
    onAddSetPriority: vi.fn(),
    onUpdateSetPriority: vi.fn(),
    onRemoveSetPriority: vi.fn(),
    onAddStatBonus: vi.fn(),
    onUpdateStatBonus: vi.fn(),
    onRemoveStatBonus: vi.fn(),
    onAddFleetBuff: vi.fn(),
    onUpdateFleetBuff: vi.fn(),
    onRemoveFleetBuff: vi.fn(),
    onUseUpgradedStatsChange: vi.fn(),
    onTryToCompleteSetsChange: vi.fn(),
    onOptimizeImplantsChange: vi.fn(),
    onIncludeCalibratedGearChange: vi.fn(),
    onAssumeCalibratedChange: vi.fn(),
    onResetConfig: vi.fn(),
    onAddFormulaRow: vi.fn(),
    onUpdateFormulaRow: vi.fn(),
    onRemoveFormulaRow: vi.fn(),
    onSeedFormula: vi.fn(),
    ...overrides,
});
