import { supabase } from '../config/supabase';
import { ArenaSeason, ArenaSeasonRule, ArenaSeasonRuleInput } from '../types/arena';

// ─── Public ──────────────────────────────────────────────

export async function getActiveSeason(): Promise<ArenaSeason | null> {
    const { data, error } = await supabase
        .from('arena_seasons')
        .select('*, rules:arena_season_rules(*)')
        .eq('active', true)
        .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
        .maybeSingle();

    if (error) {
        console.error('Failed to fetch active arena season:', error);
        return null;
    }

    return data as ArenaSeason | null;
}

// ─── Admin ───────────────────────────────────────────────

export async function getAllSeasons(): Promise<ArenaSeason[]> {
    const { data, error } = await supabase
        .from('arena_seasons')
        .select('*, rules:arena_season_rules(*)')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Failed to fetch arena seasons:', error);
        return [];
    }

    return (data as ArenaSeason[]) || [];
}

export async function createSeason(name: string): Promise<ArenaSeason | null> {
    const { data, error } = await supabase
        .from('arena_seasons')
        .insert({ name })
        .select('*, rules:arena_season_rules(*)')
        .single();

    if (error) {
        console.error('Failed to create arena season:', error);
        throw new Error(error.message);
    }

    return data as ArenaSeason;
}

export async function updateSeason(id: string, name: string): Promise<void> {
    const { error } = await supabase.from('arena_seasons').update({ name }).eq('id', id);

    if (error) {
        console.error('Failed to update arena season:', error);
        throw new Error(error.message);
    }
}

export async function deleteSeason(id: string): Promise<void> {
    const { error } = await supabase.from('arena_seasons').delete().eq('id', id);

    if (error) {
        console.error('Failed to delete arena season:', error);
        throw new Error(error.message);
    }
}

export async function activateSeason(id: string): Promise<void> {
    const { error } = await supabase.rpc('activate_arena_season', { p_season_id: id });

    if (error) {
        console.error('Failed to activate arena season:', error);
        throw new Error(error.message);
    }
}

export async function deactivateAllSeasons(): Promise<void> {
    const { error } = await supabase.rpc('deactivate_all_arena_seasons');

    if (error) {
        console.error('Failed to deactivate arena seasons:', error);
        throw new Error(error.message);
    }
}

export async function updateSeasonEndDate(id: string, endsAt: string | null): Promise<void> {
    const { error } = await supabase.from('arena_seasons').update({ ends_at: endsAt }).eq('id', id);

    if (error) {
        console.error('Failed to update season end date:', error);
        throw new Error(error.message);
    }
}

export async function createRule(
    seasonId: string,
    rule: ArenaSeasonRuleInput
): Promise<ArenaSeasonRule> {
    const { data, error } = await supabase
        .from('arena_season_rules')
        .insert({
            season_id: seasonId,
            factions: rule.factions,
            rarities: rule.rarities,
            ship_types: rule.ship_types,
            modifiers: rule.modifiers,
        })
        .select()
        .single();

    if (error) {
        console.error('Failed to create arena rule:', error);
        throw new Error(error.message);
    }

    return data as ArenaSeasonRule;
}

export async function updateRule(id: string, rule: ArenaSeasonRuleInput): Promise<void> {
    const { error } = await supabase
        .from('arena_season_rules')
        .update({
            factions: rule.factions,
            rarities: rule.rarities,
            ship_types: rule.ship_types,
            modifiers: rule.modifiers,
        })
        .eq('id', id);

    if (error) {
        console.error('Failed to update arena rule:', error);
        throw new Error(error.message);
    }
}

export async function deleteRule(id: string): Promise<void> {
    const { error } = await supabase.from('arena_season_rules').delete().eq('id', id);

    if (error) {
        console.error('Failed to delete arena rule:', error);
        throw new Error(error.message);
    }
}
