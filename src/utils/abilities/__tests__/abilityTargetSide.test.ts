import { describe, it, expect } from 'vitest';
import {
    ABILITY_TARGET_SIDE,
    isEnemyTarget,
    ABILITY_TARGET_SELECTOR,
    enemySelectorKind,
    ABILITY_TARGET_ENEMY_SCOPE,
    isAllEnemiesTarget,
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

    // #403 review Finding 1: `ABILITY_TARGET_SELECTOR` is a total `Record<AbilityTarget, …>`, but
    // ability configs are user-persisted and unvalidated on read, so a stale/imported config can
    // carry a `target` string OUTSIDE the union at runtime. Indexing a `Record` with an unknown
    // key returns `undefined`, not `null` — and `undefined !== null`, so without the `?? null`
    // coalesce an out-of-union target would slip past `debuffRecipients.ts`'s
    // `selectorKind !== null` guard and get routed to a selector arm (in practice,
    // `highestSpeedInRoster`, the ternary's last arm) instead of falling through to the safe
    // anchor tail. `tsc` forbids authoring an out-of-union target directly, so cast at the call
    // boundary to simulate the unvalidated-persisted-config input.
    it('an out-of-union target resolves to null, not undefined (unvalidated persisted config)', () => {
        expect(enemySelectorKind('bogus-target' as AbilityTarget)).toBeNull();
    });
});

/**
 * #390 board-coverage axis. Decides whether an enemy-side AURA/ACCUMULATING status registered into
 * the singular '__enemy__' bucket may be folded into every per-victim read. `'all'` folds (every
 * enemy is a recipient by definition, so there is nothing to get wrong); `'subset'` does not (the
 * bucket has no victim id, so folding would smear a one-victim debuff across the whole board).
 */
describe('#390 ABILITY_TARGET_ENEMY_SCOPE — the board-coverage axis', () => {
    it('classifies all-enemies as the ONLY board-wide scope', () => {
        const boardWide = (Object.keys(ABILITY_TARGET_ENEMY_SCOPE) as AbilityTarget[]).filter(
            (t) => ABILITY_TARGET_ENEMY_SCOPE[t] === 'all'
        );
        expect(boardWide).toEqual(['all-enemies']);
    });

    // The self side must answer `null`, not 'subset' — 'subset' would read as "an enemy scope that
    // happens to be narrow", and this axis is only ever asked about enemy-side statuses.
    it('every self-side target is null and every enemy-side target is not', () => {
        for (const target of Object.keys(ABILITY_TARGET_SIDE) as AbilityTarget[]) {
            if (ABILITY_TARGET_SIDE[target] === 'self') {
                expect(ABILITY_TARGET_ENEMY_SCOPE[target]).toBeNull();
            } else {
                expect(ABILITY_TARGET_ENEMY_SCOPE[target]).not.toBeNull();
            }
        }
    });

    it('covers the same key set as the other two axes', () => {
        expect(Object.keys(ABILITY_TARGET_ENEMY_SCOPE).sort()).toEqual(
            Object.keys(ABILITY_TARGET_SIDE).sort()
        );
    });

    // Same unvalidated-persisted-config hazard as `enemySelectorKind`'s `?? null`, with the
    // opposite safe answer: an unrecognised target must be treated as NOT board-wide, so its
    // statuses stay out of the fold rather than being smeared across enemies they never touched.
    it('an out-of-union target is NOT board-wide (unvalidated persisted config)', () => {
        expect(isAllEnemiesTarget('bogus-target' as AbilityTarget)).toBe(false);
    });

    // The discriminator: without this, `isAllEnemiesTarget` returning a constant false would pass
    // every arm above that matters.
    it('isAllEnemiesTarget agrees with the map on both answers', () => {
        expect(isAllEnemiesTarget('all-enemies')).toBe(true);
        expect(isAllEnemiesTarget('enemy')).toBe(false);
        expect(isAllEnemiesTarget('adjacent-enemies')).toBe(false);
        expect(isAllEnemiesTarget('enemy-highest-attack')).toBe(false);
        expect(isAllEnemiesTarget('self')).toBe(false);
    });
});
