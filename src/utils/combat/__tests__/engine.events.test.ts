import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { createActor, recordDestroyed } from '../state';
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
        'control-applied',
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

    it('a faster enemy flips the per-round turn order (enemy then attacker)', () => {
        const { events, result } = collect({ ...baseInput(), enemySpeed: 200 });
        const rounds = result.rounds.length;

        const turnEvents = events.filter(
            (e) => e.type === 'turn-started' || e.type === 'turn-ended'
        );
        expect(turnEvents.length).toBe(rounds * 4);

        // Order per round: enemy started, enemy ended, attacker started, attacker ended.
        for (let r = 1; r <= rounds; r++) {
            const base = (r - 1) * 4;
            const enemyStarted = turnEvents[base];
            const enemyEnded = turnEvents[base + 1];
            const attStarted = turnEvents[base + 2];
            const attEnded = turnEvents[base + 3];

            expect(enemyStarted.type).toBe('turn-started');
            expect(enemyStarted.round).toBe(r);
            expect(enemyStarted.actorId).toBe('enemy');
            expect(enemyEnded.type).toBe('turn-ended');
            expect(enemyEnded.round).toBe(r);
            expect(enemyEnded.actorId).toBe('enemy');

            expect(attStarted.type).toBe('turn-started');
            expect(attStarted.round).toBe(r);
            expect(attStarted.actorId).toBe('attacker');
            expect(attEnded.type).toBe('turn-ended');
            expect(attEnded.round).toBe(r);
            expect(attEnded.actorId).toBe('attacker');
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

// ---------------------------------------------------------------------------
// Phase 3 Task 3: retimed debuff-applied, sourceId, round-started, bomb-detonated
// ---------------------------------------------------------------------------

describe('Phase 3 Task 3 — event shape and timing', () => {
    // Case 1: timed enemy debuff (3 rounds) emits debuff-applied ONCE (round of infliction)
    // with sourceId 'attacker', not on every subsequent round it is active.
    it('timed enemy debuff active 3 rounds emits debuff-applied ONCE on the infliction round, with sourceId', () => {
        const debuff: SelectedGameBuff = {
            id: 'd1',
            buffName: 'Def Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -20 },
            skillSource: 'charge',
            skillDuration: 3,
        };
        const plainSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
            ],
        });
        // startCharged → round 1 is charged (debuff fires); chargeCount 99 → never charges
        // again, so the debuff is applied exactly once (round 1), active rounds 1-3.
        const { events } = collect(
            baseInput({
                shipSkills: plainSkills(),
                enemyDebuffs: [debuff],
                hasChargedSkill: true,
                startCharged: true,
                chargeCount: 99,
                numRounds: 5,
                debuffLandingChance: 1,
            })
        );

        const applied = events.filter((e) => e.type === 'debuff-applied');
        // Must emit exactly once (at infliction, round 1) — not per-round while active.
        expect(applied).toHaveLength(1);
        const e = applied[0];
        if (e.type !== 'debuff-applied') throw new Error('unreachable');
        expect(e.buffName).toBe('Def Down');
        expect(e.round).toBe(1);
        expect(e.targetId).toBe('enemy');
        expect(e.sourceId).toBe('attacker');
    });

    // Case 2a: recurring/aura enemy debuff emits NO debuff-applied on miss;
    // debuff-resisted still fires per round when it fails the landing roll.
    it('recurring enemy debuff emits no debuff-applied; debuff-resisted still fires per round on miss', () => {
        const recurringDebuff: SelectedGameBuff = {
            id: 'd2',
            buffName: 'Armor Break',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -15 },
            application: 'apply',
            // No skillSource → always-active / recurring per statusEngine.
        };
        const { events } = collect(
            baseInput({
                affinityDamageModifier: -25, // affinity disadvantage → 'apply' debuffs are always resisted
                affinityCritCap: 75,
                affinityCritPenalty: 25,
                enemyDebuffs: [recurringDebuff],
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
                numRounds: 3,
            })
        );

        // No debuff-applied for recurring/aura debuffs (they are not discrete inflictions).
        expect(events.filter((e) => e.type === 'debuff-applied')).toHaveLength(0);
        // debuff-resisted fires every round (affinity disadvantage → always resisted).
        const resisted = events.filter((e) => e.type === 'debuff-resisted');
        expect(resisted.length).toBeGreaterThan(0);
    });

    // Case 2b: recurring/aura enemy debuff that LANDS every round still emits zero
    // debuff-applied events — the landed-recurring path is not a discrete infliction.
    // This exercises the retimed path: before Phase 3 the old code emitted debuff-applied
    // per landed round; after retiming it must be silent even when the debuff lands.
    it('recurring enemy debuff that lands every round emits ZERO debuff-applied events', () => {
        const recurringDebuff: SelectedGameBuff = {
            id: 'd2b',
            buffName: 'Armor Break',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -15 },
            application: 'apply',
            // No skillSource → always-active / recurring per statusEngine.
        };
        const numRounds = 4;
        const { events, result } = collect(
            baseInput({
                // No affinity disadvantage → 'apply' debuffs land every round.
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                enemyDebuffs: [recurringDebuff],
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

        // Zero debuff-applied events — landed recurring is not a discrete infliction.
        expect(events.filter((e) => e.type === 'debuff-applied')).toHaveLength(0);
        // Zero debuff-resisted — it lands every round.
        expect(events.filter((e) => e.type === 'debuff-resisted')).toHaveLength(0);
        // Proof it landed: the debuff appears in activeEnemyDebuffs in every round.
        for (let r = 1; r <= numRounds; r++) {
            const round = result.rounds.find((rd) => rd.round === r)!;
            expect(round.activeEnemyDebuffs.some((b) => b.buffName === 'Armor Break')).toBe(true);
        }
    });

    // Case 3: dot-applied carries sourceId 'attacker'.
    it('dot-applied carries sourceId "attacker"', () => {
        const { events } = collect(baseInput({ numRounds: 3, debuffLandingChance: 1 }));
        const dotApplied = events.filter((e) => e.type === 'dot-applied');
        expect(dotApplied.length).toBeGreaterThan(0);
        for (const e of dotApplied) {
            if (e.type !== 'dot-applied') throw new Error('unreachable');
            expect(e.sourceId).toBe('attacker');
        }
    });

    // Case 4: round-started fires once per round, before any turn-started of that round.
    it('round-started fires once per round before any turn-started in that round', () => {
        const { events, result } = collect(baseInput());
        const rounds = result.rounds.length;

        const roundStarted = events.filter((e) => e.type === 'round-started');
        // Exactly one per round.
        expect(roundStarted).toHaveLength(rounds);
        for (let r = 1; r <= rounds; r++) {
            const e = roundStarted[r - 1];
            if (e.type !== 'round-started') throw new Error('unreachable');
            expect(e.round).toBe(r);
        }

        // round-started must immediately precede the first turn-started of its round.
        for (let r = 1; r <= rounds; r++) {
            const rsIdx = events.findIndex((e) => e.type === 'round-started' && e.round === r);
            const firstTsIdx = events.findIndex(
                (e) => e.type === 'turn-started' && 'round' in e && e.round === r
            );
            expect(rsIdx).toBeGreaterThanOrEqual(0);
            expect(firstTsIdx).toBeGreaterThan(rsIdx);
            // No turn-started for round r appears before the round-started for round r.
            const turnsBefore = events
                .slice(0, rsIdx)
                .filter(
                    (e) =>
                        e.type === 'turn-started' &&
                        'round' in e &&
                        (e as { round: number }).round === r
                );
            expect(turnsBefore).toHaveLength(0);
        }
    });

    // Case 5: bomb with countdown 2 emits bomb-detonated (actorId 'attacker', correct round,
    // stacks > 0, damage > 0) when it bursts on the enemy turn.
    it('bomb countdown 2 emits bomb-detonated (with actorId, round, stacks, damage > 0) on the enemy turn', () => {
        // Build a ship skill that applies a Bomb DoT on the active skill with countdown 2.
        // At default speeds: attacker acts round 1 (applies bomb), enemy acts round 1 (countdown-1=1),
        // attacker acts round 2 (no new bomb — charge slot next), enemy acts round 2 (countdown-1=0 → detonates).
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
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } }),
                    ],
                },
            ],
        });

        const { events } = collect(
            baseInput({
                shipSkills: bombSkills(),
                numRounds: 4,
                debuffLandingChance: 1,
            })
        );

        const bombDetonated = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDetonated.length).toBeGreaterThan(0);
        for (const e of bombDetonated) {
            if (e.type !== 'bomb-detonated') throw new Error('unreachable');
            expect(e.actorId).toBe('attacker');
            expect(typeof e.round).toBe('number');
            expect(e.stacks).toBeGreaterThan(0);
            expect(e.damage).toBeGreaterThan(0);
        }
    });

    // Case 6: a team actor's landed timed debuff emits debuff-applied with sourceId = team
    // actor id, on every application round (not just the first).
    it("team actor's landed timed debuff emits debuff-applied with that actor's sourceId on every application round", () => {
        const teamDebuff: SelectedGameBuff = {
            id: 'td1',
            buffName: 'Team Def Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -15 },
            skillSource: 'active',
            skillDuration: 3,
        };
        const plainSkills = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
            ],
        });
        // Team actor 't1' fires active every round (chargeCount 0), speed 80 (acts between
        // attacker at 100 and enemy at 50). The enemy's post-turn decrement fires after the
        // team actor each round, so the remaining window after decrement is always 2.
        // With skillDuration 3 and remaining 2, the family rule (3 > 2) always wins →
        // the debuff re-inflicts every round and debuff-applied fires each time.
        // 5 rounds × 1 active fire per round = 5 debuff-applied events total.
        const { events } = collect(
            baseInput({
                shipSkills: plainSkills(),
                hasChargedSkill: false,
                chargeCount: 0,
                numRounds: 5,
                debuffLandingChance: 1,
                teamActors: [
                    {
                        id: 't1',
                        speed: 80,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [teamDebuff],
                    },
                ],
            })
        );

        const applied = events.filter(
            (e) => e.type === 'debuff-applied' && e.buffName === 'Team Def Down'
        );
        // 5 rounds × 1 active fire per round → 5 debuff-applied events.
        expect(applied).toHaveLength(5);
        for (const e of applied) {
            if (e.type !== 'debuff-applied') throw new Error('unreachable');
            expect(e.sourceId).toBe('t1');
            expect(e.targetId).toBe('enemy');
        }
    });
});

// ---------------------------------------------------------------------------
// Echoing Burst (accumulate-detonate) display in activeEnemyDebuffs
// ---------------------------------------------------------------------------

describe('accumulate-detonate display in activeEnemyDebuffs', () => {
    // A ship with an active-slot accumulate-detonate ability (turns 2, pct 50).
    // chargeCount 3, not startCharged → active rounds 1,2,3 then charged round 4.
    // The accumulate-detonate ability fires ONLY on the active slot (debuff landing
    // is gated by dotsLanded — always true in this fixture since debuffLandingChance=1).
    const accSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ab({
                        type: 'accumulate-detonate',
                        config: { type: 'accumulate-detonate', turns: 2, pct: 50 },
                    }),
                ],
            },
            {
                slot: 'charged',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } })],
            },
        ],
    });

    const run = (overrides: Partial<CombatEngineInput> = {}) => {
        idCounter = 0;
        return runCombat({
            attack: 15000,
            crit: 50,
            critDamage: 150,
            defensePenetration: 10,
            chargeCount: 3,
            shipSkills: accSkills(),
            enemyDefense: 8000,
            enemyHp: 400000,
            numRounds: 8,
            selfBuffs: [],
            enemyDebuffs: [],
            debuffLandingChance: 1,
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
    };

    it('Echoing Burst appears in activeEnemyDebuffs with turnsRemaining 2 on the application round', () => {
        const { rounds } = run();
        // Round 1: active slot fires, accumulator applied (turns=2 → roundsRemaining=2).
        // activeEnemyDebuffs should include {buffName:'Echoing Burst', turnsRemaining:2}.
        const r1 = rounds.find((r) => r.round === 1)!;
        expect(r1.activeEnemyDebuffs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ buffName: 'Echoing Burst', turnsRemaining: 2 }),
            ])
        );
    });

    it('Echoing Burst shows turnsRemaining 1 the round after application', () => {
        const { rounds } = run();
        // Round 2: enemy's processAccumulators decremented roundsRemaining 2→1. Active slot
        // fires again, applies a new accumulator (turns=2). The surviving entry shows
        // roundsRemaining=1; the new one shows roundsRemaining=2.
        const r2 = rounds.find((r) => r.round === 2)!;
        const burst = r2.activeEnemyDebuffs.filter((d) => d.buffName === 'Echoing Burst');
        expect(burst).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ buffName: 'Echoing Burst', turnsRemaining: 1 }),
            ])
        );
    });

    it('Echoing Burst is absent from activeEnemyDebuffs after it detonates (roundsRemaining reaches 0)', () => {
        // chargeCount 3, not startCharged: rounds 1,2,3 active, round 4 charged.
        // Round 1: accumulator applied (roundsRemaining=2). Enemy turn: 2→1.
        // Round 2: active again, NEW accumulator (roundsRemaining=2). Enemy turn: round-1 entry 1→0 → detonates; round-2 entry 2→1.
        // So after round 2's enemy turn, only the round-2 entry (roundsRemaining=1) survives.
        // Round 3: active again, ANOTHER accumulator (roundsRemaining=2). Enemy turn: round-2 entry 1→0 → detonates; round-3 entry 2→1.
        // etc. The pattern: each active round applies a new one (window=2), the previous one detonates on next enemy turn.
        // Round 4: charged slot fires — NO accumulate-detonate ability on charged slot.
        // After round 3's enemy turn, round-3 entry has roundsRemaining=1. On round 4's enemy turn, 1→0 → detonates.
        // Round 4's activeEnemyDebuffs: round-3 entry still has roundsRemaining=1 AT THE ATTACKER TURN (before enemy tick).
        // Round 5: active again. At start of round 5, round-3 entry detonated (gone). New accumulator applied.
        // Let's verify round 4: the attacker turn fires charged, no new accumulator. The surviving entry
        // from round 3 (roundsRemaining=1) should appear in round 4's activeEnemyDebuffs.
        const { rounds } = run();
        const r4 = rounds.find((r) => r.round === 4)!;
        // Round 4 is charged — no new accumulator from the attacker turn.
        // The round-3 entry (roundsRemaining=1) should still be present at attacker-turn time.
        expect(r4.activeEnemyDebuffs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ buffName: 'Echoing Burst', turnsRemaining: 1 }),
            ])
        );
        // Round 5 applies a new one (active again, roundsRemaining=2). Round-4 entry is gone.
        const r5 = rounds.find((r) => r.round === 5)!;
        expect(r5.activeEnemyDebuffs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ buffName: 'Echoing Burst', turnsRemaining: 2 }),
            ])
        );
        // No roundsRemaining=1 on round 5 at attacker-turn time: only the round-4 entry
        // could give that, but it detonated during round 4's enemy turn.
        expect(
            r5.activeEnemyDebuffs.some(
                (d) => d.buffName === 'Echoing Burst' && d.turnsRemaining === 1
            )
        ).toBe(false);
    });

    it('re-application restarts the window (new entry shows turnsRemaining 2 each active round)', () => {
        const { rounds } = run();
        // Each active round should show at least one entry with turnsRemaining=2 (the newly applied one).
        const activeRounds = rounds.filter((r) => r.action === 'active');
        for (const rd of activeRounds) {
            expect(rd.activeEnemyDebuffs).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ buffName: 'Echoing Burst', turnsRemaining: 2 }),
                ])
            );
        }
    });

    it('charged rounds (no accumulate-detonate ability) do NOT show turnsRemaining=2 (only surviving entries)', () => {
        const { rounds } = run();
        // Round 4 is charged. No new accumulator. The surviving entry from round 3
        // (roundsRemaining=1 after the round-3 enemy tick) shows turnsRemaining=1, not 2.
        const r4 = rounds.find((r) => r.round === 4)!;
        expect(r4.action).toBe('charged');
        expect(
            r4.activeEnemyDebuffs.some(
                (d) => d.buffName === 'Echoing Burst' && d.turnsRemaining === 2
            )
        ).toBe(false);
    });

    it('activeEnemyDebuffs Echoing Burst entries do not affect damage numbers (display-only)', () => {
        // Verify the detonation damage is NOT affected by the presence of the display entries.
        // Run once with the accumulate-detonate skill and check that damage totals match
        // expectations (same as golden fixture: detonationDamage > 0 on rounds where detonate fires).
        const { rounds } = run({ numRounds: 4 });
        // Round 2 detonates the round-1 accumulator → detonationDamage > 0.
        const r2 = rounds.find((r) => r.round === 2)!;
        expect(r2.detonationDamage).toBeGreaterThan(0);
        // Round 1 applied the accumulator, no detonation yet.
        const r1 = rounds.find((r) => r.round === 1)!;
        expect(r1.detonationDamage).toBe(0);
    });
});

describe('control-applied event (Defiant charged Stasis inflict)', () => {
    // A charged skill carrying a stasis control ability. startCharged → round 1 fires charged.
    const controlSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 145 } })],
            },
            {
                slot: 'charged',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 195 } }),
                    ab({
                        type: 'control',
                        target: 'enemy',
                        config: { type: 'control', effect: 'stasis' },
                    }),
                ],
            },
        ],
    });

    it('emits control-applied {effect:stasis, casterId:attacker} when the charged skill fires', () => {
        const { events } = collect(
            baseInput({
                shipSkills: controlSkills(),
                startCharged: true,
                chargeCount: 99, // never re-charges → only the round-1 charged cast fires
                numRounds: 3,
            })
        );
        const controls = events.filter((e) => e.type === 'control-applied');
        expect(controls).toHaveLength(1);
        expect(controls[0]).toMatchObject({
            type: 'control-applied',
            effect: 'stasis',
            casterId: 'attacker',
            round: 1,
        });
    });

    it('does NOT emit control-applied on active-only rounds (no control on the active skill)', () => {
        const { events } = collect(
            baseInput({
                shipSkills: controlSkills(),
                startCharged: false,
                chargeCount: 99, // never charges → only active casts fire
                numRounds: 3,
            })
        );
        expect(events.some((e) => e.type === 'control-applied')).toBe(false);
    });
});

describe('recordDestroyed helper (shared all-actor ship-destroyed)', () => {
    const seedDeadActor = () => {
        const actor = createActor({
            id: 'synthetic-1',
            side: 'player',
            kind: 'team',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 1000,
                speed: 0,
            },
        });
        actor.currentHp = 0; // floored this round
        return actor;
    };

    it('sets destroyedRound and emits ship-destroyed exactly once even if called twice', () => {
        const bus = createEventBus();
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        const actor = seedDeadActor();

        recordDestroyed(actor, 3, bus);
        recordDestroyed(actor, 5, bus); // second call must be a no-op (already destroyed)

        expect(actor.destroyedRound).toBe(3);
        expect(destroyed).toHaveLength(1);
        expect(destroyed[0]).toMatchObject({
            type: 'ship-destroyed',
            actorId: 'synthetic-1',
            round: 3,
        });
    });
});

// Note: the existing healing-mode heal-target death regression (exactly one
// ship-destroyed{actorId: tankId} + healing.destroyedRound set) is guarded by
// healing.test.ts → "lethal: destroyedRound set, ship-destroyed emitted once,
// post-death flatline". This file adds the focused recordDestroyed unit guard above.
