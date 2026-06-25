import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import { createEventBus, type CombatEvent } from '../events';

describe('shield-applied event + on-shield-applied trigger (H3.5 definitions)', () => {
    it('includes on-shield-applied in LIVE_TRIGGERS', () => {
        expect(LIVE_TRIGGERS.has('on-shield-applied')).toBe(true);
    });

    it('emits and consumes a shield-applied event with the right fields', () => {
        const bus = createEventBus();
        const captured: CombatEvent[] = [];
        bus.on('shield-applied', (e) => captured.push(e));

        bus.emit({
            type: 'shield-applied',
            granterId: 'a',
            recipientIds: ['b', 'c'],
            round: 1,
            amount: 500,
        });

        expect(captured).toHaveLength(1);
        const event = captured[0];
        expect(event.type).toBe('shield-applied');
        if (event.type === 'shield-applied') {
            expect(event.granterId).toBe('a');
            expect(event.recipientIds).toEqual(['b', 'c']);
            expect(event.round).toBe(1);
            expect(event.amount).toBe(500);
        }
    });
});
