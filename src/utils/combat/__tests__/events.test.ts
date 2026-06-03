import { describe, expect, it } from 'vitest';
import { createEventBus, CombatEvent } from '../events';

describe('createEventBus', () => {
    it('dispatches to listeners of the matching type in registration order', () => {
        const bus = createEventBus();
        const seen: string[] = [];
        bus.on('turn-started', () => seen.push('a'));
        bus.on('turn-started', () => seen.push('b'));
        bus.on('turn-ended', () => seen.push('x'));
        bus.emit({ type: 'turn-started', actorId: 'attacker', round: 1 });
        expect(seen).toEqual(['a', 'b']);
    });

    it('narrows the event type for listeners', () => {
        const bus = createEventBus();
        let dmg = 0;
        bus.on('ability-performed', (e) => {
            dmg = e.damage ?? 0;
        });
        bus.emit({
            type: 'ability-performed',
            actorId: 'attacker',
            targetId: 'enemy',
            round: 2,
            abilityType: 'damage',
            damage: 1234,
            didCrit: true,
            didHit: true,
        });
        expect(dmg).toBe(1234);
    });

    it('is a no-op with no listeners', () => {
        const bus = createEventBus();
        expect(() =>
            bus.emit({ type: 'ship-destroyed', actorId: 'enemy', round: 3 })
        ).not.toThrow();
    });
});
