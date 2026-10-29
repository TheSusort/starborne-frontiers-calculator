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
        // Trailing slashes would double up in the issuer/JWKS URLs below.
        const supabaseUrl = requireEnv('VITE_SUPABASE_URL').replace(/\/+$/, '');
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
//
// The rate limit is per client IP and answers 429 before the function runs, so an unauthenticated
// loop cannot spend the account's monthly invocation quota (reaching it pauses every site).
// Netlify validates the rule after deploy without failing the build: check the deploy log.
export const config = {
    path: [
        '/mcp',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
    ],
    rateLimit: {
        windowLimit: 60,
        windowSize: 60,
        aggregateBy: ['ip', 'domain'],
    },
};
