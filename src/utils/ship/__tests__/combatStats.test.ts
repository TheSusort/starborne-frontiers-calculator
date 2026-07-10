import { describe, it, expect, vi } from 'vitest';
import { shipFinalStats, combatStatsFromShip } from '../combatStats';
import { StatBreakdown } from '../statsCalculator';
import { Ship } from '../../../types/ship';

describe('combatStatsFromShip', () => {
    it('rounds fractional stats', () => {
        const final = {
            attack: 1000.4,
            crit: 70.6,
            critDamage: 150.5,
            defensePenetration: 12.3,
            shieldPenetration: 8.7,
            hacking: 200.9,
            security: 358.6,
            defence: 500.5,
            hp: 9999.6,
            healModifier: 25.4,
            speed: 110.5,
        } as StatBreakdown['final'];

        expect(combatStatsFromShip(final)).toEqual({
            attack: 1000,
            crit: 71,
            critDamage: 151,
            defensePenetration: 12,
            shieldPenetration: 9,
            hacking: 201,
            security: 359,
            defence: 501,
            hp: 10000,
            healModifier: 25,
            speed: 111,
        });
    });

    it('applies defaults for missing stats (hacking 200, speed 100, others 0)', () => {
        const final = {
            attack: 500,
            crit: 50,
            critDamage: 100,
            // defensePenetration, hacking, defence, hp, healModifier, speed undefined
        } as unknown as StatBreakdown['final'];

        expect(combatStatsFromShip(final)).toEqual({
            attack: 500,
            crit: 50,
            critDamage: 100,
            defensePenetration: 0,
            shieldPenetration: 0,
            hacking: 200,
            security: 100,
            defence: 0,
            hp: 0,
            healModifier: 0,
            speed: 100,
        });
    });
});

describe('shipFinalStats', () => {
    it('passes ship fields + resolved deps into calculateTotalStats and returns final', () => {
        const getGearPiece = vi.fn(() => undefined);
        const getEngineeringStatsForShipType = vi.fn(() => undefined);

        const ship = {
            id: 'ship-1',
            type: 'Attacker',
            baseStats: {
                attack: 1000,
                hp: 5000,
                defence: 300,
                crit: 70,
                critDamage: 150,
                speed: 100,
            },
            equipment: {},
            refits: [],
            implants: {},
        } as unknown as Ship;

        const final = shipFinalStats(ship, { getGearPiece, getEngineeringStatsForShipType });

        // No gear/refits/engineering applied → final equals base stats.
        expect(final.attack).toBe(1000);
        expect(final.hp).toBe(5000);
        expect(getEngineeringStatsForShipType).toHaveBeenCalledWith('Attacker');
    });
});
