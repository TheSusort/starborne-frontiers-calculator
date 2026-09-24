import { useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { Ship, AffinityName } from '../types/ship';
import { AscensionStat, parseAscensionStats } from '../utils/ship/referenceShip';
import { isShipTypeName } from '../constants/shipTypes';

interface ShipTemplate {
    id: string;
    name: string;
    rarity: string;
    faction: string;
    type: string;
    affinity: string;
    image_key: string;
    active_skill_text?: string;
    charge_skill_text?: string;
    charge_skill_charge?: number;
    first_passive_skill_text?: string;
    second_passive_skill_text?: string;
    third_passive_skill_text?: string;
    active_target?: string | null;
    active_pattern?: string | null;
    charged_target?: string | null;
    charged_pattern?: string | null;
    bio?: string;
    quote?: string;
    quote_author?: string;
    ascension_stats?: unknown;
    base_stats: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit_rate: number;
        crit_damage: number;
        speed: number;
        shield: number;
        shield_penetration: number;
        defense_penetration: number;
    };
}

// `ship_templates` is a Supabase system table (`CLAUDE.md`) — a row's `type` crosses that trust
// boundary, so a row whose value fell out of the `ShipTypeName` union is dropped rather than
// carried into a `Ship` with a role the rest of the app can't classify.
const transformShipTemplate = (template: ShipTemplate): Ship | null => {
    if (!isShipTypeName(template.type)) return null;

    return {
        id: template.id,
        name: template.name,
        rarity: template.rarity.toLowerCase(),
        faction: template.faction,
        type: template.type,
        baseStats: {
            hp: template.base_stats.hp,
            attack: template.base_stats.attack,
            defence: template.base_stats.defence,
            hacking: template.base_stats.hacking,
            security: template.base_stats.security,
            crit: template.base_stats.crit_rate,
            critDamage: template.base_stats.crit_damage,
            speed: template.base_stats.speed,
            healModifier: 0,
            hpRegen: 0,
            shield: template.base_stats.shield,
            shieldPenetration: template.base_stats.shield_penetration,
            defensePenetration: template.base_stats.defense_penetration,
        },
        equipment: {},
        refits: [],
        implants: {},
        affinity: template.affinity.toLowerCase() as AffinityName,
        imageKey: template.image_key,
        activeSkillText: template.active_skill_text,
        chargeSkillText: template.charge_skill_text,
        chargeSkillCharge: template.charge_skill_charge,
        firstPassiveSkillText: template.first_passive_skill_text,
        secondPassiveSkillText: template.second_passive_skill_text,
        thirdPassiveSkillText: template.third_passive_skill_text,
        activeTarget: template.active_target ?? undefined,
        activePattern: template.active_pattern ?? undefined,
        chargedTarget: template.charged_target ?? undefined,
        chargedPattern: template.charged_pattern ?? undefined,
        bio: template.bio,
        quote: template.quote,
        quoteAuthor: template.quote_author,
    };
};

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
