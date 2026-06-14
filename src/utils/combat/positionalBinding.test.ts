import { describe, it, expect } from 'vitest';
import type { ParsedTarget } from '../targetingParser';
import { isPositional, resolvePositionalTarget } from './positionalBinding';
import type { CombatActor } from './state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

const enemyTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: `enemy-${selection}`,
    side: 'enemy',
    selection,
});

describe('isPositional', () => {
    it('false when caster has no position', () => {
        expect(isPositional(undefined, [actor('e1', 'M4')])).toBe(false);
    });

    it('false when no opposing actor is positioned', () => {
        expect(isPositional('M4', [actor('e1', undefined)])).toBe(false);
    });

    it('true when caster positioned and an opposing actor is positioned', () => {
        expect(isPositional('M4', [actor('e1', 'M4')])).toBe(true);
    });

    it('false when opposing list is empty', () => {
        expect(isPositional('M4', [])).toBe(false);
    });
});

describe('resolvePositionalTarget', () => {
    // M4 = column 4 (front-most), M1 = column 1 (back-most)
    const enemies = [actor('front', 'M4'), actor('back', 'M1')];

    it('front selects the front-most (M4) actor', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies)?.id).toBe('front');
    });

    it('skip selects the 2nd-from-front (M1) actor', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('skip'), enemies)?.id).toBe('back');
    });

    it('back selects the back-most (M1) actor', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('back'), enemies)?.id).toBe('back');
    });

    it('returns null when all opposing actors are dead', () => {
        const dead = [actor('e1', 'M4', 0), actor('e2', 'M1', -5)];
        expect(resolvePositionalTarget('M4', enemyTarget('front'), dead)).toBeNull();
    });

    it('returns null when opposing list is empty', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('front'), [])).toBeNull();
    });

    it('excludes dead actors but still resolves a living one', () => {
        const mixed = [actor('dead', 'M4', 0), actor('alive', 'M1', 50)];
        expect(resolvePositionalTarget('M4', enemyTarget('front'), mixed)?.id).toBe('alive');
    });
});
