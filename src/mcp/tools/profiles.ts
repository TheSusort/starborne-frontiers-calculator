import { z } from 'zod';
import type { McpTool, McpToolContext } from '../types';

export interface McpProfile {
    id: string;
    username: string | null;
    in_game_id: string | null;
    is_main: boolean;
}

interface ProfileRow {
    id: string;
    username: string | null;
    in_game_id: string | null;
}

/** The caller's main account and its alts — the same predicate as `altAccountService`'s
 *  profile list. Main account first. */
export async function fetchProfiles({ db, authUserId }: McpToolContext): Promise<McpProfile[]> {
    const { data, error } = await db
        .from('users')
        .select('id, username, in_game_id')
        .or(`id.eq.${authUserId},owner_auth_user_id.eq.${authUserId}`);
    if (error) throw error;
    return (data as ProfileRow[])
        .map((row) => ({
            id: row.id,
            username: row.username,
            in_game_id: row.in_game_id,
            is_main: row.id === authUserId,
        }))
        .sort((a, b) => Number(b.is_main) - Number(a.is_main));
}

const listProfilesInput = z.object({});

export const listProfiles: McpTool<z.output<typeof listProfilesInput>> = {
    name: 'list_profiles',
    description:
        'Your planner profiles: your main account and any alt accounts. Pass an id to get_my_fleet as profile_id.',
    input: listProfilesInput,
    run: async (_input, ctx) => ({ profiles: await fetchProfiles(ctx) }),
};
