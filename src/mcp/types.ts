import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

/** What every tool runs with: a Supabase client that reads as the caller (their OAuth token, so
 *  RLS applies), and the caller's auth user id. */
export interface McpToolContext {
    db: SupabaseClient;
    authUserId: string;
}

export interface McpTool<I> {
    name: string;
    description: string;
    input: z.ZodType<I>;
    run(input: I, ctx: McpToolContext): Promise<unknown>;
}

/** A tool with its input type erased, so tools of different inputs share one list. */
export interface RegisteredMcpTool {
    name: string;
    description: string;
    input: z.ZodType<unknown>;
    run(input: unknown, ctx: McpToolContext): Promise<unknown>;
}

/** Erases a tool's input type. Sound because the SDK parses a call's arguments with `input`
 *  before `registerTools` hands them to `run`. */
export const defineTool = <I>(tool: McpTool<I>): RegisteredMcpTool => ({
    name: tool.name,
    description: tool.description,
    input: tool.input,
    run: (input, ctx) => tool.run(input as I, ctx),
});

/** A failure whose message is written for the agent and is safe to show it verbatim. */
export class McpToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'McpToolError';
    }
}
