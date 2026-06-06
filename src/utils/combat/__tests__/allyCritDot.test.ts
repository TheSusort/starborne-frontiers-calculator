/**
 * Tests for:
 *  Task 1 — viaCrit on dot-applied: player-cast DoTs carry `viaCrit: true` when the
 *            applying cast had >= 1 critting hit; absent otherwise; executor-applied
 *            dots never carry it.
 *  Task 2 — on-ally-crit-dot reactive listener: another player's crit-cast DoT
 *            infliction enqueues the intent; own casts, enemy casts, and non-crit
 *            DoTs do not.
 */
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `acd${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 0,
    critDamage: 0,
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

/** Single-hit active with damage + corrosion DoT ability. */
const dotSkills = (): ShipSkills => {
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
        ],
    };
};

describe('allyCritDot – Task 1: viaCrit on dot-applied', () => {
    // ── Test 1: crit=100 → every dot-applied carries viaCrit: true ──────────
    it('crit=100: every dot-applied event carries viaCrit: true', () => {
        const bus = createEventBus();
        const dotEvents: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
        bus.on('dot-applied', (e) => dotEvents.push(e));

        simulateDPS({ ...BASE, crit: 100, critDamage: 100, shipSkills: dotSkills(), bus });

        expect(dotEvents.length).toBeGreaterThan(0);
        for (const e of dotEvents) {
            expect(e.viaCrit).toBe(true);
        }
    });

    // ── Test 2: crit=0 → no viaCrit property on dot-applied events ──────────
    it('crit=0: dot-applied events have no viaCrit property (absent, not false)', () => {
        const bus = createEventBus();
        const dotEvents: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
        bus.on('dot-applied', (e) => dotEvents.push(e));

        simulateDPS({ ...BASE, crit: 0, shipSkills: dotSkills(), bus });

        expect(dotEvents.length).toBeGreaterThan(0);
        for (const e of dotEvents) {
            expect('viaCrit' in e).toBe(false);
        }
    });

    // ── Test 3: executor-applied dot never carries viaCrit ───────────────────
    // A reactive dot (trigger: 'start-of-round') fires through the executor.
    // Its dot-applied events should NEVER carry viaCrit, even at crit=100.
    // The executor emission at triggers.ts ~485-492 deliberately omits viaCrit
    // (drain-time has no crit outcome).
    it('executor-applied dot (start-of-round reactive) never carries viaCrit at crit=100', () => {
        const bus = createEventBus();
        const executorDotEvents: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
        bus.on('dot-applied', (e) => executorDotEvents.push(e));

        idCounter = 0;
        const reactiveSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'dot',
                            target: 'enemy',
                            trigger: 'start-of-round',
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
            ],
        };

        simulateDPS({
            ...BASE,
            crit: 100,
            critDamage: 100,
            shipSkills: reactiveSkills,
            bus,
        });

        // The reactive dot fires through the executor every round.
        expect(executorDotEvents.length).toBeGreaterThan(0);
        for (const e of executorDotEvents) {
            // Executor-emitted events must NOT carry viaCrit.
            expect('viaCrit' in e).toBe(false);
        }
    });
});
