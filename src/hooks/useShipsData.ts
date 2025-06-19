import { useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { Ship } from '../types/ship';
import { RarityName } from '../constants/rarities';
import { FactionName } from '../constants/factions';
import { ShipTypeName } from '../constants/shipTypes';
import { AffinityName } from '../types/ship';

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
    first_passive_skill_text?: string;
    second_passive_skill_text?: string;
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

const transformShipTemplate = (template: ShipTemplate): Ship => ({
    id: template.id,
    name: template.name,
    rarity: template.rarity.toLowerCase() as RarityName,
    faction: template.faction as FactionName,
    type: template.type as ShipTypeName,
    baseStats: {
        hp: template.base_stats.hp,
        attack: template.base_stats.attack,
        defence: template.base_stats.defence,
        hacking: template.base_stats.hacking,
        security: template.base_stats.security,
        crit: template.base_stats.crit_rate,
        critDamage: template.base_stats.crit_damage,
        speed: template.base_stats.speed,
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
    firstPassiveSkillText: template.first_passive_skill_text,
    secondPassiveSkillText: template.second_passive_skill_text,
});

export const useShipsData = () => {
    const [ships, setShips] = useState<Ship[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchShips = async () => {
            try {
                const { data, error: fetchError } = await supabase
                    .from('ship_templates')
                    .select('*');

                if (fetchError) {
                    throw fetchError;
                }

                const transformedShips = data.map(transformShipTemplate);
                setShips(transformedShips);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch ships data');
            } finally {
                setLoading(false);
            }
        };

        fetchShips();
    }, []);

    return { ships, loading, error };
};
