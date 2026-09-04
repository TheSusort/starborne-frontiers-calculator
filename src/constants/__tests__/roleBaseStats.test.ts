import { describe, it, expect } from 'vitest';
import { ROLE_BASE_STATS, getBaseRoleStats } from '../roleBaseStats';

describe('getBaseRoleStats', () => {
    it('maps each base role to its own table', () => {
        expect(getBaseRoleStats('ATTACKER')).toBe(ROLE_BASE_STATS.ATTACKER);
        expect(getBaseRoleStats('DEFENDER')).toBe(ROLE_BASE_STATS.DEFENDER);
        expect(getBaseRoleStats('DEBUFFER')).toBe(ROLE_BASE_STATS.DEBUFFER);
        expect(getBaseRoleStats('SUPPORTER')).toBe(ROLE_BASE_STATS.SUPPORTER);
    });

    it('maps variant roles to their base role', () => {
        expect(getBaseRoleStats('DEFENDER_SECURITY')).toBe(ROLE_BASE_STATS.DEFENDER);
        expect(getBaseRoleStats('DEBUFFER_BOMBER')).toBe(ROLE_BASE_STATS.DEBUFFER);
        expect(getBaseRoleStats('DEBUFFER_CORROSION')).toBe(ROLE_BASE_STATS.DEBUFFER);
        expect(getBaseRoleStats('SUPPORTER_SHIELD')).toBe(ROLE_BASE_STATS.SUPPORTER);
        expect(getBaseRoleStats('SUPPORTER_OFFENSIVE')).toBe(ROLE_BASE_STATS.SUPPORTER);
    });

    it('keeps the attacker table as the fallback', () => {
        expect(getBaseRoleStats('ATTACKER').attack).toBe(6250);
    });
});
