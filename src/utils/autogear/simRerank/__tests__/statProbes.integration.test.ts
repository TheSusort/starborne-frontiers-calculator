import { describe, it, expect } from 'vitest';
import {
    runOffFormulaTuningPass,
    type ShipOptimizerConfig,
    type ShipOptimizerDeps,
} from '../../runShipOptimizer';
import { floorProbePriorities, ceilingProbePriorities } from '../statBands';
import { AutogearAlgorithm } from '../../AutogearStrategy';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { StatPriority } from '../../../../types/autogear';
import type { LimitableStat } from '../../../../types/stats';

// The probes are only meaningful against the REAL GeneticStrategy: their whole mechanism is how
// `calculatePriorityScore`'s penalties and `compareIndividuals`' tiebreak rank a population. A
// mocked strategy cannot fail any assertion here.

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

const landed = async (priorities: StatPriority[]): Promise<number> =>
    (await runOffFormulaTuningPass(ship, { ...config, statPriorities: priorities }, deps, stat))
        .landed;

describe('achievable-range probes against the real GeneticStrategy', () => {
    it('the floor probe reaches the inventory minimum, which a 0-pinned probe cannot', async () => {
        const unconstrained = await landed([]);
        const floor = await landed(floorProbePriorities(stat));
        // A limit of exactly 0 is "no limit" to every scorer in the chain, so this probe cannot
        // constrain anything. It is the instrument check: it proves the fixture is capable of
        // reporting "found nothing", which is what the floor probe used to do.
        const zeroPinned = await landed([
            { stat, minLimit: 0, maxLimit: 0, hardRequirement: true },
        ]);

        expect(floor).toBe(FLOOR);
        expect(unconstrained).toBeGreaterThan(FLOOR);
        expect(zeroPinned).toBe(unconstrained);
    }, 60_000);

    it('the ceiling probe drives the stat above the unconstrained pick', async () => {
        const unconstrained = await landed([]);
        const ceiling = await landed(ceilingProbePriorities(stat));

        // Only an inequality: the ceiling probe leaves a positive fitness of
        // `roleScore * value / limit`, so it maximises the role score TIMES the stat and can
        // stop short of the true maximum when the role formula pulls the other way.
        expect(ceiling).toBeGreaterThan(unconstrained);
        expect(ceiling).toBeLessThanOrEqual(CEILING);
    }, 60_000);
});
