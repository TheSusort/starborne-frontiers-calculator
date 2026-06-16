/**
 * Unit tests for the per-call isOpposing predicate in registerReactiveListeners.
 *
 * Purpose: verify that enemy owners' on-enemy-destroyed / on-ally-destroyed triggers route
 * against the CORRECT side (the player team is opposing for an enemy owner, not the enemy
 * side). This is the bySide PR2 fix. Other reactive triggers (on-ally-crit, etc.) are
 * covered by triggers.test.ts.
 *
 * These tests drive registerReactiveListeners directly with a fake bus and spy enqueue,
 * so they are fast, isolated, and free of golden-snapshot concerns.
 */

import { describe, it, expect } from 'vitest';
import { createEventBus } from '../events';
import { registerReactiveListeners, ReactiveAbility, Intent } from '../triggers';
import type { Ability } from '../../../types/abilities';

// ---------------------------------------------------------------------------
// Minimal ability builder (mirrors the ab() helper in triggers.test.ts)
// ---------------------------------------------------------------------------
let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// A simple buff ability config used in reactive slots (no extra-action complexity).
const buffAbility = (trigger: Ability['trigger']): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        trigger,
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 20 },
            stacks: 1,
            isStackable: false,
        },
    });

const makeRA = (trigger: Ability['trigger']): ReactiveAbility => ({
    ability: buffAbility(trigger),
    sourceSlot: 'passive',
});

// ---------------------------------------------------------------------------
// Scenario 1 — enemy owner E1 with on-enemy-destroyed
//   isOpposing = (id) => id === 'P1' || id === 'P2'  (player team is opposing)
//   Emitting ship-destroyed for P1 (opposing) → should enqueue once
//   Emitting ship-destroyed for E2 (same-side) → should NOT enqueue
// ---------------------------------------------------------------------------
describe('enemy owner on-enemy-destroyed', () => {
    it('fires for an opposing (player) actor death and NOT for a same-side actor death', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        const isOpposing = (id: string) => id === 'P1' || id === 'P2';

        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'E1',
                    reactiveAbilities: [makeRA('on-enemy-destroyed')],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing,
        });

        // Opposing actor dies → should fire
        bus.emit({ type: 'ship-destroyed', actorId: 'P1', round: 1 });

        // Same-side actor dies → should NOT fire
        bus.emit({ type: 'ship-destroyed', actorId: 'E2', round: 1 });

        expect(enqueued.length).toBe(1);
        expect(enqueued[0].ownerId).toBe('E1');
    });
});

// ---------------------------------------------------------------------------
// Scenario 2 — enemy owner E1 with on-ally-destroyed
//   isOpposing = (id) => id === 'P1'
//   E2 (same-side non-self) → should fire
//   E1 (self) → should NOT fire (self-death goes to on-destroyed)
//   P1 (opposing) → should NOT fire (opposing is never an ally)
// ---------------------------------------------------------------------------
describe('enemy owner on-ally-destroyed', () => {
    it('fires for same-side non-self and NOT for self or opposing actors', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        const isOpposing = (id: string) => id === 'P1';

        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'E1',
                    reactiveAbilities: [makeRA('on-ally-destroyed')],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing,
        });

        // E2: same-side, non-self → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'E2', round: 1 });

        // E1: self → does NOT fire (own death is on-destroyed's job)
        bus.emit({ type: 'ship-destroyed', actorId: 'E1', round: 1 });

        // P1: opposing → does NOT fire (opposing is never an ally)
        bus.emit({ type: 'ship-destroyed', actorId: 'P1', round: 1 });

        expect(enqueued.length).toBe(1);
        expect(enqueued[0].ownerId).toBe('E1');
    });
});

// ---------------------------------------------------------------------------
// Scenario 3 — player-call parity
//   owner 'attacker', isOpposing = isEnemySide = (id) => id === 'enemy'
//   on-ally-destroyed:
//     T1 (ally player) → fires
//     'enemy' → does NOT fire (opposing)
//     'attacker' (self) → does NOT fire
// ---------------------------------------------------------------------------
describe('player owner on-ally-destroyed (parity check)', () => {
    it('fires for team ally death and NOT for enemy or self', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        // Classic player-call predicate: isEnemySide
        const isOpposing = (id: string) => id === 'enemy';

        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'attacker',
                    reactiveAbilities: [makeRA('on-ally-destroyed')],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing,
        });

        // T1: ally player actor → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'T1', round: 1 });

        // 'enemy': opposing actor → does NOT fire
        bus.emit({ type: 'ship-destroyed', actorId: 'enemy', round: 1 });

        // 'attacker': self → does NOT fire
        bus.emit({ type: 'ship-destroyed', actorId: 'attacker', round: 1 });

        expect(enqueued.length).toBe(1);
        expect(enqueued[0].ownerId).toBe('attacker');
    });
});
