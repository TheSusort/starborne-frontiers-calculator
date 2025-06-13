import { supabase } from '../../config/supabase-admin';
import { SHIPS } from '../../constants/ships';

export const migrateShipsToSupabase = async () => {
    try {
        const shipsData = Object.entries(SHIPS).map(([id, shipData]) => ({
            id,
            name: shipData.name,
            rarity: shipData.rarity,
            faction: shipData.faction,
            type: shipData.role,
            affinity: shipData.affinity,
            image_key: shipData.imageKey,
            active_skill_text: shipData.activeSkillText,
            charge_skill_text: shipData.chargeSkillText,
            first_passive_skill_text: shipData.firstPassiveSkillText,
            second_passive_skill_text: shipData.secondPassiveSkillText,
            base_stats: {
                hp: shipData.hp,
                attack: shipData.attack,
                defence: shipData.defense,
                hacking: shipData.hacking,
                security: shipData.security,
                crit_rate: shipData.critRate,
                crit_damage: shipData.critDamage,
                speed: shipData.speed,
            },
        }));

        // Use upsert instead of delete and insert
        const { error } = await supabase.from('ship_templates').upsert(shipsData, {
            onConflict: 'id',
            ignoreDuplicates: false,
        });

        if (error) {
            throw error;
        }

        // eslint-disable-next-line no-console
        console.log(`Successfully migrated ${shipsData.length} ships to Supabase`);
    } catch (error) {
        console.error('Error during migration:', error);
        throw error;
    }
};
