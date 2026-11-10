import { describe, it, expect } from 'vitest';
import { makeShip } from '../gear/fastPotential/__tests__/fixtures';
import {
    compareByUpgradeValue,
    compareHitScores,
    pickBestScore,
    describeBestHit,
    describeMatchScore,
    describeWishlistTarget,
} from './wishlistScoreDisplay';
import type { WishlistMatchScore } from './scoreWishlistMatches';

const ship = (id: string, d: number): WishlistMatchScore => ({
    pieceId: id,
    nowScore: 1,
    potentialScore: 1,
    deltaNowPct: d,
    deltaPotentialPct: d,
    isUpgrade: d > 0,
});
const role = (id: string, rank: number): WishlistMatchScore => ({
    pieceId: id,
    nowScore: 1,
    potentialScore: 10 - rank,
    potentialRank: rank,
    rankPoolSize: 87,
    bestOwnedPotentialScore: 10,
    isUpgrade: rank <= 3,
});

describe('wishlist score display', () => {
    it('sorts ship matches by levelled delta, best first, unscored last', () => {
        const sorted = [undefined, ship('a', 1), ship('b', 5)].sort(compareByUpgradeValue);
        expect(sorted.map((s) => s?.pieceId)).toEqual(['b', 'a', undefined]);
    });

    it('sorts role matches by rank ascending', () => {
        const sorted = [role('a', 3), role('b', 1)].sort(compareByUpgradeValue);
        expect(sorted.map((s) => s.pieceId)).toEqual(['b', 'a']);
    });

    it('formats badges and the best-hit summary', () => {
        expect(describeMatchScore(ship('a', 4.24)).label).toBe('+4.2% levelled');
        expect(describeMatchScore(ship('a', -1.5)).label).toBe('-1.5% levelled');
        expect(describeMatchScore(role('a', 2)).label).toBe('#2 of 87');
        expect(describeBestHit({ status: 'scored', scores: [ship('a', 1), ship('b', 4.24)] })).toBe(
            'Best: +4.2% levelled'
        );
        expect(describeBestHit({ status: 'ship-missing', scores: [] })).toBeUndefined();
    });

    it('describes targets, flagging a missing ship and an unknown role', () => {
        const ships = [makeShip({ id: 's1', name: 'Lionheart' })];
        expect(describeWishlistTarget({ kind: 'ship', shipId: 's1' }, ships).label).toBe(
            'For Lionheart'
        );
        expect(describeWishlistTarget({ kind: 'ship', shipId: 'x' }, ships)).toEqual({
            label: 'Ship no longer in fleet',
            valid: false,
        });
        expect(describeWishlistTarget({ kind: 'role', role: 'ATTACKER' }, ships).label).toBe(
            'Attacker role'
        );
        expect(describeWishlistTarget({ kind: 'role', role: 'NOPE' as never }, ships).valid).toBe(
            false
        );
    });

    it('orders import hits upgrades first, unscored next, non-upgrades last', () => {
        // Wrapped: Array.sort always moves bare undefined elements last.
        const hits = [{ s: ship('down', -2) }, { s: undefined }, { s: ship('up', 3) }];
        const sorted = [...hits].sort((x, y) => compareHitScores(x.s, y.s));
        expect(sorted.map((h) => h.s?.pieceId)).toEqual(['up', undefined, 'down']);
    });

    it('picks an upgrade score over an earlier non-upgrade', () => {
        expect(pickBestScore([ship('down', -2), role('up', 1)])?.pieceId).toBe('up');
        expect(pickBestScore([])).toBeUndefined();
    });
});
