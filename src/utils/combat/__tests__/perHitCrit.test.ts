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
import { createEventBus } from '../events';
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

    // ── Test 5: single-hit 50% crit — events with didCrit carry critHits: 1 ─
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
