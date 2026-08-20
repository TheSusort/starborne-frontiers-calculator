/**
 * SP-4d Task 9 — pins that `countGateCondition` (src/utils/skillTextParser.ts, ~lines 908-966)
 * really does emit `eq`/`lte` comparators on the `enemy-debuff` subject from real skill-text
 * phrasings. The rung's spec parked the enemy-debuff/enemy-dot-count/enemy-shield no-victim gap,
 * arguing "only `eq`/`lte` can be satisfied by a fabricated 0, and no parser path emits that for
 * an enemy subject" — that argument was never checked against the parser and is false: both
 * phrasings below reach `detectGrantConditions` unchanged. This test is what stops that claim
 * being re-argued from scratch without evidence next time.
 *
 * `detectGrantConditions` takes TWO arguments, `(skillText, buffName)`, and returns `[]`
 * immediately if `buffName` is falsy — a single-argument call silently produces a vacuous empty
 * result (this is exactly how one of the spec's own probes went vacuous).
 */
import { describe, it, expect } from 'vitest';
import { detectGrantConditions } from '../../skillTextParser';

describe('enemy-debuff eq/lte reachability (SP-4d Task 9)', () => {
    it('"If the enemy has no debuffs" → enemy-debuff, eq, threshold 0', () => {
        const conditions = detectGrantConditions(
            'This Unit deals 100% damage. If the enemy has no debuffs, this Unit gains ' +
                '<unit-skill>Shield</unit-skill> for 2 turns.',
            'Shield'
        );
        expect(conditions).toContainEqual({
            subject: 'enemy-debuff',
            derivable: true,
            countComparator: 'eq',
            countThreshold: 0,
        });
    });

    it('"If the enemy has 2 or fewer debuffs" → enemy-debuff, lte, threshold 2', () => {
        const conditions = detectGrantConditions(
            'This Unit deals 100% damage. If the enemy has 2 or fewer debuffs, this Unit gains ' +
                '<unit-skill>Barrier</unit-skill> for 1 turn.',
            'Barrier'
        );
        expect(conditions).toContainEqual({
            subject: 'enemy-debuff',
            derivable: true,
            countComparator: 'lte',
            countThreshold: 2,
        });
    });

    it('sanity: calling with ONE argument (no buffName) returns [] — the vacuity trap itself', () => {
        // Documents the trap the spec's own probe fell into: buffName is REQUIRED, and its
        // absence produces a silently-empty result that proves nothing about reachability.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((detectGrantConditions as any)('If the enemy has no debuffs, gain Shield.')).toEqual(
            []
        );
    });
});
