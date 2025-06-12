import { supabase } from '../../config/supabase-admin';
import { SHIPS } from '../../constants/ships';

export const migrateShipsToSupabase = async () => {
    try {
        // First, create the ship_templates table if it doesn't exist
        const { error: createTableError } = await supabase.rpc('create_ship_templates_table');
        if (createTableError) {
            throw createTableError;
        }

        // Clear existing ship templates
        const { error: deleteError } = await supabase.from('ship_templates').delete().neq('id', '');
        if (deleteError) {
            throw deleteError;
        }

        // Transform and insert the ships data
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }));

        // Insert in batches of 100 to avoid hitting limits
        const batchSize = 100;
        for (let i = 0; i < shipsData.length; i += batchSize) {
            const batch = shipsData.slice(i, i + batchSize);
            const { error: insertError } = await supabase.from('ship_templates').insert(batch);
            if (insertError) {
                throw insertError;
            }
        }

        // eslint-disable-next-line no-console
        console.log(`Successfully migrated ${shipsData.length} ships to Supabase`);
    } catch (error) {
        console.error('Error during migration:', error);
        throw error;
    }
};
