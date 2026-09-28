// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
    authApiVerdict,
    dataApiVerdict,
    emailChangeVerdict,
    parseArgs,
    pkcePair,
} from '../../../scripts/oauth-probe';

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
    it.each([
        [200, true, 'ALLOWED'],
        [401, true, 'BLOCKED'],
        [403, true, 'BLOCKED'],
        [422, true, 'INCONCLUSIVE'],
        [429, true, 'INCONCLUSIVE'],
        [500, true, 'INCONCLUSIVE'],
    ])('calls an Auth API check %i (token valid: %s) %s', (status, tokenValid, verdict) => {
        expect(authApiVerdict(status, tokenValid)).toBe(verdict);
    });

    it('is INCONCLUSIVE regardless of status when the token itself was not accepted', () => {
        expect(authApiVerdict(200, false)).toBe('INCONCLUSIVE');
        expect(authApiVerdict(401, false)).toBe('INCONCLUSIVE');
        expect(authApiVerdict(403, false)).toBe('INCONCLUSIVE');
    });

    it("calls a Data API write BLOCKED only on the read-only hook's own 403", () => {
        const hook = '{"code":"PT403","message":"OAuth client tokens are read-only"}';

        expect(dataApiVerdict(403, hook)).toBe('BLOCKED');
        expect(dataApiVerdict(403, '{"message":"permission denied"}')).toBe('INCONCLUSIVE');
        expect(dataApiVerdict(204, '')).toBe('ALLOWED');
        expect(dataApiVerdict(401, '')).toBe('INCONCLUSIVE');
    });
});

describe('emailChangeVerdict', () => {
    it('is INCONCLUSIVE when the token check before this call was not 2xx', () => {
        expect(emailChangeVerdict(401, false, true)).toBe('INCONCLUSIVE');
    });

    it('calls a 401 BLOCKED only when the token check before AND after both returned 2xx', () => {
        expect(emailChangeVerdict(401, true, true)).toBe('BLOCKED');
        expect(emailChangeVerdict(401, true, false)).toBe('INCONCLUSIVE');
    });

    it('falls back to the ordinary Auth API verdict for a non-401 status', () => {
        expect(emailChangeVerdict(200, true, true)).toBe('ALLOWED');
        expect(emailChangeVerdict(200, true, false)).toBe('ALLOWED');
        expect(emailChangeVerdict(403, true, false)).toBe('BLOCKED');
        expect(emailChangeVerdict(422, true, true)).toBe('INCONCLUSIVE');
    });
});
