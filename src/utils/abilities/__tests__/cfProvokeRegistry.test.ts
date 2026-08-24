/**
 * cfProvokeRegistry.test.ts
 *
 * D-PR14: Bulwark (Provoke debuff) + Doomsayer (Concentrate Fire debuff) registry entries.
 */

import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { GearPiece } from '../../../types/gear';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';

// ---------------------------------------------------------------------------
// Minimal fixture helpers (copied from equipmentCoverage.test.ts)
// ---------------------------------------------------------------------------

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'registry-ship',
        name: 'Registry Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    };
}

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}

/**
 * Build a ship with the given implant at the given rarity and return the single
 * produced ability (throws if not exactly one ability).
 */
function buildImplant(implantKey: string, rarity: GearPiece['rarity']): Ability {
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    const ship = makeShip({ implants: { implant_major: id } });
    const abilities = buildEquipmentAbilities(ship, (gearId) => pieceMap[gearId]);
    if (abilities.length !== 1) {
        throw new Error(
            `Expected exactly 1 ability for ${implantKey} (${rarity}), got ${abilities.length}`
        );
    }
    return abilities[0];
}

function buildBulwark(rarity: GearPiece['rarity']): Ability {
    return buildImplant('BULWARK', rarity);
}

function buildDoomsayer(rarity: GearPiece['rarity']): Ability {
    return buildImplant('DOOMSAYER', rarity);
}

// ---------------------------------------------------------------------------
// D-PR14 registry — Bulwark
// ---------------------------------------------------------------------------

describe('D-PR14 registry — Bulwark', () => {
    it('produces a Provoke debuff: on-ally-attacked, target enemy, oncePerRound, adjacency-required, procChance per rarity', () => {
        const ab = buildBulwark('epic');
        expect(ab.config.type).toBe('debuff');
        expect((ab.config as { buffName: string }).buffName).toBe('Provoke');
        expect(ab.trigger).toBe('on-ally-attacked');
        expect(ab.target).toBe('enemy');
        expect(ab.oncePerRound).toBe(true);
        expect(ab.requireDamagedAllyAdjacent).toBe(true);
        expect(ab.procChance).toBeCloseTo(0.12);
        expect((ab.config as { duration: number }).duration).toBe(1);
    });

    it('common rarity: procChance 5%', () => {
        const ab = buildBulwark('common');
        expect(ab.procChance).toBeCloseTo(0.05);
    });

    it('uncommon rarity: procChance 7%', () => {
        const ab = buildBulwark('uncommon');
        expect(ab.procChance).toBeCloseTo(0.07);
    });

    it('rare rarity: procChance 9%', () => {
        const ab = buildBulwark('rare');
        expect(ab.procChance).toBeCloseTo(0.09);
    });

    it('legendary rarity: procChance 16%', () => {
        const ab = buildBulwark('legendary');
        expect(ab.procChance).toBeCloseTo(0.16);
    });
});

// ---------------------------------------------------------------------------
// D-PR14 registry — Doomsayer
// ---------------------------------------------------------------------------

describe('D-PR14 registry — Doomsayer', () => {
    it('produces a Concentrate Fire debuff: end-of-round, target enemy-highest-attack, first-activator gate, procChance per rarity', () => {
        const ab = buildDoomsayer('legendary');
        expect(ab.config.type).toBe('debuff');
        expect((ab.config as { buffName: string }).buffName).toBe('Concentrate Fire');
        expect(ab.trigger).toBe('end-of-round');
        expect(ab.target).toBe('enemy-highest-attack');
        expect(ab.conditions).toContainEqual({ subject: 'first-activator', derivable: true });
        expect(ab.procChance).toBeCloseTo(0.16);
        expect((ab.config as { duration: number }).duration).toBe(1);
    });

    it('uncommon rarity: procChance 7%', () => {
        const ab = buildDoomsayer('uncommon');
        expect(ab.procChance).toBeCloseTo(0.07);
    });

    it('rare rarity: procChance 9%', () => {
        const ab = buildDoomsayer('rare');
        expect(ab.procChance).toBeCloseTo(0.09);
    });

    it('epic rarity: procChance 12%', () => {
        const ab = buildDoomsayer('epic');
        expect(ab.procChance).toBeCloseTo(0.12);
    });
});
