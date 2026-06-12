import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import type { Ability } from '../../../types/abilities';
import { registerReactiveListeners, Intent } from '../triggers';
import { createEventBus } from '../events';

describe('Phase 4c PR 4 — enemy-action triggers', () => {
    it('registers on-enemy-repaired and on-enemy-cleansed as live triggers', () => {
        expect(LIVE_TRIGGERS.has('on-enemy-repaired')).toBe(true);
        expect(LIVE_TRIGGERS.has('on-enemy-cleansed')).toBe(true);
    });

    function reactiveAbility(trigger: Ability['trigger']): Ability {
        return {
            id: `${trigger}-ab`,
            type: 'charge',
            target: 'self',
            trigger,
            conditions: [],
            config: { type: 'charge', amount: 1 },
        };
    }

    it('on-enemy-repaired enqueues only for enemy-side heal-performed', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'zosimos',
                    reactiveAbilities: [
                        { ability: reactiveAbility('on-enemy-repaired'), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => enqueued.push(i),
            isEnemySide: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'heal-performed',
            casterId: 'enemy',
            targets: ['enemy'],
            round: 1,
            amount: 0,
        });
        bus.emit({
            type: 'heal-performed',
            casterId: 'ally',
            targets: ['tank'],
            round: 1,
            amount: 100,
        });
        expect(enqueued).toHaveLength(1);
    });

    it('on-enemy-cleansed enqueues only for enemy-side cleanse-performed', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'grif',
                    reactiveAbilities: [
                        { ability: reactiveAbility('on-enemy-cleansed'), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => enqueued.push(i),
            isEnemySide: (id) => id === 'enemy',
        });
        bus.emit({ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 1 });
        bus.emit({ type: 'cleanse-performed', casterId: 'ally', count: 1, round: 1 });
        expect(enqueued).toHaveLength(1);
    });
});
