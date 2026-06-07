import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import { TeamActorInput } from '../../../types/calculator';
import { createEventBus, CombatEvent } from '../../combat/events';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `h${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const healSkills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

const chargedHealSkills = (active: Ability[], charged: Ability[]): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: active },
        { slot: 'charged', abilities: charged },
    ],
});

const HEALER: HealerStats = {
    hp: 10000,
    attack: 5000,
    defence: 2000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    healModifier: 0,
    hacking: 200,
    speed: 100,
};

const BASE = (overrides: Partial<HealingSimulationInput> = {}): HealingSimulationInput => ({
    healer: HEALER,
    chargeCount: 0,
    shipSkills: { slots: [] },
    selfBuffs: [],
    healTargetId: 'healer',
    enemies: [],
    rounds: 5,
    ...overrides,
});

describe('simulateHealing adapter', () => {
    // ── Test 1: plain heal cadence shape ─────────────────────────────────────
    it('plain self-heal: buckets, cumulative, and summary totals are consistent', () => {
        idCounter = 0;
        const result = simulateHealing(
            BASE({
                rounds: 5,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(result.rounds).toHaveLength(5);
        // hp 10000 × 10% = 1000 raw per round; all overheal at full HP (no enemies).
        for (const r of result.rounds) {
            expect(r.action).toBe('active');
            expect(r.directHeal).toBe(1000);
            expect(r.hotHeal).toBe(0);
            expect(r.totalRoundHealing).toBe(1000);
            expect(r.targetHpPct).toBe(100);
            expect(r.overheal).toBe(1000);
            expect(r.effectiveHealing).toBe(0);
            expect(r.teamHealing).toBeUndefined();
        }
        // cumulative accumulates 1000/round.
        expect(result.rounds.map((r) => r.cumulativeHealing)).toEqual([
            1000, 2000, 3000, 4000, 5000,
        ]);
        // summary consistency.
        const s = result.summary;
        expect(s.totalHealing).toBe(5000);
        expect(s.totalDirectHeal).toBe(5000);
        expect(s.totalHotHeal).toBe(0);
        expect(s.totalHealing).toBe(s.totalDirectHeal + s.totalHotHeal);
        expect(s.avgHealingPerRound).toBe(1000);
        expect(s.totalOverheal).toBe(5000);
        expect(s.totalEffectiveHealing).toBe(0);
        expect(s.destroyedRound).toBeUndefined();
        expect(s.teamTotalHealing).toBeUndefined();
    });

    // ── Test 2: charged cadence ──────────────────────────────────────────────
    it('charged cadence: [active, active, charged] pattern; charged rounds heal more', () => {
        idCounter = 0;
        const result = simulateHealing(
            BASE({
                rounds: 6,
                chargeCount: 2,
                shipSkills: chargedHealSkills(
                    [
                        ab({
                            type: 'heal',
                            target: 'self',
                            config: { type: 'heal', pct: 10, basis: 'hp' },
                        }),
                    ],
                    [
                        ab({
                            type: 'heal',
                            target: 'self',
                            config: { type: 'heal', pct: 30, basis: 'hp' },
                        }),
                    ]
                ),
            })
        );
        expect(result.rounds.map((r) => r.action)).toEqual([
            'active',
            'active',
            'charged',
            'active',
            'active',
            'charged',
        ]);
        // active 1000, charged 3000.
        expect(result.rounds[0].directHeal).toBe(1000);
        expect(result.rounds[2].directHeal).toBe(3000);
        expect(result.rounds[2].directHeal).toBeGreaterThan(result.rounds[1].directHeal);
        expect(result.rounds[2].chargeCount).toBe(2);
    });

    // ── Test 3: destroyedRound surfaces; present-only when target survives ────
    it('destroyedRound is present when the target dies, absent when it survives', () => {
        idCounter = 0;
        // Target focus healer (hp 5000), no heal, enemy 3000/round, defence 0.
        const lethal = simulateHealing(
            BASE({
                rounds: 4,
                healer: { ...HEALER, hp: 5000, defence: 0 },
                shipSkills: { slots: [] },
                enemies: [
                    {
                        id: 'e1',
                        stats: { attack: 3000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                    },
                ],
            })
        );
        // 5000 − 3000 = 2000 (R1), 2000 − 3000 → 0 (R2 destroyed).
        expect(lethal.summary.destroyedRound).toBe(2);

        idCounter = 0;
        const survives = simulateHealing(
            BASE({
                rounds: 3,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(survives.summary.destroyedRound).toBeUndefined();
        expect('destroyedRound' in survives.summary).toBe(false);
    });

    // ── Test 4: empty enemies → no intake, full HP throughout ────────────────
    it('empty enemies: no intake, targetHpPct stays 100', () => {
        idCounter = 0;
        const result = simulateHealing(
            BASE({
                rounds: 4,
                enemies: [],
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        for (const r of result.rounds) {
            expect(r.incomingDamage).toBe(0);
            expect(r.shieldAbsorbed).toBe(0);
            expect(r.targetHpPct).toBe(100);
        }
        expect(result.summary.totalIncomingDamage).toBe(0);
        expect(result.summary.totalShieldAbsorbed).toBe(0);
    });

    // ── Test 5: target mapping (healer vs a team actor id) ────────────────────
    it('healer-as-target maps to focus; team-actor-as-target heals that team actor', () => {
        idCounter = 0;
        // 'healer' → focus 'attacker' self-heal.
        const focusTarget = simulateHealing(
            BASE({
                rounds: 1,
                healTargetId: 'healer',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(focusTarget.rounds[0].directHeal).toBe(1000);

        // Team-actor-as-target: focus heals an ally; the team actor t1 is the bombard target.
        idCounter = 0;
        const team: TeamActorInput = {
            id: 't1',
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 8000,
            },
        };
        const teamTarget = simulateHealing(
            BASE({
                rounds: 1,
                healTargetId: 't1',
                healer: { ...HEALER, speed: 200 },
                teamActors: [team],
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'ally',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        // The focus heals the ally target for the caster's hp-basis (10000×10% = 1000),
        // credited to the focus actor's directHeal.
        expect(teamTarget.rounds[0].directHeal).toBe(1000);
    });

    // ── Test 6: pressure — intake/absorb/HP flow + effectiveHealing once deficit ─
    it('pressure: incomingDamage/shieldAbsorbed/targetHpPct flow; effectiveHealing once deficit', () => {
        idCounter = 0;
        // hp 10000, heal target-hp 50% → raw 5000/round; enemy 2000/round, defence 0.
        const result = simulateHealing(
            BASE({
                rounds: 2,
                healer: { ...HEALER, hp: 10000, defence: 0 },
                enemies: [
                    {
                        id: 'e1',
                        stats: { attack: 2000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                    },
                ],
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 50, basis: 'target-hp' },
                    }),
                ]),
            })
        );
        const rounds = result.rounds;
        // R1 enters at 100% (no deficit → effectiveHeal 0). R2 enters at 80% (deficit → effective).
        expect(rounds[0].targetHpPct).toBe(100);
        expect(rounds[1].targetHpPct).toBe(80);
        expect(rounds[0].effectiveHealing).toBe(0);
        // R2 deficit 2000 → consume min(5000, 2000) = 2000.
        expect(rounds[1].effectiveHealing).toBe(2000);
        expect(rounds[0].incomingDamage).toBe(2000);
        expect(rounds[1].incomingDamage).toBe(2000);
        expect(result.summary.totalEffectiveHealing).toBeGreaterThan(0);
        expect(result.summary.totalIncomingDamage).toBe(4000);
    });

    // ── Test 7: teamHealing present only with team actors ─────────────────────
    it('teamHealing present only when team actors heal; absent otherwise', () => {
        idCounter = 0;
        // No team actors → teamHealing undefined; teamTotalHealing absent from summary.
        const noTeam = simulateHealing(
            BASE({
                rounds: 1,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(noTeam.rounds[0].teamHealing).toBeUndefined();
        expect(noTeam.summary.teamTotalHealing).toBeUndefined();

        // A walked team healer that self-heals → its raw shows up in teamHealing (non-focus).
        idCounter = 0;
        const teamHealer: TeamActorInput = {
            id: 't1',
            speed: 50,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: healSkills([
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 20, basis: 'hp' },
                }),
            ]),
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp: 6000,
            },
        };
        const withTeam = simulateHealing(
            BASE({
                rounds: 1,
                healTargetId: 'healer',
                healer: { ...HEALER, speed: 200 },
                teamActors: [teamHealer],
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        // t1 self-heals 6000×20% = 1200 raw → teamHealing 1200; focus directHeal 1000.
        expect(withTeam.rounds[0].teamHealing).toBe(1200);
        expect(withTeam.rounds[0].directHeal).toBe(1000);
        expect(withTeam.summary.teamTotalHealing).toBe(1200);
    });

    // ── Test 8: optional bus tap forwards heal-performed ─────────────────────
    it('bus tap forwards heal-performed events', () => {
        idCounter = 0;
        const bus = createEventBus();
        const perfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => perfs.push(e));
        simulateHealing(
            BASE({
                rounds: 2,
                bus,
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(perfs).toHaveLength(2);
        expect(perfs[0].amount).toBe(1000);
    });
});
