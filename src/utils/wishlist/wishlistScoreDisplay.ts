import type { Ship } from '../../types/ship';
import type { WishlistTarget } from '../../types/wishlist';
import { SHIP_TYPES, isShipTypeName } from '../../constants/shipTypes';
import type { WishlistMatchScore, WishlistScoreResult } from './scoreWishlistMatches';

const signed = (pct: number): string => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

/** Chip text for an entry's target: `For Lionheart`, `Attacker role`, or why it cannot be scored. */
export function describeWishlistTarget(
    target: WishlistTarget,
    ships: readonly Ship[]
): { label: string; valid: boolean } {
    if (target.kind === 'ship') {
        const ship = ships.find((s) => s.id === target.shipId);
        return ship
            ? { label: `For ${ship.name}`, valid: true }
            : { label: 'Ship no longer in fleet', valid: false };
    }
    return isShipTypeName(target.role)
        ? { label: `${SHIP_TYPES[target.role].name} role`, valid: true }
        : { label: 'Unknown role', valid: false };
}

/** Badge text for one scored match. */
export function describeMatchScore(score: WishlistMatchScore): { label: string; detail?: string } {
    if (score.potentialRank !== undefined) {
        return {
            label: `#${score.potentialRank} of ${score.rankPoolSize}`,
            detail:
                score.bestOwnedPotentialScore !== undefined
                    ? `Potential ${Math.round(score.potentialScore)} (best owned ${Math.round(score.bestOwnedPotentialScore)})`
                    : undefined,
        };
    }
    return {
        label: `${signed(score.deltaPotentialPct ?? 0)} levelled`,
        detail: `${signed(score.deltaNowPct ?? 0)} now`,
    };
}

/**
 * Orders scored matches best first: a ship target by levelled delta, a role target by rank.
 * `score` is undefined for a piece with no score, which sorts after every scored piece.
 */
export function compareByUpgradeValue(
    a: WishlistMatchScore | undefined,
    b: WishlistMatchScore | undefined
): number {
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    if (a.potentialRank !== undefined && b.potentialRank !== undefined) {
        return a.potentialRank - b.potentialRank || b.potentialScore - a.potentialScore;
    }
    return (b.deltaPotentialPct ?? 0) - (a.deltaPotentialPct ?? 0);
}

/** `Best: +4.2% levelled` or `Best: #2 of 87`; undefined when nothing was scored. */
export function describeBestHit(result: WishlistScoreResult | undefined): string | undefined {
    if (!result || result.status !== 'scored' || result.scores.length === 0) return undefined;
    const best = [...result.scores].sort(compareByUpgradeValue)[0];
    return `Best: ${describeMatchScore(best).label}`;
}

/**
 * A hit that matched several targeted entries shows its strongest score: an upgrade beats a
 * non-upgrade, and between equals the earlier entry wins (scores of different target kinds
 * are not comparable).
 */
export function pickBestScore(
    scores: readonly WishlistMatchScore[]
): WishlistMatchScore | undefined {
    return scores.find((s) => s.isUpgrade) ?? scores[0];
}

const hitTier = (score: WishlistMatchScore | undefined): number =>
    !score ? 1 : score.isUpgrade ? 0 : 2;

/** Orders import hits: upgrades first, then unscored, then non-upgrades. */
export function compareHitScores(
    a: WishlistMatchScore | undefined,
    b: WishlistMatchScore | undefined
): number {
    return hitTier(a) - hitTier(b) || (a && b ? compareByUpgradeValue(a, b) : 0);
}
