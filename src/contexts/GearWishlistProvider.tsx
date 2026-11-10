import React, { createContext, useContext } from 'react';
import { useGearWishlist } from '../hooks/useGearWishlist';
import { WishlistEntry } from '../types/wishlist';

interface GearWishlistContextType {
    entries: WishlistEntry[];
    loading: boolean;
    addEntry: (entry: Omit<WishlistEntry, 'id'>) => Promise<void>;
    /** Adds `entries` and removes `replaceIds` in one write. */
    addEntries: (entries: Omit<WishlistEntry, 'id'>[], replaceIds?: string[]) => Promise<void>;
    updateEntry: (entry: WishlistEntry) => Promise<void>;
    deleteEntry: (id: string) => Promise<void>;
    /** Moves an entry one place up (-1) or down (1) within its group. */
    moveEntry: (id: string, offset: -1 | 1) => Promise<void>;
    /** Moves a named group's block one group up (-1) or down (1). */
    moveGroup: (group: string, offset: -1 | 1) => Promise<void>;
}

const GearWishlistContext = createContext<GearWishlistContextType | null>(null);

export const GearWishlistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const wishlist = useGearWishlist();
    return <GearWishlistContext.Provider value={wishlist}>{children}</GearWishlistContext.Provider>;
};

export const useGearWishlistContext = (): GearWishlistContextType => {
    const ctx = useContext(GearWishlistContext);
    if (!ctx) throw new Error('useGearWishlistContext must be used within GearWishlistProvider');
    return ctx;
};
