import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
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

// A DoT scenario (scenario-4-like): charged cadence with a corrosion DoT on the
// active skill and an inferno DoT on the charged skill.
const dotSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                ab({
                    type: 'dot',
                    config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 2, duration: 3 },
                }),
            ],
        },
        {
            slot: 'charged',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                ab({
                    type: 'dot',
                    config: { type: 'dot', dotType: 'inferno', tier: 8, stacks: 3, duration: 2 },
                }),
            ],
        },
    ],
});

const baseInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 3,
    shipSkills: dotSkills(),
    enemyDefense: 8000,
    enemyHp: 400000,
    numRounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1, // hacking 250 vs security 100 → clamps to 100%
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

const collect = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    // Tap every event type onto a single ordered log.
    const types: CombatEvent['type'][] = [
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
        'hp-changed',
        'ship-destroyed',
    ];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('runCombat event emission', () => {
    it('emits one started/ended pair per actor turn (attacker then enemy), in order', () => {
        const { events, result } = collect(baseInput());
        const rounds = result.rounds.length;

        const turnEvents = events.filter(
            (e) => e.type === 'turn-started' || e.type === 'turn-ended'
        );
        // Phase 2: each round runs the attacker turn then the enemy turn, each emitting a
        // started/ended pair → 4 turn events per round (rounds * 2 turns * 2 events).
        expect(turnEvents.length).toBe(rounds * 4);

        // Order per round: attacker started, attacker ended, enemy started, enemy ended.
        for (let r = 1; r <= rounds; r++) {
            const base = (r - 1) * 4;
            const attStarted = turnEvents[base];
            const attEnded = turnEvents[base + 1];
            const enemyStarted = turnEvents[base + 2];
            const enemyEnded = turnEvents[base + 3];

            expect(attStarted.type).toBe('turn-started');
            expect(attStarted.round).toBe(r);
            expect(attStarted.actorId).toBe('attacker');
            expect(attEnded.type).toBe('turn-ended');
            expect(attEnded.round).toBe(r);
            expect(attEnded.actorId).toBe('attacker');

            expect(enemyStarted.type).toBe('turn-started');
            expect(enemyStarted.round).toBe(r);
            expect(enemyStarted.actorId).toBe('enemy');
            expect(enemyEnded.type).toBe('turn-ended');
            expect(enemyEnded.round).toBe(r);
            expect(enemyEnded.actorId).toBe('enemy');
        }
    });

    it('emits skill-fired slots matching the charge cadence', () => {
        const { events, result } = collect(baseInput());
        const skillFired = events.filter((e) => e.type === 'skill-fired');
        // One per round
        expect(skillFired.length).toBe(result.rounds.length);
        // Each skill-fired slot matches the round's action.
        for (const e of skillFired) {
            if (e.type !== 'skill-fired') throw new Error('unreachable');
            const round = result.rounds.find((r) => r.round === e.round)!;
            expect(e.slot).toBe(round.action);
        }
        // chargeCount 3, not startCharged → rounds 1-3 active, round 4 charged.
        const slotByRound = new Map(
            skillFired.map((e) => [e.round, e.type === 'skill-fired' ? e.slot : undefined])
        );
        expect(slotByRound.get(1)).toBe('active');
        expect(slotByRound.get(2)).toBe('active');
        expect(slotByRound.get(3)).toBe('active');
        expect(slotByRound.get(4)).toBe('charged');
    });

    it('emits one ability-performed (damage) per round with the round crit flag', () => {
        const { events, result } = collect(baseInput());
        const performed = events.filter((e) => e.type === 'ability-performed');
        expect(performed.length).toBe(result.rounds.length);
        for (const e of performed) {
            if (e.type !== 'ability-performed') throw new Error('unreachable');
            const round = result.rounds.find((r) => r.round === e.round)!;
            expect(e.abilityType).toBe('damage');
            expect(e.didCrit).toBe(round.didCrit);
            expect(e.didHit).toBe(true);
        }
    });

    it('emits dot-applied on the rounds whose returned data carries appliedDoTs', () => {
        const { events, result } = collect(baseInput());
        const appliedRounds = events.filter((e) => e.type === 'dot-applied').map((e) => e.round);

        // Rounds where the sim landed at least one DoT (appliedDoTs non-empty, dotsLanded).
        const expectedRounds = result.rounds
            .filter((r) => r.dotsLanded && r.appliedDoTs.length > 0)
            .map((r) => r.round);

        expect([...new Set(appliedRounds)].sort((a, b) => a - b)).toEqual(expectedRounds);
    });

    it('emits debuff-resisted for an apply debuff at an affinity disadvantage', () => {
        // A scheduled, always-active 'apply' enemy debuff. At an affinity disadvantage
        // (affinityDamageModifier < 0) it is resisted every round.
        const applyDebuff: SelectedGameBuff = {
            id: 'd1',
            buffName: 'Armor Break',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -20 },
            application: 'apply',
            // no skillSource → always-active per the status engine.
        };
        const { events } = collect(
            baseInput({
                affinityDamageModifier: -25,
                affinityCritCap: 75,
                affinityCritPenalty: 25,
                enemyDebuffs: [applyDebuff],
                // Plain skills so the only enemy debuff is the scheduled apply one.
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
            })
        );

        const resisted = events.filter((e) => e.type === 'debuff-resisted');
        expect(resisted.length).toBeGreaterThan(0);
        for (const e of resisted) {
            if (e.type !== 'debuff-resisted') throw new Error('unreachable');
            expect(e.buffName).toBe('Armor Break');
            expect(e.targetId).toBe('enemy');
        }
        // It must NOT also land.
        expect(events.some((e) => e.type === 'debuff-applied')).toBe(false);
    });

    it('emits buff-applied when a timed self-buff ability is applied on its source slot', () => {
        // A ship with a timed self-buff (Attack Up, 2 rounds) on the active slot.
        // chargeCount 3, not startCharged → active rounds 1,2,3 then charged round 4.
        // Each active round the buff either applies fresh (round 1) or re-applies (rounds 2,3
        // if the window expired) / upserts. The engine emits buff-applied whenever
        // applyTimedAbilityStatus is called (i.e. each round the slot fires and gate passes).
        const timedSelfBuffSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                stacks: 1,
                                parsedEffects: { attack: 20 },
                                isStackable: false,
                                duration: 2,
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
            ],
        });

        const { events } = collect(
            baseInput({
                shipSkills: timedSelfBuffSkills(),
                numRounds: 6,
            })
        );

        const buffApplied = events.filter((e) => e.type === 'buff-applied');
        // buff-applied must fire at least once (active slot fires on rounds 1, 2, 3 in a
        // chargeCount-3 no-startCharged cadence — at least round 1 must apply).
        expect(buffApplied.length).toBeGreaterThan(0);

        for (const e of buffApplied) {
            if (e.type !== 'buff-applied') throw new Error('unreachable');
            expect(e.buffName).toBe('Attack Up');
            expect(e.actorId).toBe('attacker');
            expect(typeof e.duration).toBe('number');
            expect(e.duration).toBe(2);
        }

        // buff-applied must only fire on active rounds (the source slot is 'active').
        // chargeCount 3, not startCharged → round 4 is charged, rounds 1-3 and 5-6 active.
        const activeRounds = new Set([1, 2, 3, 5, 6]);
        for (const e of buffApplied) {
            if (e.type !== 'buff-applied') throw new Error('unreachable');
            expect(activeRounds.has(e.round)).toBe(true);
        }
    });
});

describe('owner Post-Turn buff-expired windows (same-turn decrement rule)', () => {
    // Plain single-active-skill cadence (no charge) so a scheduled timed buff fires
    // exactly when we want and we can read its window off the round data.
    const plainSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } })],
            },
        ],
    });

    it('2-turn timed self-buff applied round 1 is present rounds 1-2 only and expires round 2', () => {
        // Self-buff with skillSource 'charge' + startCharged + a large chargeCount: it
        // fires round 1 and never again (the charge never re-banks). Duration 2 means
        // the buff is present rounds 1-2 and expires at the attacker's round-2 Post Turn.
        const buff: SelectedGameBuff = {
            id: 's1',
            buffName: 'Attack Up',
            stacks: 1,
            isStackable: false,
            parsedEffects: { attack: 20 },
            skillSource: 'charge',
            skillDuration: 2,
        };
        const { events, result } = collect(
            baseInput({
                shipSkills: plainSkills(),
                selfBuffs: [buff],
                // startCharged → round 1 is charged (buff fires); chargeCount 99 → never charges
                // again, so the buff is applied exactly once, in round 1.
                hasChargedSkill: true,
                startCharged: true,
                chargeCount: 99,
                numRounds: 5,
            })
        );

        const present = (round: number) =>
            result.rounds
                .find((r) => r.round === round)!
                .activeSelfBuffs.some((b) => b.buffName === 'Attack Up');
        expect(present(1)).toBe(true); // applied round 1
        expect(present(2)).toBe(true); // still within the 2-turn window
        expect(present(3)).toBe(false); // expired at the attacker's round-2 Post Turn

        // buff-expired fires once, at round 2, on the attacker (the self-buff carrier).
        const expired = events.filter((e) => e.type === 'buff-expired');
        expect(expired).toHaveLength(1);
        const e = expired[0];
        if (e.type !== 'buff-expired') throw new Error('unreachable');
        expect(e).toMatchObject({ actorId: 'attacker', round: 2, buffName: 'Attack Up' });
    });

    it('duration-1 self-buff re-applied every round expires every round', () => {
        // Active source, 1-turn duration, fires every (active) round. Applied each round at the
        // attacker turn, decremented to 0 at that same round's attacker Post Turn → expires every
        // round and is re-applied next round.
        const buff: SelectedGameBuff = {
            id: 's1',
            buffName: 'Attack Up',
            stacks: 1,
            isStackable: false,
            parsedEffects: { attack: 20 },
            skillSource: 'active',
            skillDuration: 1,
        };
        const numRounds = 4;
        const { events } = collect(
            baseInput({
                shipSkills: plainSkills(),
                selfBuffs: [buff],
                hasChargedSkill: false,
                chargeCount: 0,
                numRounds,
            })
        );
        const expiredRounds = events
            .filter((e) => e.type === 'buff-expired')
            .map((e) => (e.type === 'buff-expired' ? e.round : 0));
        // One expiry per round, every round.
        expect(expiredRounds).toEqual([1, 2, 3, 4]);
    });

    // The same 2-turn enemy debuff, applied once in round 1, observed via the buff-expired
    // round it reports — the cleanest observable for the fast-enemy +1 window. The debuff is
    // applied in the attacker's round-1 turn; the enemy (its carrier) decrements it at its own
    // Post Turn. At default speeds the enemy acts AFTER the attacker, so the first decrement is
    // round 1 → expiry round 2. With a faster enemy the round-1 enemy turn already passed when
    // the attacker applies it, so the first decrement is round 2 → expiry round 3 (the +1).
    const oneShotEnemyDebuff = (enemySpeed?: number) => {
        const debuff: SelectedGameBuff = {
            id: 'd1',
            buffName: 'Def Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -20 },
            skillSource: 'charge',
            skillDuration: 2,
        };
        const { events } = collect(
            baseInput({
                shipSkills: plainSkills(),
                enemyDebuffs: [debuff],
                // startCharged → round 1 is charged (debuff fires); chargeCount 99 → never charges
                // again, so the debuff is applied exactly once, in round 1.
                hasChargedSkill: true,
                startCharged: true,
                chargeCount: 99,
                enemySpeed,
                numRounds: 5,
            })
        );
        const expired = events.filter((e) => e.type === 'buff-expired');
        expect(expired).toHaveLength(1);
        const e = expired[0];
        if (e.type !== 'buff-expired') throw new Error('unreachable');
        expect(e).toMatchObject({ actorId: 'enemy', buffName: 'Def Down' });
        return e.round;
    };

    it('default speed: a 2-turn enemy debuff applied round 1 expires round 2', () => {
        expect(oneShotEnemyDebuff()).toBe(2);
    });

    it('fast enemy (enemySpeed 150): the same debuff expires one round later (round 3, the +1 KNOWN-DIFF)', () => {
        expect(oneShotEnemyDebuff(150)).toBe(3);
    });
});
