/**
 * Snakeroot counts the DoT stacks inflicted on each enemy ("120% damage for every 4 stacks of
 * damage over time inflicted onto a single enemy"). A Toxic Overflow spread is an infliction: its
 * landing emits a `dot-applied` (one stack) and the spread then announces itself on
 * `corrosion-spread`. The stack counts once, from the landing.
 */
import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '../events';
import type { Ability } from '../../../types/abilities';
import { registerReactiveListeners, Intent } from '../triggers';

const handBus = () => {
    const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
    return {
        on<T extends CombatEvent['type']>(
            type: T,
            listener: (event: Extract<CombatEvent, { type: T }>) => void
        ) {
            listeners.set(type, [
                ...(listeners.get(type) ?? []),
                listener as unknown as (e: CombatEvent) => void,
            ]);
        },
        emit(event: CombatEvent) {
            for (const l of listeners.get(event.type) ?? []) l(event);
        },
    };
};

describe('Snakeroot counts a spread Corrosion stack once', () => {
    it('a spread landing (dot-applied + corrosion-spread) adds one stack, not two', () => {
        const bus = handBus();
        const enqueued: Intent[] = [];
        const snakeroot: Ability = {
            id: 'snakeroot-every-2',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-dot-stacks-crossed',
            conditions: [],
            config: { type: 'damage', multiplier: 120, everyDotStacks: 2 },
        };
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'snakeroot',
                    reactiveAbilities: [{ ability: snakeroot, sourceSlot: 'passive' }],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing: (id) => id.startsWith('enemy'),
        });
        bus.emit({
            type: 'dot-applied',
            sourceId: 'hemlock',
            targetId: 'enemy-b',
            round: 1,
            dotType: 'corrosion',
            stacks: 1,
            tier: 3,
        });
        bus.emit({
            type: 'corrosion-spread',
            sourceId: 'enemy-a',
            affectedIds: ['enemy-b'],
            round: 1,
        });
        expect(enqueued).toHaveLength(0);
        // Control: a second landed stack crosses the step.
        bus.emit({
            type: 'dot-applied',
            sourceId: 'hemlock',
            targetId: 'enemy-b',
            round: 1,
            dotType: 'corrosion',
            stacks: 1,
            tier: 3,
        });
        expect(enqueued).toHaveLength(1);
    });
});
