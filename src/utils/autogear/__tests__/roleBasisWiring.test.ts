import { describe, it, expect, beforeEach } from 'vitest';
import { findOptimalGearForShip, type ShipOptimizerConfig } from '../runShipOptimizer';
import { AutogearAlgorithm } from '../AutogearStrategy';
import { clearScoreCache } from '../scoring';
import { makeTestShip } from '../fastScoring/__tests__/fixtures/testInventory';
import type { GearPiece } from '../../../types/gear';
import type { RoleBasis } from '../../../types/autogear';
import type { FlexibleStats } from '../../../types/stats';

/**
 * `findOptimalGearForShip` is the one entry point every UI caller funnels through
 * (`AutogearStrategy` doc, `runShipOptimizer.ts`). A `roleBasis` test that only calls a scorer
 * or a config builder directly proves nothing about whether a real run ever sees it (#544).
 *
 * The weapon slot carries two candidates that diverge only on a foreign stat (hacking) the
 * ATTACKER formula never reads on its own — `weapon-a` wins the plain `attack` primary,
 * `weapon-b` wins under a `damage` basis on hacking (`calculateDPS`'s `resolveBasisValue`
 * substitutes the basis for `attack` outright). Every other slot has exactly one candidate, so
 * the winner is unambiguous and requires no randomness to observe, even under Genetic.
 */
const ship = makeTestShip({
    id: 'wiring-ship',
    type: 'ATTACKER',
    baseStats: {
        hp: 20000,
        attack: 1000,
        defence: 2000,
        speed: 200,
        hacking: 1000,
        security: 200,
        crit: 30,
        critDamage: 120,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
});

const weaponA: GearPiece = {
    id: 'weapon-a',
    slot: 'weapon',
    setBonus: null,
    rarity: 'legendary',
    level: 16,
    stars: 6,
    mainStat: { name: 'attack', value: 200, type: 'flat' },
    subStats: [{ name: 'attack', value: 5000, type: 'flat' }],
};

const weaponB: GearPiece = {
    id: 'weapon-b',
    slot: 'weapon',
    setBonus: null,
    rarity: 'legendary',
    level: 16,
    stars: 6,
    mainStat: { name: 'attack', value: 200, type: 'flat' },
    subStats: [{ name: 'hacking', value: 5000, type: 'flat' }],
};

const filler = (id: string, slot: GearPiece['slot'], mainStatName: FlexibleStats): GearPiece => ({
    id,
    slot,
    setBonus: null,
    rarity: 'legendary',
    level: 16,
    stars: 6,
    mainStat: { name: mainStatName, value: 5, type: 'percentage' },
    subStats: [{ name: 'hp', value: 500, type: 'flat' }],
});

const inventory: GearPiece[] = [
    weaponA,
    weaponB,
    filler('hull-1', 'hull', 'hp'),
    filler('generator-1', 'generator', 'defence'),
    filler('sensor-1', 'sensor', 'hp'),
    filler('software-1', 'software', 'hp'),
    filler('thrusters-1', 'thrusters', 'speed'),
];

const roleBasis: RoleBasis = {
    produces: 'damage',
    terms: [{ stat: 'hacking', weight: 1 }],
};

const baseConfig: ShipOptimizerConfig = {
    shipRole: 'ATTACKER',
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

const deps = {
    inventory,
    usedGearIds: new Set<string>(),
    getGearPiece: (id: string) => inventory.find((g) => g.id === id),
    upgradedGearGetter: (id: string) => inventory.find((g) => g.id === id),
    getEngineeringStatsForShipType: () => undefined,
    gearToShipMap: new Map<string, string>(),
    getShipById: (): undefined => undefined,
};

describe.each([AutogearAlgorithm.Genetic, AutogearAlgorithm.TwoPass, AutogearAlgorithm.SetFirst])(
    'findOptimalGearForShip roleBasis wiring — %s',
    (algorithm) => {
        beforeEach(() => {
            clearScoreCache();
        });

        it('picks the plain-attack winner with no roleBasis', async () => {
            const { result } = await findOptimalGearForShip(
                ship,
                { ...baseConfig, selectedAlgorithm: algorithm },
                deps
            );
            const weapon = result.suggestions.find((s) => s.slotName === 'weapon');
            expect(weapon?.gearId).toBe('weapon-a');
        });

        it('picks the basis winner when config carries a roleBasis', async () => {
            const { result } = await findOptimalGearForShip(
                ship,
                { ...baseConfig, selectedAlgorithm: algorithm, roleBasis },
                deps
            );
            const weapon = result.suggestions.find((s) => s.slotName === 'weapon');
            expect(weapon?.gearId).toBe('weapon-b');
        });
    }
);
