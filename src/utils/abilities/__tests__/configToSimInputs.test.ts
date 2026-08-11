import { describe, it, expect } from 'vitest';
import { buildDefaultShipSkills, buildEmptyShipSkills } from '../configToSimInputs';

describe('configToSimInputs', () => {
    describe('buildEmptyShipSkills', () => {
        it('returns a kit with no slots and therefore no abilities', () => {
            const kit = buildEmptyShipSkills();
            expect(kit.slots).toEqual([]);
        });
    });

    describe('buildDefaultShipSkills', () => {
        it('returns one active slot with a single damage ability multiplier 100', () => {
            const result = buildDefaultShipSkills();

            expect(result.slots).toHaveLength(1);
            expect(result.slots[0].slot).toBe('active');
            expect(result.slots[0].abilities).toHaveLength(1);

            const ability = result.slots[0].abilities[0];
            expect(ability.type).toBe('damage');
            expect(ability.target).toBe('enemy');
            expect(ability.trigger).toBe('on-cast');
            expect(ability.conditions).toEqual([]);
            expect(ability.config.type).toBe('damage');
            if (ability.config.type === 'damage') {
                expect(ability.config.multiplier).toBe(100);
            }
        });

        it('does not include a charged slot', () => {
            const result = buildDefaultShipSkills();
            const hasChargedSlot = result.slots.some((s) => s.slot === 'charged');
            expect(hasChargedSlot).toBe(false);
        });
    });
});
