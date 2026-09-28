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
    PASSWORD_WRITE_FAILED,
    passwordSetVerdict,
    pkcePair,
    probeEmailAlreadyPending,
    probePassword,
    type EmailChangeObservation,
    type PasswordSetObservation,
} from '../../../scripts/oauth-probe';

describe('parseArgs', () => {
    it('reads --probe-email', () => {
        expect(parseArgs(['--probe-email', 'me@example.com'])).toEqual({
            probeEmail: 'me@example.com',
            passwordSet: false,
        });
    });

    it('reads --password-set alone', () => {
        expect(parseArgs(['--password-set'])).toEqual({ passwordSet: true });
    });

    it('reads both flags', () => {
        expect(parseArgs(['--password-set', '--probe-email', 'me@example.com'])).toEqual({
            probeEmail: 'me@example.com',
            passwordSet: true,
        });
    });

    it.each([
        [[]],
        [['--probe-email']],
        [['--probe-email', '--other']],
        [['--probe-email', 'nope']],
        [['--password-set', '--probe-email', 'nope']],
    ])('refuses %j', (argv) => {
        expect(() => parseArgs(argv)).toThrow(/--probe-email/);
    });
});

describe('probePassword', () => {
    it('is fresh each call and has every character class', () => {
        const a = probePassword();
        expect(a).not.toBe(probePassword());
        expect(a).toMatch(/[a-z]/);
        expect(a).toMatch(/[A-Z]/);
        expect(a).toMatch(/[0-9]/);
        expect(a).toMatch(/[^A-Za-z0-9]/);
        expect(Buffer.byteLength(a)).toBeLessThanOrEqual(72);
    });
});

describe('passwordSetVerdict', () => {
    // The trigger's refusal: the password-storage 500, the sign-in refused as bad credentials, and
    // both token checks fine. Each case below changes one field.
    const blocked: PasswordSetObservation = {
        putStatus: 500,
        putBody: `{"code":500,"error_code":"unexpected_failure","msg":"${PASSWORD_WRITE_FAILED}"}`,
        tokenValidBefore: true,
        tokenValidAfter: true,
        signInStatus: 400,
        signInBody:
            '{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}',
    };

    it('is BLOCKED on the password-storage 500 with the sign-in refused as bad credentials', () => {
        expect(passwordSetVerdict(blocked)).toBe('BLOCKED');
    });

    it('is ALLOWED when the sign-in works, whatever the PUT returned', () => {
        expect(passwordSetVerdict({ ...blocked, putStatus: 200, signInStatus: 200 })).toBe(
            'ALLOWED'
        );
        expect(passwordSetVerdict({ ...blocked, signInStatus: 200 })).toBe('ALLOWED');
        expect(passwordSetVerdict({ ...blocked, tokenValidAfter: false, signInStatus: 200 })).toBe(
            'ALLOWED'
        );
    });

    it('is INCONCLUSIVE when no sign-in was attempted', () => {
        expect(passwordSetVerdict({ ...blocked, signInStatus: null, signInBody: '' })).toBe(
            'INCONCLUSIVE'
        );
    });

    it.each(['tokenValidBefore', 'tokenValidAfter'] as const)(
        'is INCONCLUSIVE when %s failed',
        (field) => {
            expect(passwordSetVerdict({ ...blocked, [field]: false })).toBe('INCONCLUSIVE');
        }
    );

    it.each([
        [200, ''],
        [401, '{"msg":"Password update requires reauthentication"}'],
        [422, '{"error_code":"weak_password"}'],
        [429, ''],
        [500, '{"msg":"Error recording audit log entry"}'],
        [502, `{"msg":"${PASSWORD_WRITE_FAILED}"}`],
    ])('is INCONCLUSIVE on a %i PUT (%j) whose password does not log in', (putStatus, putBody) => {
        expect(passwordSetVerdict({ ...blocked, putStatus, putBody })).toBe('INCONCLUSIVE');
    });

    it.each([
        [422, '{"error_code":"email_provider_disabled"}'],
        [429, '{"error_code":"over_request_rate_limit"}'],
        [400, '{"error_code":"email_not_confirmed"}'],
    ])('is INCONCLUSIVE when the sign-in is refused for another reason (%i %j)', (status, body) => {
        expect(passwordSetVerdict({ ...blocked, signInStatus: status, signInBody: body })).toBe(
            'INCONCLUSIVE'
        );
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

    it.each(['userBefore', 'userAfter'] as const)(
        'is INCONCLUSIVE when %s was a 2xx but unreadable',
        (field) => {
            expect(emailChangeVerdict({ ...blocked, [field]: null })).toBe('INCONCLUSIVE');
        }
    );

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
