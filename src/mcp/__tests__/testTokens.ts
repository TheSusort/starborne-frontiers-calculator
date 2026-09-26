import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';

export const ISSUER = 'https://project.supabase.co/auth/v1';

interface SignOptions {
    issuer?: string;
    /** A `jose` time span ('1h') or an absolute epoch-seconds expiry. */
    expiresIn?: string | number;
    sub?: string;
}

/** A local ES256 key set standing in for the project's JWKS, and a signer for tokens under it. */
export const makeSigner = async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256' };
    const jwks = createLocalJWKSet({ keys: [jwk] });

    const sign = (
        claims: JWTPayload = {},
        { issuer = ISSUER, expiresIn = '1h', sub = 'user-1' }: SignOptions = {}
    ) =>
        new SignJWT({ role: 'authenticated', ...claims })
            .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
            .setSubject(sub)
            .setIssuer(issuer)
            .setIssuedAt()
            .setExpirationTime(expiresIn)
            .sign(privateKey);

    return { jwks, sign };
};
