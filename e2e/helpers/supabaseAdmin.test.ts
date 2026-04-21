import { test, expect } from '@playwright/test';
import { assertIsTestEmail } from './supabaseAdmin';

test.describe('assertIsTestEmail', () => {
    const domain = 'e2e.sbfc.invalid';

    test('accepts a well-formed test email', () => {
        expect(() =>
            assertIsTestEmail('e2e-550e8400-e29b-41d4-a716-446655440000@e2e.sbfc.invalid', domain)
        ).not.toThrow();
    });

    test('rejects a non-prefixed email', () => {
        expect(() => assertIsTestEmail('real-user@e2e.sbfc.invalid', domain)).toThrow(
            /refusing to operate/i
        );
    });

    test('rejects a wrong-domain email', () => {
        expect(() =>
            assertIsTestEmail('e2e-abc@gmail.com', domain)
        ).toThrow(/refusing to operate/i);
    });

    test('rejects a subdomain attempt', () => {
        expect(() =>
            assertIsTestEmail('e2e-abc@attacker.e2e.sbfc.invalid', domain)
        ).toThrow(/refusing to operate/i);
    });

    test('rejects an empty string', () => {
        expect(() => assertIsTestEmail('', domain)).toThrow(/refusing to operate/i);
    });
});
