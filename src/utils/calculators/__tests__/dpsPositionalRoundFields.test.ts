/**
 * The DPS display fields on a REAL-ENEMY (positional) run. Every one of these was silently zeroed
 * or de-integered by the positional path while the suite stayed green — the defect class #324's
 * `teamDamage` regression belongs to. Each assertion here drives a real `simulateDPS` run: a
 * hand-built `RoundData` literal stays green through the whole class.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, type DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import type { ShipSkills } from '../../../types/abilities';

export const REAL_ENEMY_ID = 'enemy-1';

const damageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

/** A focus that also applies corrosion, so the Direct-by-subtraction path is not vacuous. */
const dotKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ...damageKit().slots[0].abilities,
                {
                    id: 'a2',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 3 },
                },
            ],
        },
    ],
});

export const baseInput = (over: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageKit(),
    enemyDefense: 1000,
    enemyHp: 5_000_000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    defence: 0,
    hp: 1_000_000,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    hacking: 500,
    enemySecurity: 0,
    ...over,
});

/** The page's shape: an explicitly-supplied real, positioned enemy. */
export const realEnemyInput = (over: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    ...baseInput(over),
    enemyAttackers: [
        {
            id: REAL_ENEMY_ID,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                speed: 50,
                defence: 1000,
                hp: 5_000_000,
                security: 100,
            },
            chargeCount: 0,
            startCharged: false,
        },
    ],
});

describe('re-derived round totals keep the integer contract', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('writes integer totalRoundDamage / cumulativeDamage on a real-enemy run', () => {
        const { rounds } = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));

        expect(rounds.length).toBeGreaterThan(0);
        for (const r of rounds) {
            expect(Number.isInteger(r.totalRoundDamage)).toBe(true);
            expect(Number.isInteger(r.cumulativeDamage)).toBe(true);
            // PRESENCE, not just shape: a zeroed field is an integer too.
            expect(r.totalRoundDamage).toBeGreaterThan(0);
        }
    });

    it('ends the last round on exactly the summary total', () => {
        const { rounds, summary } = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));
        expect(rounds[rounds.length - 1].cumulativeDamage).toBe(summary.totalDamage);
    });
});

describe('the Direct damage row on a positional run', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('reports the focus firing damage, not 0', () => {
        const { rounds, summary } = simulateDPS(realEnemyInput());

        for (const r of rounds) {
            expect(r.directDamage).toBeGreaterThan(0);
            expect(Number.isInteger(r.directDamage)).toBe(true);
        }
        expect(summary.totalDirectDamage).toBeGreaterThan(0);
    });

    it('excludes the DoT component instead of double-counting it', () => {
        // dotKit lands corrosion, so `perTargetDealt` carries direct + ticks. Direct must be the
        // REMAINDER — reading `dealt` straight would report the ticks twice (once as Direct, once
        // as Corr) and the four tooltip rows would no longer sum to the round total.
        const { rounds } = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));

        const withDot = rounds.filter((r) => r.corrosionDamage > 0);
        expect(withDot.length).toBeGreaterThan(0); // the fixture is not vacuous

        for (const r of rounds) {
            const parts =
                r.directDamage +
                r.corrosionDamage +
                r.infernoDamage +
                (r.genericDamage ?? 0) +
                r.detonationDamage;
            // Each part is rounded independently, so allow the accumulated half-unit drift only.
            expect(Math.abs(parts - r.totalRoundDamage)).toBeLessThanOrEqual(2);
            expect(r.directDamage).toBeLessThan(r.totalRoundDamage);
            expect(r.directDamage).toBeGreaterThan(0);
        }
    });

    it('leaves a scalar-path run untouched', () => {
        // No enemyAttackers → the engine's own scalar credit still fills the row. Until Task 6
        // lands, this is the fence that proves the re-derivation only touches the positional path.
        const { rounds } = simulateDPS(baseInput());
        for (const r of rounds) expect(r.directDamage).toBeGreaterThan(0);
    });
});
