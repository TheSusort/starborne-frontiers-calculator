/**
 * Per-hit crit checks for multi-hit skills.
 *
 * The crit gate now draws from a random RNG (rng() < rate). Tests that assert an exact
 * crit pattern at a fractional crit rate force a scripted RNG sequence to recover the
 * original intent (e.g. a 50% gate that fires on the 2nd of every 2 draws → 1 of 2 hits).
 * Tests at crit 100/0 (rate >= 1 / rate <= 0) and the runPlayerTurn tests that inject
 * explicit ()=>true/false gates are RNG-independent and left unchanged.
 *
 * Damage formula (0 defence, 0 buffs):
 *   effectiveMultiplier = multiplier × hits   (folded in playerTurn.ts line 968)
 *   preCritDamage = attack × (effectiveMultiplier / 100)
 *   directDamage  = preCritDamage × (1 + critFraction × critDamage/100)
 *
 * Using multiplier=100, hits=3 → effectiveMultiplier=300 → preCritDamage=30000
 *   100% crit (critFraction=1.0): 30000 × 2.0 = 60000  ("attack × 300% × 2")
 *    0% crit (critFraction=0.0): 30000 × 1.0 = 30000
 *   50% crit 2-hit (critFraction=0.5): 30000 × 1.5 = 45000
 */
import { describe, expect, it, afterEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate, setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ph${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// multiplier=100 so effectiveMultiplier = 100 × hits (e.g. 3-hit → 300%)
const multiHitSkills = (hits: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100, hits } })],
        },
    ],
});

const BASE: DPSSimulationInput = {
    attack: 10000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 10_000_000,
    rounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    hacking: 0,
    enemySecurity: 0,
    defence: 0,
    hp: 30000,
};

describe('perHitCrit', () => {
    afterEach(() => resetRateGateRng());

    // ── Test 1: 100% crit, 3-hit skill ──────────────────────────────────────
    // effectiveMultiplier = 100 × 3 = 300 → preCritDamage = 10000 × 3.0 = 30000
    // critHits=3, critFraction=1.0, damageCritMultiplier = 1 + 1.0*(100/100) = 2.0
    // directDamage = 30000 * 2.0 = 60000
    it('100% crit 3-hit: damage = attack × multiplier × 2, didCrit true', () => {
        idCounter = 0;
        const result = simulateDPS({
            ...BASE,
            crit: 100,
            critDamage: 100,
            shipSkills: multiHitSkills(3),
        });
        expect(result.rounds[0].totalRoundDamage).toBe(60000);
        expect(result.rounds[0].didCrit).toBe(true);
        // All 4 rounds should be identical at 100% crit.
        for (const round of result.rounds) {
            expect(round.totalRoundDamage).toBe(60000);
            expect(round.didCrit).toBe(true);
        }
    });

    // ── Test 2: 0% crit, 3-hit skill ────────────────────────────────────────
    // critHits=0, critFraction=0, damageCritMultiplier = 1.0
    // directDamage = 10000 * (300/100) * 1.0 = 30000
    it('0% crit 3-hit: damage = attack × multiplier × 1, didCrit false', () => {
        idCounter = 0;
        const result = simulateDPS({
            ...BASE,
            crit: 0,
            critDamage: 100,
            shipSkills: multiHitSkills(3),
        });
        expect(result.rounds[0].totalRoundDamage).toBe(30000);
        expect(result.rounds[0].didCrit).toBe(false);
        for (const round of result.rounds) {
            expect(round.totalRoundDamage).toBe(30000);
            expect(round.didCrit).toBe(false);
        }
    });

    // ── Test 3: 50% crit, 2-hit skill ───────────────────────────────────────
    // 2 crit draws per round (one per hit). NOTE: the `setRateGateRng(seq)` override below is
    // dead for this gate under SP-0 — `attacker:active-crit` now carries a
    // `${actorId}:${purpose}` stream key, and the keyed test provider (installed globally in
    // setupTests.ts) takes precedence over a bare `setRateGateRng` override whenever a key is
    // supplied. Left in place as historical intent documentation (originally forced exactly 1
    // of 2 hits critting every round); the actual per-round hit-crit counts now come from the
    // keyed `attacker:active-crit` sub-stream under the fixed test seed, which instead produces
    // all three possible per-hit outcomes across the 4 rounds (0, 1, and 2 of 2 hits critting).
    // effectiveMultiplier = 100 × 2 = 200 → preCritDamage = 10000 × 2.0 = 20000
    // damageCritMultiplier = 1 + critFraction × (100/100):
    //   0 of 2 crit (critFraction=0.0): mult=1.0 → 20000 × 1.0 = 20000
    //   1 of 2 crit (critFraction=0.5): mult=1.5 → 20000 × 1.5 = 30000
    //   2 of 2 crit (critFraction=1.0): mult=2.0 → 20000 × 2.0 = 40000
    it('50% crit 2-hit: per-round damage matches the per-round crit-hit count (0, 1, or 2 of 2)', () => {
        idCounter = 0;
        // 2 crit draws per round over 4 rounds (full trace = 8 draws).
        const seq = [0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1];
        let drawIdx = 0;
        setRateGateRng(() => {
            if (drawIdx >= seq.length) {
                throw new Error('Unexpected extra rate-gate draw');
            }
            return seq[drawIdx++];
        });
        const result = simulateDPS({
            ...BASE,
            crit: 50,
            critDamage: 100,
            shipSkills: multiHitSkills(2),
        });
        // Keyed sub-stream trace: R1 both hits crit (40000), R2 one hit crits (30000),
        // R3 neither hit crits (20000), R4 one hit crits (30000).
        expect(result.rounds.map((r) => r.totalRoundDamage)).toEqual([40000, 30000, 20000, 30000]);
        expect(result.rounds.map((r) => r.didCrit)).toEqual([true, true, false, true]);
    });

    // ── Test 4: critHits event field at 100% crit, 3-hit ────────────────────
    it('100% crit 3-hit ability-performed carries { didCrit: true, critHits: 3 }', () => {
        idCounter = 0;
        const bus = createEventBus();
        const performed: { didCrit?: boolean; critHits?: number }[] = [];
        bus.on('ability-performed', (e) => {
            performed.push({ didCrit: e.didCrit, critHits: e.critHits });
        });
        simulateDPS({
            ...BASE,
            crit: 100,
            critDamage: 100,
            shipSkills: multiHitSkills(3),
            bus,
        });
        expect(performed.length).toBeGreaterThan(0);
        for (const e of performed) {
            expect(e.didCrit).toBe(true);
            expect(e.critHits).toBe(3);
        }
    });

    // ── Test 5: on-crit fires once per ATTACK — the DPS path's interim count ─
    // Reactive charge-on-crit: +1 charge per on-crit enqueue, chargeCount 6.
    // The damage ability has 3 hits and crit=100, so this event carries critHits=3.
    //
    // MOVED BY PR7 (multi-hit full-walk epic), deliberately. Under the locked game rule the
    // on-crit listener resolves PER ATTACK, NOT PER TARGET, so it stopped looping `critHits`
    // times: `critHits` counts critting VICTIMS of ONE sub-attack on the positional path, and
    // looping it made a 4-victim AoE resolve the reaction 4 times off the whole footprint's
    // damage. One enqueue per `ability-performed` is correct there, because PR2 already emits one
    // event per SUB-ATTACK.
    //
    // This test rides the NON-POSITIONAL DPS path (`simulateDPS`), which still folds a whole
    // `hits: 3` cast into a SINGLE `ability-performed` with `critHits: 3`. So here — and only
    // here — the collapse costs the multi-hit count: 3 enqueues per turn became 1. That is the
    // known interim state PR5 closes by emitting one event per sub-attack on the DPS loop too;
    // the engine's positional path (which every non-DPS consumer uses) already fires 3 times for
    // a `hits: 3` cast, pinned by subAttackProcGates.integration.test.ts.
    //
    // Charge trace (1 on-crit enqueue per active turn):
    //   NOTATION: preTurn banks +1; drain (after cast-path banking) fires 1 on-crit intent.
    //   R1: 0+1=1, cast-path bonusCharges=0, drain +1 → 2.  RoundData: active, charges=2.
    //   R2: 2+1=3, drain +1 → 4.                            RoundData: active, charges=4.
    //   R3: 4+1=5, drain +1 → 6.                            RoundData: active, charges=6.
    //   R4: 6>=6 → charged.                                 ← firstCharged=4
    //
    // Kept (rather than deleted) as the regression pin on the DPS path's count: when PR5 lands,
    // this must go back to 3 — a silently-still-4 would mean PR5 did not reach this path.
    it('on-crit follow-up fires once per ATTACK (DPS path folds hits:3 into one event → 1 enqueue/turn)', () => {
        idCounter = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 100, hits: 3 },
                        }),
                        ab({
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-crit',
                            config: { type: 'charge', amount: 1 },
                        }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 300 } }),
                    ],
                },
            ],
        };
        // rounds: 6 so the charged round is always captured regardless of timing.
        const result = simulateDPS({ ...BASE, chargeCount: 6, rounds: 6, shipSkills: skills });
        const firstCharged = result.rounds.find((rw) => rw.action === 'charged')?.round;
        expect(firstCharged).toBeDefined();
        // 4 = one enqueue per active turn. 3 would mean the DPS path had regained the per-hit
        // count (PR5 has landed → restore the pre-PR7 expectation); 5+ would mean the on-crit
        // reaction stopped firing on this path at all.
        expect(firstCharged).toBe(4);
        expect(
            result.rounds.map((rw) => `${rw.round}:${rw.action}:${rw.charges}`)
        ).toMatchSnapshot();
    });

    // ── Test 6: single-hit 50% crit — events with didCrit carry critHits: 1 ─
    // 1 crit draw per round. NOTE: this `setRateGateRng(seq)` override is dead for this gate
    // under SP-0 — `attacker:active-crit` now carries a `${actorId}:${purpose}` stream key, and
    // the keyed test provider (installed globally in setupTests.ts) takes precedence over a
    // bare `setRateGateRng` override whenever a key is supplied. Left in place as historical
    // intent documentation (originally forced didCrit pattern false,true,false,true); the
    // actual per-round pattern now comes from the keyed `attacker:active-crit` sub-stream under
    // the fixed test seed: true,true,false,true.
    it('single-hit 50% crit: every ability-performed with didCrit=true carries critHits: 1', () => {
        idCounter = 0;
        const seq = [0.9, 0.1, 0.9, 0.1];
        let drawIdx = 0;
        setRateGateRng(() => {
            if (drawIdx >= seq.length) {
                throw new Error('Unexpected extra rate-gate draw');
            }
            return seq[drawIdx++];
        });
        const bus = createEventBus();
        const performed: { didCrit?: boolean; critHits?: number }[] = [];
        bus.on('ability-performed', (e) => {
            performed.push({ didCrit: e.didCrit, critHits: e.critHits });
        });
        simulateDPS({
            ...BASE,
            crit: 50,
            critDamage: 100,
            shipSkills: multiHitSkills(1),
            bus,
        });
        expect(performed.length).toBe(4);
        // Keyed sub-stream trace: R1 crit, R2 crit, R3 no-crit, R4 crit.
        expect(performed[0].didCrit).toBe(true);
        expect(performed[0].critHits).toBe(1);
        expect(performed[1].didCrit).toBe(true);
        expect(performed[1].critHits).toBe(1);
        expect(performed[2].didCrit).toBe(false);
        expect(performed[2].critHits).toBeUndefined();
        expect(performed[3].didCrit).toBe(true);
        expect(performed[3].critHits).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// hitCrits on PlayerTurnResult — runPlayerTurn direct tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal PlayerActorRuntime with a given crit gate (always-true or always-false)
 * and a skill with the specified hit count.
 */
function makeHitCritRuntime(skills: ShipSkills, critAlwaysFires: boolean): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 10000,
            crit: critAlwaysFires ? 100 : 0,
            critDamage: 100,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });

    // Gate: always-true → every hit crits; always-false → no hit crits.
    // Note: rateAccumulator-based gate at crit=100 fires on draw 1, so we use a simple closure.
    const alwaysFire: PlayerActorRuntime['activeCritGate'] = () => true;
    const neverFire: PlayerActorRuntime['activeCritGate'] = () => false;
    const gate = critAlwaysFires ? alwaysFire : neverFire;

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 10000,
        crit: critAlwaysFires ? 100 : 0,
        critDamage: 100,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: gate,
        chargedCritGate: gate,
        activeHealCritGate: neverFire,
        chargedHealCritGate: neverFire,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/** Build minimal PlayerTurnArgs for a standalone runPlayerTurn call. */
function makeHitCritArgs(runtime: PlayerActorRuntime): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
    });

    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);

    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
    };
}

describe('hitCrits on PlayerTurnResult', () => {
    // ── Test 7: 100% crit, 3-hit → hitCrits = [true, true, true] ─────────────
    it('100% crit 3-hit: hitCrits has length 3 and all true', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'dmg-hc1',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 3 },
                        },
                    ],
                },
            ],
        };
        const runtime = makeHitCritRuntime(skills, true);
        const result = runPlayerTurn(makeHitCritArgs(runtime));
        expect(result.hitCrits).toHaveLength(3);
        expect(result.hitCrits.every(Boolean)).toBe(true);
        // consistency: roundCrit === hitCrits.some(Boolean)
        expect(result.roundCrit).toBe(result.hitCrits.some(Boolean));
    });

    // ── Test 8: 0% crit, 3-hit → hitCrits = [false, false, false] ────────────
    it('0% crit 3-hit: hitCrits has length 3 and all false', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'dmg-hc2',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 3 },
                        },
                    ],
                },
            ],
        };
        const runtime = makeHitCritRuntime(skills, false);
        const result = runPlayerTurn(makeHitCritArgs(runtime));
        expect(result.hitCrits).toHaveLength(3);
        expect(result.hitCrits.every((v) => !v)).toBe(true);
        expect(result.roundCrit).toBe(false);
        expect(result.roundCrit).toBe(result.hitCrits.some(Boolean));
    });

    // ── Test 9: no damage ability → hitCrits = [] ────────────────────────────
    it('skill with no damage ability: hitCrits is empty array', () => {
        // A skill with only a charge ability (no damage) — no damage ability fired.
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'charge-hc1',
                            type: 'charge',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'charge', amount: 1 },
                        },
                    ],
                },
            ],
        };
        const runtime = makeHitCritRuntime(skills, true);
        const result = runPlayerTurn(makeHitCritArgs(runtime));
        expect(result.hitCrits).toEqual([]);
    });

    // ── Test 10: consistency for single-hit 100% crit ────────────────────────
    it('1-hit 100% crit: hitCrits = [true], roundCrit = true, consistency holds', () => {
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'dmg-hc3',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
            ],
        };
        const runtime = makeHitCritRuntime(skills, true);
        const result = runPlayerTurn(makeHitCritArgs(runtime));
        expect(result.hitCrits).toEqual([true]);
        expect(result.roundCrit).toBe(true);
        expect(result.roundCrit).toBe(result.hitCrits.some(Boolean));
    });
});
