/**
 * #407 part 1 — THE one aliveness gate for the selector-targeting layer.
 *
 * The gate's two conjuncts are load-bearing and must not be collapsed into one. `currentHp <= 0`
 * and `destroyedRound !== undefined` are DIFFERENT questions in this engine: a NEVER-ALIVE actor
 * (max hp 0, never killed) has no `destroyedRound`, and a KILLED one has both. The positional
 * targeting path already refuses to target both shapes (`resolvePositionalTarget`'s `byCell`
 * indexes only `position !== undefined && currentHp > 0` cells); this is the selector layer's
 * equivalent, per owner ruling R2.
 *
 * The BRAND on `AliveRoster` is checked by `tsc --noEmit`, not by anything here — a runtime test
 * cannot observe a compile-time type. See the module's doc comment for why the brand is the
 * instrument and a coverage test is not.
 */
import { describe, it, expect } from 'vitest';
import { isAliveTarget, aliveTargetsOf } from '../targetableActors';
import type { CombatActor } from '../state';

const actor = (
    id: string,
    over: Partial<{ currentHp: number; destroyedRound: number; maxHp: number }> = {}
): CombatActor =>
    ({
        id,
        side: 'enemy',
        kind: 'team',
        currentHp: over.currentHp ?? 100,
        ...(over.destroyedRound !== undefined ? { destroyedRound: over.destroyedRound } : {}),
        stats: { hp: over.maxHp ?? 100 },
    }) as unknown as CombatActor;

describe('isAliveTarget (#407 R1/R2)', () => {
    it('accepts a living actor', () => {
        expect(isAliveTarget(actor('a'))).toBe(true);
    });

    it('rejects a KILLED actor', () => {
        // The measured defect: a corpse that still carries the buff it died holding used to win
        // the 'most buffs' selection, so Rhodium's purge stripped the dead ship.
        expect(isAliveTarget(actor('a', { destroyedRound: 3, currentHp: 0 }))).toBe(false);
    });

    it('rejects a KILLED actor even if its currentHp somehow reads positive', () => {
        // Belt-and-braces on the AND: `destroyedRound` alone is decisive.
        expect(isAliveTarget(actor('a', { destroyedRound: 3, currentHp: 40 }))).toBe(false);
    });

    it('rejects a NEVER-ALIVE actor — 0 hp, no destroyedRound', () => {
        // The shape the positional path already refuses to target: a source of pressure, never a
        // sink. It has no destroyedRound, so a death-only filter would happily select it — and
        // did, 172 times across the suite.
        expect(isAliveTarget(actor('a', { currentHp: 0, maxHp: 0 }))).toBe(false);
    });

    it('rejects negative currentHp', () => {
        expect(isAliveTarget(actor('a', { currentHp: -50 }))).toBe(false);
    });
});

describe('aliveTargetsOf (#407 R1)', () => {
    it('keeps only the alive members, in roster order', () => {
        // Order matters: every selector documents "ties resolve to roster order", and a filter
        // that reordered the living would silently re-roll those tiebreaks.
        const roster = [
            actor('dead', { destroyedRound: 2, currentHp: 0 }),
            actor('alive1'),
            actor('never-alive', { currentHp: 0, maxHp: 0 }),
            actor('alive2'),
        ];
        expect(aliveTargetsOf(roster).map((a) => a.id)).toEqual(['alive1', 'alive2']);
    });

    it('returns an empty roster when nobody is alive', () => {
        expect(aliveTargetsOf([actor('d', { destroyedRound: 1, currentHp: 0 })])).toEqual([]);
    });

    it('returns an empty roster for an empty input', () => {
        expect(aliveTargetsOf([])).toEqual([]);
    });

    it('does not mutate its input', () => {
        const roster = [actor('dead', { destroyedRound: 2, currentHp: 0 }), actor('alive')];
        aliveTargetsOf(roster);
        expect(roster.map((a) => a.id)).toEqual(['dead', 'alive']);
    });
});
