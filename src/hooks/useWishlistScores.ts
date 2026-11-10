import { useEffect, useMemo, useRef, useState } from 'react';
import type { GearPiece } from '../types/gear';
import type { EngineeringStat } from '../types/stats';
import type { WishlistEntry } from '../types/wishlist';
import type { ShipTypeName } from '../constants/shipTypes';
import { isGearSlotName } from '../constants/gearTypes';
import { useShips } from '../contexts/ShipsContext';
import { useInventory } from '../contexts/InventoryProvider';
import {
    scoreWishlistMatches,
    type WishlistScoreResult,
} from '../utils/wishlist/scoreWishlistMatches';
import { useEngineeringStats } from './useEngineeringStats';

export interface WishlistScoreRequest {
    entry: WishlistEntry;
    /** Every piece the entry matches. Memoise the array: its identity gates a rescore. */
    matches: GearPiece[];
}

interface CacheItem {
    entry: WishlistEntry;
    matches: GearPiece[];
    ships: unknown;
    inventory: unknown;
    engineering: unknown;
    result: WishlistScoreResult;
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function sameMatches(a: GearPiece[], b: GearPiece[]): boolean {
    return a.length === b.length && a.every((piece, i) => piece === b[i]);
}

/**
 * Scores each targeted request with `scoreWishlistMatches`, yielding to the event loop between
 * slots. A result is reused until its entry, its matches, the ships, the inventory or the
 * engineering stats change. Untargeted requests have no result.
 */
export function useWishlistScores(requests: WishlistScoreRequest[]): {
    results: Map<string, WishlistScoreResult>;
    scoring: boolean;
} {
    const { ships } = useShips();
    const { inventory } = useInventory();
    const { engineeringStats } = useEngineeringStats();
    const [results, setResults] = useState<Map<string, WishlistScoreResult>>(new Map());
    const [scoring, setScoring] = useState(false);
    const cache = useRef(new Map<string, CacheItem>());

    const getGearPiece = useMemo(() => {
        const byId = new Map(inventory.map((piece) => [piece.id, piece]));
        return (id: string) => byId.get(id);
    }, [inventory]);
    const gearInventory = useMemo(
        () => inventory.filter((piece) => isGearSlotName(piece.slot)),
        [inventory]
    );
    const getEngineeringStatsForShipType = useMemo(
        () =>
            (shipType: ShipTypeName): EngineeringStat | undefined =>
                engineeringStats.stats.find((stat) => stat.shipType === shipType),
        [engineeringStats]
    );

    useEffect(() => {
        let cancelled = false;
        const fresh = new Map<string, WishlistScoreResult>();
        const todo: WishlistScoreRequest[] = [];
        const live = new Set<string>();

        for (const request of requests) {
            const { entry, matches } = request;
            if (!entry.target) continue;
            live.add(entry.id);
            const cached = cache.current.get(entry.id);
            if (
                cached &&
                cached.entry === entry &&
                cached.ships === ships &&
                cached.inventory === inventory &&
                cached.engineering === engineeringStats &&
                sameMatches(cached.matches, matches)
            ) {
                fresh.set(entry.id, cached.result);
            } else {
                todo.push(request);
            }
        }
        for (const id of [...cache.current.keys()]) if (!live.has(id)) cache.current.delete(id);

        setResults(new Map(fresh));
        if (todo.length === 0) {
            setScoring(false);
            return;
        }

        setScoring(true);
        void (async () => {
            try {
                for (const { entry, matches } of todo) {
                    let result: WishlistScoreResult;
                    try {
                        result = await scoreWishlistMatches({
                            entry,
                            matches,
                            gearInventory,
                            ships,
                            getGearPiece,
                            getEngineeringStatsForShipType,
                            yieldToEventLoop,
                            shouldAbort: () => cancelled,
                        });
                    } catch (error) {
                        console.error(`Wishlist scoring failed for entry ${entry.id}:`, error);
                        continue;
                    }
                    if (cancelled) return;
                    cache.current.set(entry.id, {
                        entry,
                        matches,
                        ships,
                        inventory,
                        engineering: engineeringStats,
                        result,
                    });
                    fresh.set(entry.id, result);
                    setResults(new Map(fresh));
                }
            } finally {
                if (!cancelled) setScoring(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        requests,
        ships,
        inventory,
        engineeringStats,
        gearInventory,
        getGearPiece,
        getEngineeringStatsForShipType,
    ]);

    return { results, scoring };
}
