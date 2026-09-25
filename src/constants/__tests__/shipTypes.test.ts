import { describe, expect, it } from 'vitest';
import { matchesRoleCategory, resolveRoleEntry, toShipTypeName } from '../shipTypes';
import type { ShipTypeName } from '../shipTypes';

describe('toShipTypeName (#564)', () => {
    it('accepts a real role name, uppercasing it', () => {
        expect(toShipTypeName('ATTACKER')).toBe('ATTACKER');
        expect(toShipTypeName('debuffer_bomber')).toBe('DEBUFFER_BOMBER');
    });

    it('falls back to ATTACKER for a role outside the union', () => {
        expect(toShipTypeName('RETIRED_ROLE')).toBe('ATTACKER');
        expect(toShipTypeName('')).toBe('ATTACKER');
    });
});

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

describe('resolveRoleEntry', () => {
    const table: Partial<Record<ShipTypeName, string>> = {
        ATTACKER: 'attacker-entry',
        DEFENDER: 'defender-entry',
        SUPPORTER: 'supporter-entry',
        SUPPORTER_BUFFER: 'supporter-buffer-entry',
        DEBUFFER: 'debuffer-entry',
    };

    it('an exact-match role (ATTACKER) resolves to its own entry, unchanged', () => {
        expect(resolveRoleEntry(table, 'ATTACKER')).toBe('attacker-entry');
    });

    it('SUPPORTER_BUFFER resolves to its own entry, NOT the SUPPORTER category fallback', () => {
        // Proves the resolver is "exact match first, category second" rather than
        // "always use the category" — that shortcut would also pass every other
        // case in this file since SUPPORTER_BUFFER falls under the SUPPORTER category.
        expect(resolveRoleEntry(table, 'SUPPORTER_BUFFER')).toBe('supporter-buffer-entry');
        expect(resolveRoleEntry(table, 'SUPPORTER_BUFFER')).not.toBe(
            resolveRoleEntry(table, 'SUPPORTER')
        );
    });

    it('a role with no exact entry falls back to its category entry', () => {
        expect(resolveRoleEntry(table, 'DEFENDER_SECURITY')).toBe('defender-entry');
        expect(resolveRoleEntry(table, 'DEBUFFER_BOMBER')).toBe('debuffer-entry');
        expect(resolveRoleEntry(table, 'DEBUFFER_CORROSION')).toBe('debuffer-entry');
        expect(resolveRoleEntry(table, 'SUPPORTER_SHIELD')).toBe('supporter-entry');
        expect(resolveRoleEntry(table, 'SUPPORTER_OFFENSIVE')).toBe('supporter-entry');
    });

    it('returns undefined when neither the role nor its category has an entry', () => {
        const sparse: Partial<Record<ShipTypeName, string>> = { ATTACKER: 'attacker-entry' };
        expect(resolveRoleEntry(sparse, 'DEFENDER_SECURITY')).toBeUndefined();
    });
});
