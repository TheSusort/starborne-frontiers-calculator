import { test, expect } from '@playwright/test';
import { generateTestCredentials } from './disposableEmail';
import { assertIsTestEmail } from './supabaseAdmin';

test.describe('generateTestCredentials', () => {
    const prefix = 'starborneplanner+e2e-';
    const domain = 'gmail.com';

    test('email starts with prefix and uses the given domain', () => {
        const { email } = generateTestCredentials(prefix, domain);
        expect(email.startsWith(prefix)).toBe(true);
        expect(email.endsWith(`@${domain}`)).toBe(true);
    });

    test('email body between prefix and @ is a uuid', () => {
        const { email } = generateTestCredentials(prefix, domain);
        const body = email.slice(prefix.length, email.indexOf('@'));
        expect(body).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
    });

    test('generated email is accepted by assertIsTestEmail', () => {
        const { email } = generateTestCredentials(prefix, domain);
        expect(() => assertIsTestEmail(email, prefix, domain)).not.toThrow();
    });

    test('two calls return different emails and passwords', () => {
        const a = generateTestCredentials(prefix, domain);
        const b = generateTestCredentials(prefix, domain);
        expect(a.email).not.toBe(b.email);
        expect(a.password).not.toBe(b.password);
    });

    test('password is at least 16 characters', () => {
        const { password } = generateTestCredentials(prefix, domain);
        expect(password.length).toBeGreaterThanOrEqual(16);
    });
});
