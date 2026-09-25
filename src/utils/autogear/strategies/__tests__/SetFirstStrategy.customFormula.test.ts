import { describe, it, expect, beforeEach } from 'vitest';
import { SetFirstStrategy } from '../SetFirstStrategy';
import { Ship } from '../../../../types/ship';
import { GearPiece } from '../../../../types/gear';
import { CustomFormula } from '../../../../types/autogear';
import { BaseStats, EngineeringStat } from '../../../../types/stats';
import { ShipTypeName } from '../../../../constants/shipTypes';
import { clearScoreCache } from '../../scoring';
import type { ScoringInputs } from '../../AutogearStrategy';

const BASE: BaseStats = {
    hp: 1000,
    attack: 0,
    defence: 0,
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
};

function makeShip(): Ship {
    return {
        id: 'ship1',
        name: 'Test Ship',
        type: 'ATTACKER',
        rarity: 'legendary',
        faction: 'TERRAN',
        level: 60,
        rank: 5,
        baseStats: { ...BASE },
        equipment: {},
        implants: {},
        refits: [],
    };
}

function makeGear(
    id: string,
    slot: GearPiece['slot'],
    setBonus: GearPiece['setBonus'],
    statName: keyof BaseStats,
    amount: number
): GearPiece {
    return {
        id,
        slot,
        level: 16,
        stars: 6,
        rarity: 'legendary',
        setBonus,
        mainStat: { name: statName, value: amount, type: 'flat' } as GearPiece['mainStat'],
        subStats: [],
    };
}

describe('SetFirstStrategy — Custom formula in set ranking', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('ranks set groups by the Custom formula, not inventory insertion order', async () => {
        const strategy = new SetFirstStrategy();
        const ship = makeShip();

        // FORTITUDE barely moves attack (the formula's stat) and is inserted FIRST.
        // ATTACK moves attack a great deal and is inserted second. A correct ranking must
        // still prefer ATTACK for the weapon/hull slots.
        const inventory: GearPiece[] = [
            makeGear('f-weapon', 'weapon', 'FORTITUDE', 'attack', 10),
            makeGear('f-hull', 'hull', 'FORTITUDE', 'hp', 9000),
            makeGear('a-weapon', 'weapon', 'ATTACK', 'attack', 3000),
            makeGear('a-hull', 'hull', 'ATTACK', 'attack', 3000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const customFormula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const scoringInputs: ScoringInputs = {
            shipRole: undefined, // Custom mode
            setPriorities: undefined,
            statBonuses: undefined,
            tryToCompleteSets: undefined,
            arenaModifiers: undefined,
            fleetBuffs: undefined,
            customFormula,
            roleBasis: undefined,
        };

        const result = await strategy.findOptimalGear(
            ship,
            [],
            inventory,
            getGearPiece,
            getEng,
            scoringInputs
        );

        const gearIds = result.suggestions.map((s) => s.gearId);
        expect(gearIds).toContain('a-weapon');
        expect(gearIds).toContain('a-hull');
        expect(gearIds).not.toContain('f-weapon');
        expect(gearIds).not.toContain('f-hull');
    });
});
