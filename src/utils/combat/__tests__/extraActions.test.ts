/**
 * Extra-action queue re-insertion tests.
 *
 * Game rule (user-verified, binding): an extra action = the actor is RE-ADDED into
 * the round's turn queue at its speed position. It acts again immediately only when
 * it is the fastest remaining actor. The extra turn is a FULL normal turn — charge
 * cadence, passives, post-turn status decrement all run again.
 *
 * Test plan:
 *  1. Doubling:        once-per-round extra-action doubles per-round damage.
 *  2. Queue position:  actor inserted at correct speed position (bus tap).
 *  3. Round reset:     oncePerRound cap resets between rounds (fires every round).
 *  4. Backstop throw:  un-capped unconditional grant throws at runtime.
 *  5. Ticking:         1-turn self buff applied each turn is active on BOTH turns
 *                      (same-turn decrement rule: apply in step d, read in step e,
 *                      decrement at post-turn → expires before next actor).
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
    simulateDPS,
    DPSSimulationInput,
    SYNTHESIZED_DPS_ENEMY_ID,
} from '../../calculators/dpsSimulator';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ea${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Liberator-style: plain active damage + passive once-per-round extra action. */
const extraActionSkills = (oncePerRound = true): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'extra-action',
                    target: 'self',
                    config: { type: 'extra-action', oncePerRound },
                }),
            ],
        },
    ],
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
    hacking: 0,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

describe('extraActions', () => {
    afterEach(() => resetRateGateRng());
    // ── Test 1: Doubling ─────────────────────────────────────────────────────
    // attack=10000, multiplier=100%, defense=0 → base turn damage = 10000.
    // Once-per-round extra action → 2 attacker turns per round → 20000/round.
    // extraTurns field: 1 (one extra beyond the base turn).
    // Baseline without passive: 10000/round, extraTurns UNDEFINED (legacy shape).
    it('once-per-round extra action doubles per-round damage and sets extraTurns:1', () => {
        idCounter = 0;
        const withExtra = simulateDPS({ ...BASE, shipSkills: extraActionSkills() });
        for (const round of withExtra.rounds) {
            // Two identical 10000-damage turns → 20000/round
            expect(round.totalRoundDamage).toBe(20000);
            expect(round.extraTurns).toBe(1);
        }

        idCounter = 0;
        // Baseline: plain damage, no extra-action passive
        const baselineSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
            ],
        };
        const baseline = simulateDPS({ ...BASE, shipSkills: baselineSkills });
        for (const round of baseline.rounds) {
            expect(round.totalRoundDamage).toBe(10000);
            // Legacy shape: no extraTurns field when there are no extra actions.
            expect(round.extraTurns).toBeUndefined();
        }
    });

    // ── Test 2: Queue position by speed ─────────────────────────────────────
    // Collect turn-started actorIds for round 1 via a bus tap.
    // Attacker speed > enemy speed → attacker acts, gets extra turn (faster than
    // remaining enemy) → acts again → then enemy.
    // Attacker speed < enemy speed → enemy acts first, then attacker acts, gets
    // extra turn (no one remains) → acts again.
    //
    // The turn-taking opponent is now the REAL, positioned enemy this run synthesizes
    // (`SYNTHESIZED_DPS_ENEMY_ID` === 'enemy-1'), not the vestigial dummy sink (id 'enemy'), which
    // takes no turn at all — SP-4c-2c drops it from `turnOrderActors` unconditionally (the
    // `dummyEnemyIsVestigial` gate that used to decide this is deleted). Only the id moved: the
    // synthesized enemy is built from the SAME `enemySpeed` scalar these two runs set, so both
    // speed-rank orderings below are unchanged.
    it('extra turn inserted at speed position among remaining actors', () => {
        // Faster attacker: [attacker, attacker, enemy]
        const busFaster = createEventBus();
        const turnsFaster: string[] = [];
        busFaster.on('turn-started', (e) => {
            if (e.round === 1) turnsFaster.push(e.actorId);
        });
        idCounter = 0;
        simulateDPS({
            ...BASE,
            rounds: 1,
            speed: 100,
            enemySpeed: 50,
            shipSkills: extraActionSkills(),
            bus: busFaster,
        });
        // attacker (speed 100) re-inserted at position before enemy (speed 50): acts twice first
        expect(turnsFaster).toEqual(['attacker', 'attacker', SYNTHESIZED_DPS_ENEMY_ID]);

        // Slower attacker: [enemy, attacker, attacker]
        const busSlower = createEventBus();
        const turnsSlower: string[] = [];
        busSlower.on('turn-started', (e) => {
            if (e.round === 1) turnsSlower.push(e.actorId);
        });
        idCounter = 0;
        simulateDPS({
            ...BASE,
            rounds: 1,
            speed: 40,
            enemySpeed: 50,
            shipSkills: extraActionSkills(),
            bus: busSlower,
        });
        // enemy (speed 50) faster, acts first; attacker re-inserted at end (no one remains
        // with speed >= 40 after enemy already acted): [enemy, attacker, attacker]
        expect(turnsSlower).toEqual([SYNTHESIZED_DPS_ENEMY_ID, 'attacker', 'attacker']);
    });

    // ── Test 3: oncePerRound cap resets between rounds ───────────────────────
    // The extra-action passive fires on the normal turn, granting 1 extra turn.
    // On the extra turn the passive fires again, but the per-round cap absorbs it
    // (key already in extraActionFired set). Next round the set is fresh → grants
    // again. So every round has exactly 1 extra turn (extraTurns === 1).
    it('oncePerRound cap fires exactly once per round and resets each round', () => {
        idCounter = 0;
        const result = simulateDPS({ ...BASE, rounds: 3, shipSkills: extraActionSkills() });
        for (const round of result.rounds) {
            // The cap absorbs the re-fire on the extra turn → exactly 1 extra turn/round
            expect(round.extraTurns).toBe(1);
            // Damage: 2 × 10000 = 20000 every round
            expect(round.totalRoundDamage).toBe(20000);
        }
    });

    // ── Test 4: Backstop throws on un-capped unconditional grant ────────────
    // oncePerRound=false → the passive fires on the normal turn (extra turn granted),
    // then fires again on the extra turn (another extra turn), then again, ...
    // The backstop (MAX_EXTRA_TURNS_PER_ROUND) detects this unbounded loop and throws.
    it('un-capped extra-action grant throws with an /extra/i message', () => {
        idCounter = 0;
        expect(() =>
            simulateDPS({ ...BASE, rounds: 1, shipSkills: extraActionSkills(false) })
        ).toThrow(/extra/i);
    });

    // ── Test 6: Per-hit crit draw continuity across extra turns ─────────────
    // Verifies that the SAME continuing accumulator (activeCritGate) is used for
    // both the normal turn and the extra turn in the same round — i.e. the gate
    // does NOT reset between turns. This pins the "extra turn continues the draw
    // sequence" invariant.
    //
    // Setup: 3-hit active (multiplier=100, hits=3), crit=50, critDamage=100,
    //        once-per-round extra-action passive, rounds=1.
    //
    // The crit gate now draws from the module RNG (fires iff draw < rate). The crit hits
    // are the ONLY chance-gate consumers here (single DPS actor, 6 hits over 2 turns, no
    // debuff/proc gates) — verified empirically: exactly 6 draws, consumed in hit order.
    //
    // NOTE: the `setRateGateRng(seq)` override below is dead for this gate under SP-0 —
    // `active-crit` now carries a `${actorId}:${purpose}` stream key, and the keyed test
    // provider (installed globally in setupTests.ts) takes precedence over a bare
    // `setRateGateRng` override whenever a key is supplied. The array is left in place as
    // historical intent documentation, but the actual draws come from the keyed
    // `attacker:active-crit` sub-stream under the fixed test seed:
    //   Turn 1 (normal),     hits h1,h2,h3 → critHits=2
    //   Turn 2 (extra turn), hits h1,h2,h3 → critHits=1
    // The asymmetric [2, 1] pair still proves the per-hit draw STREAM is shared/continued
    // across the extra turn rather than reset (a reset would re-run an identical pattern;
    // draws would repeat as [x, y, z] on both turns instead of continuing on).
    //
    // PR5 (multi-hit full-walk epic): the non-positional path now emits one `ability-performed`
    // PER SUB-ATTACK instead of one folded event per turn, so a `hits: 3` cast produces THREE
    // events per turn (six total across the normal + extra turn) instead of two. The per-hit draw
    // schedule itself is unaffected — grouping the six events back into their two turns (three
    // consecutive events each, in emission order) and summing each turn's critting sub-attacks
    // recovers exactly the same [2, 1] pair this test has always pinned.
    it('per-hit crit draw continues across extra turn (per-turn critting counts [2, 1])', () => {
        const seq = [0.9, 0.1, 0.9, 0.1, 0.9, 0.1];
        let i = 0;
        setRateGateRng(() => {
            if (i >= seq.length) {
                throw new Error('Unexpected extra rate-gate draw');
            }
            return seq[i++];
        });
        const bus = createEventBus();
        const performed: { didCrit?: boolean; critHits?: number; subAttackIndex?: number }[] = [];
        bus.on('ability-performed', (e) => {
            if (e.actorId === 'attacker' && e.round === 1 && e.abilityType === 'damage') {
                performed.push({
                    didCrit: e.didCrit,
                    critHits: e.critHits,
                    subAttackIndex: e.subAttackIndex,
                });
            }
        });
        idCounter = 0;
        simulateDPS({
            ...BASE,
            crit: 50,
            critDamage: 100,
            rounds: 1,
            shipSkills: (() => {
                idCounter = 0;
                return {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                ab({
                                    type: 'damage',
                                    config: { type: 'damage', multiplier: 100, hits: 3 },
                                }),
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'extra-action',
                                    target: 'self',
                                    config: { type: 'extra-action', oncePerRound: true },
                                }),
                            ],
                        },
                    ],
                };
            })(),
            bus,
        });

        // Six ability-performed events: 2 attacker turns x 3 sub-attacks in round 1,
        // where pre-PR5 there were two (one folded event per turn).
        expect(performed).toHaveLength(6);

        // Each turn's three sub-attacks arrive consecutively and re-start their own
        // subAttackIndex — chunking recovers the per-turn grouping without relying on any
        // turn-identifying field the payload doesn't carry.
        const turn1 = performed.slice(0, 3);
        const turn2 = performed.slice(3, 6);
        expect(turn1.map((e) => e.subAttackIndex)).toEqual([0, 1, 2]);
        expect(turn2.map((e) => e.subAttackIndex)).toEqual([0, 1, 2]);

        // Turn 1: 2 of 3 sub-attacks crit. Turn 2: 1 of 3 crits (see draw trace above).
        // The asymmetric [2, 1] pair is only possible when the gate accumulator carries over
        // between turns. A resetting gate would replay the same pattern both turns; a shared
        // single-outcome gate would yield either both equal or both zero/three.
        const critCount = (events: typeof performed) => events.filter((e) => e.didCrit).length;
        expect(critCount(turn1)).toBe(2);
        expect(critCount(turn2)).toBe(1);

        // Per-sub-attack payload shape: a critting sub-attack's own critHits is 1 (the critting
        // VICTIM count for that one sub-attack), not the turn-wide tally the pre-PR5 fold carried.
        for (const e of [...turn1, ...turn2]) {
            expect(e.critHits).toBe(e.didCrit ? 1 : undefined);
        }
    });

    // ── Test 5: Per-turn ticking across the extra turn ───────────────────────
    // A 1-turn self buff is applied in step (d) and read in step (e) of the SAME
    // runPlayerTurn call (same-turn decrement rule). Post-turn decrements it to 0 →
    // expires before the next actor. On the extra turn the active slot fires AGAIN →
    // re-applies the buff → it is active AGAIN on the extra turn.
    //
    // Setup: active slot = damage(100%) + 1-turn "Attack Up" (+100% attack, self).
    //        passive slot = once-per-round extra-action.
    // attack=10000, defense=0, crit=0, critDamage=0.
    //
    // Per-turn damage derivation:
    //   BUFFED turn: effectiveAttack = 10000 × (1 + 100/100) = 20000
    //                damage = 20000 × (100/100) = 20000
    //
    // BOTH turns (normal + extra) apply+read the buff → both are buffed:
    //   round total = 20000 + 20000 = 40000
    //
    // Baseline (no extra-action passive): one turn per round, buffed:
    //   round total = 20000
    //
    // The extra turn is NOT un-buffed — round total is 2× the buffed single-turn
    // damage (40000), NOT 2× the base damage (20000) + 1× buffed (20000) = 30000.
    //
    // Two assertions prove two independent things:
    //   • totalRoundDamage === 40000  → proves re-application: the buff IS active on
    //     the extra turn (rules out "buff carries over from normal turn without expiry").
    //   • buff-expired count === 2    → proves per-turn decrement: the 1-turn buff is
    //     decremented (and thus emits buff-expired) ONCE per turn, not once per round.
    //     A per-round-decrement engine would emit only 1 expiry per round even though
    //     the buff was applied twice.
    it('1-turn self buff is re-applied (and active) on the extra turn', () => {
        const tickingSkillsWithExtra = (): ShipSkills => {
            idCounter = 0;
            return {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                            // 1-turn +100% attack self buff, duration=1 (expires at post-turn)
                            ab({
                                type: 'buff',
                                target: 'self',
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up',
                                    parsedEffects: { attack: 100 },
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 1,
                                },
                            }),
                        ],
                    },
                    {
                        slot: 'passive',
                        abilities: [
                            ab({
                                type: 'extra-action',
                                target: 'self',
                                config: { type: 'extra-action', oncePerRound: true },
                            }),
                        ],
                    },
                ],
            };
        };

        const tickingSkillsNoExtra = (): ShipSkills => {
            idCounter = 0;
            return {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                            ab({
                                type: 'buff',
                                target: 'self',
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up',
                                    parsedEffects: { attack: 100 },
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 1,
                                },
                            }),
                        ],
                    },
                ],
            };
        };

        // Baseline: no extra action, 1-turn buff → each round single buffed turn
        // effectiveAttack = 10000 × 2 = 20000; damage = 20000 × (100/100) = 20000
        const baseline = simulateDPS({
            ...BASE,
            rounds: 3,
            shipSkills: tickingSkillsNoExtra(),
        });
        for (const round of baseline.rounds) {
            // Single turn, buffed: 10000 × (1 + 100/100) × (100/100) = 20000
            expect(round.totalRoundDamage).toBe(20000);
            expect(round.extraTurns).toBeUndefined();
        }

        // With extra action: both turns apply+read the 1-turn buff → both are buffed.
        // round total = 20000 (normal turn, buffed) + 20000 (extra turn, buffed) = 40000.
        // This PROVES the extra turn does NOT see a stale/expired buff — the buff is
        // freshly re-applied on the extra turn by the active slot firing again.
        //
        // Bus tap: collect buff-expired events for "Attack Up" on 'attacker'.
        // With the own-turn reprieve, a 1-turn self-buff applied during the carrier's own
        // turn survives through the carrier's NEXT turn; both the normal-turn and extra-turn
        // applications are reprieved, so the buff no longer expires twice within a round.
        // The reprieved window still elapses, yielding exactly one expiry per round.
        const busWithExtra = createEventBus();
        const expiryRounds: number[] = [];
        busWithExtra.on('buff-expired', (e) => {
            if (e.actorId === 'attacker' && e.buffName === 'Attack Up') expiryRounds.push(e.round);
        });
        const withExtra = simulateDPS({
            ...BASE,
            rounds: 3,
            shipSkills: tickingSkillsWithExtra(),
            bus: busWithExtra,
        });
        for (const round of withExtra.rounds) {
            // Assertion 1 — re-application: 2 × buffed = 2 × 20000 = 40000
            // (NOT 2 × 10000 = 20000 which would mean neither turn was buffed,
            //  NOR 10000 + 20000 = 30000 mixed)
            expect(round.totalRoundDamage).toBe(40000);
            expect(round.extraTurns).toBe(1);
        }
        // Assertion 2 — the reprieved 1-turn self-buff still expires exactly once per
        // round (one per round across all 3 rounds), confirming the extra-action
        // interaction does not leak/accumulate stale buffs despite double application.
        expect(expiryRounds).toEqual([1, 2, 3]);
    });
});
