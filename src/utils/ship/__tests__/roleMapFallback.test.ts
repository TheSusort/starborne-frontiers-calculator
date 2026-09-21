import { describe, it, expect } from 'vitest';
import { analyzeGearQuality } from '../gearSuggestions';
import { analyzeUpgrades } from '../upgradeAnalysis';
import { SHIP_TYPES } from '../../../constants';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { SlotContribution } from '../statDistribution';
import type { BaseStats } from '../../../types/stats';

// `DESIRED_STATS` (gearSuggestions.ts) and `DESIRED_SETS` (upgradeAnalysis.ts) only carry
// entries for some `ShipTypeName` roles directly; the rest resolve through `resolveRoleEntry`'s
// category fallback (`constants/shipTypes.ts`). This walks every role in `SHIP_TYPES` through
// both real consumers with a geared ship to prove none of them throws.
const ALL_ROLES: ShipTypeName[] = Object.keys(SHIP_TYPES);

const baseStats: BaseStats = {
    hp: 1000,
    attack: 200,
    defence: 150,
    hacking: 100,
    security: 80,
    crit: 50,
    critDamage: 150,
    speed: 100,
};

function makeShip(type: ShipTypeName): Ship {
    return {
        id: 'ship-1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'terran',
        type,
        baseStats,
        equipment: { weapon: 'gear-1' },
        implants: {},
        refits: [],
    };
}

function makeGear(): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 10,
        stars: 3,
        rarity: 'rare',
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [{ name: 'crit', value: 5, type: 'percentage' }],
        setBonus: 'ATTACK',
    };
}

const slotContribution: SlotContribution = {
    slotName: 'weapon',
    absoluteScore: 10,
    relativeScore: 10,
    primaryStats: [],
};

function getGearPiece(id: string): GearPiece | undefined {
    return id === 'gear-1' ? makeGear() : undefined;
}

describe('role-map fallback: analyzeGearQuality never throws for any SHIP_TYPES role', () => {
    // Non-vacuity: assert the walk actually covers both an exact-match role (ATTACKER, has
    // its own DESIRED_STATS/DESIRED_SETS entry) and a fallback role (has neither — resolves
    // through its category). If either list were empty the "walks every role" claim below
    // would be untested.
    const exactMatchRoles = ALL_ROLES.filter((role) =>
        ['ATTACKER', 'DEFENDER', 'SUPPORTER', 'SUPPORTER_BUFFER', 'DEBUFFER'].includes(role)
    );
    const fallbackRoles = ALL_ROLES.filter((role) => !exactMatchRoles.includes(role));

    it('covers at least one exact-match role and one fallback role', () => {
        expect(exactMatchRoles.length).toBeGreaterThan(0);
        expect(fallbackRoles.length).toBeGreaterThan(0);
        expect(exactMatchRoles).toContain('ATTACKER');
        expect(fallbackRoles).toContain('DEBUFFER_BOMBER');
    });

    for (const role of ALL_ROLES) {
        it(`${role} does not throw`, () => {
            const ship = makeShip(role);
            const gear = makeGear();
            expect(() =>
                analyzeGearQuality(gear, ship, baseStats, getGearPiece, slotContribution)
            ).not.toThrow();
        });
    }
});

describe('role-map fallback: analyzeUpgrades (the DESIRED_SETS consumer) never throws for any SHIP_TYPES role', () => {
    for (const role of ALL_ROLES) {
        it(`${role} does not throw`, () => {
            const ship = makeShip(role);
            // Force both the gear-quality branch and the orphan-set-piece branch to run,
            // since those are the two DESIRED_SETS/DESIRED_STATS read sites.
            const lowContribution: SlotContribution = {
                ...slotContribution,
                relativeScore: 0,
            };
            const orphanPiece: GearPiece = { ...makeGear(), id: 'gear-2', setBonus: 'FORTITUDE' };

            expect(() =>
                analyzeUpgrades(
                    [lowContribution],
                    { weapon: 'gear-1' },
                    getGearPiece,
                    ship,
                    baseStats,
                    [orphanPiece]
                )
            ).not.toThrow();
        });
    }
});
