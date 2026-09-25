/**
 * Manual probe: what can a Supabase OAuth access token do outside the Data API?
 *
 *   npx tsx scripts/oauth-probe.ts --probe-email <address>     (Node 22, .env with VITE_SUPABASE_*)
 *
 * Claude never exposes the token it holds, so this runs its own OAuth 2.1 flow the way an MCP
 * client does: dynamic client registration with a `http://127.0.0.1:<port>/callback` redirect,
 * the authorize URL in the browser (sign in and approve on the planner's consent page, as an
 * admin), the code caught by a one-shot local server, and a PKCE code exchange. With the token it
 * makes three checks and prints one verdict line each:
 *
 *   metadata-update  PUT /auth/v1/user { data: { mcp_probe } }
 *   email-change     PUT /auth/v1/user { email: --probe-email } — never confirmed by this script
 *   data-api-write   DELETE /rest/v1/inventory_items?id=eq.<nil uuid> — the read-only hook must
 *                    answer 403; without the hook it is a 204 that matches no row
 *
 * A check is ALLOWED when the server answered 2xx; data-api-write is BLOCKED only on the hook's
 * own 403. The registered client stays in Supabase (Authentication → OAuth Apps) until deleted.
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Verdict = 'BLOCKED' | 'ALLOWED';

/** No inventory row has this id, so the Data API probe deletes nothing even if it is allowed. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface ProbeArgs {
    probeEmail: string;
}

/** Parses `--probe-email <address>`; the address is required. */
export function parseArgs(argv: string[]): ProbeArgs {
    const at = argv.indexOf('--probe-email');
    const probeEmail = at >= 0 ? argv[at + 1] : undefined;
    if (!probeEmail || probeEmail.startsWith('--') || !probeEmail.includes('@')) {
        throw new Error(
            'usage: npx tsx scripts/oauth-probe.ts --probe-email <address> ' +
                '(an address you control, different from the account email)'
        );
    }
    return { probeEmail };
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** An RFC 7636 S256 verifier/challenge pair. */
export function pkcePair(): { verifier: string; challenge: string } {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

/** An Auth API check is ALLOWED when the server accepted the request. */
export const authApiVerdict = (status: number): Verdict =>
    status >= 200 && status < 300 ? 'ALLOWED' : 'BLOCKED';

/** A Data API write is BLOCKED only when the read-only hook refused it; any other answer means the
 *  request reached the database. */
export const dataApiVerdict = (status: number, body: string): Verdict =>
    status === 403 && body.includes('OAuth client tokens are read-only') ? 'BLOCKED' : 'ALLOWED';

const requireEnv = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set (.env)`);
    return value;
};

interface AuthServerMetadata {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
}

async function discover(supabaseUrl: string): Promise<AuthServerMetadata> {
    const candidates = [
        `${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`,
        `${supabaseUrl}/auth/v1/.well-known/oauth-authorization-server`,
    ];
    for (const url of candidates) {
        const response = await fetch(url);
        if (response.ok) return (await response.json()) as AuthServerMetadata;
    }
    throw new Error('Authorization-server metadata not found. Is the OAuth server enabled?');
}

/** Listens on an ephemeral 127.0.0.1 port and resolves with the first `/callback` query. */
async function oneShotCallback(): Promise<{ port: number; params: Promise<URLSearchParams> }> {
    let deliver: (params: URLSearchParams) => void = () => {};
    const params = new Promise<URLSearchParams>((resolve) => {
        deliver = resolve;
    });
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' }).end(
            'Probe received the code. You can close this tab.'
        );
        server.close();
        deliver(url.searchParams);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as AddressInfo).port, params };
}

async function report(
    label: string,
    response: Response
): Promise<{ status: number; body: string }> {
    const body = await response.text();
    console.log(`\n${label}: HTTP ${response.status}\n${body}`);
    return { status: response.status, body };
}

async function main(): Promise<void> {
    const { probeEmail } = parseArgs(process.argv.slice(2));
    const supabaseUrl = requireEnv('VITE_SUPABASE_URL');
    const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');

    const metadata = await discover(supabaseUrl);
    const callback = await oneShotCallback();
    const redirectUri = `http://127.0.0.1:${callback.port}/callback`;

    const registration = await fetch(metadata.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Starborne Planner OAuth probe',
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    });
    if (!registration.ok) {
        throw new Error(
            `Client registration failed: HTTP ${registration.status} ${await registration.text()}`
        );
    }
    const { client_id: clientId } = (await registration.json()) as { client_id: string };

    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(16));
    const authorize = new URL(metadata.authorization_endpoint);
    authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    }).toString();

    console.log(`Open this URL, sign in as an admin and approve:\n\n${authorize.toString()}\n`);
    if (process.platform === 'darwin') spawn('open', [authorize.toString()], { stdio: 'ignore' });

    const params = await callback.params;
    if (params.get('state') !== state) throw new Error('State mismatch on the callback.');
    const code = params.get('code');
    if (!code) throw new Error(`No code on the callback: ${params.toString()}`);

    const tokenResponse = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
        }),
    });
    if (!tokenResponse.ok) {
        throw new Error(
            `Token exchange failed: HTTP ${tokenResponse.status} ${await tokenResponse.text()}`
        );
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const asCaller = { apikey: anonKey, authorization: `Bearer ${accessToken}` };
    const json = { ...asCaller, 'content-type': 'application/json' };

    const metadataCheck = await report(
        'metadata-update',
        await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'PUT',
            headers: json,
            body: JSON.stringify({ data: { mcp_probe: new Date().toISOString() } }),
        })
    );

    const emailCheck = await report(
        'email-change',
        await fetch(`${supabaseUrl}/auth/v1/user`, {
            method: 'PUT',
            headers: json,
            body: JSON.stringify({ email: probeEmail }),
        })
    );
    if (authApiVerdict(emailCheck.status) === 'ALLOWED') {
        console.warn(
            '\nWARNING: the email change was accepted and is pending. Do NOT click the ' +
                'confirmation links; ignore the confirmation mail and the change never completes.'
        );
    }

    const dataCheck = await report(
        'data-api-write',
        // A real-table write only the pre-request hook stops. Not `rpc/check_request`: that
        // function raises from its own body on any POST, hook or no hook, so it cannot tell.
        await fetch(`${supabaseUrl}/rest/v1/inventory_items?id=eq.${NIL_UUID}`, {
            method: 'DELETE',
            headers: { ...asCaller, prefer: 'return=minimal' },
        })
    );

    console.log(`\nmetadata-update: ${authApiVerdict(metadataCheck.status)}`);
    console.log(`email-change: ${authApiVerdict(emailCheck.status)}`);
    console.log(`data-api-write: ${dataApiVerdict(dataCheck.status, dataCheck.body)}`);
}

// Importing this file for its pure helpers must not start a flow.
if (process.argv[1] && process.argv[1].endsWith('oauth-probe.ts')) {
    main().catch((error: unknown) => {
        console.error(`oauth-probe: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
