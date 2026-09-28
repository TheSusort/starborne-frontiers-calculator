import { McpToolError } from './types';

/** The Postgres/PostgREST error code the read-only hook raises for a write by an OAuth token
 *  (`supabase/migrations/20260925000001_oauth_clients_read_only.sql`). */
const READ_ONLY_CODE = 'PT403';

const errorCode = (error: unknown): string | undefined =>
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;

/**
 * The text an agent sees when a tool fails. Only an `McpToolError` passes its own message
 * through; anything else — a Supabase error, a bug — is reduced to a short line with at most its
 * error code, so no stack, SQL or row data reaches the agent.
 */
export const toolErrorMessage = (error: unknown): string => {
    if (error instanceof McpToolError) return error.message;
    const code = errorCode(error);
    if (code === READ_ONLY_CODE) return 'this tool cannot change your data';
    return code ? `The planner database request failed (${code}).` : 'The tool failed.';
};
