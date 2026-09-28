/**
 * Manual probe: what can a Supabase OAuth access token do outside the Data API?
 *
 *   npx tsx scripts/oauth-probe.ts --probe-email <address>     (Node 22, .env with VITE_SUPABASE_*)
 *
 * Claude never exposes the token it holds, so this runs its own OAuth 2.1 flow the way an MCP
 * client does: dynamic client registration with a `http://127.0.0.1:<port>/callback` redirect,
 * the authorize URL in the browser (sign in and approve on the planner's consent page, as an
 * admin), the code caught by a one-shot local server, and a PKCE code exchange. With the token it
 * first reads the account (GET /auth/v1/user), which confirms the token is accepted at all, then
 * makes three further checks and prints one verdict line each, each verdict one of three outcomes:
 *
 *   metadata-update  PUT /auth/v1/user { data: { mcp_probe } }
 *   email-change     PUT /auth/v1/user { email: --probe-email } — never confirmed by this script
 *   data-api-write   DELETE /rest/v1/inventory_items?id=eq.<nil uuid>&id=neq.<nil uuid> — a
 *                    filter matching no row (PostgREST ANDs repeated filters on the same
 *                    column), so this cannot delete anything even without the hook; the
 *                    read-only hook must still answer its own 403
 *
 * The email-change verdict is judged by the account's STATE, not the PUT's status: right after
 * the PUT the probe reads the account again and looks for the probe address in `new_email` (a
 * pending change) or `email` (a change applied outright, which is what happens when email
 * confirmation is off). Either one is ALLOWED whatever the PUT returned. The database trigger
 * that blocks the change (`block_account_contact_change`) surfaces from the Auth API as the
 * email-change write failure (see `EMAIL_CHANGE_WRITE_FAILED`); BLOCKED needs that failure, no
 * probe address on the account afterwards, and the token confirmed accepted both before and
 * after the PUT (a token expiring mid-run would otherwise read as a refusal). See
 * `emailChangeVerdict` for the full rule order. A BLOCKED verdict still needs the Postgres log
 * check the probe prints, because an SMTP failure returns the same response.
 *
 * The other two checks are judged by status. ALLOWED means the server accepted the request (a
 * 2xx) — the token really could do this. BLOCKED means the server's own refusal proved it: 401/403
 * for metadata-update, or the read-only hook's own 403 message for data-api-write. Anything else
 * — a 422, a 429, a 500, a 403 with a different message — is INCONCLUSIVE: it neither proves the
 * token was refused nor that the write went through. metadata-update is also INCONCLUSIVE
 * whenever the token itself wasn't confirmed accepted beforehand, since its 401 could then mean
 * an expired or invalid token rather than a refusal.
 *
 * metadata-update is reported but does not gate anything: an OAuth token rewriting the display
 * name and avatar in the user metadata is accepted. The admin gate on the MCP endpoint stays
 * until email-change is BLOCKED (and data-api-write with it). The registered client stays in
 * Supabase (Authentication → OAuth Apps) until deleted.
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

/** The metadata-update check's verdict: ALLOWED on a 2xx, BLOCKED only on the server's own
 *  401/403 refusal, and INCONCLUSIVE otherwise (a 422/429/5xx proves neither outcome).
 *  `tokenValid` is whether the bearer token itself was confirmed accepted (a 2xx on
 *  GET /auth/v1/user) before this check; when it wasn't, a refusal here could be the token, not
 *  the Auth API, so the verdict is INCONCLUSIVE regardless of status. */
export const authApiVerdict = (status: number, tokenValid: boolean): Verdict => {
    if (!tokenValid) return 'INCONCLUSIVE';
    if (status >= 200 && status < 300) return 'ALLOWED';
    if (status === 401 || status === 403) return 'BLOCKED';
    return 'INCONCLUSIVE';
};

/** The contact fields of GET /auth/v1/user that the email-change verdict reads. */
export interface AccountContact {
    email?: string;
    new_email?: string;
}

/** Extracts `email` / `new_email` from a GET /auth/v1/user body; null when the body is not a
 *  JSON object (an error page, an empty body). Non-string fields are dropped. */
export function parseAccountContact(body: string): AccountContact | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const contact: AccountContact = {};
    if (typeof record.email === 'string') contact.email = record.email;
    if (typeof record.new_email === 'string') contact.new_email = record.new_email;
    return contact;
}

const normalizeEmail = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** Whether either contact field holds `probeEmail`, compared trimmed and case-insensitively. An
 *  absent or blank field never matches. */
const holdsProbeEmail = (user: AccountContact | null, probeEmail: string): boolean => {
    const probe = normalizeEmail(probeEmail);
    if (!probe || !user) return false;
    return normalizeEmail(user.new_email) === probe || normalizeEmail(user.email) === probe;
};

/** The public message of the Auth API's 500 when the email-change step fails: GoTrue's
 *  `sendEmailChange` (supabase/auth, internal/api/mail.go) sends the confirmation mail FIRST and
 *  then writes `email_change`, and returns this same message whether the mail send or the write
 *  failed. The trigger's refusal is a write failure, so it arrives as this 500 — and so does an
 *  SMTP failure, which only the Postgres log tells apart. */
export const EMAIL_CHANGE_WRITE_FAILED = 'Error sending email change email';

export interface EmailChangeObservation {
    /** HTTP status of PUT /auth/v1/user { email: probeEmail }. */
    putStatus: number;
    /** Response body of that PUT. */
    putBody: string;
    /** GET /auth/v1/user returned 2xx before the PUT. */
    tokenValidBefore: boolean;
    /** GET /auth/v1/user returned 2xx right after the PUT. */
    tokenValidAfter: boolean;
    /** The account as read before the PUT; null when unreadable. */
    userBefore: AccountContact | null;
    /** The account as read right after the PUT; null when unreadable. */
    userAfter: AccountContact | null;
    probeEmail: string;
}

/** The email-change verdict, judged by account state. Rules, first match wins:
 *
 *  1. The account already held the probe address before the PUT (a pending change left over
 *     from an earlier run, or the probe address IS the account email) → INCONCLUSIVE: the PUT
 *     cannot start a change that already exists, so the check says nothing.
 *  2. The account holds the probe address after the PUT, in `new_email` or `email` → ALLOWED,
 *     whatever the PUT's status.
 *  3. The token was not confirmed accepted both before and after the PUT → INCONCLUSIVE.
 *  4. The PUT was a 500 carrying `EMAIL_CHANGE_WRITE_FAILED` → BLOCKED. That response is the
 *     trigger's refusal OR an SMTP failure; `main()` prints the Postgres log check that tells
 *     them apart.
 *  5. Otherwise → INCONCLUSIVE: a 2xx that left no pending change, a 4xx, or any other 5xx. A
 *     4xx is refused before the database write (a 429 email rate limit, a 422 for an address
 *     already registered), and another 5xx failed somewhere other than the email-change step,
 *     so neither says anything about the trigger. */
export const emailChangeVerdict = ({
    putStatus,
    putBody,
    tokenValidBefore,
    tokenValidAfter,
    userBefore,
    userAfter,
    probeEmail,
}: EmailChangeObservation): Verdict => {
    if (holdsProbeEmail(userBefore, probeEmail)) return 'INCONCLUSIVE';
    if (holdsProbeEmail(userAfter, probeEmail)) return 'ALLOWED';
    if (!tokenValidBefore || !tokenValidAfter) return 'INCONCLUSIVE';
    if (putStatus === 500 && putBody.includes(EMAIL_CHANGE_WRITE_FAILED)) return 'BLOCKED';
    return 'INCONCLUSIVE';
};

/** Whether the email-change check was uninformative because the account already held the probe
 *  address before the PUT (rule 1 of `emailChangeVerdict`). */
export const probeEmailAlreadyPending = (
    userBefore: AccountContact | null,
    probeEmail: string
): boolean => holdsProbeEmail(userBefore, probeEmail);

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

    // Reads the account: `ok` says the token itself was accepted (a refusal on a check is only a
    // refusal if the token was), `user` is the state the email-change verdict is judged by.
    const checkToken = async (
        label: string
    ): Promise<{ ok: boolean; user: AccountContact | null }> => {
        const { status, body } = await report(
            label,
            await fetch(`${supabaseUrl}/auth/v1/user`, { headers: asCaller })
        );
        const ok = status >= 200 && status < 300;
        return { ok, user: ok ? parseAccountContact(body) : null };
    };

    const before = await checkToken('token-check');
    if (!before.ok) {
        console.log(
            '\ntoken-check: the token itself was not accepted — every Auth API verdict below is INCONCLUSIVE.'
        );
    }
    if (probeEmailAlreadyPending(before.user, probeEmail)) {
        console.log(
            `\ntoken-check: the account already holds ${probeEmail} (a pending change from an ` +
                'earlier run, or the account email itself), so email-change cannot be judged. ' +
                'Clear the pending change first (rollout step 1 of ' +
                'docs/superpowers/specs/2026-09-28-block-account-email-change-design.md), or ' +
                'use a different --probe-email.'
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
    const after = await checkToken('token-check (after email-change)');
    const emailVerdict = emailChangeVerdict({
        putStatus: emailCheck.status,
        putBody: emailCheck.body,
        tokenValidBefore: before.ok,
        tokenValidAfter: after.ok,
        userBefore: before.user,
        userAfter: after.user,
        probeEmail,
    });
    if (emailVerdict === 'ALLOWED') {
        console.warn(
            '\nWARNING: the email change was accepted. If it is pending, do NOT click the ' +
                'confirmation links; ignore the confirmation mail and the change never completes. ' +
                'If the account email itself changed, restore it in the dashboard.'
        );
    }
    if (emailVerdict === 'BLOCKED') {
        console.log(
            `\nemail-change: an SMTP failure returns the same 500 as the trigger. Confirm in ` +
                'Supabase Logs (Postgres) that "Changing the account email is disabled" was ' +
                `raised just now. The confirmation mail to ${probeEmail} is sent before the ` +
                'refused write, so it may still arrive; its link cannot complete the change.'
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
        'metadata-update': authApiVerdict(metadataCheck.status, before.ok),
        'email-change': emailVerdict,
        'data-api-write': dataApiVerdict(dataCheck.status, dataCheck.body),
    };
    console.log(`\nmetadata-update: ${verdicts['metadata-update']}`);
    console.log(`email-change: ${verdicts['email-change']}`);
    console.log(`data-api-write: ${verdicts['data-api-write']}`);

    // metadata-update is reported but gates nothing (see the header).
    const gating = [verdicts['email-change'], verdicts['data-api-write']];
    if (gating.includes('INCONCLUSIVE')) {
        console.log(
            '\nemail-change or data-api-write was INCONCLUSIVE: re-run after fixing the cause ' +
                'shown above. The admin gate stays until email-change is BLOCKED.'
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
