import { describe, it, expect } from 'vitest';
import { createEventBus, CombatEvent } from '../events';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { Ability } from '../../../types/abilities';

// ── Direct unit test of registerReactiveListeners for on-self-damaged ──────────
// The OWNER taking a direct hit (tank self-sustain: "when directly damaged, repairs…")
// enqueues once per hit. The onCritHit tri-state filters in the LISTENER against the
// event's didCrit flag:
//   - absent onCritHit  → fires on EVERY hit
//   - onCritHit false    → fires on NON-crit hits only
//   - onCritHit true     → fires on CRIT hits only
describe('on-self-damaged reactive listener', () => {
    const heal = (onCritHit?: boolean): Ability => ({
        id: `heal-${String(onCritHit)}`,
        type: 'heal',
        target: 'self',
        trigger: 'on-self-damaged',
        conditions: [],
        config: {
            type: 'heal',
            pct: 3,
            basis: 'hp',
            ...(onCritHit !== undefined ? { onCritHit } : {}),
        },
    });

    const setup = (abilities: Ability[]) => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        const ras: ReactiveAbility[] = abilities.map((ability) => ({
            ability,
            sourceSlot: 'passive' as const,
        }));
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'tank', reactiveAbilities: ras }],
            enqueue: (intent) => enqueued.push(intent),
            enemyId: 'enemy',
        });
        return { bus, enqueued };
    };

    const dmg = (
        targetId: string,
        didCrit?: boolean
    ): Extract<CombatEvent, { type: 'damage-taken' }> => ({
        type: 'damage-taken',
        targetId,
        round: 1,
        amount: 1000,
        ...(didCrit !== undefined ? { didCrit } : {}),
    });

    it('no-flag heal fires on every owner hit (crit or not); foreign target excluded', () => {
        const { bus, enqueued } = setup([heal()]);
        bus.emit(dmg('tank')); // non-crit
        expect(enqueued).toHaveLength(1);
        bus.emit(dmg('tank', true)); // crit
        expect(enqueued).toHaveLength(2);
        bus.emit(dmg('someone-else', true)); // foreign target → none
        expect(enqueued).toHaveLength(2);
    });

    it('non-crit hit (didCrit absent) enqueues no-flag and false-flag, NOT true-flag', () => {
        const { bus, enqueued } = setup([heal(), heal(false), heal(true)]);
        bus.emit(dmg('tank')); // didCrit absent → treated as non-crit
        expect(enqueued).toHaveLength(2);
        expect(enqueued.map((i) => i.ability.config)).toEqual([
            expect.objectContaining({ pct: 3 }), // no-flag
            expect.objectContaining({ onCritHit: false }),
        ]);
    });

    it('crit hit (didCrit true) enqueues no-flag and true-flag, NOT false-flag', () => {
        const { bus, enqueued } = setup([heal(), heal(false), heal(true)]);
        bus.emit(dmg('tank', true));
        expect(enqueued).toHaveLength(2);
        expect(enqueued.map((i) => i.ability.config)).toEqual([
            expect.objectContaining({ pct: 3 }), // no-flag
            expect.objectContaining({ onCritHit: true }),
        ]);
    });
});
