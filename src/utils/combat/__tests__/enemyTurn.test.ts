import { describe, it, expect } from 'vitest';
import { runEnemyAttackerTurn, EnemyAttackerRuntime } from '../enemyTurn';
import { createActor } from '../state';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const enemyActor = (
    stats: { attack: number; crit: number; critDamage: number; speed: number },
    extra: { chargeCount?: number; startCharged?: boolean } = {}
) =>
    createActor({
        id: 'attacker-1',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: stats.attack,
            crit: stats.crit,
            critDamage: stats.critDamage,
            defensePenetration: 0,
            defence: 0,
            hp: 0,
            speed: stats.speed,
        },
        chargeCount: extra.chargeCount ?? 0,
        startCharged: extra.startCharged ?? false,
    });

const manualRuntime = (
    stats: { attack: number; crit: number; critDamage: number; speed: number },
    extra: {
        chargeCount?: number;
        startCharged?: boolean;
        hasChargedSkill?: boolean;
    } = {}
): EnemyAttackerRuntime => ({
    actor: enemyActor(stats, extra),
    castSkills: undefined,
    hasChargedSkill: extra.hasChargedSkill ?? false,
    activeCritGate: makeRateGate(),
    chargedCritGate: makeRateGate(),
});

const walkRuntime = (
    stats: { attack: number; crit: number; critDamage: number; speed: number },
    castSkills: ShipSkills,
    extra: {
        chargeCount?: number;
        startCharged?: boolean;
        hasChargedSkill?: boolean;
    } = {}
): EnemyAttackerRuntime => ({
    actor: enemyActor(stats, extra),
    castSkills,
    hasChargedSkill: extra.hasChargedSkill ?? false,
    activeCritGate: makeRateGate(),
    chargedCritGate: makeRateGate(),
});

describe('runEnemyAttackerTurn — manual flat card', () => {
    it('manual: one hit at 100% × (1 − reduction); matches calculateDamageReduction', () => {
        idCounter = 0;
        const runtime = manualRuntime({ attack: 5000, crit: 0, critDamage: 0, speed: 50 });
        const res = runEnemyAttackerTurn({ runtime, targetDefence: 2000, targetDead: false });
        // attack 5000 × (100×1/100) × critMult 1 × (1 − dr(2000)/100)
        const expected = 5000 * (1 - calculateDamageReduction(2000) / 100);
        expect(res.action).toBe('active');
        expect(res.damage).toBeCloseTo(expected, 6);
        expect(res.damage).toBeCloseTo(3186.4464026358046, 6);
    });

    it('zero target defence → no reduction', () => {
        idCounter = 0;
        const runtime = manualRuntime({ attack: 5000, crit: 0, critDamage: 0, speed: 50 });
        const res = runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: false });
        expect(res.damage).toBeCloseTo(5000, 6);
    });

    it('dead target → damage 0 (cadence still resolves the action)', () => {
        idCounter = 0;
        const runtime = manualRuntime({ attack: 5000, crit: 0, critDamage: 0, speed: 50 });
        const res = runEnemyAttackerTurn({ runtime, targetDefence: 2000, targetDead: true });
        expect(res.damage).toBe(0);
        expect(res.action).toBe('active');
    });
});

describe('runEnemyAttackerTurn — crit gate schedule', () => {
    it('crit 50 (back-loaded): crits on draws 2, 4, ...', () => {
        idCounter = 0;
        const runtime = manualRuntime({ attack: 1000, crit: 50, critDamage: 100, speed: 50 });
        // No reduction; base = 1000. crit draw fires on every 2nd turn (rate 0.5 back-loaded).
        // critMult on a crit = 1 + (1/1) × (100/100) = 2 → damage 2000; non-crit = 1000.
        const dmgs: number[] = [];
        for (let i = 0; i < 4; i++) {
            dmgs.push(
                runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: false }).damage
            );
        }
        expect(dmgs).toEqual([1000, 2000, 1000, 2000]);
    });
});

describe('runEnemyAttackerTurn — charge cadence', () => {
    it('chargeCount 3, startCharged false → charged on turn 4', () => {
        idCounter = 0;
        // Ship-backed enemy: active slot mult 100, charged slot mult 400.
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 400 } }),
                    ],
                },
            ],
        };
        const runtime = walkRuntime({ attack: 1000, crit: 0, critDamage: 0, speed: 50 }, skills, {
            chargeCount: 3,
            startCharged: false,
            hasChargedSkill: true,
        });
        const actions: string[] = [];
        const dmgs: number[] = [];
        for (let i = 0; i < 5; i++) {
            const r = runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: false });
            actions.push(r.action);
            dmgs.push(r.damage);
        }
        // charges: t1 0→1, t2 1→2, t3 2→3, t4 fires (charged, reset to 0), t5 0→1.
        expect(actions).toEqual(['active', 'active', 'active', 'charged', 'active']);
        // active = 1000 × 100% = 1000; charged = 1000 × 400% = 4000.
        expect(dmgs).toEqual([1000, 1000, 1000, 4000, 1000]);
    });

    it('cadence advances even vs a dead target (charges keep banking)', () => {
        idCounter = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 400 } }),
                    ],
                },
            ],
        };
        const runtime = walkRuntime({ attack: 1000, crit: 0, critDamage: 0, speed: 50 }, skills, {
            chargeCount: 2,
            startCharged: false,
            hasChargedSkill: true,
        });
        const actions: string[] = [];
        for (let i = 0; i < 3; i++) {
            const r = runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: true });
            actions.push(r.action);
            expect(r.damage).toBe(0); // dead → 0 damage every turn
        }
        // t1 active (0→1), t2 active (1→2), t3 charged (fires). Cadence advanced despite dead.
        expect(actions).toEqual(['active', 'active', 'charged']);
    });
});

describe('runEnemyAttackerTurn — walk multi-hit per-hit crits', () => {
    it('3 hits, crit 100 → blended × (1 + cd/100)', () => {
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
                    ],
                },
            ],
        };
        const runtime = walkRuntime({ attack: 1000, crit: 100, critDamage: 50, speed: 50 }, skills);
        const res = runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: false });
        // 3 hits all crit (crit 100): critMult = 1 + (3/3) × (50/100) = 1.5.
        // damage = 1000 × (100 × 3 / 100) × 1.5 = 1000 × 3 × 1.5 = 4500.
        expect(res.damage).toBeCloseTo(4500, 6);
    });

    it('noCrit walk: no crit draws even at crit 100', () => {
        idCounter = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 200, noCrit: true },
                        }),
                    ],
                },
            ],
        };
        const runtime = walkRuntime(
            { attack: 1000, crit: 100, critDamage: 100, speed: 50 },
            skills
        );
        const res = runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: false });
        // noCrit → critMult 1. damage = 1000 × (200 × 1 / 100) × 1 = 2000.
        expect(res.damage).toBeCloseTo(2000, 6);
    });
});

describe('runEnemyAttackerTurn — walked charged nuke', () => {
    it('charged slot multiplier 400 → spike on charged turns', () => {
        idCounter = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
                {
                    slot: 'charged',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 400 } }),
                    ],
                },
            ],
        };
        const runtime = walkRuntime({ attack: 2000, crit: 0, critDamage: 0, speed: 50 }, skills, {
            chargeCount: 1,
            startCharged: false,
            hasChargedSkill: true,
        });
        // chargeCount 1: t1 charges 0→1, t2 fires charged. Pattern active, charged, active, charged.
        const dmgs: number[] = [];
        for (let i = 0; i < 4; i++) {
            dmgs.push(
                runEnemyAttackerTurn({ runtime, targetDefence: 0, targetDead: false }).damage
            );
        }
        // active = 2000 × 100% = 2000; charged = 2000 × 400% = 8000.
        expect(dmgs).toEqual([2000, 8000, 2000, 8000]);
    });
});

describe('runEnemyAttackerTurn — walked slot without a damage ability', () => {
    it('a walked active slot with no damage ability → 0 damage', () => {
        idCounter = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    // A buff-only slot: no damage ability → multiplier 0.
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Whatever',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                            },
                        }),
                    ],
                },
            ],
        };
        const runtime = walkRuntime({ attack: 5000, crit: 0, critDamage: 0, speed: 50 }, skills);
        const res = runEnemyAttackerTurn({ runtime, targetDefence: 2000, targetDead: false });
        expect(res.damage).toBe(0);
        expect(res.action).toBe('active');
    });
});
