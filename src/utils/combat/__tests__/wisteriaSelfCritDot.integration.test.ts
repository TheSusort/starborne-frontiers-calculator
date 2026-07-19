/**
 * Coverage follow-up for Wave 8 Task 10 (Wisteria self-crit Corrosion → Inferno II).
 *
 * Task 10 (commit 1ccc76f6) added a NEW reactive trigger `on-self-crit-dot`
 * (src/types/abilities.ts + a listener case in src/utils/combat/triggers.ts ~515-535,
 * gated on `e.viaCrit && e.sourceId === ownerId`). wave8Wisteria.test.ts only asserts the
 * parsed ability SHAPE — nothing exercises the reactive ENGINE path proving the trigger
 * actually dispatches at runtime. This file mirrors allyCritDot.test.ts's structure
 * (Task 2's direct registerReactiveListeners unit test + Task 5's simulateDPS integration
 * test) for the self-subject sibling trigger.
 */
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `scd${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

describe('wisteriaSelfCritDot – on-self-crit-dot reactive listener (unit)', () => {
    // ── Direct unit test of registerReactiveListeners ────────────────────────
    // Hand-rolled bus, mirrors allyCritDot.test.ts's Task 2 scenario table but flipped:
    // on-self-crit-dot fires ONLY for the OWNER's own crit-cast dot-applied, never an
    // ally's or an enemy's, and never without viaCrit.
    it('enqueues only for the OWNER’s own viaCrit dot-applied, not ally/enemy/non-crit', () => {
        const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
        const handBus = {
            on<T extends CombatEvent['type']>(
                type: T,
                listener: (event: Extract<CombatEvent, { type: T }>) => void
            ) {
                const existing = listeners.get(type) ?? [];
                listeners.set(type, [...existing, listener as unknown as (e: CombatEvent) => void]);
            },
            emit(event: CombatEvent) {
                for (const l of listeners.get(event.type) ?? []) l(event);
            },
        };

        const enqueued: Intent[] = [];

        const infernoAbility: Ability = {
            id: 'self-crit-dot-ability',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-self-crit-dot',
            conditions: [],
            config: { type: 'dot', dotType: 'inferno', tier: 30, stacks: 1, duration: 2 },
        };

        const ra: ReactiveAbility = { ability: infernoAbility, sourceSlot: 'passive' };

        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'attacker', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing: (id) => id === 'enemy',
        });

        const baseEvent = {
            targetId: 'enemy',
            round: 1,
            dotType: 'corrosion' as const,
            stacks: 1,
        };

        // Scenario A: the OWNER's own cast (attacker) with viaCrit → should enqueue 1.
        handBus.emit({ type: 'dot-applied', sourceId: 'attacker', viaCrit: true, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario B: another player (team-1) with viaCrit → NOT the owner → excluded → 0 more.
        handBus.emit({ type: 'dot-applied', sourceId: 'team-1', viaCrit: true, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario C: enemy with viaCrit → excluded → 0 more.
        handBus.emit({ type: 'dot-applied', sourceId: 'enemy', viaCrit: true, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario D: owner's own cast WITHOUT viaCrit → no crit, skip → 0 more.
        handBus.emit({ type: 'dot-applied', sourceId: 'attacker', ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario E: explicit viaCrit: false on the owner's own cast (the emission never sets
        // this — it omits the field — but the falsy guard must treat both shapes identically)
        // → 0 more.
        handBus.emit({ type: 'dot-applied', sourceId: 'attacker', viaCrit: false, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Sanity: the gate is genuinely load-bearing. If the `e.sourceId === ownerId` half of
        // the guard were dropped (regressing to "any crit-cast dot, ally included"), Scenario B
        // alone would have already pushed length to 2 above. Confirms this test would fail
        // (not vacuously pass) if that clause were removed or broadened.
        expect(enqueued).toHaveLength(1);
    });
});

// ── Integration tests (engine-level, via simulateDPS) ─────────────────────────────────────
//
// Fixture: a SINGLE focus actor (id 'attacker') whose active applies damage + Corrosion and
// whose crit is 100 (every cast crits → viaCrit: true on every self-applied dot-applied event),
// plus an `on-self-crit-dot` passive reactive Inferno II dot. No team actors are needed —
// unlike on-ally-crit-dot (which requires an OTHER actor's crit-cast), on-self-crit-dot fires
// off the owner's OWN crit-cast DoT infliction.
const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    // hacking=100, enemySecurity=0 → debuffLandingChance=1.0 → DoTs always land.
    hacking: 100,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

/** Active damage+Corrosion + passive on-self-crit-dot Inferno II reactive. */
const selfCritDotSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ab({
                        type: 'dot',
                        config: {
                            type: 'dot',
                            dotType: 'corrosion',
                            tier: 5,
                            stacks: 1,
                            duration: 3,
                        },
                    }),
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-self-crit-dot',
                        config: {
                            type: 'dot',
                            dotType: 'inferno',
                            tier: 30,
                            stacks: 1,
                            duration: 2,
                        },
                    }),
                ],
            },
        ],
    };
};

describe('wisteriaSelfCritDot – engine integration (simulateDPS)', () => {
    // ── Test 1: crit=100 → the owner's own crit-cast Corrosion triggers on-self-crit-dot,
    // which injects the reactive Inferno II → infernoDamage > 0 on tick rounds.
    it('crit=100: on-self-crit-dot fires off the owner’s own crit-cast Corrosion, injecting Inferno II (infernoDamage > 0)', () => {
        idCounter = 0;
        const result = simulateDPS({ ...BASE, shipSkills: selfCritDotSkills() });

        // Round 1: the active casts (crits, applies Corrosion with viaCrit: true) which
        // triggers on-self-crit-dot -> Inferno II is injected same round via the executor,
        // and both DoTs tick from round 1 onward — the reactive Inferno II must show up.
        const infernoRounds = result.rounds.filter((r) => r.infernoDamage > 0);
        expect(infernoRounds.length).toBeGreaterThan(0);
        // Corrosion (the triggering DoT) also ticks every round, unaffected by the addition.
        for (const row of result.rounds) {
            expect(row.corrosionDamage).toBeGreaterThan(0);
        }
    });

    // ── Test 2: crit=0 → no viaCrit → on-self-crit-dot never fires -> infernoDamage stays 0.
    // This is the negative mirror proving the trigger depends on viaCrit, not just on
    // Corrosion being applied at all (Corrosion still lands and ticks every round).
    it('crit=0: on-self-crit-dot never fires (infernoDamage stays 0 every round) though Corrosion still ticks', () => {
        idCounter = 0;
        const result = simulateDPS({
            ...BASE,
            crit: 0,
            critDamage: 0,
            shipSkills: selfCritDotSkills(),
        });

        for (const row of result.rounds) {
            expect(row.infernoDamage).toBe(0);
        }
        for (const row of result.rounds) {
            expect(row.corrosionDamage).toBeGreaterThan(0);
        }
    });
});
