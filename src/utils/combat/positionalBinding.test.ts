import { describe, it, expect } from 'vitest';
import type { ParsedTarget } from '../targetingParser';
import {
    isPositional,
    isTargetableRosterMember,
    resolvePositionalTarget,
    resolvesPositionalVictim,
} from './positionalBinding';
import type { ActorTargetingStatus } from './positionalBinding';
import type { CombatActor } from './state';

const actor = (id: string, position: CombatActor['position'], currentHp = 100): CombatActor =>
    ({ id, position, currentHp }) as CombatActor;

/** Same shape as `actor`, but carrying the MAX-hp field the targetability predicate reads. */
const targetable = (
    id: string,
    position: CombatActor['position'],
    maxHp: number,
    currentHp = maxHp
): CombatActor => ({ id, position, currentHp, stats: { hp: maxHp } }) as unknown as CombatActor;

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

    it('IGNORES targetability — a placed 0-max-HP roster still means "positional run"', () => {
        // Load-bearing distinction (SP-4b-1 §4B): the sites that route an actor's OWN state
        // (timed bomb/accumulator bursts, own-HP DoT ticks) gate on THIS predicate. Narrowing it
        // to targetable rosters strands those containers unticked — a bomb applied onto a player
        // by a 0-max-HP pressure source would never burst (barrier.test.ts's bomb case).
        expect(isPositional('M4', [targetable('e1', 'M4', 0)])).toBe(true);
    });
});

describe('isTargetableRosterMember', () => {
    it('false without a position', () => {
        expect(isTargetableRosterMember(targetable('e1', undefined, 5000))).toBe(false);
    });

    it('false at 0 MAX hp — a pressure source is never a damage sink', () => {
        expect(isTargetableRosterMember(targetable('e1', 'M4', 0))).toBe(false);
    });

    it('true for a placed actor with HP to lose', () => {
        expect(isTargetableRosterMember(targetable('e1', 'M4', 5000))).toBe(true);
    });

    it('keyed on MAX hp, so a KILLED actor stays a roster target (the cast whiffs, it does not re-route)', () => {
        expect(isTargetableRosterMember(targetable('e1', 'M4', 5000, 0))).toBe(true);
    });
});

describe('resolvesPositionalVictim', () => {
    it('false when the caster has no position', () => {
        expect(resolvesPositionalVictim(undefined, [targetable('e1', 'M4', 5000)])).toBe(false);
    });

    it('false when the opposing list is empty', () => {
        expect(resolvesPositionalVictim('M4', [])).toBe(false);
    });

    it('false when every placed opposing actor is a 0-max-HP pressure source', () => {
        // The SP-4b-1 §4B case: `isPositional` says true here, so the apply gate used to go
        // positional while `resolvePositionalTarget` found nobody — and the cast's damage was
        // credited to neither the per-victim channel nor the legacy sink.
        expect(resolvesPositionalVictim('M4', [targetable('e1', 'M4', 0)])).toBe(false);
    });

    it('true as soon as ONE placed opposing actor has HP to lose', () => {
        expect(
            resolvesPositionalVictim('M4', [
                targetable('e1', 'M4', 0),
                targetable('e2', 'M3', 5000),
            ])
        ).toBe(true);
    });

    it('stays true once that actor is KILLED — the run remains positional and the cast whiffs', () => {
        expect(resolvesPositionalVictim('M4', [targetable('e1', 'M4', 5000, 0)])).toBe(true);
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

describe('resolvePositionalTarget — Provoke redirect + ignore gating', () => {
    // front=M4 (front-most), back=M1 (back-most)
    // 'front' selection normally hits 'front'; used to prove override when provokedBy='back'.
    const enemies = [actor('front', 'M4'), actor('back', 'M1')];
    const noStatus = statusFrom({});

    it('provoked attacker targets the provoker even when normal selection would pick a different actor', () => {
        // Normal 'front' selection picks 'front'; provokedBy='back' must override to 'back'.
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, noStatus, {
                provokedBy: 'back',
            })?.id
        ).toBe('back');
    });

    it('provoker dead/absent → falls through to normal selectTargets', () => {
        // 'ghost' is not in the opposing list → normal 'front' selection wins.
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, noStatus, {
                provokedBy: 'ghost',
            })?.id
        ).toBe('front');
    });

    it('provoke bypasses stealth (provoker is stealthed, still targeted)', () => {
        const so = statusFrom({ back: { stealthed: true } });
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, so, {
                provokedBy: 'back',
            })?.id
        ).toBe('back');
    });

    it('ignoresForcedTargeting skips Taunt (taunting actor is NOT force-targeted)', () => {
        // 'back' is taunting; without ignore it would be forced; with ignore, 'front' selection wins.
        const so = statusFrom({ back: { taunting: true } });
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, so, {
                ignoresForcedTargeting: true,
            })?.id
        ).toBe('front');
    });

    it('ignoresForcedTargeting skips Provoke (provokedBy set, but normal selection wins)', () => {
        // provokedBy='back' would normally force 'back'; ignore skips it, 'front' selection wins.
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, noStatus, {
                ignoresForcedTargeting: true,
                provokedBy: 'back',
            })?.id
        ).toBe('front');
    });

    it('ignoresForcedTargeting does NOT skip Concentrate Fire (CF actor is still force-targeted)', () => {
        // 'back' has CF; even with ignore, CF is unconditional — must return 'back'.
        const so = statusFrom({ back: { concentrated: true } });
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, so, {
                ignoresForcedTargeting: true,
            })?.id
        ).toBe('back');
    });

    it('Taunt beats Provoke when both apply (Taunt higher priority)', () => {
        // 'front' is taunting (should win), 'back' is the provoker; result must be 'front'.
        const so = statusFrom({ front: { taunting: true } });
        expect(
            resolvePositionalTarget('M4', enemyTarget('back'), enemies, so, {
                provokedBy: 'back',
            })?.id
        ).toBe('front');
    });
});

describe('resolvePositionalTarget — Wave 6 stealth bypass', () => {
    // e-front = M4 (front-most, stealthed), e-back = M1 (back-most, visible).
    // Default 'front' selection would be filtered off the stealthed e-front and land on e-back.
    const enemies = [actor('e-front', 'M4'), actor('e-back', 'M1')];
    const so = statusFrom({ 'e-front': { stealthed: true } });

    it('without bypass: the visible back actor is targeted (stealthed front filtered out)', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('e-back');
    });

    it('acting.ignoresStealth: the stealthed front-most actor is targeted', () => {
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), enemies, so, {
                ignoresStealth: true,
            })?.id
        ).toBe('e-front');
    });

    it('target.ignoresStealth (per-cast): the stealthed front-most actor is targeted', () => {
        const target: ParsedTarget = { ...enemyTarget('front'), ignoresStealth: true };
        expect(resolvePositionalTarget('M4', target, enemies, so, {})?.id).toBe('e-front');
    });
});
