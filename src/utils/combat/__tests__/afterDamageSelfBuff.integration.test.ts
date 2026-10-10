/**
 * A skill's clauses resolve in the order they are written, for the caster's OWN side too: a
 * self/ally buff written after the damage clause lands after that cast's hit, so it boosts only
 * later hits (owner ruling, Thresh: "deals 300% damage. After targeting a defender, this Unit gains
 * Crit Power Up II" never boosts the triggering hit).
 *
 * Real parsed kits; attack 1000, crit 100, crit power 50, defence 0, Pattern-Base, so a hit is
 * exactly attack × multiplier × 1.5 (× 1.8 under Crit Power Up II).
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Slot = 'active' | 'charged';

/** The named firing slots of a real kit (no passive). */
const realKit = (ship: string, ...slots: Slot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const kit = buildShipAbilities(built);
    return {
        slots: slots.map((slot) => {
            const found = kit.slots.find((s) => s.slot === slot);
            if (!found) throw new Error(`${ship} has no ${slot} slot`);
            return { slot, abilities: found.abilities };
        }),
    };
};

const ATTACK = 1000;

const inertEnemy = (id: string, position: Position, role?: ShipTypeName): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    ...(role ? { role } : {}),
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: ATTACK,
    crit: 100,
    critDamage: 50,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1e9,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** `casterId`'s direct damage per round. */
const damageByRound = (input: CombatEngineInput, casterId: string): Record<number, number> => {
    const bus = createEventBus();
    const out: Record<number, number> = {};
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== casterId || e.damage === undefined) return;
        out[e.round] = (out[e.round] ?? 0) + e.damage;
    });
    runCombat({ ...input, bus });
    for (const k of Object.keys(out)) out[Number(k)] = Math.round(out[Number(k)]);
    return out;
};

beforeEach(() => {
    setupKeyedRng(13);
});

describe('a buff written after the damage clause boosts only later hits', () => {
    // Round 1 charged: 300% × 1.5 = 4500 (Crit Power Up II lands after it). Round 2 active:
    // Attack Up III (+45%, written first) and Crit Power Up II from round 1:
    // 240% × 1.45 × 1.8 = 6264.
    it('Thresh vs a defender: charged 4500, then the active carries Crit Power Up II (6264)', () => {
        const out = damageByRound(
            base({
                shipSkills: realKit('Thresh', 'active', 'charged'),
                chargeCount: 2,
                hasChargedSkill: true,
                startCharged: true,
                numRounds: 2,
                enemyAttackers: [inertEnemy('enemy-a', 'M4', 'DEFENDER')],
            }),
            'attacker'
        );
        expect(out).toEqual({ 1: 4500, 2: 6264 });
    });

    it('enemy Thresh vs a defender focus: the same 4500 then 6264', () => {
        const out = damageByRound(
            base({
                attack: 0,
                speed: 150,
                role: 'DEFENDER',
                numRounds: 2,
                enemyAttackers: [
                    {
                        id: 'enemy-thresh',
                        stats: {
                            attack: ATTACK,
                            crit: 100,
                            critDamage: 50,
                            defence: 0,
                            hp: 1e9,
                            speed: 10,
                            security: 0,
                            hacking: 0,
                        },
                        chargeCount: 2,
                        startCharged: true,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        shipSkills: realKit('Thresh', 'active', 'charged'),
                    },
                ],
            }),
            'enemy-thresh'
        );
        expect(out).toEqual({ 1: 4500, 2: 6264 });
    });

    it('DPS calculator, Enemy Type Defender: Thresh charged deals 4500', () => {
        const result = simulateDPS({
            attack: ATTACK,
            crit: 100,
            critDamage: 50,
            defensePenetration: 0,
            chargeCount: 1,
            startCharged: true,
            enemyDefense: 0,
            enemyHp: 1e9,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 0,
            enemySecurity: 0,
            enemyType: 'Defender',
            shipSkills: realKit('Thresh', 'charged'),
        });
        expect(result.rounds[0].directDamage).toBe(4500);
    });

    it('Tormenter active: Out. Damage Up I to itself lands after the guaranteed crit (2400)', () => {
        const out = damageByRound(
            // Crit 100 stands in for his passive's "attacks always critically hit".
            base({
                shipSkills: realKit('Tormenter', 'active'),
                enemyAttackers: [inertEnemy('enemy-a', 'M4')],
            }),
            'attacker'
        );
        expect(out).toEqual({ 1: 2400 });
    });

    it('Lev charged: the all-allies Crit Power Up II lands after the hit (3450)', () => {
        const out = damageByRound(
            base({
                shipSkills: realKit('Lev', 'charged'),
                chargeCount: 1,
                hasChargedSkill: true,
                startCharged: true,
                enemyAttackers: [inertEnemy('enemy-a', 'M4')],
            }),
            'attacker'
        );
        expect(out).toEqual({ 1: 3450 });
    });

    it('a buff written BEFORE the damage still boosts it: Thresh active alone, Attack Up III (5220)', () => {
        const out = damageByRound(
            base({
                shipSkills: realKit('Thresh', 'active'),
                enemyAttackers: [inertEnemy('enemy-a', 'M4', 'ATTACKER')],
            }),
            'attacker'
        );
        // 240% × 1.45 × 1.5
        expect(out).toEqual({ 1: 5220 });
    });
});
