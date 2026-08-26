import { describe, it, expect } from 'vitest';
import { ABILITY_TARGET_SIDE, isEnemyTarget } from '../abilityTargetSide';
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
