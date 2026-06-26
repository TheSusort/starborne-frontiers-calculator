import { describe, it, expect } from 'vitest';
import { splashPctForTier, splashDamageForBomb } from '../bombSplash';
import type { PendingBomb } from '../state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBomb(overrides: Partial<PendingBomb> = {}): PendingBomb {
    return {
        countdown: 3,
        damagePerStack: 1000,
        stacks: 2,
        tier: 200,
        sourceId: 'src-1',
        affinityMult: 1.3, // intentionally ≠ 1 — must NOT affect splash math
        detonationDamageModifier: 0,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// splashPctForTier
// ---------------------------------------------------------------------------

describe('splashPctForTier', () => {
    it('tier 100 → 25%', () => {
        expect(splashPctForTier(100)).toBe(25);
    });

    it('tier 200 → 50%', () => {
        expect(splashPctForTier(200)).toBe(50);
    });

    it('tier 300 → 75%', () => {
        expect(splashPctForTier(300)).toBe(75);
    });
});

// ---------------------------------------------------------------------------
// splashDamageForBomb
// ---------------------------------------------------------------------------

describe('splashDamageForBomb', () => {
    it('tier-200 bomb, default splashModifierPct (0): 2 × 1000 × 0.50 = 1000', () => {
        const bomb = makeBomb({ stacks: 2, damagePerStack: 1000, tier: 200 });
        expect(splashDamageForBomb(bomb)).toBe(1000);
    });

    it('tier-200 bomb, splashModifierPct=50: 1000 × 1.5 = 1500', () => {
        const bomb = makeBomb({ stacks: 2, damagePerStack: 1000, tier: 200 });
        expect(splashDamageForBomb(bomb, 50)).toBe(1500);
    });

    it('tier-100 bomb: 3 × 500 × 0.25 = 375', () => {
        const bomb = makeBomb({ stacks: 3, damagePerStack: 500, tier: 100 });
        expect(splashDamageForBomb(bomb)).toBe(375);
    });

    it('tier-300 bomb: 1 × 2000 × 0.75 = 1500', () => {
        const bomb = makeBomb({ stacks: 1, damagePerStack: 2000, tier: 300 });
        expect(splashDamageForBomb(bomb)).toBe(1500);
    });

    it('affinityMult (1.3) does NOT affect result — bombs are not affinity-scaled', () => {
        // bomb has affinityMult: 1.3 baked in via makeBomb defaults.
        // The result must be identical to a bomb with affinityMult: 1.
        const bombHighAffinity = makeBomb({
            stacks: 2,
            damagePerStack: 1000,
            tier: 200,
            affinityMult: 1.3,
        });
        const bombNeutralAffinity = makeBomb({
            stacks: 2,
            damagePerStack: 1000,
            tier: 200,
            affinityMult: 1.0,
        });
        expect(splashDamageForBomb(bombHighAffinity)).toBe(
            splashDamageForBomb(bombNeutralAffinity)
        );
        // Absolute value check as well
        expect(splashDamageForBomb(bombHighAffinity)).toBe(1000);
    });
});
