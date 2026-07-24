import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import {
    MAX_INTENT_GENERATIONS,
    registerReactiveListeners,
    executeIntent,
    Intent,
    IntentExecContext,
    ReactiveAbility,
    LIVE_TRIGGERS,
    partitionReactiveAbilities,
} from '../triggers';
import { Ability, AbilityTrigger, ShipSkills } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { SelectedGameBuff } from '../../../types/calculator';
import { createStatusEngine } from '../statusEngine';
import type { PlayerActorRuntime, HealingRuntimeCtx } from '../playerTurn';
import type { CombatActor } from '../state';

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
            baseInput({ shipSkills: skills, numRounds: 8, hacking: 0 }) // hacking 0 → landing 0
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
        // SP-U U5: the DPS enemy is real & destructible now — this scenario's heavy direct +
        // corrosion damage would wipe the default 400k pool mid-window and terminate the run,
        // truncating the cadence this test measures. A huge pool keeps it alive all 8 rounds so
        // the on-debuff-inflicted charge cadence is observed in full (enemyHp doesn't affect the
        // cadence; corrosion values aren't asserted here).
        const { result } = collectEvents(
            baseInput({ shipSkills: skills, numRounds: 8, enemyHp: 100_000_000 })
        );
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
        // crit: 100 (overriding baseInput's default 50) on BOTH runs — SP-0's keyed per-actor
        // RNG streams mean two sequential `collectEvents` calls in one test draw from the SAME
        // continuing `attacker:active-crit` sub-stream (no reseed between them), so an
        // intermediate crit rate lets each run's OWN crit outcome (not the buff) dominate the
        // per-round damage comparison below. Forcing every round to crit in both runs removes
        // that confound (mirrors the same fix already used by scenario 6 above), isolating the
        // comparison to the Attack Up buff's effect.
        const { events, result } = collectEvents(
            baseInput({
                shipSkills: buffSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100,
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
                crit: 100,
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
    // Scenario 11 — self-chain guard (Ship-kit W7): an on-debuff-inflicted DEBUFF whose own
    // application would re-trigger itself (Warden's Out. Damage Down II shape). BEFORE W7 this
    // was an unbounded chain that threw MAX_INTENT_GENERATIONS; the guard now brands the reaction's
    // own debuff-applied (`viaDebuffInflictedReaction`) so the on-debuff-inflicted listener skips
    // it — the chain is BOUNDED (Def Down applies from the cast-path Seed Down infliction, then
    // does NOT feed itself). No throw. The generation-cap backstop still exists for genuinely
    // pathological loops (see the separate 'exposes a finite MAX_INTENT_GENERATIONS backstop' test).
    // ----------------------------------------------------------------------
    it('scenario 11: a self-amplifying on-debuff-inflicted debuff is now BOUNDED (W7 self-chain guard), no throw', () => {
        const loopSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        // Seed: a normal on-cast timed debuff inflicts once per cast, emitting an
                        // UNBRANDED debuff-applied (sourceId attacker) → feeds Def Down once.
                        timedEnemyDebuff('Seed Down'),
                        // trigger:'on-debuff-inflicted' whose own application emits debuff-applied.
                        // Pre-W7 that re-triggered itself (unbounded); now the W7 guard brands its
                        // own event so it cannot re-feed this listener → bounded.
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
        const bus = createEventBus();
        let defDown = 0;
        bus.on('debuff-applied', (e) => {
            if (e.type === 'debuff-applied' && e.buffName === 'Def Down') defDown++;
        });
        // Completing at all proves the generation cap is not hit.
        const result = runCombat(
            baseInput({
                shipSkills: loopSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                numRounds: 3,
                bus,
            })
        );
        expect(result.rounds).toHaveLength(3);
        // Def Down applies once per active cast (fed by Seed Down), never self-amplifying.
        expect(defDown).toBeGreaterThan(0);
        expect(defDown).toBeLessThanOrEqual(3);
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
                hacking: 0, // hacking 0 → 0% landing → always resisted
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
        // crit: 100 (was 50) — SP-0's keyed per-actor RNG streams mean the final assertion
        // (directDamage on the last round vs. the first-stacked round) is no longer safe to
        // compare across an intermediate crit rate: two arbitrary rounds may differ in their
        // OWN crit outcome, and that swing dwarfs the modest per-stack defense-reduction delta
        // this test is actually trying to isolate. Forcing every round to crit removes that
        // confound entirely (still exercises the on-crit trigger every round, so stacks still
        // climb every round) without weakening the "scales defense reduction" invariant below.
        const { result } = collectEvents(
            baseInput({
                shipSkills: persistentEnforcerSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                crit: 100,
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
                hacking: 150, // hacking 150 vs default security 100 → 0.5 landing
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
                hacking: 0, // hacking 0 → always resisted
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
            isOpposing: (id) => id === 'enemy',
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
            isOpposing: (id) => id === 'enemy',
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

    // ------------------------------------------------------------------
    // Task 4 (Phase 4c PR 1): crit filter + per-event eventCtx
    // ------------------------------------------------------------------

    // (a) triggerCritFilter 'crit' fires only on critting hits
    it('triggerCritFilter "crit": enqueues only for didCrit:true events targeting the owner', () => {
        const critAbility: Ability = {
            ...onAttackedBuff(),
            id: 'crit-only',
            triggerCritFilter: 'crit',
        };
        const ra: ReactiveAbility = { ability: critAbility, sourceSlot: 'passive' };

        // critting hit → should enqueue
        const critIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
            didCrit: true,
        });
        expect(critIntents).toHaveLength(1);

        // non-critting hit (didCrit absent) → should NOT enqueue
        const nonCritIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
        });
        expect(nonCritIntents).toHaveLength(0);
    });

    // (b) triggerCritFilter 'non-crit' fires only on non-critting hits
    it('triggerCritFilter "non-crit": enqueues only for events WITHOUT didCrit', () => {
        const nonCritAbility: Ability = {
            ...onAttackedBuff(),
            id: 'non-crit-only',
            triggerCritFilter: 'non-crit',
        };
        const ra: ReactiveAbility = { ability: nonCritAbility, sourceSlot: 'passive' };

        // non-critting hit (didCrit absent) → should enqueue
        const nonCritIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
        });
        expect(nonCritIntents).toHaveLength(1);

        // non-critting hit (didCrit: false) → should ALSO enqueue.
        // The engine never emits didCrit:false (present-only-when-true), but this locks
        // listener robustness against any future emitter that includes the explicit falsy flag.
        const nonCritFalseIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
            didCrit: false,
        });
        expect(nonCritFalseIntents).toHaveLength(1);

        // critting hit (didCrit: true) → should NOT enqueue
        const critIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
            didCrit: true,
        });
        expect(critIntents).toHaveLength(0);
    });

    // (c) unfiltered ability (no triggerCritFilter) enqueues for both critting and non-critting hits
    it('unfiltered ability (no triggerCritFilter): enqueues for both critting and non-critting hits', () => {
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };

        const critIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
            didCrit: true,
        });
        expect(critIntents).toHaveLength(1);

        // didCrit absent (normal engine path)
        const nonCritIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
        });
        expect(nonCritIntents).toHaveLength(1);

        // didCrit: false (explicit falsy — listener robustness, engine never emits this)
        const nonCritFalseIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
            didCrit: false,
        });
        expect(nonCritFalseIntents).toHaveLength(1);
    });

    // (d) every enqueued intent carries eventCtx.counterTargetId === e.attackerId
    it('every enqueued intent carries eventCtx.counterTargetId equal to the attackerId', () => {
        const ra: ReactiveAbility = { ability: onAttackedBuff(), sourceSlot: 'passive' };

        const intents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'enemy-attacker-42',
            round: 1,
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.counterTargetId).toBe('enemy-attacker-42');
    });

    it('eventCtx.counterTargetId follows the attackerId for critting hits too', () => {
        const critAbility: Ability = {
            ...onAttackedBuff(),
            id: 'crit-ctx',
            triggerCritFilter: 'crit',
        };
        const ra: ReactiveAbility = { ability: critAbility, sourceSlot: 'passive' };

        const intents = emitAttacked([{ ownerId: 't', reactiveAbilities: [ra] }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'enemy-42',
            round: 1,
            didCrit: true,
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.counterTargetId).toBe('enemy-42');
    });

    // (e) mutually exclusive pair: one 'crit' + one 'non-crit' ability on the same owner
    //     never double-fires — exactly one intent per event
    it('mutually exclusive crit+non-crit pair: exactly one intent per event (never double-fires)', () => {
        const critAbility: Ability = {
            ...onAttackedBuff(),
            id: 'pair-crit',
            triggerCritFilter: 'crit',
        };
        const nonCritAbility: Ability = {
            ...onAttackedBuff(),
            id: 'pair-non-crit',
            triggerCritFilter: 'non-crit',
        };
        const ras: ReactiveAbility[] = [
            { ability: critAbility, sourceSlot: 'passive' },
            { ability: nonCritAbility, sourceSlot: 'passive' },
        ];

        // critting hit: only crit fires
        const critIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: ras }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
            didCrit: true,
        });
        expect(critIntents).toHaveLength(1);
        expect(critIntents[0].ability.triggerCritFilter).toBe('crit');

        // non-critting hit: only non-crit fires
        const nonCritIntents = emitAttacked([{ ownerId: 't', reactiveAbilities: ras }], {
            type: 'attacked',
            targetId: 't',
            attackerId: 'attacker-1',
            round: 1,
        });
        expect(nonCritIntents).toHaveLength(1);
        expect(nonCritIntents[0].ability.triggerCritFilter).toBe('non-crit');
    });
});

// ----------------------------------------------------------------------
// on-ally-attacked listener (Phase 4c PR 2 Task 3): fires when ANOTHER player
// actor takes a direct hit. Unit-level harness mirroring the on-attacked
// crit-filter tests: bare bus + registerReactiveListeners + manual emits.
// Owner is 'graphite' (the reacting ship); 'tank' is another player actor;
// 'enemy' and 'ea1' are enemy-side per the isOpposing predicate.
// ----------------------------------------------------------------------
describe('on-ally-attacked listener', () => {
    // Build a minimal on-ally-attacked reactive ability (Graphite/Cultivator shape).
    const onAllyAttackedBuff = (overrides: Partial<Ability> = {}): Ability =>
        ab({
            type: 'buff',
            target: 'ally',
            trigger: 'on-ally-attacked',
            config: {
                type: 'buff',
                buffName: 'Fortify',
                stacks: 1,
                parsedEffects: { defense: 15 },
                isStackable: false,
                duration: 1,
            },
            ...overrides,
        });

    // Helper: wire up the bus, register the owner's listeners (optionally with a
    // roleOf lookup), emit the given attacked events, return collected intents.
    function emitAllyAttacked(
        reactiveAbilities: ReactiveAbility[],
        events: Extract<CombatEvent, { type: 'attacked' }>[],
        roleOf?: (actorId: string) => ShipTypeName | undefined
    ): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'graphite', reactiveAbilities }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy' || id === 'ea1',
            roleOf,
        });
        for (const e of events) bus.emit(e);
        return intents;
    }

    // (1) ally scoping: another player actor's hit fires; own hits and
    //     enemy-side targets do not
    it('fires when ANOTHER player actor is hit, not for own hits or enemy-side targets', () => {
        const ra: ReactiveAbility = { ability: onAllyAttackedBuff(), sourceSlot: 'passive' };

        // another player actor ('tank') is hit → enqueue
        const allyIntents = emitAllyAttacked(
            [ra],
            [{ type: 'attacked', targetId: 'tank', attackerId: 'ea1', round: 1 }]
        );
        expect(allyIntents).toHaveLength(1);
        expect(allyIntents[0].ownerId).toBe('graphite');
        expect(allyIntents[0].ability.trigger).toBe('on-ally-attacked');

        // the owner itself is hit → NOT an ally hit (on-attacked's job)
        const ownIntents = emitAllyAttacked(
            [ra],
            [{ type: 'attacked', targetId: 'graphite', attackerId: 'ea1', round: 1 }]
        );
        expect(ownIntents).toHaveLength(0);

        // an enemy-side actor is hit (player attacking the enemy) → not an ally
        const enemyIntents = emitAllyAttacked(
            [ra],
            [{ type: 'attacked', targetId: 'enemy', attackerId: 'tank', round: 1 }]
        );
        expect(enemyIntents).toHaveLength(0);
    });

    // (2) per-HIT semantics: the engine emits one attacked event per hit
    it('fires once PER HIT: three attacked events yield three enqueues', () => {
        const ra: ReactiveAbility = { ability: onAllyAttackedBuff(), sourceSlot: 'passive' };
        const hit = { type: 'attacked', targetId: 'tank', attackerId: 'ea1', round: 1 } as const;
        const intents = emitAllyAttacked([ra], [hit, hit, hit]);
        expect(intents).toHaveLength(3);
    });

    // (3) triggerCritFilter discriminates on the hit's own crit outcome
    it('honors triggerCritFilter against the hit didCrit (crit and non-crit)', () => {
        const critRa: ReactiveAbility = {
            ability: onAllyAttackedBuff({ id: 'aa-crit', triggerCritFilter: 'crit' }),
            sourceSlot: 'passive',
        };
        const nonCritRa: ReactiveAbility = {
            ability: onAllyAttackedBuff({ id: 'aa-non-crit', triggerCritFilter: 'non-crit' }),
            sourceSlot: 'passive',
        };
        const critHit = {
            type: 'attacked',
            targetId: 'tank',
            attackerId: 'ea1',
            round: 1,
            didCrit: true,
        } as const;
        const plainHit = {
            type: 'attacked',
            targetId: 'tank',
            attackerId: 'ea1',
            round: 1,
        } as const;
        // Explicit didCrit:false — the engine never emits it (present-only-when-true),
        // but the listener must treat it as non-crit; mirrors the on-attacked PR 1
        // robustness convention pinned above.
        const explicitNonCritHit = {
            type: 'attacked',
            targetId: 'tank',
            attackerId: 'ea1',
            round: 1,
            didCrit: false,
        } as const;

        // 'crit'-filtered: only the didCrit:true hit fires
        const critIntents = emitAllyAttacked([critRa], [critHit, plainHit, explicitNonCritHit]);
        expect(critIntents).toHaveLength(1);
        expect(critIntents[0].ability.triggerCritFilter).toBe('crit');

        // 'non-crit'-filtered: the absent-didCrit hit AND the explicit didCrit:false hit fire
        const nonCritIntents = emitAllyAttacked(
            [nonCritRa],
            [critHit, plainHit, explicitNonCritHit]
        );
        expect(nonCritIntents).toHaveLength(2);
        expect(nonCritIntents.every((i) => i.ability.triggerCritFilter === 'non-crit')).toBe(true);
    });

    // (4) roleFilter matches the DAMAGED ally's role category via roleOf
    describe('roleFilter against the damaged ally role', () => {
        const filtered = (): ReactiveAbility => ({
            ability: onAllyAttackedBuff({
                id: 'aa-role',
                roleFilter: ['ATTACKER', 'DEBUFFER'],
            }),
            sourceSlot: 'passive',
        });
        const hit = { type: 'attacked', targetId: 'tank', attackerId: 'ea1', round: 1 } as const;

        it('enqueues when the ally role is an underscore variant of a listed category', () => {
            const intents = emitAllyAttacked([filtered()], [hit], () => 'DEBUFFER_BOMBER');
            expect(intents).toHaveLength(1);
        });

        it('does NOT enqueue when the ally role is outside the filter', () => {
            const intents = emitAllyAttacked([filtered()], [hit], () => 'DEFENDER');
            expect(intents).toHaveLength(0);
        });

        it('does NOT enqueue when roleOf returns undefined (unknown role = no match)', () => {
            const intents = emitAllyAttacked([filtered()], [hit], () => undefined);
            expect(intents).toHaveLength(0);
        });

        it('does NOT enqueue when no roleOf is passed at all but a filter is present', () => {
            const intents = emitAllyAttacked([filtered()], [hit]);
            expect(intents).toHaveLength(0);
        });

        it('ability WITHOUT roleFilter still enqueues when roleOf is undefined (absent filter = any ally)', () => {
            const ra: ReactiveAbility = { ability: onAllyAttackedBuff(), sourceSlot: 'passive' };
            const intents = emitAllyAttacked([ra], [hit]);
            expect(intents).toHaveLength(1);
        });

        it('EMPTY roleFilter array behaves like absent: fires for any ally', () => {
            const ra: ReactiveAbility = {
                ability: onAllyAttackedBuff({ id: 'aa-empty', roleFilter: [] }),
                sourceSlot: 'passive',
            };
            const intents = emitAllyAttacked([ra], [hit]);
            expect(intents).toHaveLength(1);
        });
    });

    // (5) per-event eventCtx: counter routing (attacker) + ally routing (target)
    it('enqueued intent carries eventCtx with BOTH counterTargetId and damagedAllyId', () => {
        const ra: ReactiveAbility = { ability: onAllyAttackedBuff(), sourceSlot: 'passive' };
        const intents = emitAllyAttacked(
            [ra],
            [{ type: 'attacked', targetId: 'tank', attackerId: 'ea1', round: 1 }]
        );
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.counterTargetId).toBe('ea1');
        expect(intents[0].eventCtx?.damagedAllyId).toBe('tank');
    });
});

// ----------------------------------------------------------------------
// Death-trigger live listeners (Task 5): on-destroyed / on-ally-destroyed /
// on-enemy-destroyed. Unit-level tests driving registerReactiveListeners +
// createEventBus directly. Owner is always 'A' (a player actor); 'B' is
// another player actor; 'enemy' is enemy-side per the isOpposing predicate.
// ----------------------------------------------------------------------
describe('death-trigger live listeners (Task 5)', () => {
    // Build a minimal reactive ability carrying the given death trigger.
    const deathAbility = (trigger: AbilityTrigger): Ability => ({
        id: `d-${trigger}`,
        type: 'buff',
        target: 'self',
        trigger,
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Vengeance',
            stacks: 1,
            parsedEffects: { attack: 20 },
            isStackable: false,
            duration: 1,
        },
    });

    // Wire up the bus, register the owner's listener, emit a ship-destroyed
    // event for `actorId`, and return the collected intents.
    function emitDestroyed(trigger: AbilityTrigger, destroyedActorId: string): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: deathAbility(trigger), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({ type: 'ship-destroyed', actorId: destroyedActorId, round: 1 });
        return intents;
    }

    describe('on-destroyed (own death, self-scoped)', () => {
        it('enqueues exactly one intent when the owner itself is destroyed', () => {
            const intents = emitDestroyed('on-destroyed', 'A');
            expect(intents).toHaveLength(1);
            expect(intents[0].ownerId).toBe('A');
            expect(intents[0].ability.trigger).toBe('on-destroyed');
        });

        it('enqueues nothing when another player actor is destroyed', () => {
            expect(emitDestroyed('on-destroyed', 'B')).toHaveLength(0);
        });

        it('enqueues nothing when an enemy is destroyed', () => {
            expect(emitDestroyed('on-destroyed', 'enemy')).toHaveLength(0);
        });

        // C2b-2 T6: the on-destroyed gate is ABILITY-SCOPED. A PURGE reaction (Faust)
        // fires only on a DIRECT-damage kill and routes counterTargetId = killerId; a
        // non-purge reaction (buff/heal — Salvation's self-destruct heal) stays
        // unconditional and fires on ANY death, regardless of byDirectDamage.
        describe('C2b-2 T6 purge gate (Faust) vs non-purge (Salvation) exemption', () => {
            const purgeDeathAbility = (): Ability => ({
                id: 'd-purge',
                type: 'purge',
                target: 'enemy',
                trigger: 'on-destroyed',
                conditions: [],
                config: { type: 'purge', count: 2 },
            });

            // Emit a ship-destroyed with explicit cause fields and collect intents for
            // the given reactive ability.
            function emitDestroyedCause(
                ability: Ability,
                cause: { byDirectDamage?: boolean; killerId?: string }
            ): Intent[] {
                const bus = createEventBus();
                const intents: Intent[] = [];
                const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
                registerReactiveListeners({
                    bus,
                    perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
                    enqueue: (i) => intents.push(i),
                    isOpposing: (id) => id === 'enemy',
                });
                bus.emit({ type: 'ship-destroyed', actorId: 'A', round: 1, ...cause });
                return intents;
            }

            it('PURGE: fires on a DIRECT kill and routes counterTargetId = killerId', () => {
                const intents = emitDestroyedCause(purgeDeathAbility(), {
                    byDirectDamage: true,
                    killerId: 'enemy',
                });
                expect(intents).toHaveLength(1);
                expect(intents[0].ability.config.type).toBe('purge');
                expect(intents[0].eventCtx?.counterTargetId).toBe('enemy');
            });

            it('PURGE: does NOT fire on a non-direct (DoT) kill (byDirectDamage:false)', () => {
                expect(
                    emitDestroyedCause(purgeDeathAbility(), { byDirectDamage: false })
                ).toHaveLength(0);
            });

            it('PURGE: does NOT fire when byDirectDamage is absent', () => {
                expect(emitDestroyedCause(purgeDeathAbility(), {})).toHaveLength(0);
            });

            it('NON-PURGE (Salvation-style buff/heal): fires on a DoT kill (gate exempt)', () => {
                const intents = emitDestroyedCause(deathAbility('on-destroyed'), {
                    byDirectDamage: false,
                });
                expect(intents).toHaveLength(1);
                expect(intents[0].ability.trigger).toBe('on-destroyed');
            });

            it('NON-PURGE: fires when cause fields are absent (unchanged from Task 5)', () => {
                expect(emitDestroyedCause(deathAbility('on-destroyed'), {})).toHaveLength(1);
            });
        });
    });

    describe('on-ally-destroyed (another player actor dies)', () => {
        it('enqueues one intent when another player actor is destroyed', () => {
            const intents = emitDestroyed('on-ally-destroyed', 'B');
            expect(intents).toHaveLength(1);
            expect(intents[0].ownerId).toBe('A');
            expect(intents[0].ability.trigger).toBe('on-ally-destroyed');
        });

        it('enqueues nothing on the owner own death', () => {
            expect(emitDestroyed('on-ally-destroyed', 'A')).toHaveLength(0);
        });

        it('enqueues nothing when an enemy-side actor is destroyed', () => {
            expect(emitDestroyed('on-ally-destroyed', 'enemy')).toHaveLength(0);
        });
    });

    describe('on-enemy-destroyed (an enemy-side actor dies)', () => {
        it('enqueues one intent when an enemy-side actor is destroyed', () => {
            const intents = emitDestroyed('on-enemy-destroyed', 'enemy');
            expect(intents).toHaveLength(1);
            expect(intents[0].ownerId).toBe('A');
            expect(intents[0].ability.trigger).toBe('on-enemy-destroyed');
        });

        it('enqueues nothing when the owner itself is destroyed', () => {
            expect(emitDestroyed('on-enemy-destroyed', 'A')).toHaveLength(0);
        });

        it('enqueues nothing when another player actor is destroyed', () => {
            expect(emitDestroyed('on-enemy-destroyed', 'B')).toHaveLength(0);
        });
    });

    it('listeners are pure: no enqueue on registration, only on matching emit', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = {
            ability: deathAbility('on-ally-destroyed'),
            sourceSlot: 'passive',
        };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'ship-destroyed', actorId: 'A', round: 1 });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'ship-destroyed', actorId: 'B', round: 1 });
        expect(intents).toHaveLength(1);
    });
});

// ----------------------------------------------------------------------
// on-cheat-death-activated live listener (Task 8): the engine emits
// `cheat-death-activated{actorId, round}` when a Cheat Death intercept saves
// an actor; the owner-scoped listener enqueues that owner's activated abilities.
// ----------------------------------------------------------------------
describe('on-cheat-death-activated live listener (Task 8)', () => {
    // A minimal reactive heal ability carrying the on-cheat-death-activated trigger.
    const cheatDeathHeal = (): Ability => ({
        id: 'cda-heal',
        type: 'heal',
        target: 'self',
        trigger: 'on-cheat-death-activated',
        conditions: [],
        config: { type: 'heal', pct: 60, basis: 'hp', oncePerCombat: true },
    });

    function emitActivated(ownerId: string, activatedActorId: string): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: cheatDeathHeal(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId, reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({ type: 'cheat-death-activated', actorId: activatedActorId, round: 1 });
        return intents;
    }

    it('enqueues the owner own activated ability when its own Cheat Death activates', () => {
        const intents = emitActivated('A', 'A');
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('A');
        expect(intents[0].ability.trigger).toBe('on-cheat-death-activated');
    });

    it('does NOT fire when a DIFFERENT owner Cheat Death activates', () => {
        expect(emitActivated('A', 'B')).toHaveLength(0);
    });

    it('listener is pure: no enqueue on registration, only on a matching emit', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: cheatDeathHeal(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'cheat-death-activated', actorId: 'B', round: 1 });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'cheat-death-activated', actorId: 'A', round: 1 });
        expect(intents).toHaveLength(1);
    });
});

// ----------------------------------------------------------------------
// Once-per-combat repair cap (Task 8): a heal ability flagged oncePerCombat
// fires its consumption at most ONCE across the whole combat — even if its
// intent is executed twice. The cap is a combat-lifetime Set keyed
// `${ownerId}:${abilityId}`, threaded into the executor via IntentExecContext.
// ----------------------------------------------------------------------
describe('once-per-combat repair cap in executeIntent (Task 8)', () => {
    // A self repair (60% of caster max HP) flagged once-per-combat.
    const repairIntent = (): Intent => ({
        ownerId: 'A',
        sourceSlot: 'passive',
        ability: {
            id: 'cda-repair',
            type: 'heal',
            target: 'self',
            trigger: 'on-cheat-death-activated',
            conditions: [],
            config: { type: 'heal', pct: 60, basis: 'hp', oncePerCombat: true },
        },
    });

    // Minimal runtime for the heal branch (it reads healModifier + base stats only).
    const runtime = (): PlayerActorRuntime =>
        ({
            actor: { id: 'A' } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    // Build a healing-on ctx that records every applyHealToTarget call (the consumption).
    const buildCtx = (oncePerCombatFired: Set<string>) => {
        const applied: number[] = [];
        const healing: HealingRuntimeCtx = {
            targetId: 'A',
            credit: () => {},
            recipientMaxHp: () => 1000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => 1000,
            applyHealToTarget: (raw) => {
                applied.push(raw);
                return { consumed: raw, overheal: 0 };
            },
            grantShieldToTarget: () => 0,
            playerIds: ['A'],
            enemyIds: [],
            recipientActor: () => undefined,
        };
        const ctx: IntentExecContext = {
            round: 1,
            enemy: { id: 'enemy' } as CombatActor,
            enemyId: 'enemy',
            statusEngine: createStatusEngine({ selfBuffs: [], enemyDebuffs: [] }),
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['A', runtime()]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['A'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            healing,
            oncePerCombatFired,
        };
        return { ctx, applied };
    };

    it('applies the repair only ONCE when the same intent executes twice', () => {
        const fired = new Set<string>();
        const { ctx, applied } = buildCtx(fired);
        executeIntent(repairIntent(), ctx);
        executeIntent(repairIntent(), ctx);
        // 60% of 1000 = 600, applied exactly once.
        expect(applied).toEqual([600]);
        expect(fired.has('A:cda-repair')).toBe(true);
    });

    it('applies a NON-flagged repair every time (no cap)', () => {
        const fired = new Set<string>();
        const { ctx, applied } = buildCtx(fired);
        const uncapped = repairIntent();
        if (uncapped.ability.config.type === 'heal') uncapped.ability.config.oncePerCombat = false;
        executeIntent(uncapped, ctx);
        executeIntent(uncapped, ctx);
        expect(applied).toEqual([600, 600]);
    });
});

// ----------------------------------------------------------------------
// Scenario 15 — on-attacked engine integration (Task 8): the engine emits
// the `attacked` event from the enemy intake so `on-attacked` reactive
// abilities on the heal target actually fire during a real run.
// ----------------------------------------------------------------------
describe('on-attacked engine integration (Task 8)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    // A heal target with an on-attacked timed self-buff (duration 1 → active the round
    // it was triggered). The focus actor is also the heal target (simplest setup).
    const onAttackedSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-attacked',
                        config: {
                            type: 'buff',
                            buffName: 'Counter Shield',
                            stacks: 1,
                            parsedEffects: { attack: 10 },
                            isStackable: false,
                            duration: 1,
                        },
                    }),
                ],
            },
        ],
    });

    // Minimal enemy attacker: flat-card (no shipSkills), 1 attack per turn.
    const flatEnemy = (): EnemyAttacker => ({
        id: 'ea1',
        stats: { attack: 100, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
    });

    it('scenario 15a: on-attacked fires once per enemy attack turn for the heal target', () => {
        idCounter = 0;
        // The focus actor is the heal target; it has an on-attacked buff. An enemy attacker
        // hits it every round. The buff (duration 1) should be present from the round
        // the enemy attacks through to the next, which means it appears in activeSelfBuffs
        // of the round it was triggered (drain runs within the same turn body).
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('attacked', (e) => events.push(e as CombatEvent));
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));

        runCombat(
            baseInput({
                shipSkills: onAttackedSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                hp: 1_000_000, // large HP so target survives
                defence: 0,
                healTargetId: 'attacker',
                numRounds: 3,
                bus,
                enemyAttackers: [flatEnemy()],
            })
        );

        // One `attacked` event per round (one enemy attacker, one turn per round).
        const attackedEvents = events.filter((e) => e.type === 'attacked');
        expect(attackedEvents.length).toBe(3);

        // Every attacked event targets the heal target and names the enemy attacker.
        for (const e of attackedEvents) {
            expect((e as { targetId?: string }).targetId).toBe('attacker');
            expect((e as { attackerId?: string }).attackerId).toBe('ea1');
        }

        // The on-attacked buff was applied at least once (the reactive ability fired).
        const buffApplied = events.filter(
            (e) =>
                e.type === 'buff-applied' &&
                (e as { buffName?: string }).buffName === 'Counter Shield'
        );
        expect(buffApplied.length).toBeGreaterThan(0);
    });

    it('scenario 15b: target WITHOUT an on-attacked ability is unaffected (no buff applied)', () => {
        idCounter = 0;
        // Focus has NO on-attacked ability; the enemy still attacks.
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));

        runCombat(
            baseInput({
                shipSkills: { slots: [] }, // no abilities
                hasChargedSkill: false,
                chargeCount: 0,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                numRounds: 3,
                bus,
                enemyAttackers: [flatEnemy()],
            })
        );

        // No 'Counter Shield' buff should appear.
        const counterBuff = events.filter(
            (e) =>
                e.type === 'buff-applied' &&
                (e as { buffName?: string }).buffName === 'Counter Shield'
        );
        expect(counterBuff.length).toBe(0);
    });

    it('scenario 15c: no attacked event emitted when heal target is dead (dead-target guard)', () => {
        idCounter = 0;
        // hp 1: target dies round 1. Rounds 2+ the dead-target guard should prevent
        // runPlayerTurn from running for the enemy attacker → no `attacked` events after round 1.
        const attackedEvents: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('attacked', (e) => attackedEvents.push(e as CombatEvent));

        runCombat(
            baseInput({
                shipSkills: { slots: [] },
                hasChargedSkill: false,
                chargeCount: 0,
                hp: 1, // dies immediately
                defence: 0,
                healTargetId: 'attacker',
                numRounds: 4,
                bus,
                enemyAttackers: [
                    {
                        id: 'ea2',
                        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                    } as EnemyAttacker,
                ],
            })
        );

        // At most 1 `attacked` event (round 1, before/when target dies).
        // Rounds 2-4 the dead-target guard skips the attack entirely.
        const laterEvents = attackedEvents.filter((e) => (e as { round?: number }).round! > 1);
        expect(laterEvents.length).toBe(0);
    });
});

// ----------------------------------------------------------------------
// Phase 4b — death/revive trigger promotion to LIVE_TRIGGERS.
// All four death/revive triggers must be in LIVE_TRIGGERS so that
// partitionReactiveAbilities routes abilities carrying them into the
// reactive partition (not the on-cast path).
// Type-level: AbilityTrigger must include the new values so they compile.
// ----------------------------------------------------------------------
describe('Phase 4b: death/revive triggers in LIVE_TRIGGERS', () => {
    it('LIVE_TRIGGERS contains on-destroyed', () => {
        expect(LIVE_TRIGGERS.has('on-destroyed')).toBe(true);
    });

    it('LIVE_TRIGGERS contains on-ally-destroyed', () => {
        expect(LIVE_TRIGGERS.has('on-ally-destroyed')).toBe(true);
    });

    it('LIVE_TRIGGERS contains on-enemy-destroyed', () => {
        expect(LIVE_TRIGGERS.has('on-enemy-destroyed')).toBe(true);
    });

    it('LIVE_TRIGGERS contains on-cheat-death-activated', () => {
        expect(LIVE_TRIGGERS.has('on-cheat-death-activated')).toBe(true);
    });

    it('AbilityTrigger includes on-enemy-destroyed (type-level compile check)', () => {
        // If AbilityTrigger does not include this value the assignment below causes a
        // TypeScript compile error (ts(2322)), which Vitest surfaces as a type error.
        const _trigger: AbilityTrigger = 'on-enemy-destroyed';
        expect(_trigger).toBe('on-enemy-destroyed');
    });

    it('AbilityTrigger includes on-cheat-death-activated (type-level compile check)', () => {
        const _trigger: AbilityTrigger = 'on-cheat-death-activated';
        expect(_trigger).toBe('on-cheat-death-activated');
    });
});

// ----------------------------------------------------------------------
// Task 1 (Phase 4c): type-layer additions
//   - Ability.triggerCritFilter?: 'crit' | 'non-crit'
//   - Intent.eventCtx?: { counterTargetId?: string }
// These are structural tests: construct typed literals with the new fields
// and assert the values round-trip correctly. The tests FAIL until the
// fields are added to their respective interfaces.
// ----------------------------------------------------------------------
describe('Phase 4c Task 1: triggerCritFilter and eventCtx type additions', () => {
    it('Ability accepts triggerCritFilter "crit" and the value round-trips', () => {
        // If triggerCritFilter is not on the Ability interface this line causes a
        // TypeScript compile error (ts(2353)), which Vitest surfaces as a type error.
        const ability = ab({
            type: 'buff',
            trigger: 'on-attacked',
            triggerCritFilter: 'crit',
            config: {
                type: 'buff',
                buffName: 'Crit Only Buff',
                stacks: 1,
                parsedEffects: { attack: 10 },
                isStackable: false,
                duration: 1,
            },
        });
        expect(ability.triggerCritFilter).toBe('crit');
    });

    it('Ability accepts triggerCritFilter "non-crit" and the value round-trips', () => {
        const ability = ab({
            type: 'buff',
            trigger: 'on-attacked',
            triggerCritFilter: 'non-crit',
            config: {
                type: 'buff',
                buffName: 'NonCrit Only Buff',
                stacks: 1,
                parsedEffects: { attack: 5 },
                isStackable: false,
                duration: 1,
            },
        });
        expect(ability.triggerCritFilter).toBe('non-crit');
    });

    it('Ability with no triggerCritFilter has the field undefined (absent → fires on any hit)', () => {
        const ability = ab({
            type: 'buff',
            trigger: 'on-attacked',
            config: {
                type: 'buff',
                buffName: 'Any Hit Buff',
                stacks: 1,
                parsedEffects: { attack: 5 },
                isStackable: false,
                duration: 1,
            },
        });
        expect(ability.triggerCritFilter).toBeUndefined();
    });

    it('Intent accepts eventCtx with counterTargetId and the value round-trips', () => {
        // If eventCtx is not on the Intent interface this line causes a TypeScript
        // compile error (ts(2353)), which Vitest surfaces as a type error.
        const intent: Intent = {
            ownerId: 'attacker',
            sourceSlot: 'passive',
            ability: {
                id: 'ctx-test',
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: 'Counter Debuff',
                    stacks: 1,
                    parsedEffects: { defense: -10 },
                    isStackable: false,
                    application: 'inflict',
                    duration: 2,
                },
            },
            eventCtx: { counterTargetId: 'enemy-1' },
        };
        expect(intent.eventCtx?.counterTargetId).toBe('enemy-1');
    });

    it('Intent with eventCtx but no counterTargetId has counterTargetId undefined', () => {
        const intent: Intent = {
            ownerId: 'attacker',
            sourceSlot: 'passive',
            ability: {
                id: 'ctx-empty',
                type: 'charge',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            },
            eventCtx: {},
        };
        // eventCtx must be present (object present, key absent) — not just "undefined chain"
        expect(intent.eventCtx).toBeDefined();
        expect('counterTargetId' in intent.eventCtx!).toBe(false);
    });

    it('Intent without eventCtx has the field undefined (normal non-event-context intent)', () => {
        const intent: Intent = {
            ownerId: 'attacker',
            sourceSlot: 'passive',
            ability: {
                id: 'no-ctx',
                type: 'charge',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: { type: 'charge', amount: 1 },
            },
        };
        expect(intent.eventCtx).toBeUndefined();
    });
});

// ----------------------------------------------------------------------
// Task 5 (Phase 4c PR 1): counter-debuff routing to the attacker's store
//
// A debuff intent carrying eventCtx.counterTargetId must:
//   - apply the timed status to THAT enemy's per-target store
//   - emit `debuff-applied` with targetId === counterTargetId
// Without eventCtx the default store and ctx.enemy.id are used (lock
// existing behaviour).
// ----------------------------------------------------------------------
describe('Phase 4c Task 5: counter-debuff routing via eventCtx.counterTargetId', () => {
    // Minimal PlayerActorRuntime that always lands (debuffLandingChance=1).
    const makeRuntime = (): PlayerActorRuntime =>
        ({
            actor: { id: 'attacker' } as CombatActor,
            landsTimedEnemyApplication: () => true,
            debuffLandingGate: (_rate: number) => true,
        }) as unknown as PlayerActorRuntime;

    const makeDebuffIntent = (counterTargetId?: string): Intent => ({
        ownerId: 'attacker',
        sourceSlot: 'passive',
        ability: {
            id: 'counter-debuff',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Counter Corrosion',
                stacks: 1,
                parsedEffects: { defense: -5 },
                isStackable: false,
                application: 'inflict',
                duration: 2,
            },
        },
        ...(counterTargetId !== undefined ? { eventCtx: { counterTargetId } } : {}),
    });

    const buildCtx = (): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['attacker', makeRuntime()]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        };
    };

    it('routes debuff to the counterTargetId store when eventCtx carries one', () => {
        const ctx = buildCtx();
        const emitted: Array<{ type: string; targetId?: string }> = [];
        ctx.bus.on('debuff-applied', (e) => emitted.push(e as { type: string; targetId?: string }));

        executeIntent(makeDebuffIntent('enemy-1'), ctx);

        // The timed ability status lands on the 'enemy-1' per-target store, not the default.
        const timedEnemy1 = ctx.statusEngine.timedAbilityStatuses('enemy', undefined, 'enemy-1');
        expect(timedEnemy1.some((s) => s.active.buffName === 'Counter Corrosion')).toBe(true);

        // The default store must NOT have received the debuff.
        const timedDefault = ctx.statusEngine.timedAbilityStatuses('enemy', undefined, undefined);
        expect(timedDefault.some((s) => s.active.buffName === 'Counter Corrosion')).toBe(false);

        // debuff-applied event targets 'enemy-1'.
        expect(emitted).toHaveLength(1);
        expect(emitted[0].targetId).toBe('enemy-1');
    });

    it('uses the default store and ctx.enemy.id when no eventCtx is present', () => {
        const ctx = buildCtx();
        const emitted: Array<{ type: string; targetId?: string }> = [];
        ctx.bus.on('debuff-applied', (e) => emitted.push(e as { type: string; targetId?: string }));

        executeIntent(makeDebuffIntent(), ctx);

        // The timed ability status lands on the default enemy store.
        const timedDefault = ctx.statusEngine.timedAbilityStatuses('enemy', undefined, undefined);
        expect(timedDefault.some((s) => s.active.buffName === 'Counter Corrosion')).toBe(true);

        // debuff-applied event targets the default enemy (ctx.enemy.id).
        expect(emitted).toHaveLength(1);
        expect(emitted[0].targetId).toBe('enemy-default');
    });
});

// ----------------------------------------------------------------------
// Phase 4c Task 6: live drain-time selfHpPct
//
// buildDrainContext must forward the owner's REAL HP% to the condition gate
// via ctx.selfHpPctFor?(ownerId). A heal intent gated on below-40% HP:
//   - is SKIPPED when the delegate reports 80%
//   - EXECUTES when the delegate reports 30%
//   - when no delegate is provided (legacy ctx), defaults to 100 → gate
//     never met for below-threshold conditions.
// ----------------------------------------------------------------------
describe('Phase 4c Task 6: live drain-time selfHpPct', () => {
    // A heal intent gated on "self HP below 40%".
    const makeHealIntent = (): Intent => ({
        ownerId: 'A',
        sourceSlot: 'passive',
        ability: {
            id: 'low-hp-heal',
            type: 'heal',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 40,
                    hpSubject: 'self',
                },
            ],
            config: { type: 'heal', pct: 50, basis: 'hp' },
        },
    });

    const runtime = (): PlayerActorRuntime =>
        ({
            actor: { id: 'A' } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    const buildCtx = (
        selfHpPctFor?: (ownerId: string) => number
    ): { ctx: IntentExecContext; applied: number[] } => {
        const applied: number[] = [];
        const healing: HealingRuntimeCtx = {
            targetId: 'A',
            credit: () => {},
            recipientMaxHp: () => 1000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => 1000,
            applyHealToTarget: (raw) => {
                applied.push(raw);
                return { consumed: raw, overheal: 0 };
            },
            grantShieldToTarget: () => 0,
            playerIds: ['A'],
            enemyIds: [],
            recipientActor: () => undefined,
        };
        const ctx: IntentExecContext = {
            round: 1,
            enemy: { id: 'enemy' } as CombatActor,
            enemyId: 'enemy',
            statusEngine: createStatusEngine({ selfBuffs: [], enemyDebuffs: [] }),
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['A', runtime()]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['A'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            healing,
            ...(selfHpPctFor !== undefined ? { selfHpPctFor } : {}),
        };
        return { ctx, applied };
    };

    it('SKIPS the heal when the delegate reports HP 80% (above the 40% gate)', () => {
        const { ctx, applied } = buildCtx(() => 80);
        executeIntent(makeHealIntent(), ctx);
        expect(applied).toHaveLength(0);
    });

    it('EXECUTES the heal when the delegate reports HP 30% (below the 40% gate)', () => {
        const { ctx, applied } = buildCtx(() => 30);
        executeIntent(makeHealIntent(), ctx);
        // 50% of owner hp (1000) = 500
        expect(applied).toEqual([500]);
    });

    it('defaults to selfHpPct 100 (gate never met) when no delegate is provided', () => {
        // No selfHpPctFor → buildDrainContext falls back to 100, which is above 40 → skip.
        const { ctx, applied } = buildCtx(undefined);
        executeIntent(makeHealIntent(), ctx);
        expect(applied).toHaveLength(0);
    });
});

// ----------------------------------------------------------------------
// Combat-log fidelity (#1): a RESISTED reactive debuff reports the RESOLVED
// target it was aimed at (eventCtx.counterTargetId / enemy-highest-attack),
// falling back to ctx.enemy.id only when no specific victim resolved — so the
// log names the ship that resisted instead of the dummy sink. (This SUPERSEDES
// the earlier Task-5 "always ctx.enemy.id" lock: the resisted target is now the
// same debuffTargetId the applied path uses.)
// ----------------------------------------------------------------------
describe('debuff-resisted reports the resolved counter target (combat-log fidelity)', () => {
    const makeResistableDebuffIntent = (counterTargetId: string): Intent => ({
        ownerId: 'attacker',
        sourceSlot: 'passive',
        ability: {
            id: 'counter-debuff-resisted',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Counter Shred',
                stacks: 1,
                parsedEffects: { defense: -5 },
                isStackable: false,
                application: 'inflict',
                duration: 2,
            },
        },
        eventCtx: { counterTargetId },
    });

    it('debuff-resisted emits with targetId === the resolved counterTargetId when set', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        const emitted: Array<{ type: string; targetId?: string }> = [];
        const ctx: IntentExecContext = {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                [
                    'attacker',
                    {
                        actor: { id: 'attacker' } as CombatActor,
                        // landsTimedEnemyApplication returns false → resist path
                        landsTimedEnemyApplication: () => false,
                        debuffLandingGate: (_rate: number) => false,
                    } as unknown as PlayerActorRuntime,
                ],
            ]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        };
        ctx.bus.on('debuff-resisted', (e) =>
            emitted.push(e as { type: string; targetId?: string })
        );

        executeIntent(makeResistableDebuffIntent('enemy-attacker-99'), ctx);

        // debuff-resisted now points at the RESOLVED counter target (the ship it was aimed at),
        // so the combat log can name it — not the default ctx.enemy.id dummy sink.
        expect(emitted).toHaveLength(1);
        expect(emitted[0].targetId).toBe('enemy-attacker-99');
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 2 Task 4: ally-target payload routing via eventCtx.damagedAllyId
//
// An on-ally-attacked reaction grant ('ally' target + eventCtx naming the
// damaged ally — Graphite's "grants the ally Repair Over Time III") must land
// on EXACTLY that ally. Without the routing the buff branch's Task-5 rule
// ('ally' → every playerId) would put the HoT on the whole team and inflate
// healing numbers. Without eventCtx the all-players grant is preserved
// (PR 1 contract lock). The heal branch prefers damagedAllyId over
// ctx.healing.targetId — identical today (the engine only attacks the heal
// target) but locks "repairs THAT ally" semantics for 4d multi-target.
// ----------------------------------------------------------------------
describe('Phase 4c PR 2 Task 4: damagedAllyId recipient routing', () => {
    const PLAYER_IDS = ['healer', 'team1', 'tank'];

    const makeRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    const makeBuffIntent = (damagedAllyId?: string): Intent => ({
        ownerId: 'healer',
        sourceSlot: 'passive',
        ability: {
            id: 'graphite-ally-hot',
            type: 'buff',
            target: 'ally',
            trigger: 'on-ally-attacked',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Repair Over Time III',
                stacks: 1,
                parsedEffects: { defense: 5 },
                isStackable: false,
                duration: 2,
            },
        },
        ...(damagedAllyId !== undefined
            ? { eventCtx: { counterTargetId: 'ea1', damagedAllyId } }
            : {}),
    });

    const buildBuffCtx = (): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['healer', makeRuntime('healer')]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: PLAYER_IDS,
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        };
    };

    it('buff intent with eventCtx.damagedAllyId and target "ally" grants ONLY the damaged ally', () => {
        const ctx = buildBuffCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');
        const buffEvents: Array<{ actorId?: string }> = [];
        ctx.bus.on('buff-applied', (e) => buffEvents.push(e as { actorId?: string }));

        executeIntent(makeBuffIntent('tank'), ctx);

        // EXACTLY one application, recipient = the damaged ally (third positional arg).
        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(applySpy.mock.calls[0][2]).toBe('tank');

        // Exactly one buff-applied event, on the damaged ally — not the whole team.
        expect(buffEvents).toHaveLength(1);
        expect(buffEvents[0].actorId).toBe('tank');
    });

    it('buff intent with target "ally" and NO eventCtx keeps the all-players grant (PR 1 contract)', () => {
        const ctx = buildBuffCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');
        const buffEvents: Array<{ actorId?: string }> = [];
        ctx.bus.on('buff-applied', (e) => buffEvents.push(e as { actorId?: string }));

        executeIntent(makeBuffIntent(), ctx);

        // Every player id receives the grant, in the fixed playerIds order.
        expect(applySpy).toHaveBeenCalledTimes(PLAYER_IDS.length);
        expect(applySpy.mock.calls.map((c) => c[2])).toEqual(PLAYER_IDS);
        expect(buffEvents.map((e) => e.actorId)).toEqual(PLAYER_IDS);
    });

    // ---- heal branch: damagedAllyId preferred over ctx.healing.targetId ----

    const makeHealIntent = (damagedAllyId: string): Intent => ({
        ownerId: 'healer',
        sourceSlot: 'passive',
        ability: {
            id: 'ally-reactive-repair',
            type: 'heal',
            target: 'ally',
            trigger: 'on-ally-attacked',
            conditions: [],
            config: { type: 'heal', pct: 10, basis: 'hp' },
        },
        eventCtx: { counterTargetId: 'ea1', damagedAllyId },
    });

    const buildHealCtx = (): {
        ctx: IntentExecContext;
        applied: number[];
        credits: Array<{ bucket: string; amount: number }>;
    } => {
        const applied: number[] = [];
        const credits: Array<{ bucket: string; amount: number }> = [];
        const healing: HealingRuntimeCtx = {
            targetId: 'tank',
            credit: (_actorId, bucket, amount) => credits.push({ bucket, amount }),
            recipientMaxHp: () => 1000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => 1000,
            applyHealToTarget: (raw) => {
                applied.push(raw);
                return { consumed: raw, overheal: 0 };
            },
            grantShieldToTarget: () => 0,
            playerIds: PLAYER_IDS,
            enemyIds: [],
            recipientActor: () => undefined,
        };
        const ctx: IntentExecContext = {
            ...buildBuffCtx(),
            healing,
        };
        return { ctx, applied, credits };
    };

    it('heal intent with damagedAllyId === healing.targetId routes to the target (effectiveHeal credited)', () => {
        const { ctx, applied, credits } = buildHealCtx();

        executeIntent(makeHealIntent('tank'), ctx);

        // 10% of owner hp (1000) = 100, consumed by the heal target.
        expect(applied).toEqual([100]);
        expect(credits).toContainEqual({ bucket: 'directHeal', amount: 100 });
        expect(credits).toContainEqual({ bucket: 'effectiveHeal', amount: 100 });
    });

    it('heal intent with damagedAllyId ≠ healing.targetId credits directHeal but does NOT touch the target pool', () => {
        const { ctx, applied, credits } = buildHealCtx();

        // The damaged ally is 'team1', NOT the heal target 'tank' — locks the
        // recipient-vs-target consumption split for the 4d multi-target future.
        executeIntent(makeHealIntent('team1'), ctx);

        expect(applied).toHaveLength(0);
        expect(credits).toContainEqual({ bucket: 'directHeal', amount: 100 });
        expect(credits.some((c) => c.bucket === 'effectiveHeal')).toBe(false);
    });
});

describe('Overload lifecycle Task 3: executeIntent remove-self-buff branch', () => {
    const makeRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    const makeRemoveSelfBuffIntent = (ownerId: string): Intent => ({
        ownerId,
        sourceSlot: 'passive',
        ability: {
            id: 'overload-removal',
            type: 'remove-self-buff',
            target: 'self',
            trigger: 'on-enemy-destroyed',
            conditions: [],
            config: { type: 'remove-self-buff', buffName: 'Overload', scope: 'all' },
        },
    });

    const buildCtx = (ownerId: string): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([[ownerId, makeRuntime(ownerId)]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: [ownerId],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        };
    };

    it('calls removeSelfBuffByName with (ownerId, buffName)', () => {
        const ctx = buildCtx('attacker');
        const spy = vi.spyOn(ctx.statusEngine, 'removeSelfBuffByName');

        executeIntent(makeRemoveSelfBuffIntent('attacker'), ctx);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('attacker', 'Overload');
    });
});

// ----------------------------------------------------------------------
// Overload lifecycle Task 3 — remove-self-buff partition guard.
// A `remove-self-buff` ability with a REACTIVE trigger (on-enemy-destroyed)
// MUST route to reactiveAbilities so its bus listener registers and the
// removal fires reactively. The SAME ability with `on-cast` MUST stay in
// castSkills (the cast path handles it). This guard ensures a future edit to
// REACTIVE_ABILITY_TYPES cannot silently regress either path.
// ----------------------------------------------------------------------
describe('Overload lifecycle Task 3: remove-self-buff partition guard (on-enemy-destroyed reactive, on-cast stays cast)', () => {
    const removeSelfBuffOnKill = (): Ability => ({
        id: 'rsbk1',
        type: 'remove-self-buff',
        target: 'self',
        trigger: 'on-enemy-destroyed',
        conditions: [],
        config: { type: 'remove-self-buff', buffName: 'Overload', scope: 'all' },
    });

    const removeSelfBuffOnCast = (): Ability => ({
        id: 'rsbc1',
        type: 'remove-self-buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'remove-self-buff', buffName: 'Overload', scope: 'all' },
    });

    const skills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [removeSelfBuffOnCast()],
            },
            {
                slot: 'passive',
                abilities: [removeSelfBuffOnKill()],
            },
        ],
    });

    it('on-enemy-destroyed remove-self-buff routes to reactiveAbilities (IS classified reactive)', () => {
        const { castSkills, reactiveAbilities } = partitionReactiveAbilities(skills());
        const castIds = castSkills.slots.flatMap((s) => s.abilities.map((a) => a.id));
        const reactiveIds = reactiveAbilities.map((r) => r.ability.id);
        expect(reactiveIds).toContain('rsbk1');
        expect(castIds).not.toContain('rsbk1');
    });

    it('on-cast remove-self-buff stays in castSkills (NOT classified reactive)', () => {
        const { castSkills, reactiveAbilities } = partitionReactiveAbilities(skills());
        const castIds = castSkills.slots.flatMap((s) => s.abilities.map((a) => a.id));
        const reactiveIds = reactiveAbilities.map((r) => r.ability.id);
        expect(castIds).toContain('rsbc1');
        expect(reactiveIds).not.toContain('rsbc1');
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 2 Task 5: on-ally-attacked ENGINE integration (scenario 16).
// Full runCombat in healing mode: a walked TEAM owner carries the reactive
// ability; the heal target is a walked team 'tank' the enemy attacker hits.
// Locks the engine-level threading: per-hit attacked events feed the owner's
// listener; 'ally'-target payloads route to the DAMAGED tank (damagedAllyId);
// roleFilter resolves the tank's role via the engine-built roleByActorId map
// (TeamActorInput.role / CombatEngineInput.role → roleOf); counter debuffs
// route to the ATTACKING enemy's per-target store (counterTargetId).
// ----------------------------------------------------------------------
describe('on-ally-attacked engine integration (scenario 16)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    // Walked team actor: real runPlayerTurn pipeline (reactive abilities only
    // register for WALKED owners), real hp (the heal target's currentHp seeds
    // from walk stats). `extra` lets a test set `role` / overrides.
    const teamWalk = (
        id: string,
        speed: number,
        hp: number,
        shipSkills: ShipSkills,
        extra: Partial<TeamActorEngineInput> = {}
    ): TeamActorEngineInput => ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills,
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 200, // vs enemy default security 100 → landing 1 (was masked by the old gate when enemy had no security; debuffLandingChance: 1 below kept it 100%)
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
        ...extra,
    });

    // Graphite shape: passive on-ally-attacked ally buff (duration 2). Ability-level
    // overrides (roleFilter, triggerCritFilter) flow through to the reactive guard.
    const reactivePlatingSkills = (overrides: Partial<Ability> = {}): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'ally',
                        trigger: 'on-ally-attacked',
                        config: {
                            type: 'buff',
                            buffName: 'Reactive Plating',
                            stacks: 1,
                            parsedEffects: { defense: 15 },
                            isStackable: false,
                            duration: 2,
                        },
                        ...overrides,
                    }),
                ],
            },
        ],
    });

    // Minimal flat-card enemy attacker: one attack (one `attacked` event) per turn.
    const flatEnemy = (stats: Partial<EnemyAttacker['stats']> = {}): EnemyAttacker => ({
        id: 'ea1',
        stats: { attack: 100, crit: 0, critDamage: 0, speed: 10, ...stats },
        chargeCount: 0,
        startCharged: false,
    });

    // Shared arrangement: focus actor (no reactives, NOT the heal target) + team owner
    // 'graphite' (reactive carrier) + team 'tank' (heal target, large HP, optional role)
    // + one enemy attacker bombarding the tank. Returns the collected bus events.
    const runScenario = (opts: {
        ownerSkills: ShipSkills;
        tankSkills?: ShipSkills;
        tankRole?: ShipTypeName;
        enemy?: EnemyAttacker;
        numRounds?: number;
    }): CombatEvent[] => {
        idCounter = 0;
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('attacked', (e) => events.push(e as CombatEvent));
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));
        bus.on('debuff-applied', (e) => events.push(e as CombatEvent));
        runCombat(
            baseInput({
                shipSkills: { slots: [] }, // focus actor: no reactives
                hasChargedSkill: false,
                chargeCount: 0,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'tank',
                numRounds: opts.numRounds ?? 3,
                bus,
                teamActors: [
                    teamWalk('graphite', 120, 50_000, opts.ownerSkills),
                    teamWalk('tank', 80, 1_000_000, opts.tankSkills ?? { slots: [] }, {
                        role: opts.tankRole,
                    }),
                ],
                enemyAttackers: [opts.enemy ?? flatEnemy()],
            })
        );
        return events;
    };

    const buffsNamed = (events: CombatEvent[], buffName: string) =>
        events.filter(
            (e) => e.type === 'buff-applied' && (e as { buffName?: string }).buffName === buffName
        ) as Array<{ actorId: string }>;

    it('scenario 16a: team owner grants the damaged tank the ally buff, once per attack turn, ONLY the tank', () => {
        const events = runScenario({ ownerSkills: reactivePlatingSkills(), tankRole: 'ATTACKER' });

        // One attacked event per round, all on the tank — locks the arrangement.
        const attacked = events.filter((e) => e.type === 'attacked');
        expect(attacked.length).toBe(3);
        for (const e of attacked) {
            expect((e as { targetId?: string }).targetId).toBe('tank');
            expect((e as { attackerId?: string }).attackerId).toBe('ea1');
        }

        // The reactive fires once per attack turn; damagedAllyId routing means the
        // 'ally' payload lands on EXACTLY the tank (never graphite or the focus actor).
        const plating = buffsNamed(events, 'Reactive Plating');
        expect(plating.length).toBe(3);
        expect(plating.every((e) => e.actorId === 'tank')).toBe(true);
    });

    describe('scenario 16b: roleFilter dormancy/firing against the tank role from the engine input', () => {
        const filteredSkills = () =>
            reactivePlatingSkills({ roleFilter: ['ATTACKER', 'DEBUFFER'] });

        it('tank role DEFENDER (outside the filter) → ZERO applications', () => {
            const events = runScenario({ ownerSkills: filteredSkills(), tankRole: 'DEFENDER' });
            expect(buffsNamed(events, 'Reactive Plating').length).toBe(0);
        });

        it('tank role DEBUFFER_BOMBER (underscore variant of a listed category) → fires every attack turn', () => {
            const events = runScenario({
                ownerSkills: filteredSkills(),
                tankRole: 'DEBUFFER_BOMBER',
            });
            const plating = buffsNamed(events, 'Reactive Plating');
            expect(plating.length).toBe(3);
            expect(plating.every((e) => e.actorId === 'tank')).toBe(true);
        });

        it('NO role on the tank input + filter present → dormant (conservative)', () => {
            const events = runScenario({ ownerSkills: filteredSkills() });
            expect(buffsNamed(events, 'Reactive Plating').length).toBe(0);
        });
    });

    describe('scenario 16c: crit-only counter debuff routes to the attacking enemy (Guardian Provoke shape)', () => {
        const provokeSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-ally-attacked',
                            triggerCritFilter: 'crit',
                            config: {
                                type: 'debuff',
                                buffName: 'Provoke',
                                stacks: 1,
                                parsedEffects: { defense: -10 },
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        });

        it('100%-crit enemy → Provoke lands on THAT enemy id each attack turn (per-target routing)', () => {
            const events = runScenario({
                ownerSkills: provokeSkills(),
                tankRole: 'DEFENDER',
                enemy: flatEnemy({ crit: 100, critDamage: 50 }),
            });
            const provokes = events.filter(
                (e) =>
                    e.type === 'debuff-applied' &&
                    (e as { buffName?: string }).buffName === 'Provoke'
            ) as Array<{ targetId: string }>;
            expect(provokes.length).toBe(3);
            expect(provokes.every((e) => e.targetId === 'ea1')).toBe(true);
        });

        it('0%-crit enemy → no Provoke (crit filter holds at the engine level)', () => {
            const events = runScenario({
                ownerSkills: provokeSkills(),
                tankRole: 'DEFENDER',
                enemy: flatEnemy({ crit: 0 }),
            });
            const provokes = events.filter(
                (e) =>
                    e.type === 'debuff-applied' &&
                    (e as { buffName?: string }).buffName === 'Provoke'
            );
            expect(provokes.length).toBe(0);
        });
    });

    it('scenario 16d: the heal target OWNING the on-ally-attacked ability does NOT fire on its own hits', () => {
        // The tank itself carries the reactive; only the tank is ever attacked. Own hits
        // are on-attacked scope — the ally listener must stay silent the whole run.
        const events = runScenario({
            ownerSkills: { slots: [] },
            tankSkills: reactivePlatingSkills(),
            tankRole: 'ATTACKER',
        });
        expect(events.filter((e) => e.type === 'attacked').length).toBe(3);
        expect(buffsNamed(events, 'Reactive Plating').length).toBe(0);
    });
});

// ----------------------------------------------------------------------
// D-PR11: start-of-turn trigger — self-scoped on turn-started.
//
// Fortifying Shroud fires once at the START of the owner's OWN turn
// (not every actor's turn). The engine emits `turn-started` once per actor
// per round; the listener must enqueue ONLY when actorId === ownerId.
//
// Pattern mirrors on-cheat-death-activated (self-scoped event subscription).
// ----------------------------------------------------------------------
describe('start-of-turn live trigger (D-PR11)', () => {
    // A minimal reactive buff ability carrying the start-of-turn trigger.
    const startOfTurnBuff = (): Ability => ({
        id: 'sot-buff',
        type: 'buff',
        target: 'self',
        trigger: 'start-of-turn',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Fortifying Shroud',
            stacks: 1,
            parsedEffects: { defense: 20 },
            isStackable: false,
            duration: 1,
        },
    });

    function emitTurnStarted(ownerId: string, actorId: string): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: startOfTurnBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId, reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({ type: 'turn-started', actorId, round: 1 });
        return intents;
    }

    it("start-of-turn enqueues on the owner's own turn-started, not another actor's", () => {
        // Non-owner's turn-started: must NOT enqueue
        const bus = createEventBus();
        const queue: Intent[] = [];
        const ra: ReactiveAbility = { ability: startOfTurnBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => queue.push(i),
            isOpposing: (id) => id === 'enemy',
        });

        bus.emit({ type: 'turn-started', actorId: 'B', round: 1 });
        expect(queue.length).toBe(0);

        bus.emit({ type: 'turn-started', actorId: 'A', round: 1 });
        expect(queue.length).toBe(1);
        expect(queue[0].ownerId).toBe('A');
        expect(queue[0].ability.trigger).toBe('start-of-turn');
    });

    it('enqueues the intent when the owner own turn-started fires', () => {
        const intents = emitTurnStarted('A', 'A');
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('A');
        expect(intents[0].ability.trigger).toBe('start-of-turn');
    });

    it('does NOT enqueue when a DIFFERENT actor turn-started fires', () => {
        expect(emitTurnStarted('A', 'B')).toHaveLength(0);
    });

    it('listener is pure: no enqueue on registration, only on matching emit', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: startOfTurnBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'turn-started', actorId: 'B', round: 1 });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'turn-started', actorId: 'A', round: 1 });
        expect(intents).toHaveLength(1);
    });

    it('LIVE_TRIGGERS contains start-of-turn', () => {
        expect(LIVE_TRIGGERS.has('start-of-turn')).toBe(true);
    });

    it('AbilityTrigger includes start-of-turn (type-level compile check)', () => {
        const _trigger: AbilityTrigger = 'start-of-turn';
        expect(_trigger).toBe('start-of-turn');
    });
});

// ----------------------------------------------------------------------
// Phase 0 (charge) — end-of-turn trigger, self-scoped on turn-ended.
//
// Mirror of start-of-turn: fires once at the END of the OWNER's OWN turn
// (not every actor's turn). The engine emits `turn-ended` once per actor per
// round; the listener must enqueue ONLY when actorId === ownerId.
// ----------------------------------------------------------------------
describe('end-of-turn live trigger (Phase 0 charge)', () => {
    // A minimal reactive buff ability carrying the end-of-turn trigger.
    const endOfTurnBuff = (): Ability => ({
        id: 'eot-buff',
        type: 'buff',
        target: 'self',
        trigger: 'end-of-turn',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'End-of-Turn Shield',
            stacks: 1,
            parsedEffects: { defense: 15 },
            isStackable: false,
            duration: 1,
        },
    });

    function emitTurnEnded(ownerId: string, actorId: string): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: endOfTurnBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId, reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({ type: 'turn-ended', actorId, round: 1 });
        return intents;
    }

    it("end-of-turn enqueues on the owner's own turn-ended, not another actor's", () => {
        // Non-owner's turn-ended: must NOT enqueue
        const bus = createEventBus();
        const queue: Intent[] = [];
        const ra: ReactiveAbility = { ability: endOfTurnBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => queue.push(i),
            isOpposing: (id) => id === 'enemy',
        });

        bus.emit({ type: 'turn-ended', actorId: 'B', round: 1 });
        expect(queue.length).toBe(0);

        bus.emit({ type: 'turn-ended', actorId: 'A', round: 1 });
        expect(queue.length).toBe(1);
        expect(queue[0].ownerId).toBe('A');
        expect(queue[0].ability.trigger).toBe('end-of-turn');
    });

    it('enqueues the intent when the owner own turn-ended fires', () => {
        const intents = emitTurnEnded('A', 'A');
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('A');
        expect(intents[0].ability.trigger).toBe('end-of-turn');
    });

    it('does NOT enqueue when a DIFFERENT actor turn-ended fires', () => {
        expect(emitTurnEnded('A', 'B')).toHaveLength(0);
    });

    it('listener is pure: no enqueue on registration, only on matching emit', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        const ra: ReactiveAbility = { ability: endOfTurnBuff(), sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'turn-ended', actorId: 'B', round: 1 });
        expect(intents).toHaveLength(0);
        bus.emit({ type: 'turn-ended', actorId: 'A', round: 1 });
        expect(intents).toHaveLength(1);
    });

    it('LIVE_TRIGGERS contains end-of-turn', () => {
        expect(LIVE_TRIGGERS.has('end-of-turn')).toBe(true);
    });

    it('AbilityTrigger includes end-of-turn (type-level compile check)', () => {
        const _trigger: AbilityTrigger = 'end-of-turn';
        expect(_trigger).toBe('end-of-turn');
    });
});

// ----------------------------------------------------------------------
// C2b-1 — purge partition guard.
// An `on-cast` purge ability MUST stay in castSkills (the on-cast path
// handles it). An `on-enemy-purged` purge ability MUST route to
// reactiveAbilities (so the bus listener is registered and Sefuba's
// chain fires). This guard ensures a future edit to REACTIVE_ABILITY_TYPES
// cannot silently regress both paths at once.
// ----------------------------------------------------------------------
describe('C2b-1: purge partition guard (on-cast stays cast, on-enemy-purged goes reactive)', () => {
    const purgeOnCast = (): Ability => ({
        id: 'poc1',
        type: 'purge',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'purge', count: 1 },
    });

    const purgeOnEnemyPurged = (): Ability => ({
        id: 'pop1',
        type: 'purge',
        target: 'enemy',
        trigger: 'on-enemy-purged',
        conditions: [],
        config: { type: 'purge', count: 1 },
    });

    const skills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [purgeOnCast()],
            },
            {
                slot: 'passive',
                abilities: [purgeOnEnemyPurged()],
            },
        ],
    });

    it('on-cast purge stays in castSkills (NOT classified reactive)', () => {
        const { castSkills, reactiveAbilities } = partitionReactiveAbilities(skills());
        const castIds = castSkills.slots.flatMap((s) => s.abilities.map((a) => a.id));
        const reactiveIds = reactiveAbilities.map((r) => r.ability.id);
        expect(castIds).toContain('poc1');
        expect(reactiveIds).not.toContain('poc1');
    });

    it('on-enemy-purged purge routes to reactiveAbilities (IS classified reactive)', () => {
        const { castSkills, reactiveAbilities } = partitionReactiveAbilities(skills());
        const castIds = castSkills.slots.flatMap((s) => s.abilities.map((a) => a.id));
        const reactiveIds = reactiveAbilities.map((r) => r.ability.id);
        expect(reactiveIds).toContain('pop1');
        expect(castIds).not.toContain('pop1');
    });
});

// ----------------------------------------------------------------------
// on-deal-damage live trigger: unit-level tests for the pure listener.
// Models the Warpstrike implant: owner reduces a self-debuff's duration
// when it deals direct damage on its own turn.
//
// The listener rides the aggregate `ability-performed` event emitted once
// per damage-dealing turn (runPlayerTurn emits exactly one; positional path
// emits none — engine.ts ~2887). No once-per-turn guard is needed.
// The while-debuffed condition is enforced at drain (gateConditions), NOT here.
// ----------------------------------------------------------------------
describe('on-deal-damage live trigger', () => {
    // Minimal on-deal-damage ability (Warpstrike shape): a cleanse that
    // reduces the duration of the oldest self-debuff when the owner deals damage.
    const onDealDamageAbility = (): Ability =>
        ab({
            type: 'cleanse',
            target: 'self',
            trigger: 'on-deal-damage',
            config: {
                type: 'cleanse',
                mode: 'reduce-duration',
                count: 1,
            },
        });

    // Helper: wire up the bus, register the owner's listeners, emit an
    // `ability-performed` event, and return the collected intents.
    function emitAbilityPerformed(
        perOwner: { ownerId: string; reactiveAbilities: ReactiveAbility[] }[],
        event: Extract<CombatEvent, { type: 'ability-performed' }>
    ): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner,
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit(event);
        return intents;
    }

    it('enqueues when actorId === ownerId AND damage > 0', () => {
        const ra: ReactiveAbility = {
            ability: onDealDamageAbility(),
            sourceSlot: 'passive',
        };
        const intents = emitAbilityPerformed([{ ownerId: 'warpstrike', reactiveAbilities: [ra] }], {
            type: 'ability-performed',
            actorId: 'warpstrike',
            targetId: 'enemy',
            round: 1,
            abilityType: 'damage',
            damage: 5000,
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('warpstrike');
        expect(intents[0].ability.trigger).toBe('on-deal-damage');
    });

    it('does NOT enqueue when actorId !== ownerId (another actor dealing damage)', () => {
        const ra: ReactiveAbility = {
            ability: onDealDamageAbility(),
            sourceSlot: 'passive',
        };
        const intents = emitAbilityPerformed([{ ownerId: 'warpstrike', reactiveAbilities: [ra] }], {
            type: 'ability-performed',
            actorId: 'other-ship',
            targetId: 'enemy',
            round: 1,
            abilityType: 'damage',
            damage: 5000,
        });
        expect(intents).toHaveLength(0);
    });

    it('does NOT enqueue when damage is 0', () => {
        const ra: ReactiveAbility = {
            ability: onDealDamageAbility(),
            sourceSlot: 'passive',
        };
        const intents = emitAbilityPerformed([{ ownerId: 'warpstrike', reactiveAbilities: [ra] }], {
            type: 'ability-performed',
            actorId: 'warpstrike',
            targetId: 'enemy',
            round: 1,
            abilityType: 'damage',
            damage: 0,
        });
        expect(intents).toHaveLength(0);
    });

    it('does NOT enqueue when damage is undefined (non-damage ability event)', () => {
        const ra: ReactiveAbility = {
            ability: onDealDamageAbility(),
            sourceSlot: 'passive',
        };
        const intents = emitAbilityPerformed([{ ownerId: 'warpstrike', reactiveAbilities: [ra] }], {
            type: 'ability-performed',
            actorId: 'warpstrike',
            targetId: 'enemy',
            round: 1,
            abilityType: 'buff',
            // damage omitted — optional field, should default via ?? 0
        });
        expect(intents).toHaveLength(0);
    });

    it('fires exactly once per turn regardless of hit count (aggregate event model)', () => {
        // runPlayerTurn emits ONE ability-performed per turn. Multi-hit and AoE are
        // already aggregated — this test confirms the listener enqueues exactly once.
        const ra: ReactiveAbility = {
            ability: onDealDamageAbility(),
            sourceSlot: 'passive',
        };
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'warpstrike', reactiveAbilities: [ra] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        // Emit ONE aggregate event (as the engine does for a multi-hit turn).
        bus.emit({
            type: 'ability-performed',
            actorId: 'warpstrike',
            targetId: 'enemy',
            round: 2,
            abilityType: 'damage',
            damage: 12000,
        });
        expect(intents).toHaveLength(1);
    });

    it('fires only the matching owner when multiple owners are registered', () => {
        const ra: ReactiveAbility = {
            ability: onDealDamageAbility(),
            sourceSlot: 'passive',
        };
        const raOther: ReactiveAbility = {
            ability: { ...onDealDamageAbility(), id: 'other-dd' },
            sourceSlot: 'passive',
        };
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                { ownerId: 'warpstrike', reactiveAbilities: [ra] },
                { ownerId: 'bystander', reactiveAbilities: [raOther] },
            ],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'ability-performed',
            actorId: 'warpstrike',
            targetId: 'enemy',
            round: 1,
            abilityType: 'damage',
            damage: 8000,
        });
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('warpstrike');
    });

    it('on-deal-damage is in LIVE_TRIGGERS (partitions as reactive)', () => {
        expect(LIVE_TRIGGERS.has('on-deal-damage')).toBe(true);
        const { reactiveAbilities } = partitionReactiveAbilities({
            slots: [
                {
                    slot: 'passive',
                    abilities: [onDealDamageAbility()],
                },
            ],
        });
        expect(reactiveAbilities).toHaveLength(1);
        expect(reactiveAbilities[0].ability.trigger).toBe('on-deal-damage');
    });
});

describe('on-debuff-resisted listener — source routing', () => {
    const onResistDamage = (): ReactiveAbility => ({
        sourceSlot: 'passive',
        ability: ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-resisted',
            config: { type: 'damage', multiplier: 0, hits: 1, hpBasisPct: 30 },
        }),
    });

    function emitResist(sourceId: string | undefined): Intent[] {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'vindi', reactiveAbilities: [onResistDamage()] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy1' || id === 'enemy2',
        });
        bus.emit({
            type: 'debuff-resisted',
            sourceId,
            targetId: 'vindi',
            round: 1,
            buffName: 'Def Down',
        });
        return intents;
    }

    it('routes the inflictor as counterTargetId when the resist carries a source', () => {
        const intents = emitResist('enemy1');
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.counterTargetId).toBe('enemy1');
    });

    it('enqueues without counterTargetId when the resist has no source', () => {
        const intents = emitResist(undefined);
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.counterTargetId).toBeUndefined();
    });

    it('does not fire for a resist on a different unit', () => {
        const bus = createEventBus();
        const intents: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId: 'vindi', reactiveAbilities: [onResistDamage()] }],
            enqueue: (i) => intents.push(i),
            isOpposing: (id) => id === 'enemy1',
        });
        bus.emit({
            type: 'debuff-resisted',
            sourceId: 'enemy1',
            targetId: 'someoneElse',
            round: 1,
            buffName: 'Def Down',
        });
        expect(intents).toHaveLength(0);
    });
});

// ----------------------------------------------------------------------
// Task 4: the `cfg.type === 'damage'` executor branch for an hpBasisPct-flagged
// ability (Vindicator on-resist). Requires a routed source (never falls back to
// ctx.enemy), dedups per (owner, ability, source) via oncePerRoundConsumed, and
// passes hpBasisPct through to ctx.applyReactiveDamage as the 7th arg.
// ----------------------------------------------------------------------
describe('on-debuff-resisted damage branch (hpBasisPct)', () => {
    type Call = { owner: string; victim: string; mult: number; hpPct?: number };
    // Minimal PlayerActorRuntime — executeIntent requires an owner runtime entry
    // (dead-owner gate reads owner.actor.destroyedRound); nothing else is read on
    // this branch.
    const vindiRuntime = (): PlayerActorRuntime =>
        ({ actor: { id: 'vindi' } as CombatActor }) as unknown as PlayerActorRuntime;
    const makeCtx = (over: Partial<IntentExecContext> = {}) => {
        const calls: Call[] = [];
        const ctx = {
            round: 1,
            enemy: { id: 'dummy' } as CombatActor,
            enemyId: 'dummy',
            statusEngine: createStatusEngine({ selfBuffs: [], enemyDebuffs: [] }),
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['vindi', vindiRuntime()]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['vindi'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            oncePerRoundConsumed: new Set<string>(),
            applyReactiveDamage: (
                owner: string,
                victim: string,
                _id: string,
                mult: number,
                _hits: number,
                _noCrit: boolean,
                hpPct?: number
            ) => calls.push({ owner, victim, mult, hpPct }),
            ...over,
        } as unknown as IntentExecContext;
        return { ctx, calls };
    };
    const intent = (counterTargetId?: string): Intent => ({
        ownerId: 'vindi',
        sourceSlot: 'passive',
        ability: {
            id: 'vindi-onresist',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-resisted',
            conditions: [],
            config: { type: 'damage', multiplier: 0, hits: 1, hpBasisPct: 30 },
        },
        ...(counterTargetId ? { eventCtx: { counterTargetId } } : {}),
    });

    it('passes hpBasisPct through to applyReactiveDamage, targeting the routed source', () => {
        const { ctx, calls } = makeCtx();
        executeIntent(intent('enemy1'), ctx);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ owner: 'vindi', victim: 'enemy1', hpPct: 30 });
    });

    it('no-ops when no source is routed (never falls back to ctx.enemy)', () => {
        const { ctx, calls } = makeCtx();
        executeIntent(intent(undefined), ctx);
        expect(calls).toHaveLength(0);
    });

    it('dedups multiple resists from the SAME source in one round to one proc', () => {
        const shared = new Set<string>();
        const { ctx, calls } = makeCtx({ oncePerRoundConsumed: shared });
        executeIntent(intent('enemy1'), ctx);
        executeIntent(intent('enemy1'), ctx);
        expect(calls).toHaveLength(1);
    });

    it('fires once per DISTINCT source in the same round', () => {
        const shared = new Set<string>();
        const { ctx, calls } = makeCtx({ oncePerRoundConsumed: shared });
        executeIntent(intent('enemy1'), ctx);
        executeIntent(intent('enemy2'), ctx);
        expect(calls).toHaveLength(2);
    });
});

// ----------------------------------------------------------------------
// Insidiousness routing: an on-debuff-inflicted DAMAGE proc must land on the enemy
// that was actually debuffed (eventCtx.debuffVictimId), not the first living opposing
// actor. The listener stamps the field; this covers the executor side.
// ----------------------------------------------------------------------
describe('on-debuff-inflicted damage branch (debuffVictimId routing)', () => {
    type Call = { owner: string; victim: string; mult: number };

    const ownerRuntime = (): PlayerActorRuntime =>
        ({ actor: { id: 'owner' } as CombatActor }) as unknown as PlayerActorRuntime;

    const makeCtx = (over: Partial<IntentExecContext> = {}) => {
        const calls: Call[] = [];
        const ctx = {
            round: 1,
            enemy: { id: 'dummy' } as CombatActor,
            enemyId: 'dummy',
            statusEngine: createStatusEngine({ selfBuffs: [], enemyDebuffs: [] }),
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['owner', ownerRuntime()]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['owner'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            oncePerRoundConsumed: new Set<string>(),
            livingOpposingActorIds: () => ['enemy1', 'enemy2'],
            applyReactiveDamage: (owner: string, victim: string, _id: string, mult: number) =>
                calls.push({ owner, victim, mult }),
            ...over,
        } as unknown as IntentExecContext;
        return { ctx, calls };
    };

    const intent = (debuffVictimId?: string): Intent => ({
        ownerId: 'owner',
        sourceSlot: 'passive',
        ability: {
            id: 'equip-implant-INSIDIOUSNESS',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-inflicted',
            conditions: [],
            config: { type: 'damage', multiplier: 70, hits: 1 },
        },
        ...(debuffVictimId ? { eventCtx: { debuffVictimId } } : {}),
    });

    it('routes to the debuffed enemy, NOT the first living opposing actor', () => {
        const { ctx, calls } = makeCtx();
        executeIntent(intent('enemy2'), ctx);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ owner: 'owner', victim: 'enemy2', mult: 70 });
    });

    it('keeps the first-living-opposing fallback when no debuff victim was stamped', () => {
        // Start/end-of-round damage passives (Judge/Chakara) have no triggering counterparty
        // and must keep routing to opposing[0] — this guards that fallback.
        const { ctx, calls } = makeCtx();
        executeIntent(intent(undefined), ctx);
        expect(calls).toHaveLength(1);
        expect(calls[0].victim).toBe('enemy1');
    });
});

// ----------------------------------------------------------------------
// procScope:'per-attack' — Insidiousness rolls ONCE per attack and every debuff event
// in that attack reuses the verdict (all debuffed enemies take the hit, or none do).
// ----------------------------------------------------------------------
describe("procScope 'per-attack' verdict cache", () => {
    const ownerRuntime = (): PlayerActorRuntime =>
        ({ actor: { id: 'owner' } as CombatActor }) as unknown as PlayerActorRuntime;

    /** Pin the keyed proc stream and count draws. `value` < procChance → pass. */
    function pinKeyedRng(value: number): { draws: () => number } {
        let n = 0;
        setKeyedRng(() => {
            n++;
            return value;
        });
        return { draws: () => n };
    }

    const makeCtx = (over: Partial<IntentExecContext> = {}) => {
        const calls: string[] = [];
        const ctx = {
            round: 1,
            enemy: { id: 'dummy' } as CombatActor,
            enemyId: 'dummy',
            statusEngine: createStatusEngine({ selfBuffs: [], enemyDebuffs: [] }),
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['owner', ownerRuntime()]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['owner'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            oncePerRoundConsumed: new Set<string>(),
            procChanceGates: new Map(),
            procDecisionThisAttack: new Map<string, boolean>(),
            reactionFiredThisAttack: new Set<string>(),
            applyReactiveDamage: (_o: string, victim: string) => calls.push(victim),
            ...over,
        } as unknown as IntentExecContext;
        return { ctx, calls };
    };

    const intent = (victim: string, perAttack: boolean): Intent => ({
        ownerId: 'owner',
        sourceSlot: 'passive',
        ability: {
            id: 'equip-implant-INSIDIOUSNESS',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-inflicted',
            conditions: [],
            procChance: 0.5,
            ...(perAttack ? { procScope: 'per-attack' as const } : {}),
            config: { type: 'damage', multiplier: 70, hits: 1 },
        },
        eventCtx: { debuffVictimId: victim },
    });

    afterEach(() => resetRateGateRng());

    it('draws ONCE for two debuff events and applies to both victims on a pass', () => {
        const rng = pinKeyedRng(0.1); // 0.1 < 0.5 → pass
        const { ctx, calls } = makeCtx();
        executeIntent(intent('enemy1', true), ctx);
        executeIntent(intent('enemy2', true), ctx);
        expect(rng.draws()).toBe(1);
        expect(calls).toEqual(['enemy1', 'enemy2']);
    });

    it('draws ONCE for two debuff events and applies to NEITHER victim on a fail', () => {
        const rng = pinKeyedRng(0.9); // 0.9 > 0.5 → fail
        const { ctx, calls } = makeCtx();
        executeIntent(intent('enemy1', true), ctx);
        executeIntent(intent('enemy2', true), ctx);
        expect(rng.draws()).toBe(1);
        expect(calls).toEqual([]);
    });

    it('hits each victim ONCE per attack even when the cast inflicts two debuffs on it', () => {
        // Curator applies Attack Down III AND Crit Power Down III to the same enemy → two
        // debuff-applied events → two intents sharing one verdict. Without the per-victim
        // dedupe the enemy would take the 100% hit twice (200% for a 100% implant).
        pinKeyedRng(0.1);
        const { ctx, calls } = makeCtx();
        executeIntent(intent('enemy1', true), ctx);
        executeIntent(intent('enemy1', true), ctx);
        executeIntent(intent('enemy2', true), ctx);
        executeIntent(intent('enemy2', true), ctx);
        expect(calls).toEqual(['enemy1', 'enemy2']);
    });

    it('draws again once the cache is cleared (next attack)', () => {
        const rng = pinKeyedRng(0.1);
        const cache = new Map<string, boolean>();
        const fired = new Set<string>();
        const { ctx, calls } = makeCtx({
            procDecisionThisAttack: cache,
            reactionFiredThisAttack: fired,
        });
        executeIntent(intent('enemy1', true), ctx);
        // The engine clears both at each actor turn-start.
        cache.clear();
        fired.clear();
        executeIntent(intent('enemy1', true), ctx);
        expect(rng.draws()).toBe(2);
        expect(calls).toEqual(['enemy1', 'enemy1']);
    });

    it('without procScope, every event draws its own verdict (regression guard)', () => {
        // Adaptive Plating / Smokescreen / Bloodthirst et al. must keep per-event rolls.
        const rng = pinKeyedRng(0.1);
        const { ctx, calls } = makeCtx();
        executeIntent(intent('enemy1', false), ctx);
        executeIntent(intent('enemy2', false), ctx);
        expect(rng.draws()).toBe(2);
        expect(calls).toEqual(['enemy1', 'enemy2']);
    });
});
