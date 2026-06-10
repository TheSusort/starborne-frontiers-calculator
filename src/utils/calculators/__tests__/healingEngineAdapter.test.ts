import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import { TeamActorInput } from '../../../types/calculator';
import { createEventBus, CombatEvent } from '../../combat/events';
import { simulateHealing, HealingSimulationInput, HealerStats } from '../healingEngineAdapter';
import { buildEnemyPlayerActorRuntime, EnemyActorInput } from '../../combat/engine';
import { createStatusEngine } from '../../combat/statusEngine';

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
            expect('teamHealing' in r).toBe(false);
            expect('extraTurns' in r).toBe(false);
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
        expect('destroyedRound' in s).toBe(false);
        expect('teamTotalHealing' in s).toBe(false);
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
        expect('teamHealing' in noTeam.rounds[0]).toBe(false);
        expect('teamTotalHealing' in noTeam.summary).toBe(false);

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

// ── Task 9: affinity threading — enemy matchup vs heal target ─────────────────
describe('Task 9: enemy affinity threading', () => {
    // Helper: build a statusEngine context for buildEnemyPlayerActorRuntime
    const makeCtx = () => {
        const statusEngine = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            landsTimedEnemyApplication: () => true,
        });
        return {
            statusEngine,
            playerIds: ['attacker'],
            enemyDebuffLookup: new Map(),
        };
    };

    // ── Test 9a: buildEnemyPlayerActorRuntime threads advantage matchup correctly ─
    it('9a: advantage matchup → affinityDamageModifier +25, critCap 100, critPenalty 0, no disadvantage', () => {
        // thermal (enemy attacker) vs chemical (target) → ADVANTAGE for the attacker
        // computeAffinityModifiers('thermal', 'chemical') → { damageModifier: 25, critCap: 100, critPenalty: 0 }
        const input: EnemyActorInput = {
            id: 'e-adv',
            stats: { attack: 4000, crit: 30, critDamage: 100, speed: 50 },
            chargeCount: 0,
            startCharged: false,
            affinityDamageModifier: 25,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
        };
        const runtime = buildEnemyPlayerActorRuntime(input, makeCtx());
        expect(runtime.affinityDamageModifier).toBe(25);
        expect(runtime.affinityCritCap).toBe(100);
        expect(runtime.affinityCritPenalty).toBe(0);
        expect(runtime.affinityDisadvantage).toBe(false);
    });

    // ── Test 9b: buildEnemyPlayerActorRuntime threads disadvantage matchup correctly ─
    it('9b: disadvantage matchup → affinityDamageModifier -25, critCap 75, critPenalty 25, disadvantage true', () => {
        const input: EnemyActorInput = {
            id: 'e-dis',
            stats: { attack: 4000, crit: 30, critDamage: 100, speed: 50 },
            chargeCount: 0,
            startCharged: false,
            affinityDamageModifier: -25,
            affinityCritCap: 75,
            affinityCritPenalty: 25,
        };
        const runtime = buildEnemyPlayerActorRuntime(input, makeCtx());
        expect(runtime.affinityDamageModifier).toBe(-25);
        expect(runtime.affinityCritCap).toBe(75);
        expect(runtime.affinityCritPenalty).toBe(25);
        expect(runtime.affinityDisadvantage).toBe(true);
    });

    // ── Test 9c: neutral default when affinity fields omitted ────────────────
    it('9c: neutral default when affinityDamageModifier/Cap/Penalty absent on EnemyActorInput', () => {
        const input: EnemyActorInput = {
            id: 'e-neutral',
            stats: { attack: 4000, crit: 30, critDamage: 100, speed: 50 },
            chargeCount: 0,
            startCharged: false,
            // no affinity fields
        };
        const runtime = buildEnemyPlayerActorRuntime(input, makeCtx());
        expect(runtime.affinityDamageModifier).toBe(0);
        expect(runtime.affinityCritCap).toBe(100);
        expect(runtime.affinityCritPenalty).toBe(0);
        expect(runtime.affinityDisadvantage).toBe(false);
    });

    // ── Test 9d: simulateHealing routes advantage → enemy deals +25% more damage ─
    // thermal enemy (ADVANTAGE) vs chemical heal target: enemy attack 4000, target hp 10000,
    // defence 0. With +25% advantage, effective attack ≈ 4000 × 1.25 = 5000 per round.
    // Neutral: 4000/round. Advantage: 5000/round. Delta = 1000.
    it('9d: advantage enemy deals +25% more damage vs same enemy neutral', () => {
        idCounter = 0;
        // neutral matchup: enemy thermal, target thermal (same → neutral)
        const neutralResult = simulateHealing(
            BASE({
                rounds: 1,
                healer: { ...HEALER, defence: 0, hp: 20000 },
                healTargetAffinity: 'thermal',
                enemies: [
                    {
                        id: 'en1',
                        stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        affinity: 'thermal', // thermal vs thermal → neutral
                    },
                ],
                shipSkills: { slots: [] },
            })
        );

        idCounter = 0;
        // advantage matchup: enemy thermal, target chemical (thermal beats chemical)
        const advantageResult = simulateHealing(
            BASE({
                rounds: 1,
                healer: { ...HEALER, defence: 0, hp: 20000 },
                healTargetAffinity: 'chemical',
                enemies: [
                    {
                        id: 'en1',
                        stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        affinity: 'thermal', // thermal beats chemical → +25%
                    },
                ],
                shipSkills: { slots: [] },
            })
        );

        const neutralDamage = neutralResult.rounds[0].incomingDamage;
        const advantageDamage = advantageResult.rounds[0].incomingDamage;
        // +25% more damage
        expect(advantageDamage).toBe(Math.round(neutralDamage * 1.25));
    });

    // ── Test 9e: existing fixtures (no affinity) remain byte-identical (neutral default) ─
    it('9e: omitting affinity on enemy attacker yields neutral matchup (no change vs prior behaviour)', () => {
        idCounter = 0;
        const withoutAffinity = simulateHealing(
            BASE({
                rounds: 2,
                healer: { ...HEALER, defence: 0, hp: 20000 },
                enemies: [
                    {
                        id: 'en1',
                        stats: { attack: 3000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        // no affinity field
                    },
                ],
                shipSkills: { slots: [] },
            })
        );

        idCounter = 0;
        const withNeutralAffinity = simulateHealing(
            BASE({
                rounds: 2,
                healer: { ...HEALER, defence: 0, hp: 20000 },
                healTargetAffinity: 'thermal',
                enemies: [
                    {
                        id: 'en1',
                        stats: { attack: 3000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        affinity: 'thermal', // thermal vs thermal → neutral
                    },
                ],
                shipSkills: { slots: [] },
            })
        );

        // Both should produce identical damage per round
        expect(withNeutralAffinity.summary.totalIncomingDamage).toBe(
            withoutAffinity.summary.totalIncomingDamage
        );
    });
});

describe('Task 4a: enemy-applied DoTs surface in enemyEffects[].dots', () => {
    // A single ship-backed enemy whose ACTIVE slot applies an inferno DoT (tier 100, 1 stack,
    // 3 turns) to the heal target every round (no debuff, no self-buff). The target is a beefy
    // self-healer so it survives. Each round the engine re-applies the inferno → the active
    // entry count on the target climbs to a steady 3 (then holds, oldest expires). The DoTs
    // must be attributed to e1 via the stack sourceId and summed per type+tier.
    const infernoEnemy = (id: string) => ({
        id,
        stats: { attack: 4000, crit: 0, critDamage: 0, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 50, hits: 1 },
                        }),
                        ab({
                            type: 'dot',
                            target: 'enemy',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 100,
                                stacks: 1,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        },
    });

    it('single inferno enemy: enemyEffects[].dots carries the inferno stacks, attributed to that enemy', () => {
        idCounter = 0;
        const result = simulateHealing(
            BASE({
                rounds: 6,
                healer: { ...HEALER, hp: 1000000, defence: 0 },
                healTargetId: 'healer',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 50, basis: 'hp' },
                    }),
                ]),
                enemies: [infernoEnemy('e1')],
            })
        );

        const rounds = result.rounds;
        // R1: applied at the enemy turn → 1 active entry by round-end, attributed to e1.
        expect(rounds[0].enemyEffects).toHaveLength(1);
        const r1 = rounds[0].enemyEffects[0];
        expect(r1.enemyId).toBe('e1');
        expect(r1.dots).toEqual([{ type: 'inferno', tier: 100, stacks: 1 }]);

        // The active stack count (entries summed per type+tier) climbs and holds at a steady 3.
        const stacksByRound = rounds.map((rd) => {
            const e = rd.enemyEffects.find((x) => x.enemyId === 'e1');
            const dot = e?.dots.find((d) => d.type === 'inferno' && d.tier === 100);
            return dot?.stacks ?? 0;
        });
        expect(stacksByRound[0]).toBe(1);
        expect(stacksByRound.every((s) => s >= 1)).toBe(true);
        expect(Math.max(...stacksByRound)).toBe(3);

        // Sanity: the DoT actually ticks → positive incoming damage (additive field changes nothing).
        expect(result.summary.totalIncomingDamage).toBeGreaterThan(0);
    });

    it('multi-enemy: each enemy DoT is attributed to its own source id', () => {
        idCounter = 0;
        const result = simulateHealing(
            BASE({
                rounds: 4,
                healer: { ...HEALER, hp: 1000000, defence: 0 },
                healTargetId: 'healer',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 50, basis: 'hp' },
                    }),
                ]),
                enemies: [infernoEnemy('e1'), infernoEnemy('e2')],
            })
        );

        const r2 = result.rounds[1].enemyEffects;
        const e1 = r2.find((x) => x.enemyId === 'e1');
        const e2 = r2.find((x) => x.enemyId === 'e2');
        expect(e1?.dots.some((d) => d.type === 'inferno' && d.tier === 100)).toBe(true);
        expect(e2?.dots.some((d) => d.type === 'inferno' && d.tier === 100)).toBe(true);
    });

    // ── CodeRabbit fix: tick-and-expire DoTs must still appear in enemyEffects ──
    // A 1-turn inferno DoT ticks (and expires) at the tank's turn-start in the SAME
    // round the enemy applied it, when the enemy acts FASTER than the tank.
    // Before the fix, buildEnemyRoundEffects read the LIVE containers at end-of-round —
    // after expireStacks had already removed the entry — so enemyEffects[].dots was
    // empty for any round where a short DoT ticked and expired.  After the fix a
    // snapshot is captured BEFORE the tick/expire, so the DoT appears even though it
    // expired by round-end.
    //
    // Turn order: enemy speed 150 > tank speed 100 → enemy acts first every round.
    //   R1: enemy applies inferno (rem 1).  Then tank turn-start: tickDoTs → 1 entry
    //       ticks → expireStacks removes it.  R1 end: infernoEntries = [].
    //       Before fix: enemyEffects[].dots = [] (BUG).
    //       After fix:  enemyEffects[].dots shows {type:'inferno', tier:100, stacks:1}.
    //   R2+: same pattern — fresh entry applied, ticks, expires; snapshot shows it.
    //
    // Incoming damage is ALWAYS correct (tickDoTs credits the damage regardless).
    // Only the display dots field is affected and verified here.
    it('1-turn inferno: enemyEffects[].dots shows the DoT even in the tick-and-expire round', () => {
        idCounter = 0;
        const shortInfernoEnemy = (id: string) => ({
            id,
            // Speed 150 > healer speed 100 → enemy acts BEFORE the tank each round,
            // so the DoT applied this round ticks AND expires at the tank's turn-start
            // in the same round (the critical bug scenario).
            stats: { attack: 4000, crit: 0, critDamage: 0, speed: 150 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            ab({
                                type: 'dot',
                                target: 'enemy',
                                config: {
                                    type: 'dot',
                                    dotType: 'inferno',
                                    tier: 100,
                                    stacks: 1,
                                    duration: 1, // expires in 1 tick — the bug scenario
                                },
                            }),
                        ],
                    },
                ],
            },
        });

        const result = simulateHealing(
            BASE({
                rounds: 3,
                // Beefy target that never dies (so all 3 rounds run cleanly).
                healer: { ...HEALER, hp: 1_000_000, speed: 100, defence: 0 },
                healTargetId: 'healer',
                shipSkills: healSkills([
                    ab({
                        type: 'heal',
                        target: 'self',
                        config: { type: 'heal', pct: 10, basis: 'hp' },
                    }),
                ]),
                enemies: [shortInfernoEnemy('e1')],
            })
        );

        const rounds = result.rounds;

        // All 3 rounds: enemy applied inferno (rem 1), tank ticked + expired it.
        // The snapshot fix means all rounds must show the DoT in enemyEffects[].dots.
        for (let i = 0; i < 3; i++) {
            const eff = rounds[i].enemyEffects.find((x) => x.enemyId === 'e1');
            expect(
                eff?.dots.some((d) => d.type === 'inferno' && d.tier === 100 && d.stacks >= 1),
                `R${i + 1}: enemyEffects dots must include the 1-turn inferno even though it expired`
            ).toBe(true);
        }

        // Sanity: numeric incoming damage is positive (the DoT DID tick correctly).
        expect(result.summary.totalIncomingDamage).toBeGreaterThan(0);
    });
});

// ── Task 6 (Phase 4c PR 2): ship-role threading through the adapter ──────────
// Two paths into the engine's roleOf lookup for role-filtered on-ally-attacked
// reactions (Graphite "when an ally Attacker or Debuffer is directly damaged"):
//   (1) TeamActorInput.role rides through deriveTeamEngineActors untouched
//       (the walk derivation spreads the input actor), and
//   (2) HealingSimulationInput.healerRole maps to the engine's focus-actor
//       `input.role` — the Task 5 carry-forward: the focus branch of the
//       engine-built roleByActorId map, exercised end-to-end here with the
//       healer AS the heal target.
// Each path gets a matching-role firing case and a dormancy case (non-matching
// or absent role → conservative no-fire).
describe('Task 6: role threading for role-filtered on-ally-attacked reactions', () => {
    // Walked team actor (shipSkills + stats → deriveTeamEngineActors builds the
    // walk; reactive listeners only register for WALKED owners). Optional role.
    const walkedActor = (
        id: string,
        speed: number,
        hp: number,
        shipSkills: ShipSkills,
        role?: TeamActorInput['role']
    ): TeamActorInput => ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        shipSkills,
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        ...(role ? { role } : {}),
    });

    // Graphite shape: passive on-ally-attacked ally buff, role-filtered to
    // Attacker/Debuffer allies. Fires once per attack turn on the damaged ally.
    const reactivePlatingSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'ally',
                        trigger: 'on-ally-attacked',
                        roleFilter: ['ATTACKER', 'DEBUFFER'],
                        config: {
                            type: 'buff',
                            buffName: 'Reactive Plating',
                            stacks: 1,
                            parsedEffects: { defense: 15 },
                            isStackable: false,
                            duration: 2,
                        },
                    }),
                ],
            },
        ],
    });

    // Flat-card enemy: one basic attack per turn at the heal target.
    const flatEnemy = (id: string) => ({
        id,
        stats: { attack: 100, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
    });

    // Bus tap collecting 'Reactive Plating' buff-applied events (actorId = recipient).
    const collectPlating = () => {
        const bus = createEventBus();
        const plating: Array<{ actorId: string }> = [];
        bus.on('buff-applied', (e) => {
            if ((e as { buffName?: string }).buffName === 'Reactive Plating')
                plating.push(e as unknown as { actorId: string });
        });
        return { bus, plating };
    };

    it('team-actor role path: heal-target team actor with a matching role → reaction fires on it every attack turn', () => {
        idCounter = 0;
        const { bus, plating } = collectPlating();
        simulateHealing(
            BASE({
                rounds: 3,
                healer: { ...HEALER, speed: 200 },
                healTargetId: 'tank',
                teamActors: [
                    walkedActor('graphite', 120, 50_000, reactivePlatingSkills()),
                    walkedActor('tank', 80, 1_000_000, { slots: [] }, 'ATTACKER'),
                ],
                enemies: [flatEnemy('ea1')],
                bus,
            })
        );
        expect(plating.length).toBe(3);
        expect(plating.every((e) => e.actorId === 'tank')).toBe(true);
    });

    it('team-actor role path: non-matching role (DEFENDER outside the filter) → dormant', () => {
        idCounter = 0;
        const { bus, plating } = collectPlating();
        simulateHealing(
            BASE({
                rounds: 3,
                healer: { ...HEALER, speed: 200 },
                healTargetId: 'tank',
                teamActors: [
                    walkedActor('graphite', 120, 50_000, reactivePlatingSkills()),
                    walkedActor('tank', 80, 1_000_000, { slots: [] }, 'DEFENDER'),
                ],
                enemies: [flatEnemy('ea1')],
                bus,
            })
        );
        expect(plating.length).toBe(0);
    });

    it('focus-healer role path: healer-as-target with matching healerRole → reaction fires on the focus actor (engine input.role)', () => {
        idCounter = 0;
        const { bus, plating } = collectPlating();
        simulateHealing(
            BASE({
                rounds: 3,
                healer: { ...HEALER, speed: 200 },
                healerRole: 'ATTACKER',
                healTargetId: 'healer',
                teamActors: [walkedActor('graphite', 120, 50_000, reactivePlatingSkills())],
                enemies: [flatEnemy('ea1')],
                bus,
            })
        );
        // The damaged ally is the FOCUS actor (engine id 'attacker') — its role
        // comes ONLY from healerRole → input.role (the focus branch of roleByActorId).
        expect(plating.length).toBe(3);
        expect(plating.every((e) => e.actorId === 'attacker')).toBe(true);
    });

    it('focus-healer role path: healerRole absent → dormant (conservative; unknown role never matches)', () => {
        idCounter = 0;
        const { bus, plating } = collectPlating();
        simulateHealing(
            BASE({
                rounds: 3,
                healer: { ...HEALER, speed: 200 },
                healTargetId: 'healer',
                teamActors: [walkedActor('graphite', 120, 50_000, reactivePlatingSkills())],
                enemies: [flatEnemy('ea1')],
                bus,
            })
        );
        expect(plating.length).toBe(0);
    });
});
