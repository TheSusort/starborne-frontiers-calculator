import {
    doc,
    setDoc,
    getDoc,
    collection,
    writeBatch,
    query,
    getDocs,
    where,
    orderBy,
    limit,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    DocumentReference,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { EncounterNote } from '../types/encounters';
import { TeamLoadout, Loadout } from '../types/loadout';
import { EngineeringStats } from '../types/stats';
import { ChangelogState } from '../types/changelog';

// Constants
const USERS_COLLECTION = process.env.NODE_ENV === 'development' ? 'users_dev' : 'users';
const BATCH_SIZE = 500;
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Types
interface UserMetadata {
    lastSync: Timestamp;
    engineeringStats?: EngineeringStats;
    changelogState?: ChangelogState;
    version: number;
}

interface UserData {
    ships?: Ship[];
    inventory?: GearPiece[];
    encounterNotes?: EncounterNote[];
    loadouts?: Loadout[];
    teamLoadouts?: TeamLoadout[];
    engineeringStats?: EngineeringStats;
    changelogState?: ChangelogState;
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    version: number;
}

// Cache management
const cache = new Map<string, CacheEntry<any>>();
const activeListeners = new Map<string, () => void>();

// Utility functions
const getCacheKey = (userId: string, collection?: string) =>
    `${userId}${collection ? `_${collection}` : ''}`;

const isCacheValid = (entry: CacheEntry<any>) => Date.now() - entry.timestamp < CACHE_EXPIRY;

const cleanObject = <T extends Record<string, any>>(obj: T): Partial<T> =>
    Object.entries(obj)
        .filter(([_, value]) => value !== undefined)
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

// Main storage service
export const firebaseStorage = {
    // Real-time listeners
    subscribeToCollection<T>(
        userId: string,
        collectionName: string,
        callback: (data: T[]) => void
    ): () => void {
        const cacheKey = getCacheKey(userId, collectionName);

        // Clean up existing listener
        if (activeListeners.has(cacheKey)) {
            activeListeners.get(cacheKey)?.();
            activeListeners.delete(cacheKey);
        }

        const collectionRef = collection(db, USERS_COLLECTION, userId, collectionName);
        const unsubscribe = onSnapshot(collectionRef, (snapshot) => {
            const items = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as T[];

            // Update cache
            cache.set(cacheKey, {
                data: items,
                timestamp: Date.now(),
                version: Date.now(),
            });

            callback(items);
        });

        activeListeners.set(cacheKey, unsubscribe);
        return unsubscribe;
    },

    // Metadata operations
    async getUserMetadata(userId: string): Promise<UserMetadata | null> {
        const docRef = doc(db, USERS_COLLECTION, userId);
        const snapshot = await getDoc(docRef);
        return snapshot.exists() ? (snapshot.data() as UserMetadata) : null;
    },

    async updateUserMetadata(userId: string, data: Partial<UserMetadata>): Promise<void> {
        const docRef = doc(db, USERS_COLLECTION, userId);
        const cleanData = cleanObject(data);
        if (Object.keys(cleanData).length > 0) {
            await setDoc(
                docRef,
                {
                    ...cleanData,
                    lastSync: serverTimestamp(),
                },
                { merge: true }
            );
        }
    },

    // Collection operations
    async saveItems<T extends { id: string }>(
        userId: string,
        collectionName: string,
        items: T[],
        options: { merge?: boolean; batch?: boolean } = {}
    ): Promise<void> {
        const { merge = true, batch = true } = options;

        if (!items.length) return;

        if (batch && items.length > 1) {
            // Handle batched writes
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = writeBatch(db);
                const chunk = items.slice(i, i + BATCH_SIZE);

                chunk.forEach((item) => {
                    const docRef = doc(db, USERS_COLLECTION, userId, collectionName, item.id);
                    batch.set(
                        docRef,
                        {
                            ...cleanObject(item),
                            updatedAt: serverTimestamp(),
                        },
                        { merge }
                    );
                });

                await batch.commit();
            }
        } else {
            // Handle single writes
            const promises = items.map((item) => {
                const docRef = doc(db, USERS_COLLECTION, userId, collectionName, item.id);
                return setDoc(
                    docRef,
                    {
                        ...cleanObject(item),
                        updatedAt: serverTimestamp(),
                    },
                    { merge }
                );
            });

            await Promise.all(promises);
        }

        // Update cache
        const cacheKey = getCacheKey(userId, collectionName);
        const cached = cache.get(cacheKey)?.data || [];
        const newCache = merge
            ? [...cached.filter((c) => !items.find((i) => i.id === (c as any).id)), ...items]
            : items;

        cache.set(cacheKey, {
            data: newCache,
            timestamp: Date.now(),
            version: Date.now(),
        });
    },

    async getItems<T>(
        userId: string,
        collectionName: string,
        options: {
            force?: boolean;
            where?: [string, any, any][];
            orderBy?: [string, 'asc' | 'desc'][];
            limit?: number;
        } = {}
    ): Promise<T[]> {
        const cacheKey = getCacheKey(userId, collectionName);
        const cached = cache.get(cacheKey);

        if (!options.force && cached && isCacheValid(cached)) {
            return cached.data;
        }

        let q = query(collection(db, USERS_COLLECTION, userId, collectionName));

        if (options.where) {
            options.where.forEach(([field, op, value]) => {
                q = query(q, where(field, op, value));
            });
        }

        if (options.orderBy) {
            options.orderBy.forEach(([field, direction]) => {
                q = query(q, orderBy(field, direction));
            });
        }

        if (options.limit) {
            q = query(q, limit(options.limit));
        }

        const snapshot = await getDocs(q);
        const items = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as T[];

        cache.set(cacheKey, {
            data: items,
            timestamp: Date.now(),
            version: Date.now(),
        });

        return items;
    },

    async deleteItems(userId: string, collectionName: string, itemIds: string[]): Promise<void> {
        if (!itemIds.length) return;

        const batch = writeBatch(db);
        itemIds.forEach((id) => {
            const docRef = doc(db, USERS_COLLECTION, userId, collectionName, id);
            batch.delete(docRef);
        });

        await batch.commit();

        // Update cache
        const cacheKey = getCacheKey(userId, collectionName);
        const cached = cache.get(cacheKey);
        if (cached) {
            cache.set(cacheKey, {
                data: cached.data.filter((item: any) => !itemIds.includes(item.id)),
                timestamp: Date.now(),
                version: Date.now(),
            });
        }
    },

    // Cleanup
    clearCache(): void {
        cache.clear();
    },

    unsubscribeAll(): void {
        activeListeners.forEach((unsubscribe) => unsubscribe());
        activeListeners.clear();
    },
};
