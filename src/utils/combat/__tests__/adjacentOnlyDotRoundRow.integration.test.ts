/**
 * A cast whose only DoT is aimed at the primary's NEIGHBOURS ("inflicts Corrosion on all adjacent
 * enemies") never rolls that DoT against the primary, so the primary's round row must not report
 * it resisted. `dotsLanded` is decided over the DoTs that can land on the primary
 * (`rollsOnPrimary`); with none, nothing was resisted there.
 *
 * Hand-built kit — no corpus ship carries an adjacent-only DoT clause (Asphyxiator's active Inferno
 * reaches "the targeted enemy and all adjacent enemies", the primary included). Hacking dwarfs every
 * security, so the neighbour's Corrosion lands. Both sides: a player caster (the focus round row),
 * and an enemy caster (its enemy-effects entry on the player heal target).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeEach(() => {
    setupKeyedRng(34);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const ADJACENT_CORROSION: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 10 },
                },
                {
                    id: 'adjacent-corrosion',
                    type: 'dot',
                    target: 'adjacent-enemies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 3 },
                },
            ],
        },
    ],
};
const EMPTY: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HP = 1e9;

const harmlessEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: EMPTY,
});
const harmlessAlly = (id: string, position: Position): TeamActor => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: EMPTY,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
            security: 0,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: EMPTY,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: true,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** Targets of the caster's round-1 Corrosion `dot-applied` and `debuff-resisted` events. */
const watch = (casterId: string) => {
    const bus = createEventBus();
    const landed: string[] = [];
    const resisted: string[] = [];
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.sourceId === casterId && e.round === 1) landed.push(e.targetId);
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (e.sourceId === casterId && e.round === 1) resisted.push(e.targetId);
    });
    return { bus, landed, resisted };
};

describe('an adjacent-only DoT is never reported resisted on the primary', () => {
    it('player: the focus round row reports its DoTs landed', () => {
        const w = watch('attacker');
        const { rounds } = runCombat({
            ...base({
                shipSkills: ADJACENT_CORROSION,
                enemyAttackers: [harmlessEnemy('enemy-a', 'M4'), harmlessEnemy('enemy-b', 'M3')],
            }),
            bus: w.bus,
        });
        // The neighbour took the Corrosion; the primary was never rolled against.
        expect(w.landed).toEqual(['enemy-b']);
        expect(w.resisted).toEqual([]);
        expect(rounds[0].dotsLanded).toBe(true);
    });

    it('enemy-side: the caster’s enemy-effects entry lists no resisted DoT', () => {
        const w = watch('enemy-caster');
        const { healing } = runCombat({
            ...base({
                attack: 0,
                hacking: 0,
                speed: 10,
                healTargetId: 'attacker',
                teamActors: [harmlessAlly('ally-b', 'M3')],
                enemyAttackers: [
                    {
                        id: 'enemy-caster',
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: HP,
                            speed: 100,
                            security: 0,
                            hacking: 1e6,
                        },
                        chargeCount: 9,
                        startCharged: false,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        shipSkills: ADJACENT_CORROSION,
                    },
                ],
            }),
            bus: w.bus,
        });
        expect(w.landed).toEqual(['ally-b']);
        expect(w.resisted).toEqual([]);
        const entry = healing?.rounds[0].enemyEffects.find((e) => e.enemyId === 'enemy-caster');
        // An entry is recorded only for an enemy with something to show; this caster lands no
        // named debuff, so a resisted DoT is the only thing that could create one.
        expect(entry?.resistedDots ?? []).toEqual([]);
    });
});
