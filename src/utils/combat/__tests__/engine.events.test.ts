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
