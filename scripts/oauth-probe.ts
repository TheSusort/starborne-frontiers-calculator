/**
 * Manual probe: what can a Supabase OAuth access token do outside the Data API?
 *
 *   npx tsx scripts/oauth-probe.ts --probe-email <address>     (Node 22, .env with VITE_SUPABASE_*)
 *
 * Claude never exposes the token it holds, so this runs its own OAuth 2.1 flow the way an MCP
 * client does: dynamic client registration with a `http://127.0.0.1:<port>/callback` redirect,
 * the authorize URL in the browser (sign in and approve on the planner's consent page, as an
 * admin), the code caught by a one-shot local server, and a PKCE code exchange. With the token it
 * first checks the token is accepted at all (GET /auth/v1/user), then makes three further checks
 * and prints one verdict line each, each verdict one of three outcomes:
 *
 *   metadata-update  PUT /auth/v1/user { data: { mcp_probe } }
 *   email-change     PUT /auth/v1/user { email: --probe-email } — never confirmed by this script
 *   data-api-write   DELETE /rest/v1/inventory_items?id=eq.<nil uuid>&id=neq.<nil uuid> — a
 *                    filter matching no row (PostgREST ANDs repeated filters on the same
 *                    column), so this cannot delete anything even without the hook; the
 *                    read-only hook must still answer its own 403
 *
 * ALLOWED means the server accepted the request (a 2xx) — the token really could do this.
 * BLOCKED means the server's own refusal proved it: 401/403 for the Auth API checks, or the
 * read-only hook's own 403 message for the Data API check. Anything else — a 422, a 429, a 500,
 * a 403 with a different message — is INCONCLUSIVE: it neither proves the token was refused nor
 * that the write went through, so it must never be read as BLOCKED (a false sense of safety on
 * the email-change check) or as ALLOWED (a false alarm). A 401 on an Auth API check is also
 * INCONCLUSIVE rather than BLOCKED whenever the token itself wasn't confirmed accepted at the
 * time: a 401 can mean the Auth API refused the request, or it can mean the token had expired or
 * was never valid, and those read very differently. The email-change check re-checks the token
 * immediately after its own call and only calls a 401 BLOCKED when both the before and the after
 * token check came back 2xx (guards against the token expiring mid-run). The registered client
 * stays in Supabase (Authentication → OAuth Apps) until deleted.
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Verdict = 'BLOCKED' | 'ALLOWED' | 'INCONCLUSIVE';

/** No inventory row has this id, and the Data API probe's URL also ANDs `id=neq.<NIL_UUID>` onto
 *  the same filter, a contradiction no row can satisfy — so the delete matches nothing even if
 *  it is allowed, hook or no hook. */
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

/** An Auth API check is ALLOWED on a 2xx, BLOCKED only on the server's own 401/403 refusal, and
 *  INCONCLUSIVE otherwise (a 422/429/5xx proves neither outcome — never call it BLOCKED, which
 *  would give a false-safe verdict on the email-change check). `tokenValid` is whether the
 *  bearer token itself was confirmed accepted (a 2xx on GET /auth/v1/user) around the same time
 *  as this check; when it wasn't, a refusal here could be the token, not the Auth API, so the
 *  verdict is INCONCLUSIVE regardless of status. */
export const authApiVerdict = (status: number, tokenValid: boolean): Verdict => {
    if (!tokenValid) return 'INCONCLUSIVE';
    if (status >= 200 && status < 300) return 'ALLOWED';
    if (status === 401 || status === 403) return 'BLOCKED';
    return 'INCONCLUSIVE';
};

/** The email-change check's own verdict. A 401 here is ambiguous between "the Auth API refused
 *  the email change" and "the token expired between the before/after token checks", so it is
 *  only read as BLOCKED when both the token check made before this call and the one made right
 *  after it came back 2xx; any other status falls back to the ordinary `authApiVerdict`. */
export const emailChangeVerdict = (
    status: number,
    tokenValidBefore: boolean,
    tokenValidAfter: boolean
): Verdict => {
    if (!tokenValidBefore) return 'INCONCLUSIVE';
    if (status === 401) return tokenValidAfter ? 'BLOCKED' : 'INCONCLUSIVE';
    return authApiVerdict(status, tokenValidBefore);
};

/** A Data API write is BLOCKED only when the read-only hook's own message refused it, ALLOWED on
 *  a 2xx (the request reached the database), and INCONCLUSIVE otherwise — a 401/500 proves the
 *  write didn't go through as tested, not that it would be refused if it did. */
export const dataApiVerdict = (status: number, body: string): Verdict => {
    if (status === 403 && body.includes('OAuth client tokens are read-only')) return 'BLOCKED';
    if (status >= 200 && status < 300) return 'ALLOWED';
    return 'INCONCLUSIVE';
};

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

    // A 401 on one of the checks below is ambiguous unless we know the token itself was still
    // accepted around that time — otherwise the 401 proves the token, not the Auth API, refused.
    const checkToken = async (label: string): Promise<boolean> => {
        const { status } = await report(
            label,
            await fetch(`${supabaseUrl}/auth/v1/user`, { headers: asCaller })
        );
        return status >= 200 && status < 300;
    };

    const tokenValidBefore = await checkToken('token-check');
    if (!tokenValidBefore) {
        console.log(
            '\ntoken-check: the token itself was not accepted — every Auth API verdict below is INCONCLUSIVE.'
        );
    }

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
    const tokenValidAfter = await checkToken('token-check (after email-change)');
    const emailVerdict = emailChangeVerdict(emailCheck.status, tokenValidBefore, tokenValidAfter);
    if (emailVerdict === 'ALLOWED') {
        console.warn(
            '\nWARNING: the email change was accepted and is pending. Do NOT click the ' +
                'confirmation links; ignore the confirmation mail and the change never completes.'
        );
    }

    const dataCheck = await report(
        'data-api-write',
        // A real-table write only the pre-request hook stops. Not `rpc/check_request`: that
        // function raises from its own body on any POST, hook or no hook, so it cannot tell. The
        // repeated `id` filter is contradictory (see `NIL_UUID`), so this matches no row either way.
        await fetch(`${supabaseUrl}/rest/v1/inventory_items?id=eq.${NIL_UUID}&id=neq.${NIL_UUID}`, {
            method: 'DELETE',
            headers: { ...asCaller, prefer: 'return=minimal' },
        })
    );

    const verdicts = {
        'metadata-update': authApiVerdict(metadataCheck.status, tokenValidBefore),
        'email-change': emailVerdict,
        'data-api-write': dataApiVerdict(dataCheck.status, dataCheck.body),
    };
    console.log(`\nmetadata-update: ${verdicts['metadata-update']}`);
    console.log(`email-change: ${verdicts['email-change']}`);
    console.log(`data-api-write: ${verdicts['data-api-write']}`);

    if (Object.values(verdicts).includes('INCONCLUSIVE')) {
        console.log(
            '\nAt least one check was INCONCLUSIVE: re-run after fixing the cause shown above. ' +
                'The admin gate stays until email-change is BLOCKED.'
        );
    }
}

// Importing this file for its pure helpers must not start a flow.
if (process.argv[1] && process.argv[1].endsWith('oauth-probe.ts')) {
    main().catch((error: unknown) => {
        console.error(`oauth-probe: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
