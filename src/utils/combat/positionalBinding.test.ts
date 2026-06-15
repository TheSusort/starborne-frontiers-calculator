import { describe, it, expect } from 'vitest';
import type { ParsedTarget } from '../targetingParser';
import { isPositional, resolvePositionalTarget } from './positionalBinding';
import type { ActorTargetingStatus } from './positionalBinding';
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

// Build a statusOf stub from a partial map keyed by actor id.
const statusFrom =
    (m: Record<string, Partial<ActorTargetingStatus>>) =>
    (id: string): ActorTargetingStatus | undefined => {
        const s = m[id];
        return s ? { stealthed: false, taunting: false, concentrated: false, ...s } : undefined;
    };

describe('resolvePositionalTarget — stealth + forced targeting (statusOf)', () => {
    const enemies = [actor('front', 'M4'), actor('back', 'M1')]; // M4 front-most, M1 back-most

    it('omitting statusOf is identical to the Phase-2 result', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies)?.id).toBe('front');
    });
    it('statusOf returning undefined for every id is identical to Phase-2', () => {
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, statusFrom({}))?.id
        ).toBe('front');
    });
    it('stealth filter excludes a stealthed enemy (front stealthed → front picks back)', () => {
        const so = statusFrom({ front: { stealthed: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });
    it('all-stealthed fallback: every enemy stealthed → still targetable (front → front)', () => {
        const so = statusFrom({ front: { stealthed: true }, back: { stealthed: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('front');
    });
    it('Taunt forces the taunting actor even when it is not the default anchor', () => {
        const so = statusFrom({ back: { taunting: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });
    it('Concentrate Fire forces the marked actor and reaches it through stealth', () => {
        const so = statusFrom({ back: { stealthed: true, concentrated: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });
    it('Concentrate Fire beats a simultaneous Taunt (priority CF > Taunt)', () => {
        const so = statusFrom({ front: { taunting: true }, back: { concentrated: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });
    it('multi-taunt with no round data → front-most (colOf descending), not roster order', () => {
        const rosterBackFirst = [actor('back', 'M1'), actor('front', 'M4')];
        const so = statusFrom({ front: { taunting: true }, back: { taunting: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), rosterBackFirst, so)?.id).toBe(
            'front'
        );
    });
    it('multi-taunt honours tauntAppliedRound when present (later round wins over front-most)', () => {
        const so = statusFrom({
            front: { taunting: true, tauntAppliedRound: 1 },
            back: { taunting: true, tauntAppliedRound: 2 },
        });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });
    it('ally-side selection ignores statusOf (no stealth/forced targeting)', () => {
        const allyTarget: ParsedTarget = { raw: 'ally', side: 'ally', selection: 'self' };
        const so = statusFrom({ front: { taunting: true } });
        expect(resolvePositionalTarget('M4', allyTarget, enemies, so)).toBeNull();
    });
    it('statusOf supplied but opposing list empty → null (statusOf not consulted)', () => {
        const so = statusFrom({ x: { taunting: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), [], so)).toBeNull();
    });
});
