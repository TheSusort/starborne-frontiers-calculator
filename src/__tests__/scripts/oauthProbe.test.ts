// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
    authApiVerdict,
    dataApiVerdict,
    EMAIL_CHANGE_WRITE_FAILED,
    emailChangeVerdict,
    parseAccountContact,
    parseArgs,
    pkcePair,
    probeEmailAlreadyPending,
    type EmailChangeObservation,
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
    const PROBE = 'probe@example.com';
    const ACCOUNT = { email: 'owner@example.com' };
    // The trigger's refusal, as the Auth API reports it: the email-change write failure, both
    // token checks fine, and no pending change afterwards. Each case below changes one field.
    const blocked: EmailChangeObservation = {
        putStatus: 500,
        putBody: `{"code":500,"error_code":"unexpected_failure","msg":"${EMAIL_CHANGE_WRITE_FAILED}"}`,
        tokenValidBefore: true,
        tokenValidAfter: true,
        userBefore: ACCOUNT,
        userAfter: ACCOUNT,
        probeEmail: PROBE,
    };

    it('is BLOCKED on the email-change write failure with both token checks ok and no pending change', () => {
        expect(emailChangeVerdict(blocked)).toBe('BLOCKED');
    });

    it.each([
        [500, '{"code":500,"msg":"Error recording audit log entry"}'],
        [500, ''],
        [502, `{"msg":"${EMAIL_CHANGE_WRITE_FAILED}"}`],
        [503, 'upstream unavailable'],
    ])(
        'is INCONCLUSIVE on a %i PUT that is not the email-change write failure (%j)',
        (putStatus, putBody) => {
            expect(emailChangeVerdict({ ...blocked, putStatus, putBody })).toBe('INCONCLUSIVE');
        }
    );

    it.each([400, 401, 403, 422, 429])(
        'is INCONCLUSIVE on a %i PUT, refused before the database write',
        (putStatus) => {
            expect(emailChangeVerdict({ ...blocked, putStatus })).toBe('INCONCLUSIVE');
        }
    );

    it('is ALLOWED when the account holds the probe address as a pending new_email', () => {
        expect(
            emailChangeVerdict({
                ...blocked,
                putStatus: 200,
                userAfter: { ...ACCOUNT, new_email: PROBE },
            })
        ).toBe('ALLOWED');
    });

    it('is ALLOWED when the probe address replaced the email outright (confirmation off)', () => {
        expect(
            emailChangeVerdict({ ...blocked, putStatus: 200, userAfter: { email: PROBE } })
        ).toBe('ALLOWED');
    });

    it('is ALLOWED on a pending change even when the PUT returned 500', () => {
        expect(
            emailChangeVerdict({ ...blocked, userAfter: { ...ACCOUNT, new_email: PROBE } })
        ).toBe('ALLOWED');
    });

    it('matches the probe address trimmed and case-insensitively', () => {
        expect(
            emailChangeVerdict({
                ...blocked,
                userAfter: { ...ACCOUNT, new_email: ' PROBE@Example.COM ' },
            })
        ).toBe('ALLOWED');
    });

    it('is INCONCLUSIVE when the token check before the PUT failed', () => {
        expect(emailChangeVerdict({ ...blocked, tokenValidBefore: false, userBefore: null })).toBe(
            'INCONCLUSIVE'
        );
    });

    it('is INCONCLUSIVE when the token check after the PUT failed', () => {
        expect(emailChangeVerdict({ ...blocked, tokenValidAfter: false, userAfter: null })).toBe(
            'INCONCLUSIVE'
        );
    });

    it('is INCONCLUSIVE on a 2xx PUT that left no pending change', () => {
        expect(emailChangeVerdict({ ...blocked, putStatus: 200 })).toBe('INCONCLUSIVE');
    });

    it('is INCONCLUSIVE when the probe address was already pending before the PUT', () => {
        const pending = { ...ACCOUNT, new_email: PROBE };
        expect(
            emailChangeVerdict({
                ...blocked,
                putStatus: 200,
                userBefore: pending,
                userAfter: pending,
            })
        ).toBe('INCONCLUSIVE');
        expect(probeEmailAlreadyPending(pending, PROBE)).toBe(true);
        expect(probeEmailAlreadyPending(ACCOUNT, PROBE)).toBe(false);
    });
});

describe('parseAccountContact', () => {
    it('reads email and new_email from a user body', () => {
        expect(
            parseAccountContact('{"id":"x","email":"a@example.com","new_email":"b@example.com"}')
        ).toEqual({ email: 'a@example.com', new_email: 'b@example.com' });
    });

    it('drops non-string fields', () => {
        expect(parseAccountContact('{"email":42,"new_email":null}')).toEqual({});
    });

    it.each(['', 'not json', '[]', 'null', '"a string"'])('is null for %j', (body) => {
        expect(parseAccountContact(body)).toBeNull();
    });
});
