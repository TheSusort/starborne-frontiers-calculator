import React, { useState, useMemo, useEffect } from 'react';
import { WishlistEntry } from '../../types/wishlist';
import { GearPiece } from '../../types/gear';
import { Tabs } from '../ui/layout/Tabs';
import { Pagination, Checkbox } from '../ui';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITY_ORDER } from '../../constants/rarities';
import { matchesWishlistEntry } from '../../utils/wishlist/matchWishlistEntry';
import { GearPieceDisplay } from './GearPieceDisplay';

const ITEMS_PER_PAGE = 12;

const GEAR_SLOT_SET = new Set(Object.keys(GEAR_SLOTS));

interface Props {
    entries: WishlistEntry[];
    inventory: GearPiece[];
}

export const WishlistSearchResults: React.FC<Props> = ({ entries, inventory }) => {
    const [activeTab, setActiveTab] = useState(entries[0]?.id ?? '');
    const [currentPage, setCurrentPage] = useState(1);
    const [hideMaxLevel, setHideMaxLevel] = useState(false);

    useEffect(() => {
        if (entries.length === 0) return;
        if (!entries.some((e) => e.id === activeTab)) {
            setActiveTab(entries[0].id);
        }
    }, [entries, activeTab]);

    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab]);

    const gearOnly = useMemo(() => inventory.filter((p) => GEAR_SLOT_SET.has(p.slot)), [inventory]);

    const tabs = useMemo(() => entries.map((e) => ({ id: e.id, label: e.name })), [entries]);

    const matches = useMemo(() => {
        const entry = entries.find((e) => e.id === activeTab);
        if (!entry) return [];
        return gearOnly
            .filter((g) => matchesWishlistEntry(g, entry) && (!hideMaxLevel || g.level < 16))
            .sort(
                (a, b) =>
                    RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
                    b.stars - a.stars ||
                    b.level - a.level
            );
    }, [entries, activeTab, gearOnly, hideMaxLevel]);

    const totalPages = Math.ceil(matches.length / ITEMS_PER_PAGE);
    const visibleMatches = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return matches.slice(start, start + ITEMS_PER_PAGE);
    }, [matches, currentPage]);

    if (entries.length === 0) return null;

    return (
        <div className="mt-4">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            <Checkbox
                label="Hide max levelled (Lv.16)"
                checked={hideMaxLevel}
                onChange={setHideMaxLevel}
                className="mb-4"
            />
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
