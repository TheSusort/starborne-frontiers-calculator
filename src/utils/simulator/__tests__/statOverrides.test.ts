import { describe, it, expect } from 'vitest';
import {
    OVERRIDABLE_STATS,
    OVERRIDE_MIN,
    applyStatOverrides,
    hasAnyOverride,
    normalizeOverride,
    type OverridableCoversResolved,
    type ResolvedCombatStats,
} from '../statOverrides';

const base: ResolvedCombatStats = {
    attack: 12450,
    crit: 70,
    critDamage: 180,
    defensePenetration: 0,
    shieldPenetration: 0,
    hacking: 310,
    security: 240,
    defence: 8200,
    hp: 46500,
    healModifier: 0,
    speed: 118,
};

describe('OVERRIDABLE_STATS', () => {
    it('covers exactly the keys combatStatsFromShip emits', () => {
        // Compile-time tripwire: this assignment fails `tsc --noEmit` if a stat is added to
        // combatStatsFromShip without being added here, or vice versa.
        const covers: OverridableCoversResolved = true;
        expect(covers).toBe(true);
        expect([...OVERRIDABLE_STATS].sort()).toEqual(Object.keys(base).sort());
    });
});

describe('normalizeOverride', () => {
    it('keeps a value that differs from base', () => {
        expect(normalizeOverride('attack', 12650, base.attack)).toBe(12650);
    });

    it('clears an override equal to base, so an "overridden" badge never lies', () => {
        expect(normalizeOverride('attack', 12450, base.attack)).toBeUndefined();
    });

    it('rounds to an integer', () => {
        expect(normalizeOverride('speed', 118.6, base.speed)).toBe(119);
    });

    it('rejects NaN and Infinity, which reach the engine as NaN damage with no error', () => {
        expect(normalizeOverride('attack', NaN, base.attack)).toBeUndefined();
        expect(normalizeOverride('attack', Infinity, base.attack)).toBeUndefined();
    });

    it('rejects a value below the stat floor', () => {
        expect(normalizeOverride('attack', -1, base.attack)).toBeUndefined();
        // hp 0 puts the actor on the engine's corpse path before the fight starts.
        expect(OVERRIDE_MIN.hp).toBe(1);
        expect(normalizeOverride('hp', 0, base.hp)).toBeUndefined();
        expect(normalizeOverride('hp', 1, base.hp)).toBe(1);
    });

    it('treats undefined as no override', () => {
        expect(normalizeOverride('attack', undefined, base.attack)).toBeUndefined();
    });
});

describe('applyStatOverrides', () => {
    it('returns the base block untouched when there are no overrides', () => {
        expect(applyStatOverrides(base, undefined)).toEqual(base);
        expect(applyStatOverrides(base, {})).toEqual(base);
    });

    it('wins field-by-field over the resolved block and leaves the rest alone', () => {
        const result = applyStatOverrides(base, { attack: 12650, hacking: 180 });
        expect(result.attack).toBe(12650);
        expect(result.hacking).toBe(180);
        expect(result.speed).toBe(base.speed);
        expect(result.hp).toBe(base.hp);
    });

    it('does not mutate the base block', () => {
        applyStatOverrides(base, { attack: 1 });
        expect(base.attack).toBe(12450);
    });
});

describe('hasAnyOverride', () => {
    it('is false for undefined and for an empty record', () => {
        expect(hasAnyOverride(undefined)).toBe(false);
        expect(hasAnyOverride({})).toBe(false);
    });

    it('is true once a stat carries a value', () => {
        expect(hasAnyOverride({ speed: 133 })).toBe(true);
    });
});
