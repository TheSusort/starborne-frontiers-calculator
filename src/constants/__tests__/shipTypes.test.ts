import { describe, expect, it } from 'vitest';
import { matchesRoleCategory } from '../shipTypes';

describe('matchesRoleCategory', () => {
    it('matches the exact category name', () => {
        expect(matchesRoleCategory('ATTACKER', ['ATTACKER'])).toBe(true);
        expect(matchesRoleCategory('DEBUFFER', ['DEBUFFER'])).toBe(true);
    });

    it('matches every variant of a category by prefix (DEBUFFER_* family)', () => {
        expect(matchesRoleCategory('DEBUFFER_DEFENSIVE', ['DEBUFFER'])).toBe(true);
        expect(matchesRoleCategory('DEBUFFER_BOMBER', ['ATTACKER', 'DEBUFFER'])).toBe(true);
        expect(matchesRoleCategory('DEBUFFER_DEFENSIVE_SECURITY', ['DEBUFFER'])).toBe(true);
        expect(matchesRoleCategory('DEFENDER_SECURITY', ['DEFENDER'])).toBe(true);
        expect(matchesRoleCategory('SUPPORTER_SHIELD', ['SUPPORTER'])).toBe(true);
    });

    it('does NOT cross-match categories', () => {
        expect(matchesRoleCategory('DEFENDER', ['ATTACKER', 'DEBUFFER'])).toBe(false);
        expect(matchesRoleCategory('SUPPORTER_OFFENSIVE', ['ATTACKER'])).toBe(false);
    });

    it('unknown role (undefined) never matches — conservative', () => {
        expect(matchesRoleCategory(undefined, ['ATTACKER', 'DEBUFFER'])).toBe(false);
    });
});
