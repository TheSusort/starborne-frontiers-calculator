import React, { createContext, useContext } from 'react';
import { useGearWishlist } from '../hooks/useGearWishlist';
import { WishlistEntry } from '../types/wishlist';

interface GearWishlistContextType {
    entries: WishlistEntry[];
    loading: boolean;
    addEntry: (entry: Omit<WishlistEntry, 'id'>) => Promise<void>;
    updateEntry: (entry: WishlistEntry) => Promise<void>;
    deleteEntry: (id: string) => Promise<void>;
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
