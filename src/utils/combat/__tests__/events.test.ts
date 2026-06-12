import { describe, expect, it } from 'vitest';
import { CombatEvent, createEventBus } from '../events';

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

    it('ship-destroyed round-trips with an arbitrary actorId (generalized contract)', () => {
        const bus = createEventBus();
        const received: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => received.push({ actorId: e.actorId, round: e.round }));
        bus.emit({ type: 'ship-destroyed', actorId: 'team-actor-1', round: 5 });
        expect(received).toEqual([{ actorId: 'team-actor-1', round: 5 }]);
    });

    it('cheat-death-activated round-trips through the bus', () => {
        const bus = createEventBus();
        const received: { actorId: string; round: number }[] = [];
        bus.on('cheat-death-activated', (e) =>
            received.push({ actorId: e.actorId, round: e.round })
        );
        bus.emit({ type: 'cheat-death-activated', actorId: 'tank', round: 2 });
        expect(received).toEqual([{ actorId: 'tank', round: 2 }]);
    });

    it('delivers cleanse-performed to listeners', () => {
        const bus = createEventBus();
        const seen: CombatEvent[] = [];
        bus.on('cleanse-performed', (e) => seen.push(e));
        bus.emit({ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 2 });
        expect(seen).toEqual([
            { type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 2 },
        ]);
    });
});
