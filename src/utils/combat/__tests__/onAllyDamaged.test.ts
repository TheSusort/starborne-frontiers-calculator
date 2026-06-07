import { describe, it, expect } from 'vitest';
import { createEventBus, CombatEvent } from '../events';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { Ability } from '../../../types/abilities';

// ── Direct unit test of registerReactiveListeners for on-ally-damaged ──────────
// An ALLY (any other player actor) taking a direct hit enqueues once per hit; the
// owner's OWN hits are excluded (self-damage reactions are the Phase-4 on-attacked seam).
describe('on-ally-damaged reactive listener', () => {
    it('enqueues once per ally damage-taken; owner hits and zero-fan-out excluded', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        const healAbility: Ability = {
            id: 'cultivator-r2-heal',
            type: 'heal',
            target: 'ally',
            trigger: 'on-ally-damaged',
            conditions: [],
            config: { type: 'heal', pct: 8, basis: 'hp' },
        };
        const ra: ReactiveAbility = { ability: healAbility, sourceSlot: 'passive' };

        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'healer', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            enemyId: 'enemy',
        });

        const dmg = (targetId: string): Extract<CombatEvent, { type: 'damage-taken' }> => ({
            type: 'damage-taken',
            targetId,
            round: 1,
            amount: 1000,
        });

        // Ally (the heal target) takes a hit → 1 enqueue.
        bus.emit(dmg('target-ally'));
        expect(enqueued).toHaveLength(1);

        // A SECOND ally hit (e.g. a second enemy attacker) → fires again (per-hit).
        bus.emit(dmg('target-ally'));
        expect(enqueued).toHaveLength(2);

        // The OWNER itself takes a direct hit → excluded (Phase-4 on-attacked seam).
        bus.emit(dmg('healer'));
        expect(enqueued).toHaveLength(2);
    });
});
