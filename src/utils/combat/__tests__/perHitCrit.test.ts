/**
 * Per-hit crit checks for multi-hit skills.
 *
 * makeRateGate rule (from rateAccumulator.ts):
 *   acc starts at 0; each call: acc += rate; if acc >= 1-EPS → fire, acc -= 1.
 *   The gate is back-loaded: a 0.5-rate gate first fires on call 2, then every 2 calls.
 *
 * Key derivation for 50% crit, 2-hit skill (gate starts fresh per simulateDPS call):
 *   R1 h1: acc=0.5 (no), h2: acc=1.0 → fire, acc=0. critHits=1.
 *   R2 h1: acc=0.5 (no), h2: acc=1.0 → fire, acc=0. critHits=1.
 *   Every round: exactly 1 of 2 hits crits → critFraction=0.5 every round.
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
import { describe, expect, it } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
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
    // Gate (rate=0.5, 2 draws per round):
    //   R1: h1 acc=0.5 (no), h2 acc=1.0 → fire acc=0. critHits=1.
    //   R2: h1 acc=0.5 (no), h2 acc=1.0 → fire acc=0. critHits=1.
    //   ...same every round. critFraction=0.5 always, didCrit=true always.
    // effectiveMultiplier = 100 × 2 = 200 → preCritDamage = 10000 × 2.0 = 20000
    // critFraction=0.5 → damageCritMultiplier = 1 + 0.5 × (100/100) = 1.5
    // directDamage = 20000 * 1.5 = 30000
    it('50% crit 2-hit: every round has exactly 1 of 2 critting → constant damage', () => {
        idCounter = 0;
        const result = simulateDPS({
            ...BASE,
            crit: 50,
            critDamage: 100,
            shipSkills: multiHitSkills(2),
        });
        // Every round: critHits=1, critFraction=0.5, mult=1.5 → 20000*1.5 = 30000
        for (const round of result.rounds) {
            expect(round.totalRoundDamage).toBe(30000);
            expect(round.didCrit).toBe(true);
        }
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

    // ── Test 5: on-crit triggers fire once PER CRITTING HIT ─────────────────
    // Reactive charge-on-crit: +1 charge per crit event, chargeCount 6.
    // The damage ability has 3 hits and crit=100, so critHits=3 every active turn.
    //
    // Charge trace (WITH FIX — 3 on-crit enqueues per active turn):
    //   NOTATION: preTurn banks +1; drain (after cast-path banking) fires 3 on-crit intents.
    //   R1 preTurn: 0+1=1. Cast-path banking: bonusCharges=0 (charge ability is reactive/
    //     partitioned out), charges=min(1+0,6)=1. Drain: +1+1+1=4. RoundData: active, charges=4.
    //   R2 preTurn: 4+1=5. Cast-path: min(5+0,6)=5. Drain: +1→6, +1→cap 6, +1→cap 6. RoundData: active, charges=6.
    //   R3 preTurn: 6>=6 → charged, charges=0. RoundData: charged, charges=0.  ← firstCharged=3
    //
    // Pre-fix (1 on-crit enqueue regardless of critHits):
    //   R1: 0+1=1 drain→+1=2. R2: 2+1=3 drain→+1=4. R3: 4+1=5 drain→+1=6. R4: charged. ← firstCharged=4
    //
    // Assertion: firstCharged < 4 → fails pre-fix (4 not < 4), passes post-fix (3 < 4).
    it('on-crit follow-up fires once PER CRITTING HIT (3-hit @100% crit → 3 enqueues/turn)', () => {
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
        // Post-fix: firstCharged=3 (< 4). Pre-fix: firstCharged=4 (not < 4 → FAIL).
        expect(firstCharged!).toBeLessThan(4);
        expect(firstCharged).toBe(3);
        expect(
            result.rounds.map((rw) => `${rw.round}:${rw.action}:${rw.charges}`)
        ).toMatchSnapshot();
    });

    // ── Test 6: single-hit 50% crit — events with didCrit carry critHits: 1 ─
    // (existing test — unchanged)
    // Gate (rate=0.5, 1 draw per round):
    //   R1: acc=0.5 (no) → didCrit=false
    //   R2: acc=1.0 → fire, acc=0 → didCrit=true, critHits=1
    //   R3: acc=0.5 (no) → didCrit=false
    //   R4: acc=1.0 → fire, acc=0 → didCrit=true, critHits=1
    it('single-hit 50% crit: every ability-performed with didCrit=true carries critHits: 1', () => {
        idCounter = 0;
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
        // R1: didCrit=false (acc=0.5, no fire), R2: didCrit=true, R3: false, R4: true
        expect(performed[0].didCrit).toBe(false);
        expect(performed[0].critHits).toBeUndefined();
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
        debuffLandingChance: 1,
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
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        enemyHpDecline: 0,
    };
}

describe('hitCrits on PlayerTurnResult', () => {
    // ── Test 7: 100% crit, 3-hit → hitCrits = [true, true, true] ─────────────
    it('100% crit 3-hit: hitCrits has length 3 and all true', () => {
        idCounter = 0;
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
        idCounter = 0;
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
        idCounter = 0;
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
        idCounter = 0;
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
