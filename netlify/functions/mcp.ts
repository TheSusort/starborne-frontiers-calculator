import { env } from 'node:process';
import { createRemoteJWKSet } from 'jose';
import { createMcpHandler } from '../../src/mcp/http';

const requireEnv = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set for Netlify Functions`);
    return value;
};

let handler: ((request: Request) => Promise<Response>) | undefined;

/**
 * Netlify adapter for `src/mcp/http.ts`. The handler — and with it the remote JWKS — is built on
 * the first request and reused while the instance stays warm. Building it at module load would
 * read env that the node-load tripwire (`src/mcp/__tests__/nodeLoad.test.ts`) scrubs.
 */
export default async (request: Request): Promise<Response> => {
    if (!handler) {
        const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
        handler = createMcpHandler({
            supabaseUrl,
            supabaseAnonKey: requireEnv('VITE_SUPABASE_ANON_KEY'),
            jwks: createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)),
        });
    }
    return handler(request);
};

// Netlify reads this statically, so the paths are literals; `src/mcp/__tests__/http.test.ts`
// pins them to `MCP_PATH` and `PROTECTED_RESOURCE_PATHS`.
export const config = {
    path: [
        '/mcp',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
    ],
};
