import { beforeEach, describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import {
    MAX_INTENT_GENERATIONS,
    registerReactiveListeners,
    Intent,
    ReactiveAbility,
} from '../triggers';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const baseInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 3,
    shipSkills: { slots: [] },
    enemyDefense: 8000,
    enemyHp: 400000,
    numRounds: 8,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1, // 100% landing
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 6000,
    hp: 30000,
    ...overrides,
});

const collectEvents = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = [
        'round-started',
        'turn-started',
        'turn-ended',
        'skill-fired',
        'ability-performed',
        'buff-applied',
        'buff-expired',
        'debuff-applied',
        'debuff-resisted',
        'dot-applied',
        'dot-ticked',
        'dot-detonated',
        'bomb-detonated',
        'hp-changed',
        'ship-destroyed',
    ];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

// A single timed enemy debuff ability (defence shred), distinct buffName per call.
const timedEnemyDebuff = (buffName: string, duration = 2): Ability =>
    ab({
        type: 'debuff',
        target: 'enemy',
        config: {
            type: 'debuff',
            buffName,
            stacks: 1,
            parsedEffects: { defense: -20 },
            isStackable: false,
            application: 'inflict',
            duration,
        },
    });

beforeEach(() => {
    idCounter = 0;
});

describe('Phase 3 reactive triggers', () => {
    // ----------------------------------------------------------------------
    // Scenario 1 — on-debuff-inflicted charge (Hemlock shape): +1 per
    // infliction on top of the +1 bank ⇒ effective +2 per active round.
    // ----------------------------------------------------------------------
    it('scenario 1: on-debuff-inflicted charge — effective +2 per active round, charged every 3rd', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        timedEnemyDebuff('Def Down'),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const { result } = collectEvents(baseInput({ shipSkills: skills, numRounds: 8 }));
        const actions = result.rounds.map((r) => r.action);
        const charges = result.rounds.map((r) => r.charges);
        // preTurn +1 bank, then +1 trigger drain ⇒ +2/active round; charged every 3rd.
        expect(actions).toEqual([
            'active',
            'active',
            'charged',
            'active',
            'active',
            'charged',
            'active',
            'active',
        ]);
        expect(charges).toEqual([2, 3, 0, 2, 3, 0, 2, 3]);
    });

    // ----------------------------------------------------------------------
    // Scenario 2 — two inflictions = +2 from the trigger ⇒ +3/active round,
    // charged every 2nd round.
    // ----------------------------------------------------------------------
    it('scenario 2: two timed enemy debuffs ⇒ +2/cast, charged every 2nd round', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        timedEnemyDebuff('Def Down'),
                        timedEnemyDebuff('Speed Down'),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const { result } = collectEvents(baseInput({ shipSkills: skills, numRounds: 8 }));
        const actions = result.rounds.map((r) => r.action);
        const charges = result.rounds.map((r) => r.charges);
        // +1 bank + 2 trigger drains ⇒ charges 3 every active round; charged every 2nd.
        expect(actions).toEqual([
            'active',
            'charged',
            'active',
            'charged',
            'active',
            'charged',
            'active',
            'charged',
        ]);
        expect(charges).toEqual([3, 0, 3, 0, 3, 0, 3, 0]);
    });

    // ----------------------------------------------------------------------
    // Scenario 3 — standing aura debuff grants nothing (recurring fold never
    // emits debuff-applied, so the trigger never fires). Cadence = baseline.
    // ----------------------------------------------------------------------
    it('scenario 3: recurring (aura) enemy debuff never feeds the on-debuff-inflicted trigger', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                stacks: 1,
                                parsedEffects: { defense: -20 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const { result } = collectEvents(baseInput({ shipSkills: skills, numRounds: 8 }));
        const actions = result.rounds.map((r) => r.action);
        // No trigger ⇒ plain +1/active-round banking ⇒ charged every 4th round.
        expect(actions).toEqual([
            'active',
            'active',
            'active',
            'charged',
            'active',
            'active',
            'active',
            'charged',
        ]);
    });

    // ----------------------------------------------------------------------
    // Scenario 4 — resisted application grants nothing (debuffLandingChance 0
    // ⇒ no debuff-applied ⇒ no trigger). Cadence = baseline.
    // ----------------------------------------------------------------------
    it('scenario 4: resisted timed enemy debuff (landing 0) never feeds the trigger', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        timedEnemyDebuff('Def Down'),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const { result } = collectEvents(
            baseInput({ shipSkills: skills, numRounds: 8, debuffLandingChance: 0 })
        );
        const actions = result.rounds.map((r) => r.action);
        expect(actions).toEqual([
            'active',
            'active',
            'active',
            'charged',
            'active',
            'active',
            'active',
            'charged',
        ]);
    });

    // ----------------------------------------------------------------------
    // Scenario 5 — DoT applications count: a corrosion DoT feeds dot-applied
    // ⇒ +1/active cast while landing ⇒ same +2/active-round cadence as #1.
    // ----------------------------------------------------------------------
    it('scenario 5: a landed DoT feeds the on-debuff-inflicted trigger', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'corrosion',
                                tier: 5,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const { result } = collectEvents(baseInput({ shipSkills: skills, numRounds: 8 }));
        const actions = result.rounds.map((r) => r.action);
        const charges = result.rounds.map((r) => r.charges);
        expect(actions).toEqual([
            'active',
            'active',
            'charged',
            'active',
            'active',
            'charged',
            'active',
            'active',
        ]);
        expect(charges).toEqual([2, 3, 0, 2, 3, 0, 2, 3]);
    });

    // ----------------------------------------------------------------------
    // Scenario 6 — on-crit debuff (Enforcer shape). Passive timed enemy
    // debuff trigger:'on-crit' duration 2. Crit 100 ⇒ present from the round
    // AFTER the first crit turn onward; crit 0 ⇒ never present. The crit
    // round's own directDamage is unaffected (lands after the hit).
    // ----------------------------------------------------------------------
    // NOTE: a generic (non-persistent) buffName is used here so this scenario keeps testing the
    // TIMED on-crit machinery. The real "Defense Shred" is now a persistent stacking status
    // (game-verified 2026-06-05) and is covered separately below.
    const enforcerSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-crit',
                        config: {
                            type: 'debuff',
                            buffName: 'Timed Shred',
                            stacks: 1,
                            parsedEffects: { defense: -30 },
                            isStackable: false,
                            application: 'inflict',
                            duration: 2,
                        },
                    }),
                ],
            },
        ],
    });

    it('scenario 6: on-crit debuff present from the round after the first crit; crit 0 never; crit round damage unaffected', () => {
        const baseline = collectEvents(
            baseInput({
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                            ],
                        },
                    ],
                },
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100,
                numRounds: 4,
            })
        );

        const withCrit = collectEvents(
            baseInput({
                shipSkills: enforcerSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100,
                numRounds: 4,
            })
        );
        const present = (rounds: typeof withCrit.result.rounds, n: number) =>
            rounds
                .find((r) => r.round === n)!
                .activeEnemyDebuffs.some((b) => b.buffName === 'Timed Shred');

        // crit 100 → every round crits → Shred applied after round 1's hit, active 2..3.
        expect(present(withCrit.result.rounds, 1)).toBe(false);
        expect(present(withCrit.result.rounds, 2)).toBe(true);
        expect(present(withCrit.result.rounds, 3)).toBe(true);

        // The crit round (round 1) damage equals the no-reactive baseline (no self-boost).
        expect(withCrit.result.rounds[0].directDamage).toBe(baseline.result.rounds[0].directDamage);

        // crit 0 → never crits → Shred never present.
        const noCrit = collectEvents(
            baseInput({
                shipSkills: enforcerSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 0,
                numRounds: 4,
            })
        );
        for (const r of noCrit.result.rounds) {
            expect(r.activeEnemyDebuffs.some((b) => b.buffName === 'Timed Shred')).toBe(false);
        }
    });

    // ----------------------------------------------------------------------
    // Scenario 7 — start-of-round self buff: active in every round's attacker
    // turn (in activeSelfBuffs), boosts damage vs a no-buff baseline, and
    // buff-applied emits each round.
    // ----------------------------------------------------------------------
    it('scenario 7: start-of-round self buff active every round, boosts damage, emits buff-applied each round', () => {
        const buffSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            trigger: 'start-of-round',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                stacks: 1,
                                parsedEffects: { attack: 30 },
                                isStackable: false,
                                duration: 1,
                            },
                        }),
                    ],
                },
            ],
        });
        const numRounds = 4;
        const { events, result } = collectEvents(
            baseInput({
                shipSkills: buffSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                numRounds,
            })
        );
        const baseline = collectEvents(
            baseInput({
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                            ],
                        },
                    ],
                },
                hasChargedSkill: false,
                chargeCount: 0,
                numRounds,
            })
        );

        for (let r = 1; r <= numRounds; r++) {
            const round = result.rounds.find((rd) => rd.round === r)!;
            expect(round.activeSelfBuffs.some((b) => b.buffName === 'Attack Up')).toBe(true);
            expect(round.directDamage).toBeGreaterThan(
                baseline.result.rounds.find((rd) => rd.round === r)!.directDamage
            );
        }
        const buffApplied = events.filter((e) => e.type === 'buff-applied');
        expect(buffApplied).toHaveLength(numRounds);
        for (const e of buffApplied) {
            if (e.type !== 'buff-applied') throw new Error('unreachable');
            expect(e.buffName).toBe('Attack Up');
            expect(e.actorId).toBe('attacker');
        }
    });

    // ----------------------------------------------------------------------
    // Scenario 8 — on-ally-debuff-inflicted (Oleander shape): charge ability
    // gains +1 each round a faster team actor lands its timed debuff; without
    // teamActors it never fires.
    // ----------------------------------------------------------------------
    const oleanderSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
            },
            {
                slot: 'charged',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } })],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'charge',
                        target: 'self',
                        trigger: 'on-ally-debuff-inflicted',
                        config: { type: 'charge', amount: 1 },
                    }),
                ],
            },
        ],
    });

    it('scenario 8: on-ally-debuff-inflicted gains +1 per team infliction; no teamActors ⇒ no gains', () => {
        const teamDebuff: SelectedGameBuff = {
            id: 'td1',
            buffName: 'Team Def Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -15 },
            skillSource: 'active',
            skillDuration: 3,
        };
        const withTeam = collectEvents(
            baseInput({
                shipSkills: oleanderSkills(),
                numRounds: 8,
                teamActors: [
                    {
                        id: 't1',
                        speed: 120, // faster than attacker (100): acts first, lands before attacker
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [teamDebuff],
                    },
                ],
            })
        );
        // Team (speed 120) acts BEFORE the attacker and lands its debuff every round
        // (family 3>2 always wins) ⇒ its on-ally-debuff-inflicted charge intent drains +1
        // before the attacker's preTurn each round. Combined with the attacker's own +1
        // active-round bank the threshold (3) is reached every other round ⇒ active,charged
        // alternating. (On the charged round the team's +1 lands on a fresh 0, but the
        // attacker had already banked to 3 the round before — the alternation is stable.)
        expect(withTeam.result.rounds.map((r) => r.action)).toEqual([
            'active',
            'charged',
            'active',
            'charged',
            'active',
            'charged',
            'active',
            'charged',
        ]);

        const noTeam = collectEvents(baseInput({ shipSkills: oleanderSkills(), numRounds: 8 }));
        // No ally inflictions ⇒ plain +1/active banking ⇒ charged every 4th round.
        expect(noTeam.result.rounds.map((r) => r.action)).toEqual([
            'active',
            'active',
            'active',
            'charged',
            'active',
            'active',
            'active',
            'charged',
        ]);
    });

    // ----------------------------------------------------------------------
    // Scenario 9 — on-bomb-detonated self buff becomes active after the burst.
    // ----------------------------------------------------------------------
    it('scenario 9: on-bomb-detonated self buff active after the burst round', () => {
        const bombSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'bomb',
                                tier: 10,
                                stacks: 2,
                                duration: 2,
                            },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-bomb-detonated',
                            config: {
                                type: 'buff',
                                buffName: 'Bomb High',
                                stacks: 1,
                                parsedEffects: { attack: 25 },
                                isStackable: false,
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        });
        const { events, result } = collectEvents(
            baseInput({
                shipSkills: bombSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                numRounds: 5,
            })
        );
        // Bomb applied round 1 (countdown 2): enemy ticks round1→1, round2→0 ⇒ bursts on the
        // round-2 enemy turn ⇒ buff active from round 3.
        const burst = events.find((e) => e.type === 'bomb-detonated');
        expect(burst).toBeDefined();
        const present = (n: number) =>
            result.rounds
                .find((r) => r.round === n)!
                .activeSelfBuffs.some((b) => b.buffName === 'Bomb High');
        expect(present(2)).toBe(false);
        expect(present(3)).toBe(true);
    });

    // ----------------------------------------------------------------------
    // Scenario 10 — chaining: an on-crit-inflicted timed debuff ALSO feeds an
    // on-debuff-inflicted charge listener in the SAME drain. On crit rounds the
    // charge gets an extra +1 (the active-slot debuff +1 PLUS the on-crit debuff +1).
    // ----------------------------------------------------------------------
    const chainSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                    timedEnemyDebuff('Def Down'),
                ],
            },
            {
                slot: 'charged',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } })],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'charge',
                        target: 'self',
                        trigger: 'on-debuff-inflicted',
                        config: { type: 'charge', amount: 1 },
                    }),
                    ab({
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-crit',
                        config: {
                            type: 'debuff',
                            buffName: 'Crit Shred',
                            stacks: 1,
                            parsedEffects: { defense: -30 },
                            isStackable: false,
                            application: 'inflict',
                            duration: 2,
                        },
                    }),
                ],
            },
        ],
    });

    it('scenario 10: crit-inflicted debuff also feeds the on-debuff-inflicted charge (extra +1 on crit rounds)', () => {
        // crit 100 → every active round crits → on-crit debuff lands → its debuff-applied
        // chains into the charge listener. Active-round gain: +1 bank +1 (active debuff)
        // +1 (crit debuff) = +3 ⇒ charges hit 3 immediately ⇒ charged every 2nd round.
        const { result } = collectEvents(
            baseInput({ shipSkills: chainSkills(), crit: 100, numRounds: 8 })
        );
        expect(result.rounds.map((r) => r.action)).toEqual([
            'active',
            'charged',
            'active',
            'charged',
            'active',
            'charged',
            'active',
            'charged',
        ]);
    });

    // ----------------------------------------------------------------------
    // Scenario 11 — generation cap: a self-amplifying on-debuff-inflicted timed
    // enemy debuff (its own application emits debuff-applied, re-triggering it).
    // The family rule absorbs the re-apply, but a landed-but-family-blocked
    // application still emits ⇒ unbounded chain ⇒ throws MAX_INTENT_GENERATIONS.
    // ----------------------------------------------------------------------
    it('scenario 11: self-amplifying debuff trigger throws the generation cap error (no hang)', () => {
        const loopSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        // Seed: a normal on-cast timed debuff inflicts once per cast, emitting
                        // debuff-applied (sourceId attacker) → kicks off the self-amplifying chain.
                        timedEnemyDebuff('Seed Down'),
                        // Self-amplifying: trigger:'on-debuff-inflicted' on a debuff whose own
                        // application emits debuff-applied → re-triggers itself. The family rule
                        // absorbs the re-apply (tier equal, not longer), but a landed-but-family-
                        // blocked application STILL emits, so the chain never terminates.
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-debuff-inflicted',
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                stacks: 1,
                                parsedEffects: { defense: -20 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        });
        expect(() =>
            runCombat(
                baseInput({
                    shipSkills: loopSkills(),
                    hasChargedSkill: false,
                    chargeCount: 0,
                    numRounds: 3,
                })
            )
        ).toThrow(/MAX_INTENT_GENERATIONS/);
    });

    // ----------------------------------------------------------------------
    // Scenario 12 — determinism: scenario 10 run twice is byte-equal.
    // ----------------------------------------------------------------------
    it('scenario 12: identical reactive runs produce deep-equal results', () => {
        const run = () =>
            runCombat(baseInput({ shipSkills: chainSkills(), crit: 100, numRounds: 8 }));
        idCounter = 0;
        const a = run();
        idCounter = 0;
        const b = run();
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    // ----------------------------------------------------------------------
    // Scenario 13 — exclusion: a live-trigger ability does NOT also act on-cast.
    //  (a) scenario 1's charge ability is not double-counted by the cast path.
    //  (b) scenario 6's on-crit debuff does not apply on cast (round 1 absent).
    // ----------------------------------------------------------------------
    it('scenario 13a: an on-debuff-inflicted charge ability is not also counted on-cast', () => {
        // Same skills as scenario 1 but with the timed enemy debuff REMOVED, so the ONLY
        // path to the charge ability is the (now never-firing) trigger. If the charge were
        // still on-cast it would bank +1 extra per active round; excluding it ⇒ plain
        // +1/active banking ⇒ charged every 4th round.
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        };
        const { result } = collectEvents(baseInput({ shipSkills: skills, numRounds: 8 }));
        expect(result.rounds.map((r) => r.action)).toEqual([
            'active',
            'active',
            'active',
            'charged',
            'active',
            'active',
            'active',
            'charged',
        ]);
    });

    it('scenario 13b: an on-crit debuff does not apply on cast (absent the round it would land on-cast)', () => {
        // crit 0 → the on-crit debuff never fires reactively; if it were still on-cast it
        // would apply as a normal passive aura/timed status. It must be wholly absent.
        const { result } = collectEvents(
            baseInput({
                shipSkills: enforcerSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 0,
                numRounds: 4,
            })
        );
        for (const r of result.rounds) {
            expect(r.activeEnemyDebuffs.some((b) => b.buffName === 'Timed Shred')).toBe(false);
        }
    });

    // Determinism corollary: the MAX_INTENT_GENERATIONS constant is a finite backstop.
    it('exposes a finite MAX_INTENT_GENERATIONS backstop', () => {
        expect(MAX_INTENT_GENERATIONS).toBeGreaterThan(0);
        expect(Number.isFinite(MAX_INTENT_GENERATIONS)).toBe(true);
    });

    // ----------------------------------------------------------------------
    // Scenario 14 — reactive enemy debuff resist path: a timed enemy debuff
    // on-crit with debuffLandingChance 0 fires (crit 100) but is resisted.
    // Asserts: (a) debuff-resisted event emitted; (b) the debuff appears in
    // that round's resistedEnemyDebuffs; (c) never in activeEnemyDebuffs.
    // At default speeds the drain runs after the attacker turn, so the resisted
    // entry lands on the same round's resisted list.
    // ----------------------------------------------------------------------
    it('scenario 14: on-crit reactive debuff resisted at debuffLandingChance 0 — event, resisted list, never active', () => {
        const resistSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-crit',
                            config: {
                                type: 'debuff',
                                buffName: 'Reactive Shred',
                                stacks: 1,
                                parsedEffects: { defense: -20 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        });

        const { events, result } = collectEvents(
            baseInput({
                shipSkills: resistSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100, // trigger fires every round
                debuffLandingChance: 0, // 0% landing → always resisted
                numRounds: 4,
            })
        );

        // (a) A debuff-resisted event is emitted for the reactive debuff each round.
        const resistedEvents = events.filter(
            (e) =>
                e.type === 'debuff-resisted' &&
                (e as { buffName?: string }).buffName === 'Reactive Shred'
        );
        expect(resistedEvents.length).toBeGreaterThan(0);

        // (b) The debuff appears in each round's resistedEnemyDebuffs list.
        for (const round of result.rounds) {
            expect(round.resistedEnemyDebuffs.some((b) => b.buffName === 'Reactive Shred')).toBe(
                true
            );
        }

        // (c) It never appears in activeEnemyDebuffs.
        for (const round of result.rounds) {
            expect(round.activeEnemyDebuffs.some((b) => b.buffName === 'Reactive Shred')).toBe(
                false
            );
        }
    });

    // ----------------------------------------------------------------------
    // Persistent stacking statuses (game-verified 2026-06-05). Defense Shred is a
    // persistent stacking debuff: each landed application adds a stack (capped at
    // the buff DB's 20), the buff-name rule OVERRIDES the skill text's "for x turns",
    // and it never expires in-sim. These cover the Enforcer reactive shape, the
    // no-re-roll invariant, and the on-cast (active-slot) application path.
    // ----------------------------------------------------------------------

    // Enforcer shape: on-crit passive enemy debuff named "Defense Shred" with a TEXT
    // duration of 3 that MUST be ignored (the name routes it persistent). Stacks climb
    // +1 per crit round, never expire, and grow effective defense reduction.
    const persistentEnforcerSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-crit',
                        config: {
                            type: 'debuff',
                            buffName: 'Defense Shred',
                            stacks: 1,
                            parsedEffects: { defense: -2 },
                            isStackable: false,
                            application: 'inflict',
                            duration: 3, // text value — MUST be ignored (persists in-game)
                        },
                    }),
                ],
            },
        ],
    });

    it('persistent (test 4): Defense Shred climbs +1 per crit round, never expires, scales defense reduction', () => {
        const { result } = collectEvents(
            baseInput({
                shipSkills: persistentEnforcerSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 50,
                numRounds: 10,
            })
        );

        const stacksAt = (n: number): number | undefined =>
            result.rounds
                .find((r) => r.round === n)!
                .activeEnemyDebuffs.find((b) => b.buffName === 'Defense Shred')?.stacks;

        // Identify crit rounds (the on-crit trigger fires on a crit; the inflicted Shred is
        // visible from the FOLLOWING round). Stacks must form a non-decreasing sequence that
        // strictly grows on rounds after a crit, and never drop (no expiry).
        const seq = result.rounds.map((r) => stacksAt(r.round) ?? 0);
        // Non-decreasing (never expires / never loses a stack).
        for (let i = 1; i < seq.length; i++) {
            expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
        }
        // It grows beyond a single stack over 10 rounds at crit 50 (multiple crits land).
        expect(Math.max(...seq)).toBeGreaterThan(1);
        // Capped at the buff DB max of 20.
        expect(Math.max(...seq)).toBeLessThanOrEqual(20);

        // Stacking debuff is never expired (persistent → no buff-expired for it).
        // (Defense Shred is enemy-side; it would emit nothing on expiry regardless, but assert
        //  the active list never drops it once present.)
        const firstPresent = result.rounds.findIndex((r) =>
            r.activeEnemyDebuffs.some((b) => b.buffName === 'Defense Shred')
        );
        expect(firstPresent).toBeGreaterThanOrEqual(0);
        for (let i = firstPresent; i < result.rounds.length; i++) {
            expect(
                result.rounds[i].activeEnemyDebuffs.some((b) => b.buffName === 'Defense Shred')
            ).toBe(true);
        }

        // Effective defense reduction scales with stacks → directDamage on the LAST round
        // (most stacks) strictly exceeds the round right after Shred first appears (1 stack).
        const lastRound = result.rounds[result.rounds.length - 1];
        const firstStackedRound = result.rounds[firstPresent];
        expect(lastRound.directDamage).toBeGreaterThan(firstStackedRound.directDamage);
    });

    it('persistent (test 5): an already-landed persistent debuff is NOT re-rolled per round — it stays active even on rounds where a fresh application is resisted', () => {
        // debuffLandingChance 0.5: a NEW application attempt may be resisted (legitimate — a
        // resisted re-application adds no stack), but the ALREADY-LANDED persistent status must
        // NOT itself be re-rolled each round (the snapshot/partition no-re-roll invariant). So on
        // any round where a fresh application is resisted, the existing stacks remain active.
        const { events, result } = collectEvents(
            baseInput({
                shipSkills: persistentEnforcerSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100, // every round crits → an application is attempted each round
                debuffLandingChance: 0.5,
                numRounds: 10,
            })
        );

        // Once present, it stays present every subsequent round (the existing status is never
        // re-rolled away — only NEW applications can be resisted, and they add no stack).
        const firstPresent = result.rounds.findIndex((r) =>
            r.activeEnemyDebuffs.some((b) => b.buffName === 'Defense Shred')
        );
        expect(firstPresent).toBeGreaterThanOrEqual(0);
        for (let i = firstPresent; i < result.rounds.length; i++) {
            expect(
                result.rounds[i].activeEnemyDebuffs.some((b) => b.buffName === 'Defense Shred')
            ).toBe(true);
        }

        // On every round where a fresh application was resisted (after first landing), the
        // already-landed status is STILL active — proving the existing status is not re-rolled.
        const firstPresentRound = result.rounds[firstPresent].round;
        const resistedRounds = events
            .filter(
                (e) =>
                    e.type === 'debuff-resisted' &&
                    (e as { buffName?: string }).buffName === 'Defense Shred' &&
                    (e as { round?: number }).round! > firstPresentRound
            )
            .map((e) => (e as { round: number }).round);
        for (const rn of resistedRounds) {
            expect(
                result.rounds
                    .find((r) => r.round === rn)!
                    .activeEnemyDebuffs.some((b) => b.buffName === 'Defense Shred')
            ).toBe(true);
        }
    });

    it('persistent (test 6): an active-slot (on-cast) persistent debuff adds +1 stack per cast', () => {
        const onCastSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: {
                                type: 'debuff',
                                buffName: 'Defense Shred',
                                stacks: 1,
                                parsedEffects: { defense: -2 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 3, // ignored — persistent
                            },
                        }),
                    ],
                },
            ],
        });

        const { result } = collectEvents(
            baseInput({
                shipSkills: onCastSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 0,
                numRounds: 5,
            })
        );

        // Active every round → one application per cast → stacks 1,2,3,4,5.
        const seq = result.rounds.map(
            (r) => r.activeEnemyDebuffs.find((b) => b.buffName === 'Defense Shred')?.stacks ?? 0
        );
        expect(seq).toEqual([1, 2, 3, 4, 5]);
    });

    // ----------------------------------------------------------------------
    // Fix B — condition gating on a reclassified start-of-round BUFF. Before the
    // fix only the debuff branch gated executeIntent; the buff/charge/dot branches
    // executed unconditionally, so a start-of-round buff carrying a real co-gate
    // (Asphyxiator shape: enemy-debuff gte N) ignored its gate entirely. With the
    // fix the buff branch honors its gate against the drain context.
    //
    // Drain-snapshot trace (verified): the start-of-round buff drains at drain point
    // (a), BEFORE any turn. buildDrainContext's enemy-debuff count comes from
    // statusEngine.snapshot().activeEnemyDebuffs, which counts SCHEDULED (input
    // enemyDebuffs) statuses — recurring ones are visible immediately — but EXCLUDES
    // ability-sourced (payload-carrying) timed debuffs. So this test seeds the
    // standing count via the scheduled enemyDebuffs input (the count the drain sees):
    //   - gte 2 with TWO standing recurring enemy debuffs ⇒ gate passes ⇒ buff present.
    //   - gte 2 with ONE standing recurring enemy debuff ⇒ count 1 < 2 ⇒ gate fails ⇒
    //     buff absent (before the fix it would have applied regardless).
    // ----------------------------------------------------------------------
    const gatedStartOfRoundBuffSkills = (threshold: number): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        trigger: 'start-of-round',
                        conditions: [
                            {
                                subject: 'enemy-debuff',
                                derivable: true,
                                countComparator: 'gte',
                                countThreshold: threshold,
                            },
                        ],
                        config: {
                            type: 'buff',
                            buffName: 'Gated Attack Up',
                            stacks: 1,
                            parsedEffects: { attack: 30 },
                            isStackable: false,
                            duration: 1,
                        },
                    }),
                ],
            },
        ],
    });

    const recurringEnemyDebuff = (id: string, buffName: string): SelectedGameBuff => ({
        id,
        buffName,
        stacks: 1,
        isStackable: false,
        parsedEffects: { defense: -10 },
        skillSource: 'active',
        skillDuration: 'recurring',
    });

    it('fix B: start-of-round self buff applies when its enemy-debuff gte 2 gate is met (two standing debuffs)', () => {
        const { result } = collectEvents(
            baseInput({
                shipSkills: gatedStartOfRoundBuffSkills(2),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 0,
                enemyDebuffs: [
                    recurringEnemyDebuff('e1', 'Def Down'),
                    recurringEnemyDebuff('e2', 'Speed Down'),
                ],
                numRounds: 3,
            })
        );
        const present = (n: number) =>
            result.rounds
                .find((r) => r.round === n)!
                .activeSelfBuffs.some((b) => b.buffName === 'Gated Attack Up');
        // Count 2 ≥ 2 each round's drain ⇒ gate passes ⇒ buff present every round.
        expect(present(1)).toBe(true);
        expect(present(2)).toBe(true);
        expect(present(3)).toBe(true);
    });

    it('fix B: start-of-round self buff is GATED OUT when its enemy-debuff gte 2 gate fails (one standing debuff) — before the fix it applied unconditionally', () => {
        const { result } = collectEvents(
            baseInput({
                shipSkills: gatedStartOfRoundBuffSkills(2),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 0,
                enemyDebuffs: [recurringEnemyDebuff('e1', 'Def Down')],
                numRounds: 3,
            })
        );
        // Count 1 < 2 ⇒ gate fails on every drain ⇒ buff NEVER applies (the bug: the buff
        // branch ignored the gate and would apply it regardless).
        for (const round of result.rounds) {
            expect(round.activeSelfBuffs.some((b) => b.buffName === 'Gated Attack Up')).toBe(false);
        }
    });

    // A charge follow-up whose manual condition genuinely fails (derivable:false,
    // manualCount:0 → evaluateCondition returns 0 → conditionMet's count>0 is false).
    // liveGateConditions passes manual conditions through untouched, so the gate stays
    // literal. Before Fix B the charge branch ignored conditions entirely and banked +1.
    it('fix B: a charge follow-up with a failing manual condition grants nothing', () => {
        const gatedChargeSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        timedEnemyDebuff('Def Down'),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-debuff-inflicted',
                            // Manual gate that never passes (count 0).
                            conditions: [
                                { subject: 'self-buff', derivable: false, manualCount: 0 },
                            ],
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
            ],
        });

        const { result } = collectEvents(
            baseInput({ shipSkills: gatedChargeSkills(), numRounds: 8 })
        );
        // The trigger fires (a debuff lands each cast) but the gate blocks the charge gain,
        // so cadence is plain +1/active banking ⇒ charged every 4th round (NOT every 3rd).
        expect(result.rounds.map((r) => r.action)).toEqual([
            'active',
            'active',
            'active',
            'charged',
            'active',
            'active',
            'active',
            'charged',
        ]);
    });

    // ----------------------------------------------------------------------
    // Fix C — drain-time HP% includes THIS round's damage so far. An on-crit timed
    // enemy debuff gated on enemy HP% below 50 where the triggering hit itself crosses
    // the threshold. enemyHp 30000; one crit hit deals ~18.5k ≈ 62% of it.
    //
    // Round-1 trace (verified): entering HP% = 100 (> 50). The on-crit drain runs at
    // drain point (b), AFTER the attacker's hit. WITH the fix cumulativeDamage at the
    // drain includes round 1's directDamage (~18.5k) ⇒ post-hit HP% ≈ 38 (< 50) ⇒ the
    // gate passes ⇒ the timed debuff applies on round 1's drain ⇒ visible from round 2
    // (same-turn decrement, identical to the scenario-6 on-crit timing).
    // WITHOUT the fix the drain read the entering-round cumulativeDamage (0) ⇒ HP% 100
    // (> 50) ⇒ the gate failed on round 1; the debuff would only appear from round 3
    // (round 2's entering HP% 38 passes, visible round 3). Asserting round-1 ABSENT and
    // round-2 PRESENT pins the post-hit semantics: it is the crit round's OWN hit that
    // crosses the threshold and triggers the application.
    // ----------------------------------------------------------------------
    it('fix C: on-crit HP-gated debuff applies when the triggering hit crosses the HP threshold (drain sees post-hit HP)', () => {
        const hpGatedSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-crit',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpComparator: 'below',
                                    hpPercent: 50,
                                    hpSubject: 'enemy',
                                },
                            ],
                            config: {
                                type: 'debuff',
                                buffName: 'Below50 Shred',
                                stacks: 1,
                                parsedEffects: { defense: -20 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        });

        const { result } = collectEvents(
            baseInput({
                shipSkills: hpGatedSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100, // every active turn crits → the on-crit trigger fires
                enemyHp: 30000, // one crit hit (~18.5k) takes the enemy below 50% HP
                numRounds: 4,
            })
        );

        const present = (n: number) =>
            result.rounds
                .find((r) => r.round === n)!
                .activeEnemyDebuffs.some((b) => b.buffName === 'Below50 Shred');
        // Round 1: the crit hit crosses 50% → applied on round 1's drain → not yet visible
        // round 1 (same-turn decrement), visible from round 2. WITHOUT the fix the round-1
        // drain saw 100% HP and the debuff would only appear from round 3.
        expect(present(1)).toBe(false);
        expect(present(2)).toBe(true);
    });

    // ----------------------------------------------------------------------
    // Fix D — a resisted persistent-stacking status surfaces its display row with
    // turnsRemaining 'permanent' (not its skill-text turn count). Defense Shred at
    // debuffLandingChance 0 always resists; the resisted row must read 'permanent'.
    // ----------------------------------------------------------------------
    it('fix D: a resisted persistent-stacking debuff shows turnsRemaining "permanent" in resistedEnemyDebuffs', () => {
        const resistedPersistentSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-crit',
                            config: {
                                type: 'debuff',
                                buffName: 'Defense Shred',
                                stacks: 1,
                                parsedEffects: { defense: -2 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 3, // text value — irrelevant; persistent name wins
                            },
                        }),
                    ],
                },
            ],
        });

        const { result } = collectEvents(
            baseInput({
                shipSkills: resistedPersistentSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100, // trigger fires every round
                debuffLandingChance: 0, // always resisted
                numRounds: 3,
            })
        );

        const resistedRow = result.rounds
            .flatMap((r) => r.resistedEnemyDebuffs)
            .find((b) => b.buffName === 'Defense Shred');
        expect(resistedRow).toBeDefined();
        expect(resistedRow!.turnsRemaining).toBe('permanent');
    });
});

// ----------------------------------------------------------------------
// on-attacked live trigger: unit-level tests for the pure listener.
// These tests drive registerReactiveListeners + createEventBus directly
// (nothing emits `attacked` from the engine yet — Task 8). They verify
// the listener fires only for the matching target, is target-scoped (not
// attacker-scoped), and is pure (no state mutation before drain).
// ----------------------------------------------------------------------
describe('on-attacked live trigger (Task 4)', () => {
    // Build a minimal on-attacked reactive ability.
    const onAttackedBuff = (): Ability => ({
        id: 'oa1',
        type: 'buff',
        target: 'self',
        trigger: 'on-attacked',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Counterready',
            stacks: 1,
            parsedEffects: { attack: 20 },
            isStackable: false,
            duration: 1,
        },
    });

    // Helper: wire up the bus, register listeners for the given owners, emit
    // an `attacked` event, and return the collected intents.
    function emitAttacked(
        perOwner: { ownerId: string; reactiveAbilities: ReactiveAbility[] }[],
        event: Extract<CombatEvent, { type: 'attacked' }>
    ): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner,
            enqueue: (i) => intents.push(i),
            enemyId: 'enemy',
        });
        bus.emit(event);
        return intents;
    }

    it('emits exactly one intent for the matching target owner when attacked', () => {
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };
        const intents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'enemy',
            round: 1,
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('t');
        expect(intents[0].ability.trigger).toBe('on-attacked');
    });

    it('enqueues nothing for an actor with no on-attacked ability', () => {
        const intents = emitAttacked([{ ownerId: 't', reactiveAbilities: [] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'enemy',
            round: 1,
        });
        expect(intents).toHaveLength(0);
    });

    it('does NOT fire the listener when targetId does not match ownerId', () => {
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };
        // ownerId is 't' but the event targets 'other-actor'
        const intents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 'other-actor',
            attackerId: 'enemy',
            round: 1,
        });
        expect(intents).toHaveLength(0);
    });

    it('fires only the matching owner when multiple owners are registered', () => {
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };
        const raOther: ReactiveAbility = {
            ability: { ...onAttackedBuff(), id: 'oa2' },
            sourceSlot: 'passive',
        };
        const intents = emitAttacked(
            [
                { ownerId: 't', reactiveAbilities: [ra] },
                { ownerId: 'u', reactiveAbilities: [raOther] },
            ],
            { type: 'attacked', targetId: 't', attackerId: 'enemy', round: 1 }
        );
        // Only owner 't' should fire — 'u' is not the target
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('t');
    });

    it('listener is pure: enqueues only, no state mutation before drain', () => {
        // Verify that the intent array is empty before the event is emitted
        // (the listener produces no side-effects on registration).
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 't', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            enemyId: 'enemy',
        });
        // Before any event: no intents enqueued
        expect(intents).toHaveLength(0);
        // Emit a non-matching event: still nothing
        bus.emit({ type: 'attacked', targetId: 'other', attackerId: 'enemy', round: 1 });
        expect(intents).toHaveLength(0);
        // Emit matching: exactly one
        bus.emit({ type: 'attacked', targetId: 't', attackerId: 'enemy', round: 1 });
        expect(intents).toHaveLength(1);
    });

    it('optional didCrit field is accepted: event with didCrit still fires the listener', () => {
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };
        const intents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'enemy',
            round: 2,
            didCrit: true,
        });
        expect(intents).toHaveLength(1);
    });
});
