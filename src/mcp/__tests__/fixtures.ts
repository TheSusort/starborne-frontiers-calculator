import type { McpToolContext, McpTool } from '../types';
import { stubDb } from '../../__tests__/services/stubDb';

export const AUTH_USER = '11111111-1111-4111-8111-111111111111';
export const ALT_PROFILE = '22222222-2222-4222-8222-222222222222';
export const STRANGER = '33333333-3333-4333-8333-333333333333';

/** A context over `tables`, reading as `AUTH_USER`. */
export const ctxOver = (tables: Record<string, Record<string, unknown>[]>, options = {}) => {
    const { db, calls } = stubDb(tables, options);
    const ctx: McpToolContext = { db, authUserId: AUTH_USER };
    return { ctx, calls };
};

/** Runs `tool` the way the SDK does: parse the raw arguments with its `input`, then `run`. */
export const call = <I>(tool: McpTool<I>, raw: unknown, ctx: McpToolContext) =>
    tool.run(tool.input.parse(raw), ctx);
