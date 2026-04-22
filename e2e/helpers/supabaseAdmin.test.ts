import { test, expect } from '@playwright/test';
import { assertIsTestEmail } from './supabaseAdmin';

test.describe('assertIsTestEmail', () => {
    const prefix = 'starborneplanner+e2e-';
    const domain = 'gmail.com';

    test('accepts a well-formed gmail plus-alias test email', () => {
        expect(() =>
            assertIsTestEmail(
                'starborneplanner+e2e-550e8400-e29b-41d4-a716-446655440000@gmail.com',
                prefix,
                domain
            )
        ).not.toThrow();
    });

    test('rejects a non-prefixed email', () => {
        expect(() =>
            assertIsTestEmail('starborneplanner@gmail.com', prefix, domain)
        ).toThrow(/refusing to operate/i);
    });

    test('rejects a wrong-prefix email', () => {
        expect(() =>
            assertIsTestEmail(
                'other+e2e-550e8400-e29b-41d4-a716-446655440000@gmail.com',
                prefix,
                domain
            )
        ).toThrow(/refusing to operate/i);
    });

    test('rejects a wrong-domain email', () => {
        expect(() =>
            assertIsTestEmail(
                'starborneplanner+e2e-550e8400-e29b-41d4-a716-446655440000@other.com',
                prefix,
                domain
            )
        ).toThrow(/refusing to operate/i);
    });

    test('rejects a subdomain attempt on the domain', () => {
        expect(() =>
            assertIsTestEmail(
                'starborneplanner+e2e-550e8400-e29b-41d4-a716-446655440000@attacker.gmail.com',
                prefix,
                domain
            )
        ).toThrow(/refusing to operate/i);
    });

    test('rejects an empty string', () => {
        expect(() => assertIsTestEmail('', prefix, domain)).toThrow(/refusing to operate/i);
    });

    test('rejects a bare uuid without prefix or domain', () => {
        expect(() =>
            assertIsTestEmail('550e8400-e29b-41d4-a716-446655440000', prefix, domain)
        ).toThrow(/refusing to operate/i);
    });
});
