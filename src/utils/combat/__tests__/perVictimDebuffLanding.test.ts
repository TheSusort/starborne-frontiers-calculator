/**
 * SP2b: per-victim debuff landing + apply on AoE footprint.
 * - 'all-enemies' inflict: independent hacking roll per footprint victim
 * - 'all-enemies' apply: independent affinity check per footprint victim
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { AffinityName } from '../../../types/ship';
import { resetRateGateRng } from '../../calculators/rateAccumulator';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvdl${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const lineRange3Pattern = (): ParsedPattern => ({
    raw: 'line-range-3',
    shape: 'line',
    range: 3,
    modifiers: {},
});

const basicEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    opts: { security?: number; affinity?: AffinityName } = {}
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 1,
            security: opts.security,
        },
        affinity: opts.affinity,
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: lineRange3Pattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

const runPositionalRound = (shipSkills: ShipSkills, enemyAttackers: EnemyAttacker[]) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('debuff-applied', (e) => events.push(e));
    bus.on('debuff-resisted', (e) => events.push(e));
    runCombat({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills,
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
        affinity: 'chemical',
        defence: 0,
        hp: 10_000_000,
        hacking: 200,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: lineRange3Pattern(),
        enemyAttackers,
        bus,
    });
    return events.filter((e) => e.type === 'debuff-applied' || e.type === 'debuff-resisted');
};

describe('SP2b — per-victim debuff landing on footprint', () => {
    afterEach(() => resetRateGateRng());

    it("'all-enemies' inflict debuff: independent hacking roll per footprint victim", () => {
        idc = 0;
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        ab({
                            type: 'debuff',
                            target: 'all-enemies',
                            config: {
                                type: 'debuff',
                                buffName: 'Disable',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 2,
                            },
                        }),
                    ],
                },
            ],
        };

        const events = runPositionalRound(shipSkills, [
            basicEnemyAt('enemy-front', 'M4', 'front', { security: 100 }),
            basicEnemyAt('enemy-back', 'M1', 'back', { security: 250 }),
        ]);

        const applied = events.filter((e) => e.type === 'debuff-applied');
        const resisted = events.filter((e) => e.type === 'debuff-resisted');

        expect(applied.map((e) => e.targetId)).toEqual(['enemy-front']);
        expect(resisted.map((e) => e.targetId)).toEqual(['enemy-back']);
    });

    it("'all-enemies' apply debuff: independent affinity check per footprint victim", () => {
        idc = 0;
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        ab({
                            type: 'debuff',
                            target: 'all-enemies',
                            config: {
                                type: 'debuff',
                                buffName: 'Defense Down',
                                parsedEffects: { defense: -50 },
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        };

        const events = runPositionalRound(shipSkills, [
            // chemical attacker vs thermal front → disadvantage; vs chemical back → neutral
            basicEnemyAt('enemy-front', 'M4', 'front', { affinity: 'thermal' }),
            basicEnemyAt('enemy-back', 'M1', 'back', { affinity: 'chemical' }),
        ]);

        const applied = events.filter((e) => e.type === 'debuff-applied');
        const resisted = events.filter((e) => e.type === 'debuff-resisted');

        expect(applied.map((e) => e.targetId)).toEqual(['enemy-back']);
        expect(resisted.map((e) => e.targetId)).toEqual(['enemy-front']);
    });
});
