import { describe, expect, it, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { createActor, recordDestroyed } from '../state';
import { Ability, ShipSkills } from '../../../types/abilities';
import { SelectedGameBuff } from '../../../types/calculator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

/**
 * The focus attacker's own actor id. Every CARDINALITY assertion that means "the focus fanned out N
 * events" filters on this (the `runCollectingPerformed` pattern from
 * `dpsSubAttackEvents.integration.test.ts`, SP-4b-2a): since SP-4b-2b every run has a real opponent,
 * and an enemy supplied without `shipSkills` gets the engine's synthesized flat-card basic attack —
 * so it casts once per round and emits its own `skill-fired` + zero-damage `ability-performed`.
 * Those are the OTHER actor's cast; filtering them out keeps every expected count the pre-change
 * number and keeps the assertion meaning "the focus emitted N", not "how many actors are on the
 * board".
 */
const FOCUS = 'attacker';

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
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 3,
    shipSkills: dotSkills(),
    // Legacy vestigial-dummy scalars — DEAD on this positional run. The real opposing actor
    // is `enemyAttackers[0]` (`bareEnemy`, above), which carries its own `defence: 0` and (via
    // the `hp: 10_000_000` override) 10M HP; nothing here reads `enemyDefense`/`enemyHp` for it.
    // Kept only because `CombatEngineInput` still requires them. Do not copy these two values
    // into a new fixture expecting them to configure the enemy's stats.
    numRounds: 6,
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
        'charge-changed',
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
        // SP-4b-2b: the second turn belongs to the REAL enemy (`BARE_ENEMY_ID`) — the vestigial
        // dummy `enemy` is dropped from the turn order on a positional run — so the count is
        // unchanged and only the id it reports moved.
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
            expect(enemyStarted.actorId).toBe(BARE_ENEMY_ID);
            expect(enemyEnded.type).toBe('turn-ended');
            expect(enemyEnded.round).toBe(r);
            expect(enemyEnded.actorId).toBe(BARE_ENEMY_ID);
        }
    });

    it('a faster enemy flips the per-round turn order (enemy then attacker)', () => {
        // The speed that decides the order is the REAL enemy's own. The top-level `enemySpeed`
        // scalar configures the vestigial dummy, which a positional run drops from the turn order
        // entirely — it can no longer move anything (verified: with `enemySpeed: 200` the order
        // stayed attacker-first).
        const { events, result } = collect(
            baseInput({ enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, speed: 200 } }) })
        );
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
            expect(enemyStarted.actorId).toBe(BARE_ENEMY_ID);
            expect(enemyEnded.type).toBe('turn-ended');
            expect(enemyEnded.round).toBe(r);
            expect(enemyEnded.actorId).toBe(BARE_ENEMY_ID);

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
        const skillFired = events.filter((e) => e.type === 'skill-fired' && e.actorId === FOCUS);
        // One per round (the FOCUS's own cadence — see FOCUS's doc comment for why the real
        // enemy's own once-per-round cast is filtered out rather than counted).
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
        // One event per SUB-ATTACK since the multi-hit full-walk epic (PR2); this fixture's skill
        // is single-hit, so that is one per round and the count still matches rounds.length.
        const { events, result } = collect(baseInput());
        const performed = events.filter(
            (e) => e.type === 'ability-performed' && e.actorId === FOCUS
        );
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
        // A scheduled, always-active 'apply' enemy debuff. At an affinity disadvantage it is
        // resisted every round.
        //
        // SP-4b-2b: the disadvantage must be a REAL matchup, not just the pre-resolved
        // `affinityDamageModifier` scalar. On a positional cast `landingAtDisadvantage`
        // (playerTurn.ts) is re-derived as `computeAffinityModifiers(attackerAffinity,
        // victim.affinity) < 0`, so the scalar alone leaves the run NEUTRAL and the 'apply' debuff
        // lands silently (measured: 0 resisted, and the row started reporting Armor Break active).
        // chemical attacker vs thermal enemy is the disadvantaged pairing (thermal beats chemical),
        // and it resolves to exactly the −25 / cap 75 / penalty 25 the scalars below declare.
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
                affinity: 'chemical',
                enemyAttackers: bareEnemy({
                    affinity: 'thermal',
                    stats: { hp: 10_000_000 },
                }),
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
            expect(e.targetId).toBe(BARE_ENEMY_ID);
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

    it('2-turn timed self-buff applied round 1 is present rounds 1-3 only and expires round 3', () => {
        // Self-buff with skillSource 'charge' + startCharged + a large chargeCount: it
        // fires round 1 and never again (the charge never re-banks). Duration 2 means
        // the buff is present rounds 1-3 and expires at the attacker's round-3 Post Turn:
        // a self-buff applied during the carrier's OWN turn gets a one-turn reprieve, so it
        // lasts through one ADDITIONAL of the carrier's turns (rounds 1-2 → rounds 1-3).
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
        expect(present(2)).toBe(true); // still within the (reprieved) window
        expect(present(3)).toBe(true); // last reprieved round
        expect(present(4)).toBe(false); // expired at the attacker's round-3 Post Turn

        // buff-expired fires once, at round 3, on the attacker (the self-buff carrier).
        const expired = events.filter((e) => e.type === 'buff-expired');
        expect(expired).toHaveLength(1);
        const e = expired[0];
        if (e.type !== 'buff-expired') throw new Error('unreachable');
        expect(e).toMatchObject({ actorId: 'attacker', round: 3, buffName: 'Attack Up' });
    });

    it('duration-1 self-buff re-applied every round expires every other round (own-turn reprieve)', () => {
        // Active source, 1-turn duration, fires every (active) round. A 1-turn self-buff applied
        // during the carrier's OWN turn gets a one-turn reprieve, so it survives through the
        // carrier's NEXT turn before expiring. Re-application refreshes the window: round-1
        // application expires at round 2 (and is re-applied that same round), round-2 re-application
        // expires at round 4, etc. → expiries land on every OTHER round.
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
        // With the own-turn reprieve, expiries land on every other round (the round-1
        // application expires round 2 and re-arms, round-2 re-application expires round 4).
        expect(expiredRounds).toEqual([2, 4]);
    });

    // A 2-turn enemy debuff, applied once in round 1, observed via the buff-expired round it
    // reports — the cleanest observable for the fast-enemy +1 window. The debuff is applied in the
    // attacker's round-1 turn; the enemy (its carrier) decrements it at its own Post Turn. At
    // default speeds the enemy acts AFTER the attacker, so the first decrement is round 1 → expiry
    // round 2. With a faster enemy the round-1 enemy turn already passed when the attacker applies
    // it, so the first decrement is round 2 → expiry round 3 (the +1).
    //
    // SP-4b-2b — WHAT MOVED AND WHY THE FIXTURE, NOT THE ASSERTION, WAS REWRITTEN. This used to
    // express the rule with a SCHEDULED `enemyDebuffs` entry and the top-level `enemySpeed` scalar.
    // Neither can express it any more, and both for the same reason: they describe the DUMMY.
    //   • `enemySpeed` is the dummy's speed, and the dummy is dropped from the turn order — a
    //     positional run only when this was written, EVERY run since SP-4c-2c — so it no longer
    //     reorders anything (measured: `enemySpeed: 150` left the order attacker-first and the
    //     expiry at round 2).
    //   • a SCHEDULED debuff lives in the side-wide `__enemy__` sentinel bucket, which EVERY run
    //     decrements ONCE PER ROUND at the round boundary (engine.ts, the round-tail
    //     `decrementEnemy()` block) precisely BECAUSE the dummy has no turn to hang the decrement
    //     on. That was positional-run-only when this note was written, gated on the since-deleted
    //     `dummyEnemyIsVestigial`; SP-4c-2c retired the dummy's turn outright, so the round-tail
    //     block is now the sole decrement site on every run. A round-boundary decrement is by
    //     construction speed-independent.
    // So the rule is now expressed where it still lives: an ABILITY-applied timed debuff on the
    // REAL enemy, whose OWN speed decides turn order. Same rule, same expected rounds (2 and 3),
    // and the carrier the expiry reports is the real enemy instead of the vestigial dummy.
    const oneShotEnemyDebuff = (enemySpeed: number) => {
        const debuffOnCharged = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 150 } }),
                        ab({
                            type: 'debuff',
                            target: 'enemy',
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: { defense: -20 },
                                // 'apply' lands unconditionally at a neutral matchup (no landing
                                // draw), so the round the window opens is not RNG-dependent — the
                                // whole point of this fixture is the DECREMENT timing.
                                application: 'apply',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        });
        const { events } = collect(
            baseInput({
                shipSkills: debuffOnCharged(),
                enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, speed: enemySpeed } }),
                // startCharged → round 1 is charged (debuff fires); chargeCount 99 → never charges
                // again, so the debuff is applied exactly once, in round 1.
                hasChargedSkill: true,
                startCharged: true,
                chargeCount: 99,
                numRounds: 5,
            })
        );
        const expired = events.filter((e) => e.type === 'buff-expired');
        expect(expired).toHaveLength(1);
        const e = expired[0];
        if (e.type !== 'buff-expired') throw new Error('unreachable');
        expect(e).toMatchObject({ actorId: BARE_ENEMY_ID, buffName: 'Def Down' });
        return e.round;
    };

    it('slow enemy (speed 10): a 2-turn enemy debuff applied round 1 expires round 2', () => {
        expect(oneShotEnemyDebuff(10)).toBe(2);
    });

    it('fast enemy (speed 150): the same debuff expires one round later (round 3, the +1 KNOWN-DIFF)', () => {
        expect(oneShotEnemyDebuff(150)).toBe(3);
    });

    it('applies a finite-duration passive self-buff once at combat start and expires it on its window', () => {
        const skills: ShipSkills = {
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
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'buff',
                                buffName: 'Everliving Regeneration II',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        };
        const { events } = collect(
            baseInput({
                shipSkills: skills,
                numRounds: 6,
                hasChargedSkill: false,
                startCharged: false,
                chargeCount: 0,
            })
        );
        const applied = events.filter(
            (e) =>
                e.type === 'buff-applied' &&
                (e as { buffName?: string }).buffName === 'Everliving Regeneration II'
        );
        const expired = events.filter(
            (e) =>
                e.type === 'buff-expired' &&
                (e as { buffName?: string }).buffName === 'Everliving Regeneration II'
        );
        // Applied exactly once, at combat start.
        expect(applied.map((e) => (e as { round: number }).round)).toEqual([1]);
        // Expires after its 3-turn window (applied round 1 → decremented at the owner's
        // post-turn each round → 0 at the end of round 3).
        expect(expired.map((e) => (e as { round: number }).round)).toEqual([3]);
    });
});

// ---------------------------------------------------------------------------
// Phase 3 Task 3: retimed debuff-applied, sourceId, round-started, bomb-detonated
// ---------------------------------------------------------------------------

describe('Phase 3 Task 3 — event shape and timing', () => {
    // The damage clause every detonating charged slot below carries is LOAD-BEARING since
    // SP-4b-2b: positional detonation detonates the victims this cast HIT (engine.ts's
    // `detonationTargets`, fed from drivePositionalApply's resolved victims), so a detonate-ONLY
    // cast resolves nobody and its burst drops entirely — measured 10,800 → 0 on the inferno
    // fixture. Every real detonator ship deals damage in the same clause (Crocus "deals 250% damage
    // and detonates Corrosion effects at 180% power", Demolisher, Incinerator), so this is also what
    // the corpus actually looks like.
    //
    // This is a REAL, latent engine gap, not a fixture quirk: any future `DOT_DETONATE_RE` cast
    // whose clause carries no `type: 'damage'` ability (skillTextParser.ts:3167) would lose its
    // detonation entirely on a positional run (`const detonationTargets = new Map<...>()`,
    // engine.ts:7492 → `applyPerVictimDetonation(recipe, detonationTargets, …)`, engine.ts:7819).
    // It is intentionally left UNFIXED here — a
    // follow-up investigation scanned all 147 corpus ships' skill columns and confirmed the gap is
    // CORPUS-UNREACHABLE today: only Crocus, Demolisher and Incinerator mention detonation, and all
    // three deal damage in the same clause (safe, per above). Lingshe's charged skill also
    // detonates but does NOT match `DOT_DETONATE_RE` — it parses to `bomb-countdown-reduce`
    // (skillTextParser.ts:4523-4537), which resolves its damage in `reduceBombsOnVictim`
    // (bombCountdown.ts:29-80) from the cast's own target footprint, entirely independent of
    // `detonationTargets`, so it is unaffected by this gap. Do not read `detonatorHit()` below as
    // incidental filler: it exists BECAUSE of this gap, and removing it would silently zero out
    // every skill-triggered detonation assertion in this describe block.
    const detonatorHit = () => ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } });

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
            })
        );

        const applied = events.filter((e) => e.type === 'debuff-applied');
        // Must emit exactly once (at infliction, round 1) — not per-round while active.
        expect(applied).toHaveLength(1);
        const e = applied[0];
        if (e.type !== 'debuff-applied') throw new Error('unreachable');
        expect(e.buffName).toBe('Def Down');
        expect(e.round).toBe(1);
        expect(e.targetId).toBe(BARE_ENEMY_ID);
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
                // A REAL disadvantaged matchup, not just the pre-resolved scalars: a positional
                // cast re-derives the landing disadvantage from the two actors' own affinities
                // (chemical attacker vs thermal enemy → −25 / cap 75 / penalty 25). See the
                // 'emits debuff-resisted for an apply debuff at an affinity disadvantage' test.
                affinity: 'chemical',
                enemyAttackers: bareEnemy({ affinity: 'thermal', stats: { hp: 10_000_000 } }),
                // Legacy-dummy scalar, inert on this positional run — see the block comment
                // above: the real disadvantage comes from the two actors' own `affinity` fields.
                affinityDamageModifier: -25,
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
        const { events } = collect(baseInput({ numRounds: 3 }));
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

    // Case 5b: bomb with detonationDamageModifier=100 timed-detonates for 2× the baseline.
    // Validates that processBombs scales the burst by (1 + detonationDamageModifier/100).
    it('timed bomb detonation scales by detonationDamageModifier: modifier 100 doubles the burst', () => {
        // A ship skill that applies a Bomb DoT with countdown 2 on the active slot.
        // The passive slot carries a modifier ability with channel 'detonationDamage', value 100
        // (a +100% detonation damage multiplier → burst should be 2× the baseline).
        // Baseline run: same skills but no passive modifier → burst at 1×.
        // Modified run: passive modifier 100 → burst at 2×.
        // At default speeds: attacker acts round 1 (bomb applied), enemy acts round 1 (countdown
        // decrements to 1), attacker acts round 2 (charged slot, no new bomb), enemy acts round 2
        // (countdown → 0 → detonates). We compare the bomb-detonated damage between the two runs.
        const bombSkillsBase = (): ShipSkills => ({
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

        const bombSkillsWithModifier = (): ShipSkills => ({
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
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'modifier',
                                channel: 'detonationDamage',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        });

        const { events: baseEvents } = collect(
            baseInput({ shipSkills: bombSkillsBase(), numRounds: 4 })
        );
        const { events: modEvents } = collect(
            baseInput({ shipSkills: bombSkillsWithModifier(), numRounds: 4 })
        );

        const baseBurst = baseEvents
            .filter((e) => e.type === 'bomb-detonated')
            .reduce((sum, e) => sum + (e.type === 'bomb-detonated' ? e.damage : 0), 0);
        const modBurst = modEvents
            .filter((e) => e.type === 'bomb-detonated')
            .reduce((sum, e) => sum + (e.type === 'bomb-detonated' ? e.damage : 0), 0);

        // With modifier 0: burst = stacks × damagePerStack × affinityMult × (1 + 0/100) = baseBurst
        // With modifier 100: burst = stacks × damagePerStack × affinityMult × (1 + 100/100) = 2 × baseBurst
        expect(baseBurst).toBeGreaterThan(0);
        expect(modBurst).toBe(baseBurst * 2);
    });

    // Case 5c: skill-triggered bomb detonation scales by detonator's detonationDamageModifier.
    // The DETONATING actor carries a passive modifier +50% detonation damage (value 50 → mult 1.5).
    // Validates that the skill-triggered detonate() path scales by (1 + detonationDamageModifier/100).
    it('skill-triggered bomb detonation scales by detonationDamageModifier: modifier 50 gives 1.5× burst', () => {
        // Active slot: apply bomb (tier 10, 2 stacks, duration 3 — survives until charged fires).
        // Charged slot: detonate bomb (powerPct 100).
        // Passive slot (modifier run only): detonationDamage modifier +50 → mult 1.5.
        // chargeCount 3, startCharged false → round 4 fires charged (detonate).
        // Baseline: same layout without the passive modifier.
        // Compare sum of bomb-detonated damage across both runs.
        const skillsBase = (): ShipSkills => ({
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
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        detonatorHit(),
                        ab({
                            type: 'detonate-dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
                        }),
                    ],
                },
            ],
        });

        const skillsWithModifier = (): ShipSkills => ({
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
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        detonatorHit(),
                        ab({
                            type: 'detonate-dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'modifier',
                                channel: 'detonationDamage',
                                value: 50,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        });

        const { events: baseEvents } = collect(
            baseInput({ shipSkills: skillsBase(), numRounds: 4 })
        );
        const { events: modEvents } = collect(
            baseInput({ shipSkills: skillsWithModifier(), numRounds: 4 })
        );

        // Bombs also burst on natural countdown-0 EXPIRY (processBombs, the enemy-turn/
        // positioned-timed-burst path), which never sets `detonatorId` (events.ts: "UNDEFINED
        // for a natural countdown-0 expiry ... which nobody 'detonates'"). Only the
        // skill-triggered `detonate()` path stamps `detonatorId` with the casting actor
        // (engine.ts's `applyPerVictimDetonation`: "the positional detonate caster IS the
        // detonator"). Summing every `bomb-detonated` event regardless of source would let an
        // expiry burst alone satisfy both assertions below even if the skill-triggered path
        // (this test's actual subject) regressed to zero — filter to `detonatorId === FOCUS`
        // so the measurement is specific to the charged-cast burst.
        const baseBurstSkill = baseEvents
            .filter((e) => e.type === 'bomb-detonated' && e.detonatorId === FOCUS)
            .reduce((sum, e) => sum + (e.type === 'bomb-detonated' ? e.damage : 0), 0);
        const modBurstSkill = modEvents
            .filter((e) => e.type === 'bomb-detonated' && e.detonatorId === FOCUS)
            .reduce((sum, e) => sum + (e.type === 'bomb-detonated' ? e.damage : 0), 0);

        // With modifier 0: burst = baseline
        // With modifier 50: burst = baseline × 1.5
        expect(baseBurstSkill).toBeGreaterThan(0);
        expect(modBurstSkill).toBeCloseTo(baseBurstSkill * 1.5, 5);
    });

    // Case 5d: skill-triggered Inferno detonation scales by detonator's detonationDamageModifier.
    // The DETONATING actor carries a passive modifier +50% detonation damage (value 50 → mult 1.5).
    // Validates that the detonate() inferno branch scales by (1 + detonationDamageModifier/100).
    it('skill-triggered inferno detonation scales by detonationDamageModifier: modifier 50 gives 1.5× burst', () => {
        // Active slot: apply inferno DoT (tier 8, stacks 3, duration 3 — survives until charged fires).
        // Charged slot: detonate inferno (powerPct 100).
        // Passive slot (modifier run only): detonationDamage modifier +50 → mult 1.5.
        // chargeCount 3, startCharged false → round 4 fires charged (detonate).
        // Baseline: same layout without the passive modifier.
        // Compare sum of dot-detonated damage across both runs.
        const infernoSkillsBase = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 3,
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        detonatorHit(),
                        ab({
                            type: 'detonate-dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 100 },
                        }),
                    ],
                },
            ],
        });

        const infernoSkillsWithModifier = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 8,
                                stacks: 3,
                                duration: 3,
                            },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        detonatorHit(),
                        ab({
                            type: 'detonate-dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 100 },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'modifier',
                                channel: 'detonationDamage',
                                value: 50,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        });

        const { events: baseEvents } = collect(
            baseInput({ shipSkills: infernoSkillsBase(), numRounds: 4 })
        );
        const { events: modEvents } = collect(
            baseInput({ shipSkills: infernoSkillsWithModifier(), numRounds: 4 })
        );

        const baseBurst = baseEvents
            .filter((e) => e.type === 'dot-detonated')
            .reduce((sum, e) => sum + (e.type === 'dot-detonated' ? e.damage : 0), 0);
        const modBurst = modEvents
            .filter((e) => e.type === 'dot-detonated')
            .reduce((sum, e) => sum + (e.type === 'dot-detonated' ? e.damage : 0), 0);

        // With modifier 0: burst = baseline
        // With modifier 50: burst = baseline × 1.5
        expect(baseBurst).toBeGreaterThan(0);
        expect(modBurst).toBeCloseTo(baseBurst * 1.5, 5);
    });

    // Case 5e: skill-triggered Corrosion detonation scales by detonator's detonationDamageModifier.
    // The DETONATING actor carries a passive modifier +50% detonation damage (value 50 → mult 1.5).
    // Validates that the detonate() corrosion branch scales by (1 + detonationDamageModifier/100).
    it('skill-triggered corrosion detonation scales by detonationDamageModifier: modifier 50 gives 1.5× burst', () => {
        // Active slot: apply corrosion DoT (tier 5, stacks 2, duration 3 — survives until charged fires).
        // Charged slot: detonate corrosion (powerPct 100).
        // Passive slot (modifier run only): detonationDamage modifier +50 → mult 1.5.
        // chargeCount 3, startCharged false → round 4 fires charged (detonate).
        // Baseline: same layout without the passive modifier.
        // Compare sum of dot-detonated damage across both runs.
        const corrosionSkillsBase = (): ShipSkills => ({
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
                        detonatorHit(),
                        ab({
                            type: 'detonate-dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: { type: 'detonate-dot', dotType: 'corrosion', powerPct: 100 },
                        }),
                    ],
                },
            ],
        });

        const corrosionSkillsWithModifier = (): ShipSkills => ({
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
                        detonatorHit(),
                        ab({
                            type: 'detonate-dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            config: { type: 'detonate-dot', dotType: 'corrosion', powerPct: 100 },
                        }),
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'modifier',
                            target: 'self',
                            trigger: 'on-cast',
                            config: {
                                type: 'modifier',
                                channel: 'detonationDamage',
                                value: 50,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        });

        const { events: baseEvents } = collect(
            baseInput({ shipSkills: corrosionSkillsBase(), numRounds: 4 })
        );
        const { events: modEvents } = collect(
            baseInput({ shipSkills: corrosionSkillsWithModifier(), numRounds: 4 })
        );

        const baseBurst = baseEvents
            .filter((e) => e.type === 'dot-detonated')
            .reduce((sum, e) => sum + (e.type === 'dot-detonated' ? e.damage : 0), 0);
        const modBurst = modEvents
            .filter((e) => e.type === 'dot-detonated')
            .reduce((sum, e) => sum + (e.type === 'dot-detonated' ? e.damage : 0), 0);

        // With modifier 0: burst = baseline
        // With modifier 50: burst = baseline × 1.5
        expect(baseBurst).toBeGreaterThan(0);
        expect(modBurst).toBeCloseTo(baseBurst * 1.5, 5);
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
            expect(e.targetId).toBe(BARE_ENEMY_ID);
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
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            attack: 15000,
            crit: 50,
            critDamage: 150,
            defensePenetration: 10,
            chargeCount: 3,
            shipSkills: accSkills(),
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
                shieldPenetration: 0,
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

// ---------------------------------------------------------------------------
// Phase 4c Task 3: per-hit `attacked` emission
// ---------------------------------------------------------------------------

/**
 * Helpers for the per-hit attacked emission tests.
 *
 * Ship-backed enemy: carries a real ShipSkills with a 3-hit damage ability.
 * With crit=100 every hit crits (gate always fires) → hitCrits=[true,true,true]
 * every round → 3 `attacked` events, all with didCrit:true.
 *
 * Manual flat enemy: no shipSkills → synthesized 1-hit basic attack → hitCrits=[]
 * in the engine (flat-enemy path) → falls back to [enemyTurnDidCrit] → 1 event.
 */

/** Ship-backed enemy attacker with a 3-hit damage ability at 100% crit. */
const threeHitEnemy = (id: string, speed = 50) => ({
    id,
    stats: { attack: 1000, crit: 100, critDamage: 100, speed },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            {
                slot: 'active' as const,
                abilities: [
                    ab({
                        type: 'damage' as const,
                        target: 'enemy' as const,
                        config: { type: 'damage' as const, multiplier: 100, hits: 3 },
                    }),
                ],
            },
        ],
    },
});

/** Collect `attacked` events from a healing-mode run. */
const collectAttacked = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('attacked', (e) => attacked.push(e));
    runCombat({ ...input, bus });
    return attacked;
};

/** Base healing-mode input: focus attacker is the heal target, huge HP so it never dies. */
const healBase = (): CombatEngineInput => ({
    enemyAttackers: bareEnemy(),
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 100_000, // huge so the target survives both enemy attacks
    healTargetId: 'attacker',
    mode: 'healing',
});

describe('Phase 4c Task 3 — per-hit attacked emission', () => {
    afterEach(() => resetRateGateRng());

    // ── Test 1: ship-backed enemy with 3-hit ability → 3 events per round ───────
    // The enemy fires a 3-hit damage ability at 100% crit → hitCrits=[true,true,true].
    // With 2 rounds of combat the engine emits 3×2 = 6 `attacked` events total,
    // each with didCrit:true. All share the same targetId/attackerId/round within
    // each group of 3.
    it('ship-backed 3-hit enemy emits 3 attacked events per round, each with per-hit didCrit', () => {
        const attacked = collectAttacked({
            ...healBase(),
            numRounds: 2,
            enemyAttackers: [threeHitEnemy('atk1')],
        });

        // 3 hits × 2 rounds = 6 total events.
        expect(attacked).toHaveLength(6);

        // Group by round and verify shape.
        for (const r of [1, 2]) {
            const roundEvents = attacked.filter((e) => e.round === r);
            expect(roundEvents).toHaveLength(3);
            for (const e of roundEvents) {
                expect(e.targetId).toBe('attacker');
                expect(e.attackerId).toBe('atk1');
                expect(e.didCrit).toBe(true); // 100% crit → every hit crits
            }
        }
    });

    // ── Test 1b: ship-backed 3-hit enemy at crit:50 → mixed per-hit didCrit ──────
    // Bug class targeted: "every attacked event wrongly carries the round-level crit
    // binary instead of its own hit's outcome." With crit:100 both the buggy and
    // correct implementations emit identical events. This test uses crit:50 with a
    // 3-hit ability to produce a MIXED per-hit pattern that can distinguish the two.
    //
    // The gate now draws from the module RNG and fires a crit iff `draw < rate`. Rate = 50/100
    // = 0.5. NOTE: the `setRateGateRng(seq)` override below is dead for the enemy's crit gate
    // under SP-0 — `atk50:active-crit` now carries a `${actorId}:${purpose}` stream key, and
    // the keyed test provider (installed globally in setupTests.ts) takes precedence over a
    // bare `setRateGateRng` override whenever a key is supplied. Left in place as historical
    // intent documentation; the actual per-hit pattern comes from the keyed `atk50:active-crit`
    // sub-stream under the fixed test seed:
    //   Round 1 enemy hits: [false, false, true]
    //   Round 2 enemy hits: [true,  false, true]
    //
    // Buggy implementation (uses [enemyTurnDidCrit, enemyTurnDidCrit, enemyTurnDidCrit]):
    //   Round 1: [true, true, true] — all three carry the round-level binary (true).
    //   Round 2: [true, true, true] — same.
    // Correct implementation (uses per-hit hitCrits):
    //   Round 1: [undefined, undefined, true] — matches the actual per-hit trace above.
    //   Round 2: [true, undefined, true].
    it('ship-backed 3-hit enemy at crit:50 emits mixed per-hit didCrit matching gate trace', () => {
        //          d1   d2(h1) d3(h2) d4(h3) d5   d6(h1) d7(h2) d8(h3)
        const seq = [0.9, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9, 0.1];
        let i = 0;
        setRateGateRng(() => {
            if (i >= seq.length) {
                throw new Error('Unexpected extra rate-gate draw');
            }
            return seq[i++];
        });
        const attacked = collectAttacked({
            ...healBase(),
            numRounds: 2,
            enemyAttackers: [
                {
                    id: 'atk50',
                    stats: { attack: 1000, crit: 50, critDamage: 100, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active' as const,
                                abilities: [
                                    ab({
                                        type: 'damage' as const,
                                        target: 'enemy' as const,
                                        config: {
                                            type: 'damage' as const,
                                            multiplier: 100,
                                            hits: 3,
                                        },
                                    }),
                                ],
                            },
                        ],
                    },
                },
            ],
        });

        // 3 hits × 2 rounds = 6 events total.
        expect(attacked).toHaveLength(6);

        const r1 = attacked.filter((e) => e.round === 1);
        const r2 = attacked.filter((e) => e.round === 2);
        expect(r1).toHaveLength(3);
        expect(r2).toHaveLength(3);

        // All events share attacker/target identity.
        for (const e of [...r1, ...r2]) {
            expect(e.targetId).toBe('attacker');
            expect(e.attackerId).toBe('atk50');
        }

        // Round 1 gate trace: [false, false, true] → didCrit absent, absent, present.
        expect(r1[0].didCrit).toBeUndefined();
        expect(r1[1].didCrit).toBeUndefined();
        expect(r1[2].didCrit).toBe(true);

        // Round 2 gate trace (stream carries over): [true, false, true] → present, absent, present.
        expect(r2[0].didCrit).toBe(true);
        expect(r2[1].didCrit).toBeUndefined();
        expect(r2[2].didCrit).toBe(true);
    });

    // ── charge-changed emission ───────────────────────────────────────────────────
    it('charge-changed gen: emits reason:gen with newCharge = oldCharge+1 each non-charged round', () => {
        // chargeCount 3, not startCharged → rounds 1,2,3 are active (gen), round 4 is charged
        // (cast-reset). After reset charges = 0 then gen resumes. In a 6-round sim the
        // pattern is: gen(1→1), gen(2→2), gen(3→3), cast-reset(3→0), gen(0→1), gen(1→2).
        const { events } = collect(
            baseInput({ numRounds: 6, chargeCount: 3, startCharged: false })
        );
        const genEvents = events.filter((e) => e.type === 'charge-changed' && e.reason === 'gen');
        // There must be at least one gen event.
        expect(genEvents.length).toBeGreaterThan(0);
        // Every gen event must have newCharge = oldCharge + 1.
        for (const e of genEvents) {
            if (e.type !== 'charge-changed') throw new Error('unreachable');
            expect(e.newCharge).toBe(e.oldCharge + 1);
            expect(e.actorId).toBe('attacker');
            expect(e.round).toBeGreaterThanOrEqual(1);
        }
    });

    it('charge-changed cast-reset: emits reason:cast-reset with newCharge 0 on a charged-skill fire', () => {
        // chargeCount 3, not startCharged → round 4 fires charged + resets.
        const { events } = collect(
            baseInput({ numRounds: 6, chargeCount: 3, startCharged: false })
        );
        const resetEvents = events.filter(
            (e) => e.type === 'charge-changed' && e.reason === 'cast-reset'
        );
        expect(resetEvents.length).toBeGreaterThan(0);
        for (const e of resetEvents) {
            if (e.type !== 'charge-changed') throw new Error('unreachable');
            expect(e.newCharge).toBe(0);
            expect(e.actorId).toBe('attacker');
        }
    });

    // ── Test 2: manual flat enemy → 1 event per round (unchanged contract) ──────
    // A manual flat enemy (no shipSkills) synthesizes a single-hit basic attack.
    // The engine falls back to [enemyTurnDidCrit] (hitCrits=[]) → exactly 1
    // `attacked` event per round — the pre-4c contract.
    it('manual flat enemy (no shipSkills) emits exactly 1 attacked event per round', () => {
        const attacked = collectAttacked({
            ...healBase(),
            numRounds: 2,
            enemyAttackers: [
                {
                    id: 'flat1',
                    stats: { attack: 500, crit: 0, critDamage: 0, speed: 50 },
                    chargeCount: 0,
                    startCharged: false,
                    // no shipSkills → synthesized 1-hit basic attack
                },
            ],
        });

        // 1 hit × 2 rounds = 2 total events.
        expect(attacked).toHaveLength(2);

        for (const r of [1, 2]) {
            const roundEvents = attacked.filter((e) => e.round === r);
            expect(roundEvents).toHaveLength(1);
            expect(roundEvents[0].targetId).toBe('attacker');
            expect(roundEvents[0].attackerId).toBe('flat1');
            // crit=0 → didCrit absent
            expect(roundEvents[0].didCrit).toBeUndefined();
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// perTarget on heal-performed and shield-applied events
// ─────────────────────────────────────────────────────────────────────────────
describe('heal-performed / shield-applied perTarget breakdown', () => {
    // Helper: a walked team actor with explicit HP (no skills — just a slot filler).
    const idleAlly = (id: string, speed: number, hp: number): TeamActorEngineInput => ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: { slots: [] },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 1000,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    it('perTarget: AoE heal across 2 allies with DIFFERENT missing HP yields distinct per-recipient amounts', () => {
        // Focus (hp 10000, speed 200) heals 'all-allies' with basis 'target-hp' (10%) each round.
        // t1 (hp 8000) and t2 (hp 12000) → raw per recipient differs (800 and 1200).
        // We use two enemy attackers (speed 80, 60) that wound t1 and t2 BEFORE the focus acts
        // by running 2 rounds: round 1 enemy attacks → t1 and t2 take damage.
        // Round 2 focus heals all-allies → each recipient gets its own target-hp-scaled amount.
        //
        // Actually: focus (speed 200) acts FIRST each round — so we pre-wound allies.
        // Simpler: use basis 'target-hp' so that raw = recipient.maxHp × 10% (t1: 800, t2: 1200).
        // This is already distinct without needing damage — the AMOUNTS differ by definition.
        idCounter = 0;
        const bus = createEventBus();
        const healPerfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => {
            if (e.casterId === 'attacker') healPerfs.push(e);
        });

        runCombat({
            enemyAttackers: bareEnemy(),
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // Speed 200: focus acts before allies (speed 50, 40)
            speed: 200,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'heal-aoe',
                                type: 'heal',
                                // target-hp basis: raw = recipient.maxHp × pct → different per recipient
                                target: 'all-allies',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'heal', pct: 10, basis: 'target-hp' },
                            },
                        ],
                    },
                ],
            },
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 2000,
            hp: 10000,
            healTargetId: 'attacker',
            mode: 'healing',
            teamActors: [
                idleAlly('t1', 50, 8000), // raw = 800 (8000 × 10%)
                idleAlly('t2', 40, 12000), // raw = 1200 (12000 × 10%)
            ],
            bus,
        });

        // Should have exactly 1 heal-performed from the focus actor.
        expect(healPerfs).toHaveLength(1);
        const evt = healPerfs[0];

        // perTarget must exist with one entry per recipient.
        expect(evt.perTarget).toBeDefined();
        const perTarget = evt.perTarget!;
        expect(perTarget).toHaveLength(3); // attacker + t1 + t2

        // The amounts must NOT all be equal (distinct per-recipient amounts).
        const amounts = perTarget.map((e) => e.amount);
        const allSame = amounts.every((a) => a === amounts[0]);
        expect(allSame).toBe(false);

        // Each entry must have a targetId.
        for (const entry of perTarget) {
            expect(typeof entry.targetId).toBe('string');
            expect(entry.amount).toBeGreaterThan(0);
        }

        // Sum of perTarget amounts must equal the summed amount on the event.
        const sum = perTarget.reduce((acc, e) => acc + e.amount, 0);
        expect(sum).toBeCloseTo(evt.amount, 5);
    });

    it('perTarget: single-recipient self-heal has one perTarget entry matching the event amount', () => {
        idCounter = 0;
        const bus = createEventBus();
        const healPerfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
        bus.on('heal-performed', (e) => healPerfs.push(e));

        runCombat({
            enemyAttackers: bareEnemy(),
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'self-heal',
                                type: 'heal',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'heal', pct: 10, basis: 'hp' },
                            },
                        ],
                    },
                ],
            },
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 2000,
            hp: 10000,
            healTargetId: 'attacker',
            mode: 'healing',
            bus,
        });

        expect(healPerfs).toHaveLength(1);
        const evt = healPerfs[0];
        expect(evt.perTarget).toBeDefined();
        const perTarget = evt.perTarget!;
        expect(perTarget).toHaveLength(1);
        expect(perTarget[0].targetId).toBe('attacker');
        expect(perTarget[0].amount).toBeCloseTo(evt.amount, 5);
    });

    it('perTarget: shield-applied has one perTarget entry per recipient with summing amounts', () => {
        idCounter = 0;
        const bus = createEventBus();
        const shieldEvts: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.granterId === 'attacker') shieldEvts.push(e);
        });

        runCombat({
            enemyAttackers: bareEnemy(),
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            speed: 200,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'shield-aoe',
                                type: 'shield',
                                target: 'all-allies',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'shield', pct: 10, basis: 'hp' },
                            },
                        ],
                    },
                ],
            },
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 2000,
            hp: 10000,
            healTargetId: 'attacker',
            mode: 'healing',
            teamActors: [idleAlly('t1', 50, 8000), idleAlly('t2', 40, 12000)],
            bus,
        });

        expect(shieldEvts).toHaveLength(1);
        const evt = shieldEvts[0];
        expect(evt.perTarget).toBeDefined();
        const perTarget = evt.perTarget!;
        // All 3 recipients get shields (all at full HP → no cap).
        expect(perTarget).toHaveLength(3);
        // Amounts sum to total.
        const sum = perTarget.reduce((acc, e) => acc + e.amount, 0);
        expect(sum).toBeCloseTo(evt.amount, 5);
        // Each entry has a targetId.
        for (const entry of perTarget) {
            expect(typeof entry.targetId).toBe('string');
        }
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Reactive stamp: events emitted while resolving a REACTIVE intent carry
// reactive:true + duringTurnOf (the actor whose turn was active when the
// reaction fired) so a later log builder can nest the reaction under the
// triggering turn, NOT under the reactor's own turn.
//
// Harness mirrors counterAttack.integration.test.ts: the FOCUS ('attacker')
// carries Stalwart's parsed first passive (an on-attacked counter co-located
// with a `Legion Discipline II` self-buff grant). A single enemy attacker
// ('foe') lands a primary hit each round; the reactive grant emits a
// `buff-applied` event during the FOE's turn.
// ───────────────────────────────────────────────────────────────────────────
describe('reactive stamp — reactive emissions carry duringTurnOf', () => {
    const STALWART_P1 =
        'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.';

    const stalwartShip = (): Ship =>
        ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [{}, {}, {}, {}],
            firstPassiveSkillText: STALWART_P1,
        }) as Ship;

    const basicEnemy = (
        id: string,
        attack: number
    ): NonNullable<CombatEngineInput['enemyAttackers']>[number] =>
        ({
            id,
            stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 50 },
            chargeCount: 0,
            startCharged: false,
        }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

    it('B counterattack buff grant carries reactive:true and duringTurnOf === attacker turn', () => {
        const skills = buildShipAbilities(stalwartShip());

        const bus = createEventBus();
        const buffEvents: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => buffEvents.push(e));

        runCombat({
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: skills,
            numRounds: 3,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [basicEnemy('foe', 3_000)],
            bus,
        });

        const ld2 = buffEvents.filter((e) => e.buffName === 'Legion Discipline II');
        // The reactive grant fires (it lands on the focus 'attacker').
        expect(ld2.length).toBeGreaterThan(0);
        for (const e of ld2) {
            // The grant is a REACTION to the foe's attack → stamped during the foe's turn.
            expect(e.reactive).toBe(true);
            expect(e.duringTurnOf).toBe('foe');
            expect(e.triggerActorId).toBe('foe');
        }
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Round-2 start-of-round reactive: duringTurnOf must be undefined (turn-less)
//
// A start-of-round reactive fires BEFORE any turn in the round. In round 1
// actingActorId is undefined (no prior turn), so duringTurnOf is correctly
// undefined. WITHOUT the per-round reset, round 2's start-of-round drain reads
// the previous round's last acting actor and wrongly stamps duringTurnOf with
// that id. WITH the fix, actingActorId is reset to undefined at the top of
// every round so the start-of-round drain always sees undefined.
//
// Harness: the focus ('attacker') carries a start-of-round passive buff ability
// (Attack Up, 1 turn). The enemy attacker ('foe') goes LAST in each round
// (speed 20 vs attacker speed default), ensuring actingActorId is set to 'foe'
// at the END of round 1. If the reset is missing, round 2's start-of-round
// buff-applied would carry duringTurnOf === 'foe'. With the fix it is undefined.
// ───────────────────────────────────────────────────────────────────────────
describe('start-of-round reactive stamp — duringTurnOf is undefined (turn-less)', () => {
    idCounter = 0;
    const startOfRoundBuffSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
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
                            parsedEffects: { attack: 20 },
                            isStackable: false,
                            duration: 1,
                        },
                    }),
                ],
            },
        ],
    });

    const basicEnemy = (
        id: string,
        speed: number
    ): NonNullable<CombatEngineInput['enemyAttackers']>[number] =>
        ({
            id,
            stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed },
            chargeCount: 0,
            startCharged: false,
        }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

    it('start-of-round buff-applied in round 2+ carries duringTurnOf === undefined (not the prior round last actor)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const buffEvents: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => buffEvents.push(e));

        runCombat({
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: startOfRoundBuffSkills(),
            numRounds: 3,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000,
            healTargetId: 'attacker',
            mode: 'healing',
            // Enemy speed=20 (low) → goes LAST in every round; sets actingActorId='foe'
            // at end of round 1. Without the reset fix, round 2's start-of-round drain
            // would stamp duringTurnOf:'foe' instead of undefined.
            enemyAttackers: [basicEnemy('foe', 20)],
            bus,
        });

        // The start-of-round buff fires every round — collect round-2+ events.
        const attackUpEvents = buffEvents.filter((e) => e.buffName === 'Attack Up');
        // Must have fired in multiple rounds (at minimum rounds 1, 2, 3).
        expect(attackUpEvents.length).toBeGreaterThanOrEqual(2);

        // Every start-of-round buff-applied must carry duringTurnOf === undefined:
        // the drain fires before any turn, so no actor was active.
        for (const e of attackUpEvents) {
            expect(e.reactive).toBe(true);
            // KEY assertion: turn-less reactive — must NOT be stamped with a prior actor.
            expect(e.duringTurnOf).toBeUndefined();
        }
    });
});
