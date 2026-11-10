import React, { useState, useMemo, useEffect } from 'react';
import { WishlistEntry } from '../../types/wishlist';
import { GearPiece } from '../../types/gear';
import { Pagination, Checkbox } from '../ui';
import { RARITY_ORDER } from '../../constants/rarities';
import { useShips } from '../../contexts/ShipsContext';
import { matchesWishlistEntry } from '../../utils/wishlist/matchWishlistEntry';
import { GearPieceDisplay } from './GearPieceDisplay';

const ITEMS_PER_PAGE = 12;

interface Props {
    entry: WishlistEntry;
    /** Gear pieces only (no implants). */
    gearInventory: GearPiece[];
}

export const WishlistSearchResults: React.FC<Props> = ({ entry, gearInventory }) => {
    const { gearToShipMap } = useShips();
    const [currentPage, setCurrentPage] = useState(1);
    const [hideMaxLevel, setHideMaxLevel] = useState(false);
    const [hideEquipped, setHideEquipped] = useState(false);

    useEffect(() => {
        setCurrentPage(1);
    }, [entry.id, hideMaxLevel, hideEquipped]);

    const matches = useMemo(
        () =>
            gearInventory
                .filter(
                    (g) =>
                        matchesWishlistEntry(g, entry) &&
                        (!hideMaxLevel || g.level < 16) &&
                        (!hideEquipped || !gearToShipMap.has(g.id))
                )
                .sort(
                    (a, b) =>
                        RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
                        b.stars - a.stars ||
                        b.level - a.level
                ),
        [entry, gearInventory, hideMaxLevel, hideEquipped, gearToShipMap]
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
                        {visibleMatches.map((gear) => (
                            <GearPieceDisplay key={gear.id} gear={gear} mode="compact" />
                        ))}
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
