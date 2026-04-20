import { describe, it, expect } from 'vitest';
import {
    STAT_INDEX,
    STAT_COUNT,
    createStatVector,
    copyStatVector,
    addStatVector,
    zeroStatVector,
    baseStatsToStatVector,
    statVectorToBaseStats,
} from '../statVector';
import type { BaseStats } from '../../../types/stats';
import { generateTestInventory, makeTestShip, seededRandom } from './fixtures/testInventory';

describe('statVector layout', () => {
    it('exposes one index per stat name without collisions', () => {
        const indices = Object.values(STAT_INDEX);
        expect(indices.length).toBe(STAT_COUNT);
        expect(new Set(indices).size).toBe(STAT_COUNT);
        for (const idx of indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(STAT_COUNT);
        }
    });

    it('covers every stat in BaseStats', () => {
        const expected = [
            'hp',
            'attack',
            'defence',
            'speed',
            'hacking',
            'security',
            'crit',
            'critDamage',
            'healModifier',
            'shield',
            'hpRegen',
            'defensePenetration',
            'shieldPenetration',
            'damageReduction',
        ];
        expect(Object.keys(STAT_INDEX).sort()).toEqual(expected.sort());
    });
});

describe('statVector helpers', () => {
    it('createStatVector returns zeroed vector of correct length', () => {
        const v = createStatVector();
        expect(v.length).toBe(STAT_COUNT);
        expect(Array.from(v)).toEqual(new Array(STAT_COUNT).fill(0));
    });

    it('copyStatVector copies all elements', () => {
        const src = createStatVector();
        src[0] = 1;
        src[5] = 5;
        src[13] = 13;
        const dst = createStatVector();
        copyStatVector(src, dst);
        expect(Array.from(dst)).toEqual(Array.from(src));
    });

    it('addStatVector adds component-wise in place', () => {
        const a = createStatVector();
        a[0] = 10;
        a[1] = 20;
        const b = createStatVector();
        b[0] = 5;
        b[1] = 7;
        addStatVector(a, b);
        expect(a[0]).toBe(15);
        expect(a[1]).toBe(27);
    });

    it('zeroStatVector resets in place', () => {
        const v = createStatVector();
        v[2] = 99;
        v[7] = -3;
        zeroStatVector(v);
        expect(Array.from(v)).toEqual(new Array(STAT_COUNT).fill(0));
    });
});

describe('BaseStats <-> StatVector round-trip', () => {
    it('round-trips a full BaseStats object', () => {
        const s: BaseStats = {
            hp: 50000,
            attack: 10000,
            defence: 8000,
            speed: 300,
            hacking: 5000,
            security: 3000,
            crit: 50,
            critDamage: 150,
            healModifier: 0,
            hpRegen: 0,
            shield: 0,
            damageReduction: 0,
            defensePenetration: 0,
        };
        const v = baseStatsToStatVector(s);
        const back = statVectorToBaseStats(v);
        expect(back.hp).toBe(s.hp);
        expect(back.attack).toBe(s.attack);
        expect(back.defence).toBe(s.defence);
        expect(back.speed).toBe(s.speed);
        expect(back.hacking).toBe(s.hacking);
        expect(back.security).toBe(s.security);
        expect(back.crit).toBe(s.crit);
        expect(back.critDamage).toBe(s.critDamage);
    });

    it('treats missing optional fields as 0', () => {
        const s: BaseStats = {
            hp: 1,
            attack: 1,
            defence: 1,
            speed: 1,
            hacking: 1,
            security: 1,
            crit: 1,
            critDamage: 1,
        };
        const v = baseStatsToStatVector(s);
        const back = statVectorToBaseStats(v);
        expect(back.healModifier).toBe(0);
        expect(back.hpRegen).toBe(0);
        expect(back.shield).toBe(0);
    });
});

describe('test fixture sanity', () => {
    it('generates deterministic inventory given the same seed', () => {
        const a = generateTestInventory(42, 10);
        const b = generateTestInventory(42, 10);
        expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    });

    it('seededRandom(1) is deterministic', () => {
        const r1 = seededRandom(1);
        const r2 = seededRandom(1);
        for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
    });

    it('makeTestShip returns a valid Ship', () => {
        const ship = makeTestShip();
        expect(ship.id).toBeTruthy();
        expect(ship.baseStats.hp).toBeGreaterThan(0);
    });
});
