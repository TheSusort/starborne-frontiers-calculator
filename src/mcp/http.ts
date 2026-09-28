import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { JWTVerifyGetKey } from 'jose';
import { AuthError, verifyAccessToken } from './auth';
import { registerTools } from './registry';

export const MCP_PATH = '/mcp';
/** RFC 9728 protected-resource metadata, at the root and path-suffixed for `/mcp`. */
export const PROTECTED_RESOURCE_PATHS = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
];

export interface McpHandlerConfig {
    /** The project URL, `https://<ref>.supabase.co`. */
    supabaseUrl: string;
    supabaseAnonKey: string;
    /** The project's token signing keys. */
    jwks: JWTVerifyGetKey;
    /** Builds the client a request reads through. Defaults to a supabase-js client carrying the
     *  caller's token, so every read runs under the caller's RLS. */
    createDb?: (accessToken: string) => SupabaseClient;
}

const callerClient =
    (supabaseUrl: string, supabaseAnonKey: string) =>
    (accessToken: string): SupabaseClient =>
        createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
            auth: { persistSession: false, autoRefreshToken: false },
        });

const bearerToken = (request: Request): string | null => {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    return match ? match[1] : null;
};

/** The JSON-RPC id of the request, so an error answers the call it refuses. */
const requestId = async (request: Request): Promise<string | number | null> => {
    try {
        const body: unknown = await request.json();
        if (body && typeof body === 'object' && 'id' in body) {
            const { id } = body;
            if (typeof id === 'string' || typeof id === 'number') return id;
        }
    } catch {
        // Not JSON: answer with a null id.
    }
    return null;
};

const jsonRpcError = (status: number, id: string | number | null, message: string) =>
    Response.json({ jsonrpc: '2.0', id, error: { code: -32001, message } }, { status });

const methodNotAllowed = (allow: string) =>
    new Response(null, { status: 405, headers: { Allow: allow } });

/**
 * The MCP endpoint as a web-standard `Request → Response` handler.
 *
 * - `GET` on a `PROTECTED_RESOURCE_PATHS` path: the metadata pointing clients at Supabase Auth.
 * - `POST /mcp`: 401 (with `WWW-Authenticate` naming the metadata) unless the bearer token is a
 *   valid OAuth-issued Supabase token; otherwise the call runs on a fresh stateless server and
 *   transport, reading through a client that carries the caller's token. The transport cannot be reused across requests,
 *   and answers a POST whose `Accept` lacks `application/json, text/event-stream` with 406.
 * - Any other method on `/mcp`: 405. The server is stateless, so there is no SSE stream to GET
 *   and no session to DELETE.
 */
export const createMcpHandler = ({
    supabaseUrl,
    supabaseAnonKey,
    jwks,
    createDb = callerClient(supabaseUrl, supabaseAnonKey),
}: McpHandlerConfig) => {
    const issuer = `${supabaseUrl}/auth/v1`;

    return async (request: Request): Promise<Response> => {
        const { origin, pathname } = new URL(request.url);
        const metadataUrl = `${origin}${PROTECTED_RESOURCE_PATHS[0]}`;

        if (PROTECTED_RESOURCE_PATHS.includes(pathname)) {
            if (request.method !== 'GET') return methodNotAllowed('GET');
            return Response.json({
                resource: `${origin}${MCP_PATH}`,
                authorization_servers: [issuer],
                bearer_methods_supported: ['header'],
            });
        }

        if (request.method !== 'POST') return methodNotAllowed('POST');

        const unauthorized = () =>
            Response.json(
                { error: 'unauthorized' },
                {
                    status: 401,
                    headers: {
                        'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
                    },
                }
            );

        const token = bearerToken(request);
        if (!token) return unauthorized();

        let sub: string;
        try {
            ({ sub } = await verifyAccessToken(token, { jwks, issuer }));
        } catch (error) {
            if (error instanceof AuthError) return unauthorized();
            // Not a token problem — a JWKS fetch failure, timeout or other infrastructure error.
            // Telling the client to restart OAuth would be wrong, so this is a 503, not a 401.
            console.error('MCP token verification unavailable:', error);
            return jsonRpcError(
                503,
                await requestId(request),
                'Could not verify the token. Try again.'
            );
        }

        // Open to every signed-in player. What makes that safe lives in the database, not here:
        // OAuth tokens are read-only on the Data API (`20260925000001`), and auth.users triggers
        // refuse email, phone and password changes through the Auth API (`20260928000001`,
        // `20260928000002`), each checked end to end by `scripts/oauth-probe.ts` (#562).
        const db = createDb(token);

        const server = new McpServer({ name: 'starborne-planner', version: '1.0.0' });
        registerTools(server, { db, authUserId: sub });
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
            return await transport.handleRequest(request);
        } finally {
            await server.close();
        }
    };
};
