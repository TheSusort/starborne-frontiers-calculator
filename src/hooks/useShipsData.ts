import { useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { Ship } from '../types/ship';
import { AscensionStat, parseAscensionStats } from '../utils/ship/referenceShip';
import { transformShipTemplate, type ShipTemplate } from '../utils/ship/shipTemplate';

// Module-level cache so every consumer of this hook shares a single
// ship_templates fetch per session. Templates rarely change mid-session.
let cachedShips: Ship[] | null = null;
// Keyed by template id. Ascension stats are per-unit reference data, not part of
// any one player's Ship, so they ride alongside rather than on the Ship itself.
let cachedAscensionStats: Map<string, AscensionStat[]> = new Map();
let inflightFetch: Promise<Ship[]> | null = null;

const fetchShipTemplates = async (): Promise<Ship[]> => {
    if (cachedShips) {
        return cachedShips;
    }
    if (!inflightFetch) {
        inflightFetch = (async () => {
            const { data, error: fetchError } = await supabase.from('ship_templates').select('*');

            if (fetchError) {
                inflightFetch = null; // allow a later retry
                throw fetchError;
            }

            const rows = data as ShipTemplate[];
            const ascension = new Map<string, AscensionStat[]>();
            for (const row of rows) {
                const stats = parseAscensionStats(row.ascension_stats);
                if (stats) ascension.set(row.id, stats);
            }
            cachedAscensionStats = ascension;
            cachedShips = rows
                .map(transformShipTemplate)
                .filter((ship): ship is Ship => ship !== null);
            return cachedShips;
        })();
    }
    return inflightFetch;
};

export const useShipsData = () => {
    const [ships, setShips] = useState<Ship[]>(() => cachedShips ?? []);
    const [loading, setLoading] = useState(() => cachedShips === null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        const loadShips = async () => {
            try {
                const result = await fetchShipTemplates();
                if (mounted) {
                    setShips(result);
                }
            } catch (err) {
                if (mounted) {
                    setError(err instanceof Error ? err.message : 'Failed to fetch ships data');
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        void loadShips();

        return () => {
            mounted = false;
        };
    }, []);

    const fetchSingleShip = async (shipName: string): Promise<Ship | null> => {
        if (cachedShips) {
            const found = cachedShips.find((ship) => ship.name === shipName);
            if (found) {
                return found;
            }
        }
        try {
            const { data, error: fetchError } = await supabase
                .from('ship_templates')
                .select('*')
                .eq('name', shipName)
                .single();

            if (fetchError) {
                throw fetchError;
            }

            return transformShipTemplate(data as ShipTemplate);
        } catch (err) {
            console.error('Failed to fetch single ship:', err);
            return null;
        }
    };

    /** The unit's per-refit stat grants, or null when the catalogue has none for it. */
    const getAscensionStats = (templateId: string): AscensionStat[] | null =>
        cachedAscensionStats.get(templateId) ?? null;

    return { ships, loading, error, fetchSingleShip, getAscensionStats };
};
