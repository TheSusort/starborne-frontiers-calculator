import React, { useState, useMemo, useEffect } from 'react';
import { WishlistEntry } from '../../types/wishlist';
import { GearPiece } from '../../types/gear';
import { Pagination, Checkbox } from '../ui';
import { RARITY_ORDER } from '../../constants/rarities';
import { useShips } from '../../contexts/ShipsContext';
import type { WishlistScoreResult } from '../../utils/wishlist/scoreWishlistMatches';
import { compareByUpgradeValue } from '../../utils/wishlist/wishlistScoreDisplay';
import { GearPieceDisplay } from './GearPieceDisplay';
import { WishlistScoreBadge } from './WishlistScoreBadge';

const ITEMS_PER_PAGE = 12;

interface Props {
    entry: WishlistEntry;
    /** Every gear piece the entry matches. */
    matches: GearPiece[];
    /** Absent while an entry with a target is still being scored, and for untargeted entries. */
    scoreResult?: WishlistScoreResult;
    scoring?: boolean;
}

export const WishlistSearchResults: React.FC<Props> = ({
    entry,
    matches: allMatches,
    scoreResult,
    scoring = false,
}) => {
    const { gearToShipMap } = useShips();
    const [currentPage, setCurrentPage] = useState(1);
    const [hideMaxLevel, setHideMaxLevel] = useState(false);
    const [hideEquipped, setHideEquipped] = useState(false);

    useEffect(() => {
        setCurrentPage(1);
    }, [entry.id, hideMaxLevel, hideEquipped]);

    const scoreById = useMemo(
        () => new Map((scoreResult?.scores ?? []).map((score) => [score.pieceId, score])),
        [scoreResult]
    );

    // Scored matches lead, best first; the rest keep the rarity / stars / level order.
    const matches = useMemo(
        () =>
            allMatches
                .filter(
                    (g) =>
                        (!hideMaxLevel || g.level < 16) &&
                        (!hideEquipped || !gearToShipMap.has(g.id))
                )
                .sort(
                    (a, b) =>
                        compareByUpgradeValue(scoreById.get(a.id), scoreById.get(b.id)) ||
                        RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
                        b.stars - a.stars ||
                        b.level - a.level
                ),
        [allMatches, hideMaxLevel, hideEquipped, gearToShipMap, scoreById]
    );

    const totalPages = Math.ceil(matches.length / ITEMS_PER_PAGE);
    const visibleMatches = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return matches.slice(start, start + ITEMS_PER_PAGE);
    }, [matches, currentPage]);

    return (
        <div>
            <div className="flex flex-wrap gap-x-6">
                <Checkbox
                    label="Hide max levelled (Lv.16)"
                    checked={hideMaxLevel}
                    onChange={setHideMaxLevel}
                    className="mb-4"
                />
                <Checkbox
                    label="Hide equipped"
                    checked={hideEquipped}
                    onChange={setHideEquipped}
                    className="mb-4"
                />
            </div>
            {matches.length === 0 ? (
                <p className="text-theme-text-secondary text-sm mt-4">
                    No gear in your inventory matches this entry yet.
                </p>
            ) : (
                <>
                    <p className="text-sm text-theme-text-secondary mt-4">
                        {matches.length} match{matches.length !== 1 ? 'es' : ''}
                    </p>
                    {scoring && (
                        <p className="text-xs text-theme-text-secondary mt-1">
                            Scoring upgrade value...
                        </p>
                    )}
                    {scoreResult && scoreResult.status !== 'scored' && (
                        <p className="text-xs text-theme-text-secondary mt-1">
                            {scoreResult.status === 'ship-missing'
                                ? 'The target ship is no longer in your fleet, so these matches are not scored.'
                                : 'The target role is not recognised, so these matches are not scored.'}
                        </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                        {visibleMatches.map((gear) => {
                            const score = scoreById.get(gear.id);
                            return (
                                <div
                                    key={gear.id}
                                    className={`space-y-2 ${score && !score.isUpgrade ? 'opacity-50' : ''}`}
                                >
                                    {score && <WishlistScoreBadge score={score} />}
                                    <GearPieceDisplay gear={gear} mode="compact" />
                                </div>
                            );
                        })}
                    </div>
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                    />
                </>
            )}
        </div>
    );
};
