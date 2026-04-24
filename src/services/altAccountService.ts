import { supabase } from '../config/supabase';

export interface ProfileRow {
    id: string;
    username: string | null;
    is_public: boolean;
    owner_auth_user_id: string | null;
    in_game_id: string | null;
    email: string | null;
    is_admin: boolean;
    created_at: string;
    updated_at: string;
}

export const listProfiles = async (authUserId: string): Promise<ProfileRow[]> => {
    const { data, error } = await supabase
        .from('users')
        .select(
            'id, username, is_public, owner_auth_user_id, in_game_id, email, is_admin, created_at, updated_at'
        )
        .or(`id.eq.${authUserId},owner_auth_user_id.eq.${authUserId}`);
    if (error) throw error;
    return (data ?? []) as ProfileRow[];
};

export const createAlt = async (authUserId: string, username: string): Promise<ProfileRow> => {
    const { data, error } = await supabase
        .from('users')
        .insert({
            owner_auth_user_id: authUserId,
            username,
            is_public: false,
        })
        .select()
        .single();
    if (error) throw error;
    return data as ProfileRow;
};

export const renameAlt = async (
    altId: string,
    authUserId: string,
    username: string
): Promise<void> => {
    const { error } = await supabase
        .from('users')
        .update({ username })
        .eq('id', altId)
        .eq('owner_auth_user_id', authUserId);
    if (error) throw error;
};

export const setAltPublic = async (
    altId: string,
    authUserId: string,
    isPublic: boolean
): Promise<void> => {
    const { error } = await supabase
        .from('users')
        .update({ is_public: isPublic })
        .eq('id', altId)
        .eq('owner_auth_user_id', authUserId);
    if (error) throw error;
};

export const deleteAlt = async (altId: string, authUserId: string): Promise<void> => {
    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', altId)
        .eq('owner_auth_user_id', authUserId);
    if (error) throw error;
};
