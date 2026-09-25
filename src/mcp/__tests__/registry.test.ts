// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, registerTools } from '../registry';
import { McpToolError, defineTool, type RegisteredMcpTool } from '../types';
import { ctxOver } from './fixtures';

const probe = (run: () => Promise<unknown>): RegisteredMcpTool =>
    defineTool({
        name: 'probe',
        description: 'test tool',
        input: z.object({ n: z.number().int().max(5).default(1) }),
        run: async () => run(),
    });

/** Registers `tools` on a fresh server and returns a connected in-memory client. */
const connect = async (tools: readonly RegisteredMcpTool[]) => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTools(server, ctxOver({}).ctx, tools);
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientSide);
    return client;
};

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { type: string; text: string }[])[0].text;

describe('registerTools', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers every tool, all marked read-only', async () => {
        const client = await connect(TOOLS);

        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name).sort()).toEqual([
            'get_ship',
            'get_ship_skills',
            'list_gear_sets',
            'list_implants',
            'search_ships',
        ]);
        expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    });

    it('returns a tool result as JSON text', async () => {
        const client = await connect([probe(async () => ({ ok: 1 }))]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(textOf(result))).toEqual({ ok: 1 });
    });

    it('answers invalid arguments with isError and the validation message', async () => {
        const client = await connect([probe(async () => ({ ok: 1 }))]);

        const result = await client.callTool({ name: 'probe', arguments: { n: 9 } });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('Input validation error');
    });

    it('passes an McpToolError message through', async () => {
        const client = await connect([
            probe(async () => {
                throw new McpToolError('not one of your profiles');
            }),
        ]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('not one of your profiles');
    });

    it('maps the read-only hook error to "this tool cannot change your data"', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = await connect([
            probe(async () => {
                throw Object.assign(new Error('OAuth client tokens are read-only'), {
                    code: 'PT403',
                });
            }),
        ]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('this tool cannot change your data');
    });

    it('reduces any other Supabase error to its code, with no message or SQL', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = await connect([
            probe(async () => {
                throw Object.assign(new Error('relation "secret_table" does not exist'), {
                    code: '42P01',
                });
            }),
        ]);

        const result = await client.callTool({ name: 'probe', arguments: {} });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('The planner database request failed (42P01).');
    });
});
