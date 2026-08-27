import { describe, it, expect } from 'vitest';
import {
    ABILITY_TARGET_SIDE,
    isEnemyTarget,
    ABILITY_TARGET_SELECTOR,
    enemySelectorKind,
} from '../abilityTargetSide';
import type { AbilityTarget } from '../../../types/abilities';

/**
 * The classification of every AbilityTarget, pinned. The `Record` type is the real tripwire — tsc
 * rejects a new AbilityTarget variant until somebody classifies it here — but the type cannot say
 * WHICH side is right, so this file is the readable record of the decision.
 *
 * #399: the three SELECTOR targets are enemy-side. Each names exactly ONE opposing actor, resolved
 * at drain time; naming one enemy rather than all of them changes the FOOTPRINT, never the SIDE.
 */
describe('ABILITY_TARGET_SIDE', () => {
    const SELF: AbilityTarget[] = [
        'self',
        'ally',
        'all-allies',
        'lowest-hp-ally',
        'adjacent-allies',
    ];
    const ENEMY: AbilityTarget[] = [
        'enemy',
        'all-enemies',
        'adjacent-enemies',
        'target-and-adjacent-enemies',
        'enemy-most-buffs',
        'enemy-highest-attack',
        'enemy-highest-speed',
    ];

    it.each(SELF)('%s is self-side', (t) => {
        expect(ABILITY_TARGET_SIDE[t]).toBe('self');
        expect(isEnemyTarget(t)).toBe(false);
    });

    it.each(ENEMY)('%s is enemy-side', (t) => {
        expect(ABILITY_TARGET_SIDE[t]).toBe('enemy');
        expect(isEnemyTarget(t)).toBe(true);
    });

    it('classifies every AbilityTarget — no key is missing and none is extra', () => {
        expect(Object.keys(ABILITY_TARGET_SIDE).sort()).toEqual([...SELF, ...ENEMY].sort());
    });
});

describe('#403 ABILITY_TARGET_SELECTOR — the footprint axis', () => {
    it('classifies exactly the three enemy selector targets and nothing else', () => {
        const selectors = Object.entries(ABILITY_TARGET_SELECTOR)
            .filter(([, kind]) => kind !== null)
            .map(([target]) => target)
            .sort();
        expect(selectors).toEqual([
            'enemy-highest-attack',
            'enemy-highest-speed',
            'enemy-most-buffs',
        ]);
    });

    it('maps each selector target to its own kind', () => {
        expect(enemySelectorKind('enemy-most-buffs')).toBe('most-buffs');
        expect(enemySelectorKind('enemy-highest-attack')).toBe('highest-attack');
        expect(enemySelectorKind('enemy-highest-speed')).toBe('highest-speed');
    });

    it('every non-selector target resolves to null (the tail must stay reachable)', () => {
        expect(enemySelectorKind('enemy')).toBeNull();
        expect(enemySelectorKind('all-enemies')).toBeNull();
        expect(enemySelectorKind('adjacent-enemies')).toBeNull();
        expect(enemySelectorKind('target-and-adjacent-enemies')).toBeNull();
        expect(enemySelectorKind('self')).toBeNull();
        expect(enemySelectorKind('ally')).toBeNull();
        expect(enemySelectorKind('all-allies')).toBeNull();
        expect(enemySelectorKind('lowest-hp-ally')).toBeNull();
        expect(enemySelectorKind('adjacent-allies')).toBeNull();
    });

    // CROSS-CHECK between the two axes: a selector names ONE opposing actor, so it is by
    // definition enemy-side. If a future variant is classified as a selector but self-side, one
    // of the two maps is wrong and this catches it without anyone having to notice.
    it('every selector target is also enemy-side on the store axis', () => {
        for (const [target, kind] of Object.entries(ABILITY_TARGET_SELECTOR)) {
            if (kind === null) continue;
            expect(ABILITY_TARGET_SIDE[target as keyof typeof ABILITY_TARGET_SIDE]).toBe('enemy');
        }
    });

    // The two maps must have IDENTICAL key sets. Both are total Records over AbilityTarget, so
    // tsc already enforces it; this is the runtime witness for a reader.
    it('both axis maps cover the same key set', () => {
        expect(Object.keys(ABILITY_TARGET_SELECTOR).sort()).toEqual(
            Object.keys(ABILITY_TARGET_SIDE).sort()
        );
    });
});
