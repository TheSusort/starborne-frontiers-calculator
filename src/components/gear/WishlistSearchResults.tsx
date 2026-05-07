import React, { useState, useMemo } from 'react';
import { WishlistEntry } from '../../types/wishlist';
import { GearPiece } from '../../types/gear';
import { Tabs } from '../ui/layout/Tabs';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { matchesWishlistEntry } from '../../utils/wishlist/matchWishlistEntry';
import { GearPieceDisplay } from './GearPieceDisplay';

const GEAR_SLOT_SET = new Set(Object.keys(GEAR_SLOTS));

interface Props {
    entries: WishlistEntry[];
    inventory: GearPiece[];
}

export const WishlistSearchResults: React.FC<Props> = ({ entries, inventory }) => {
    const [activeTab, setActiveTab] = useState(entries[0]?.id ?? '');

    const gearOnly = useMemo(() => inventory.filter((p) => GEAR_SLOT_SET.has(p.slot)), [inventory]);

    const tabs = entries.map((e) => ({ id: e.id, label: e.name }));

    const matches = useMemo(() => {
        const entry = entries.find((e) => e.id === activeTab);
        if (!entry) return [];
        return gearOnly.filter((g) => matchesWishlistEntry(g, entry));
    }, [entries, activeTab, gearOnly]);

    if (entries.length === 0) return null;

    return (
        <div className="mt-4">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            {matches.length === 0 ? (
                <p className="text-theme-text-secondary text-sm mt-4">
                    No gear in your inventory matches this entry yet.
                </p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                    {matches.map((gear) => (
                        <GearPieceDisplay key={gear.id} gear={gear} mode="compact" />
                    ))}
                </div>
            )}
        </div>
    );
};
