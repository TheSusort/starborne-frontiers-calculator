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
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

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
        expect(turnsFaster).toEqual(['attacker', 'attacker', 'enemy']);

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
        expect(turnsSlower).toEqual(['enemy', 'attacker', 'attacker']);
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
        // Bus tap: count buff-expired events for "Attack Up" on 'attacker' in round 1.
        // Per-turn decrement → buff decrements at post-turn of normal turn AND post-turn
        // of extra turn → 2 expiry events per round.
        // Per-round decrement (wrong) → only 1 expiry event per round even with 2 applies.
        const busWithExtra = createEventBus();
        let buffExpiredCountRound1 = 0;
        busWithExtra.on('buff-expired', (e) => {
            if (e.round === 1 && e.actorId === 'attacker' && e.buffName === 'Attack Up') {
                buffExpiredCountRound1++;
            }
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
        // Assertion 2 — per-turn decrement: the 1-turn buff expired exactly twice in
        // round 1 (once after the normal turn's post-turn, once after the extra turn's
        // post-turn). A per-round-decrement engine would emit only 1 here.
        expect(buffExpiredCountRound1).toBe(2);
    });
});
