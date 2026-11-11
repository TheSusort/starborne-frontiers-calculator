/**
 * TRIPWIRE: every trigger in `LIVE_TRIGGERS` is bound by `registerReactiveListeners`. A live trigger
 * is routed reactive (`partitionReactiveAbilities`), so it is neither cast nor seeded at combat
 * start: a trigger added to the set without a listener case silently never fires.
 */
import { describe, it, expect } from 'vitest';
import { registerReactiveListeners, type ReactiveAbility } from '../triggers';
import { createEventBus, type CombatEventBus } from '../events';
import { LIVE_TRIGGERS, type AbilityTrigger } from '../../../types/abilities';

const reactiveOn = (trigger: AbilityTrigger): ReactiveAbility => ({
    ability: {
        id: `probe-${trigger}`,
        type: 'buff',
        target: 'self',
        trigger,
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Probe',
            duration: 1,
            stacks: 1,
            isStackable: false,
            parsedEffects: {},
        },
    },
    sourceSlot: 'passive',
});

/** How many bus subscriptions registering one ability on `trigger` makes. */
const subscriptionsFor = (trigger: AbilityTrigger): number => {
    const inner = createEventBus();
    let count = 0;
    const bus: CombatEventBus = {
        on: (type, listener) => {
            count++;
            inner.on(type, listener);
        },
        emit: (event) => inner.emit(event),
    };
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: 'owner', reactiveAbilities: [reactiveOn(trigger)] }],
        enqueue: () => {},
        isOpposing: (id) => id === 'enemy',
    });
    return count;
};

describe('every live trigger has a listener', () => {
    const baseline = subscriptionsFor('pre-combat');

    it.each([...LIVE_TRIGGERS])('%s subscribes to the bus', (trigger) => {
        expect(subscriptionsFor(trigger)).toBeGreaterThan(baseline);
    });
});
