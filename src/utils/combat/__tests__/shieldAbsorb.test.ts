import { test, expect } from 'vitest';
import { shieldAbsorb } from '../shieldAbsorb';

test('DoT bypasses shield entirely', () => {
    expect(shieldAbsorb({ damage: 500, shieldPool: 1000, isDot: true, penPct: 50, bombPortion: 0 }))
        .toEqual({ absorbed: 0, hpDamage: 500 });
});
test('direct hit with 20% pen: 80% eligible to drain', () => {
    expect(shieldAbsorb({ damage: 1000, shieldPool: 1000, isDot: false, penPct: 20, bombPortion: 0 }))
        .toEqual({ absorbed: 800, hpDamage: 200 });
});
test('direct hit, shield smaller than eligible: full drain + overflow', () => {
    expect(shieldAbsorb({ damage: 1000, shieldPool: 300, isDot: false, penPct: 20, bombPortion: 0 }))
        .toEqual({ absorbed: 300, hpDamage: 700 });
});
test('bomb portion ignores pen (full drain eligible)', () => {
    expect(shieldAbsorb({ damage: 1000, shieldPool: 1000, isDot: false, penPct: 50, bombPortion: 1000 }))
        .toEqual({ absorbed: 1000, hpDamage: 0 });
});
test('mixed direct+bomb: pen only on direct portion', () => {
    expect(shieldAbsorb({ damage: 1000, shieldPool: 10000, isDot: false, penPct: 50, bombPortion: 400 }))
        .toEqual({ absorbed: 700, hpDamage: 300 });
});
test('no pen, no bomb = legacy behavior (full eligible)', () => {
    expect(shieldAbsorb({ damage: 500, shieldPool: 300, isDot: false, penPct: 0, bombPortion: 0 }))
        .toEqual({ absorbed: 300, hpDamage: 200 });
});
