// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { authApiVerdict, dataApiVerdict, parseArgs, pkcePair } from '../../../scripts/oauth-probe';

describe('parseArgs', () => {
    it('reads --probe-email', () => {
        expect(parseArgs(['--probe-email', 'me@example.com'])).toEqual({
            probeEmail: 'me@example.com',
        });
    });

    it.each([
        [[]],
        [['--probe-email']],
        [['--probe-email', '--other']],
        [['--probe-email', 'nope']],
    ])('refuses %j', (argv) => {
        expect(() => parseArgs(argv)).toThrow(/--probe-email/);
    });
});

describe('pkcePair', () => {
    it('makes an S256 challenge of the verifier', () => {
        const { verifier, challenge } = pkcePair();

        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    });
});

describe('verdicts', () => {
    it('calls an Auth API check ALLOWED only on 2xx', () => {
        expect(authApiVerdict(200)).toBe('ALLOWED');
        expect(authApiVerdict(403)).toBe('BLOCKED');
        expect(authApiVerdict(401)).toBe('BLOCKED');
    });

    it("calls a Data API write BLOCKED only on the read-only hook's own 403", () => {
        const hook = '{"code":"PT403","message":"OAuth client tokens are read-only"}';

        expect(dataApiVerdict(403, hook)).toBe('BLOCKED');
        expect(dataApiVerdict(403, '{"message":"permission denied"}')).toBe('ALLOWED');
        expect(dataApiVerdict(204, '')).toBe('ALLOWED');
    });
});
