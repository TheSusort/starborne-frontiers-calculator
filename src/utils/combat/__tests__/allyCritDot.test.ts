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
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';

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

describe('allyCritDot – Task 2: on-ally-crit-dot reactive listener', () => {
    // ── Direct unit test of registerReactiveListeners ────────────────────────
    // Build a hand-rolled bus and assert enqueue counts per dot-applied scenario.
    it('enqueues only for other players viaCrit dot-applied, not own/enemy/non-crit', () => {
        // Hand-rolled minimal event bus.
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

        // Reactive dot ability with on-ally-crit-dot trigger.
        const dotAbility: Ability = {
            id: 'ally-crit-dot-ability',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-ally-crit-dot',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 3 },
        };

        const ra: ReactiveAbility = { ability: dotAbility, sourceSlot: 'passive' };

        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'attacker', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isEnemySide: (id) => id === 'enemy',
        });

        const baseEvent = {
            targetId: 'enemy',
            round: 1,
            dotType: 'corrosion' as const,
            stacks: 1,
        };

        // Scenario A: another player (team-1) with viaCrit → should enqueue 1.
        handBus.emit({ type: 'dot-applied', sourceId: 'team-1', viaCrit: true, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario B: own cast (attacker) with viaCrit → own cast excluded → 0 additional.
        handBus.emit({ type: 'dot-applied', sourceId: 'attacker', viaCrit: true, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario C: enemy with viaCrit → enemy excluded → 0 additional.
        handBus.emit({ type: 'dot-applied', sourceId: 'enemy', viaCrit: true, ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario D: another player (team-1) WITHOUT viaCrit → no crit, skip → 0 additional.
        handBus.emit({ type: 'dot-applied', sourceId: 'team-1', ...baseEvent });
        expect(enqueued).toHaveLength(1);

        // Scenario E: explicit viaCrit: false (the emission never sets this — it omits the
        // field — but the falsy guard must treat both shapes identically) → 0 additional.
        handBus.emit({ type: 'dot-applied', sourceId: 'team-1', viaCrit: false, ...baseEvent });
        expect(enqueued).toHaveLength(1);
    });
});

// ── Task 5: integration tests (engine-level) ──────────────────────────────────────────────────────
//
// Fixture: focus actor (attacker) with an `on-ally-crit-dot` passive reactive corrosion +
// a plain damage active; ONE walked team actor whose active applies damage + corrosion and
// whose crit is 100 (every cast crits → viaCrit: true on every team-applied dot-applied event).
// Speed order: team (130) → attacker (100) → enemy (50). Both actors' debuffLandingChance = 1.0
// (hacking 100, enemySecurity 0) so every DoT always lands. Corrosion tick formula:
//   stacks × (tier/100) × min(enemyHp, 500_000) × dotMult × affinityMult
// With tier=5, stacks=1, enemyHp=10_000_000 (stays ≫ 500_000), neutral affinity:
//   1 × 0.05 × 500_000 × 1.0 × 1.0 = 25_000 per entry per tick.

const TASK5_BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 0, // focus actor does NOT crit — keeps its own dots out of viaCrit events
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 100,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
    speed: 100,
    enemySpeed: 50,
};

/** Focus shipSkills: plain damage active + on-ally-crit-dot reactive corrosion passive. */
const focusSkillsT5 = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-ally-crit-dot',
                        config: {
                            type: 'dot',
                            dotType: 'corrosion',
                            tier: 5,
                            stacks: 1,
                            duration: 2,
                        },
                    }),
                ],
            },
        ],
    };
};

/** Team actor entry whose active crit-cast applies a corrosion DoT. */
const teamActorT5 = () => ({
    id: 'team-1',
    speed: 130, // acts BEFORE the focus actor (100) and enemy (50)
    chargeCount: 0,
    startCharged: false as const,
    selfBuffs: [] as [],
    enemyDebuffs: [] as [],
    shipSkills: {
        slots: [
            {
                slot: 'active' as const,
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                    ab({
                        type: 'dot',
                        config: {
                            type: 'dot',
                            dotType: 'corrosion',
                            tier: 5,
                            stacks: 1,
                            duration: 2,
                        },
                    }),
                ],
            },
        ],
    } as ShipSkills,
    stats: {
        attack: 10000,
        crit: 100, // always crits → viaCrit: true on every team-applied dot-applied
        critDamage: 100,
        defensePenetration: 0,
        hacking: 100,
        defence: 0,
        hp: 0,
    },
    // no affinity → neutral (no damage/crit modifier)
});

describe('allyCritDot – Task 5: engine integration tests', () => {
    // ── Test 1: team crit=100 → focus corrosionDamage > 0 each round ─────────────────────────
    it('team crit=100: focus corrosionDamage > 0 on every tick round (reactive corrosion lands and ticks)', () => {
        idCounter = 0;
        const result = simulateDPS({
            ...TASK5_BASE,
            shipSkills: focusSkillsT5(),
            teamActors: [teamActorT5()],
        });

        // The enemy ticks each round (enemy speed 50, acts last).
        // Focus-applied reactive corrosion (sourceId='attacker') ticks starting round 1.
        // Each row's corrosionDamage must be > 0 (focus row attribution).
        for (const row of result.rounds) {
            expect(row.corrosionDamage).toBeGreaterThan(0);
        }
        // teamDamage must also include the team's own corrosion contribution
        // (the team-applied DoT ticks with sourceId='team-1', credited to teamDamage).
        for (const row of result.rounds) {
            expect(row.teamDamage).toBeGreaterThan(0);
        }
    });

    // ── Test 2: team crit=0 → no viaCrit → focus corrosionDamage === 0 every round ──────────
    it('team crit=0: focus corrosionDamage stays 0 every round (reactive dot never fires without viaCrit)', () => {
        idCounter = 0;
        const teamNoСrit = {
            ...teamActorT5(),
            stats: { ...teamActorT5().stats, crit: 0, critDamage: 0 },
        };
        const result = simulateDPS({
            ...TASK5_BASE,
            shipSkills: focusSkillsT5(),
            teamActors: [teamNoСrit],
        });

        // No viaCrit → reactive listener never fires → no focus-attributed corrosion.
        for (const row of result.rounds) {
            expect(row.corrosionDamage).toBe(0);
        }
        // The team's own non-crit corrosion still ticks (lands with debuffLandingChance=1.0)
        // and is credited to teamDamage.
        for (const row of result.rounds) {
            expect(row.teamDamage).toBeGreaterThan(0);
        }
    });

    // ── Test 3: per-event frequency — one team cast per round → one reactive dot per round ───
    it('team crit=100, 3 rounds: exactly one focus-sourced dot-applied event per round (reactive fires once per qualifying team cast)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const focusDotApplied: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
        bus.on('dot-applied', (e) => {
            // Only collect executor-applied events attributed to the focus actor ('attacker').
            // These are emitted by executeIntent and have no viaCrit (executor never sets it).
            if (e.sourceId === 'attacker' && !('viaCrit' in e)) {
                focusDotApplied.push(e);
            }
        });

        simulateDPS({
            ...TASK5_BASE,
            shipSkills: focusSkillsT5(),
            teamActors: [teamActorT5()],
            bus,
        });

        // One qualifying team cast per round (team has no charge cadence, fires active every
        // round, always crits) → exactly one reactive intent enqueued and executed per round.
        expect(focusDotApplied).toHaveLength(3);
        // Each event references the correct dot type.
        for (const e of focusDotApplied) {
            expect(e.dotType).toBe('corrosion');
            expect(e.stacks).toBe(1);
        }
    });
});
