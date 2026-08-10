/**
 * Recipient resolution for a direct enemy-debuff clause (multi-hit full-walk epic, PR8 Task 1).
 *
 * Extracted VERBATIM from playerTurn.ts's cast-time ternary so the cast-time path and PR8's
 * per-sub-attack path cannot drift. Every branch below mirrors one arm of that ternary; the
 * `undefined` recipient is the DPS/non-positional dummy sink ("resolve to the turn's `enemy`"),
 * which is why the return type is `(string | undefined)[]` and not `string[]`.
 */
import { describe, it, expect } from 'vitest';
import { resolveDebuffRecipientIds } from '../debuffRecipients';

const adjacentOf = (anchorId: string): string[] => [`${anchorId}-left`, `${anchorId}-right`];

describe('resolveDebuffRecipientIds', () => {
    it('adjacent-enemies fans over the anchor’s neighbours and excludes the anchor', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'adjacent-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual(['v1-left', 'v1-right']);
    });

    it('adjacent-enemies with no anchor resolves to nothing', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'adjacent-enemies',
                anchorId: undefined,
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual([]);
    });

    it('target-and-adjacent-enemies puts the anchor FIRST, then its neighbours', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'target-and-adjacent-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual(['v1', 'v1-left', 'v1-right']);
    });

    it('target-and-adjacent-enemies with no anchor: positional resolves to nothing, non-positional to the dummy sink', () => {
        const base = {
            abTarget: 'target-and-adjacent-enemies' as const,
            anchorId: undefined,
            aoeVictimIds: undefined,
            adjacentEnemyIdsFor: adjacentOf,
        };
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: true })).toEqual([]);
        expect(resolveDebuffRecipientIds({ ...base, positionalLanding: false })).toEqual([
            undefined,
        ]);
    });

    it('all-enemies positional uses the supplied footprint, even when empty', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: ['v1', 'v2'],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual(['v1', 'v2']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual([]);
    });

    it('all-enemies non-positional uses the footprint only when non-empty, else falls back to the anchor', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: ['v2', 'v3'],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: false,
            })
        ).toEqual(['v2', 'v3']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'all-enemies',
                anchorId: 'v1',
                aoeVictimIds: [],
                adjacentEnemyIdsFor: undefined,
                positionalLanding: false,
            })
        ).toEqual(['v1']);
    });

    it('single-target resolves to the anchor; with no anchor, positional is empty and non-positional is the dummy sink', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual(['v1']);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: undefined,
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual([]);
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'enemy',
                anchorId: undefined,
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: false,
            })
        ).toEqual([undefined]);
    });

    it('an undefined abTarget (no matching ability found) behaves as single-target', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: undefined,
                anchorId: 'v1',
                aoeVictimIds: ['v1', 'v2'],
                adjacentEnemyIdsFor: adjacentOf,
                positionalLanding: true,
            })
        ).toEqual(['v1']);
    });

    it('adjacentEnemyIdsFor absent yields no neighbours (the DPS/non-positional caller supplies none)', () => {
        expect(
            resolveDebuffRecipientIds({
                abTarget: 'target-and-adjacent-enemies',
                anchorId: 'v1',
                aoeVictimIds: undefined,
                adjacentEnemyIdsFor: undefined,
                positionalLanding: true,
            })
        ).toEqual(['v1']);
    });
});
