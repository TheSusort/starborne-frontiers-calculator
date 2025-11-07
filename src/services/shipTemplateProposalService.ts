import { supabase } from '../config/supabase';
import { ShipTemplateProposal } from '../utils/shipTemplateComparison';

export interface TemplateProposalRecord {
    id: string;
    ship_name: string;
    ship_id: string;
    proposed_stats: Record<string, number>;
    current_stats?: Record<string, number>;
    stat_differences: Array<{
        stat: string;
        currentValue: number | undefined;
        proposedValue: number;
        difference: number;
    }>;
    proposal_count: number;
    created_at: string;
    updated_at: string;
    status: 'pending' | 'approved' | 'rejected';
}

/**
 * Submits a ship template proposal to Supabase
 * Uses upsert to increment count if same proposal exists
 */
export const submitTemplateProposal = async (
    proposal: ShipTemplateProposal,
    userId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        // Check if identical proposal exists
        const { data: existingProposals, error: fetchError } = await supabase
            .from('ship_template_proposals')
            .select('id, proposal_count')
            .eq('ship_name', proposal.shipName)
            .eq('ship_id', proposal.shipId)
            .eq('status', 'pending')
            .limit(1);

        if (fetchError) {
            throw fetchError;
        }

        const existingProposal = existingProposals?.[0];

        if (existingProposal) {
            // Update existing proposal count
            const { error: updateError } = await supabase
                .from('ship_template_proposals')
                .update({
                    proposal_count: existingProposal.proposal_count + 1,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingProposal.id);

            if (updateError) throw updateError;
        } else {
            // Insert new proposal
            const { error: insertError } = await supabase.from('ship_template_proposals').insert({
                ship_name: proposal.shipName,
                ship_id: proposal.shipId,
                proposed_stats: proposal.proposedStats,
                current_stats: proposal.currentStats || null,
                stat_differences: proposal.statDifferences,
                proposed_by_user_id: userId,
                proposal_count: 1,
                status: 'pending',
            });

            if (insertError) throw insertError;
        }

        return { success: true };
    } catch (error) {
        console.error('Error submitting template proposal:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};

/**
 * Gets all pending proposals
 */
export const getPendingProposals = async (): Promise<TemplateProposalRecord[]> => {
    try {
        const { data, error } = await supabase
            .from('ship_template_proposals')
            .select('*')
            .eq('status', 'pending')
            .order('proposal_count', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        return data || [];
    } catch (error) {
        console.error('Error fetching pending proposals:', error);
        return [];
    }
};

/**
 * Approves a template proposal
 */
export const approveProposal = async (
    proposalId: string,
    adminUserId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const { data, error } = await supabase.rpc('approve_ship_template_proposal', {
            proposal_id: proposalId,
            admin_user_id: adminUserId,
        });

        if (error) throw error;

        if (!data) {
            return { success: false, error: 'Proposal not found or already processed' };
        }

        return { success: true };
    } catch (error) {
        console.error('Error approving proposal:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};

/**
 * Rejects a template proposal
 */
export const rejectProposal = async (
    proposalId: string,
    adminUserId: string
): Promise<{ success: boolean; error?: string }> => {
    try {
        const { data, error } = await supabase.rpc('reject_ship_template_proposal', {
            proposal_id: proposalId,
            admin_user_id: adminUserId,
        });

        if (error) throw error;

        if (!data) {
            return { success: false, error: 'Proposal not found or already processed' };
        }

        return { success: true };
    } catch (error) {
        console.error('Error rejecting proposal:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};

export interface NewShipTemplateData {
    name: string;
    affinity: string;
    rarity: string;
    faction: string;
    type: string;
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    critRate: number;
    critDamage: number;
    speed: number;
    hpRegen: number;
    shield: number;
    shieldPenetration: number;
    defensePenetration: number;
    imageKey: string;
    activeSkillText: string;
    chargeSkillText: string;
    firstPassiveSkillText: string;
    secondPassiveSkillText: string;
    thirdPassiveSkillText: string;
    definitionId: string;
}

/**
 * Adds a new ship template to the database
 */
export const addShipTemplate = async (
    templateData: NewShipTemplateData
): Promise<{ success: boolean; error?: string }> => {
    try {
        // Convert faction and type to uppercase with underscores
        // e.g., "Atlas Syndicate" -> "ATLAS_SYNDICATE", "Defender(Security)" -> "DEFENDER_SECURITY"
        const factionUppercase = templateData.faction.toUpperCase().replace(/\s+/g, '_');
        const typeUppercase = templateData.type
            .toUpperCase()
            .replace(/\s+/g, '_')
            .replace(/\(/g, '_')
            .replace(/\)/g, '');

        // Generate a unique ID based on faction_type_rarity pattern
        const id = `${templateData.faction.toLowerCase().replace(/\s+/g, '_')}_${templateData.type.toLowerCase().replace(/\s+/g, '_')}_${templateData.rarity}_${templateData.name.toLowerCase().replace(/\s+/g, '_')}`;

        const { error } = await supabase.from('ship_templates').insert({
            id,
            name: templateData.name,
            rarity: templateData.rarity.toLowerCase(),
            faction: factionUppercase,
            type: typeUppercase,
            affinity: templateData.affinity.toLowerCase(),
            image_key: templateData.imageKey || null,
            active_skill_text: templateData.activeSkillText || null,
            charge_skill_text: templateData.chargeSkillText || null,
            first_passive_skill_text: templateData.firstPassiveSkillText || null,
            second_passive_skill_text: templateData.secondPassiveSkillText || null,
            third_passive_skill_text: templateData.thirdPassiveSkillText || null,
            definition_id: templateData.definitionId || null,
            base_stats: {
                hp: templateData.hp,
                attack: templateData.attack,
                defence: templateData.defence,
                hacking: templateData.hacking,
                security: templateData.security,
                crit_rate: templateData.critRate,
                crit_damage: templateData.critDamage,
                speed: templateData.speed,
                hp_regen: templateData.hpRegen || 0,
                shield: templateData.shield || 0,
                shield_penetration: templateData.shieldPenetration || 0,
                defense_penetration: templateData.defensePenetration || 0,
            },
        });

        if (error) throw error;

        return { success: true };
    } catch (error) {
        console.error('Error adding ship template:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};
