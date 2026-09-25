import { describe, it, expect, beforeEach } from 'vitest';
import { SetFirstStrategy } from '../SetFirstStrategy';
import { TwoPassStrategy } from '../TwoPassStrategy';
import { Ship } from '../../../../types/ship';
import { GearPiece } from '../../../../types/gear';
import { EngineeringStat } from '../../../../types/stats';
import { ShipTypeName } from '../../../../constants/shipTypes';
import { clearScoreCache } from '../../scoring';
import type { ScoringInputs } from '../../AutogearStrategy';

// A stored set name is a raw string (`GearPiece.setBonus`). One that names an inherited
// Object.prototype property must not reach a plain-object set grouping, where the lookup
// returns the inherited function and `.push` throws (#569).
const ship: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    type: 'ATTACKER',
    rarity: 'legendary',
    faction: 'TERRAN',
    level: 60,
    rank: 5,
    baseStats: {
        hp: 1000,
        attack: 100,
        defence: 100,
        speed: 100,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 100,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    },
    equipment: {},
    implants: {},
    refits: [],
};

const piece = (id: string, slot: string, setBonus: string | null): GearPiece => ({
    id,
    slot,
    level: 16,
    stars: 6,
    rarity: 'legendary',
    setBonus,
    mainStat: { name: 'attack', value: 500, type: 'flat' },
    subStats: [],
});

const inventory: GearPiece[] = [
    piece('proto-weapon', 'weapon', 'constructor'),
    piece('proto-hull', 'hull', 'constructor'),
    piece('atk-weapon', 'weapon', 'ATTACK'),
    piece('atk-hull', 'hull', 'ATTACK'),
];

const scoringInputs: ScoringInputs = {
    shipRole: 'ATTACKER',
    setPriorities: undefined,
    statBonuses: undefined,
    tryToCompleteSets: true,
    arenaModifiers: undefined,
    fleetBuffs: undefined,
    customFormula: undefined,
    roleBasis: undefined,
};

const run = (strategy: SetFirstStrategy | TwoPassStrategy) =>
    strategy.findOptimalGear(
        ship,
        [],
        inventory,
        (id) => inventory.find((g) => g.id === id),
        (_t: ShipTypeName): EngineeringStat | undefined => undefined,
        scoringInputs
    );

describe('autogear set grouping with an unrecognised stored set name', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('SetFirstStrategy completes', async () => {
        await expect(run(new SetFirstStrategy())).resolves.toHaveProperty('suggestions');
    });

    it('TwoPassStrategy completes', async () => {
        await expect(run(new TwoPassStrategy())).resolves.toHaveProperty('suggestions');
    });
});
