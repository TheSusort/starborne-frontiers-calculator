// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { config } from '../../../netlify/functions/mcp';
import { stubDb, type StubDbError } from '../../__tests__/services/stubDb';
import { ADMIN_ONLY_MESSAGE, MCP_PATH, PROTECTED_RESOURCE_PATHS, createMcpHandler } from '../http';
import { AUTH_USER } from './fixtures';
import { ISSUER, makeSigner } from './testTokens';

const SUPABASE_URL = 'https://project.supabase.co';
const ORIGIN = 'https://starborneplanner.com';
const METADATA_HEADER = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;

let signer: Awaited<ReturnType<typeof makeSigner>>;

beforeAll(async () => {
    signer = await makeSigner();
    expect(ISSUER).toBe(`${SUPABASE_URL}/auth/v1`);
});

/** A handler whose database holds one `users` row for `AUTH_USER`. */
const handlerFor = ({
    isAdmin = true,
    usersError,
}: { isAdmin?: boolean; usersError?: StubDbError } = {}) => {
    const createDb = vi.fn(
        () =>
            stubDb(
                { users: [{ id: AUTH_USER, is_admin: isAdmin }] },
                usersError ? { errors: { users: usersError } } : {}
            ).db
    );
    const handler = createMcpHandler({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: 'anon',
        jwks: signer.jwks,
        createDb,
    });
    return { handler, createDb };
};

const rpc = (body: unknown, token?: string) =>
    new Request(`${ORIGIN}${MCP_PATH}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(token && { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(body),
    });

const oauthToken = () => signer.sign({ client_id: 'client-1' }, { sub: AUTH_USER });

describe('protected-resource metadata', () => {
    it.each(PROTECTED_RESOURCE_PATHS)('serves %s pointing at Supabase Auth', async (path) => {
        const { handler } = handlerFor();

        const response = await handler(new Request(`${ORIGIN}${path}`));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            resource: `${ORIGIN}/mcp`,
            authorization_servers: [`${SUPABASE_URL}/auth/v1`],
            bearer_methods_supported: ['header'],
        });
    });
});

describe('POST /mcp', () => {
    it('answers a missing token with 401 and the metadata pointer', async () => {
        const { handler } = handlerFor();

        const response = await handler(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(METADATA_HEADER);
    });

    it('answers a bad token with 401', async () => {
        const { handler } = handlerFor();

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'nope')
        );

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(METADATA_HEADER);
    });

    it('answers a website session token (no client_id) with 401', async () => {
        const { handler, createDb } = handlerFor();
        const session = await signer.sign({}, { sub: AUTH_USER });

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, session)
        );

        expect(response.status).toBe(401);
        expect(createDb).not.toHaveBeenCalled();
    });

    it('answers a non-admin with 403 and a JSON-RPC error for the same id', async () => {
        const { handler } = handlerFor({ isAdmin: false });

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, await oauthToken())
        );

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            jsonrpc: '2.0',
            id: 7,
            error: { code: -32001, message: ADMIN_ONLY_MESSAGE },
        });
    });

    it('answers a failed admin check with 503', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { handler } = handlerFor({ usersError: { message: 'down' } });

        const response = await handler(
            rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, await oauthToken())
        );

        expect(response.status).toBe(503);
    });

    it("runs an admin's call with a client built from their token", async () => {
        const { handler, createDb } = handlerFor();
        const token = await oauthToken();

        const response = await handler(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, token));

        expect(response.status).toBe(200);
        const body = (await response.json()) as { result: { tools: { name: string }[] } };
        expect(body.result.tools.map((tool) => tool.name)).toContain('get_my_fleet');
        expect(createDb).toHaveBeenCalledWith(token);
    });

    it('serves consecutive calls, each on its own transport', async () => {
        const { handler } = handlerFor();
        const token = await oauthToken();

        const first = await handler(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, token));
        const second = await handler(
            rpc(
                {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/call',
                    params: { name: 'list_gear_sets', arguments: {} },
                },
                token
            )
        );

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        const body = (await second.json()) as { result: { isError?: boolean } };
        expect(body.result.isError).toBeFalsy();
    });
});

describe('other methods on /mcp', () => {
    it.each(['GET', 'DELETE'])('answers %s with 405', async (method) => {
        const { handler } = handlerFor();

        const response = await handler(new Request(`${ORIGIN}${MCP_PATH}`, { method }));

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
    });
});

describe('the Netlify adapter', () => {
    it('routes exactly the paths the handler serves', () => {
        expect(config.path).toEqual([MCP_PATH, ...PROTECTED_RESOURCE_PATHS]);
    });
});
