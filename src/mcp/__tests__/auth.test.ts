// @vitest-environment node
import { errors, type JWTVerifyGetKey } from 'jose';
import { describe, it, expect, beforeAll } from 'vitest';
import { AuthError, verifyAccessToken, type VerifyAccessTokenOptions } from '../auth';
import { ISSUER, makeSigner } from './testTokens';

let signer: Awaited<ReturnType<typeof makeSigner>>;
let options: VerifyAccessTokenOptions;

beforeAll(async () => {
    signer = await makeSigner();
    options = { jwks: signer.jwks, issuer: ISSUER };
});

/** The reason `verifyAccessToken` refused `token` with; fails the test if it accepted it. */
const refusal = async (token: string) => {
    const error: unknown = await verifyAccessToken(token, options).then(
        () => null,
        (e: unknown) => e
    );
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).reason;
};

describe('verifyAccessToken', () => {
    it('accepts an OAuth token and returns its subject and client', async () => {
        const token = await signer.sign({ client_id: 'client-1' });

        await expect(verifyAccessToken(token, options)).resolves.toEqual({
            sub: 'user-1',
            clientId: 'client-1',
        });
    });

    it('refuses an expired token as unauthenticated', async () => {
        const token = await signer.sign(
            { client_id: 'client-1' },
            { expiresIn: Math.floor(Date.now() / 1000) - 60 }
        );

        expect(await refusal(token)).toBe('unauthenticated');
    });

    it('refuses a token from another issuer as unauthenticated', async () => {
        const token = await signer.sign(
            { client_id: 'client-1' },
            { issuer: 'https://other.supabase.co/auth/v1' }
        );

        expect(await refusal(token)).toBe('unauthenticated');
    });

    it('refuses a token signed by a key outside the set as unauthenticated', async () => {
        const stranger = await makeSigner();
        const token = await stranger.sign({ client_id: 'client-1' });

        expect(await refusal(token)).toBe('unauthenticated');
    });

    it('refuses a malformed token as unauthenticated', async () => {
        expect(await refusal('not-a-jwt')).toBe('unauthenticated');
    });

    it('refuses a website session token (no client_id) as not_oauth', async () => {
        const token = await signer.sign();

        expect(await refusal(token)).toBe('not_oauth');
    });

    it('refuses an empty client_id as not_oauth', async () => {
        const token = await signer.sign({ client_id: '' });

        expect(await refusal(token)).toBe('not_oauth');
    });

    it('rethrows a JWKS fetch failure unchanged, not as an AuthError', async () => {
        const token = await signer.sign({ client_id: 'client-1' });
        const outage = new errors.JWKSTimeout();
        const brokenJwks: JWTVerifyGetKey = () => {
            throw outage;
        };

        await expect(verifyAccessToken(token, { jwks: brokenJwks, issuer: ISSUER })).rejects.toBe(
            outage
        );
    });
});
