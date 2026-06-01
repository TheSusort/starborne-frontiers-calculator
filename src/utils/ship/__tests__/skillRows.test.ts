import { describe, it, expect } from 'vitest';
import { getSkillRowForSlot } from '../skillRows';
import { Ship } from '../../../types/ship';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

describe('getSkillRowForSlot', () => {
    const s = ship({
        activeSkillText: 'Active deals 100% damage',
        chargeSkillText: 'Charged deals 300% damage',
        chargeSkillCharge: 3,
        secondPassiveSkillText: 'Passive grants Attack Up II', // refits=2 → Passive R2
    });

    it('maps active slot to the Active row', () => {
        const row = getSkillRowForSlot(s, 'active');
        expect(row?.label).toBe('Active');
        expect(row?.text).toContain('100% damage');
    });

    it('maps charged slot to the Charge row (with charge cost)', () => {
        const row = getSkillRowForSlot(s, 'charged');
        expect(row?.label).toBe('Charge');
        expect(row?.charge).toBe(3);
        expect(row?.text).toContain('300% damage');
    });

    it('maps passive slot to the refit-active Passive row', () => {
        const row = getSkillRowForSlot(s, 'passive');
        expect(row?.label.startsWith('Passive')).toBe(true);
        expect(row?.text).toContain('Attack Up II');
    });

    it('returns undefined when the slot has no text', () => {
        const noCharge = ship({ activeSkillText: 'Active deals 100% damage' });
        expect(getSkillRowForSlot(noCharge, 'charged')).toBeUndefined();
        expect(getSkillRowForSlot(noCharge, 'passive')).toBeUndefined();
    });
});
