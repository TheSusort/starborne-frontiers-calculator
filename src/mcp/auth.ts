import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** `unauthenticated`: no usable token — missing, malformed, bad signature, wrong issuer, expired.
 *  `not_oauth`: a valid Supabase token that no OAuth client was issued (a website session). */
export type AuthErrorReason = 'unauthenticated' | 'not_oauth';

export class AuthError extends Error {
    constructor(
        readonly reason: AuthErrorReason,
        message: string
    ) {
        super(message);
        this.name = 'AuthError';
    }
}

export interface VerifiedToken {
    sub: string;
    clientId: string;
}

export interface VerifyAccessTokenOptions {
    /** The project's signing keys: `createRemoteJWKSet` in production, `createLocalJWKSet` in
     *  tests. */
    jwks: JWTVerifyGetKey;
    /** `<SUPABASE_URL>/auth/v1`. */
    issuer: string;
}

/** Whether `error` says the *token* is bad (expired, malformed, wrong signature/algorithm, wrong
 *  issuer, no matching key). Anything else — a JWKS fetch timeout, a network error, a malformed
 *  JWKS document — says nothing about the token and must not be reported as one. */
const isTokenError = (error: unknown): boolean =>
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JOSENotSupported;

/**
 * Verifies a Supabase access token and requires it to be OAuth-issued. The project signs with
 * ES256, so no other algorithm is accepted. A token carries `client_id` only when Supabase issued
 * it to an OAuth client, and the database treats such tokens as read-only
 * (`supabase/migrations/20260925000001_oauth_clients_read_only.sql`, #562). That is the guarantee
 * the MCP server relies on, so a website session token is refused here.
 */
export async function verifyAccessToken(
    token: string,
    { jwks, issuer }: VerifyAccessTokenOptions
): Promise<VerifiedToken> {
    let payload;
    try {
        ({ payload } = await jwtVerify(token, jwks, {
            issuer,
            algorithms: ['ES256'],
            requiredClaims: ['sub', 'exp'],
        }));
    } catch (error) {
        if (!isTokenError(error)) throw error;
        throw new AuthError(
            'unauthenticated',
            error instanceof errors.JOSEError ? error.code : 'invalid token'
        );
    }

    const clientId = payload.client_id;
    if (typeof clientId !== 'string' || clientId === '') {
        throw new AuthError('not_oauth', 'token was not issued to an OAuth client');
    }
    return { sub: payload.sub as string, clientId };
}
