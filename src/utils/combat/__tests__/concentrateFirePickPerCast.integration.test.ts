/**
 * With several enemies carrying Concentrate Fire, an ally's single-target cast picks ONE of them
 * at random and every part of the cast follows that pick: the damage lands on the enemy the
 * cast's debuff is built around, never on a second carrier drawn separately for the hit.
 *
 * Two enemies carry a hand-applied Concentrate Fire mark; the third does not.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { StatusEngine } from '../statusEngine';
import type { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HP = 10_000_000;
const MARKER = 'Target Marker';

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const damage = (): Ability => ({
    id: 'dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});
const marker = (): Ability => ({
    id: 'marker',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: MARKER,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 99,
    },
});
/** Hand-applied Concentrate Fire on `targetId` (a timed enemy-side debuff, as an ally's skill lands it). */
const markConcentrated = (engine: StatusEngine, targetId: string): void => {
    engine.applyTimedAbilityStatus(
        1,
        {
            payload: { buffName: 'Concentrate Fire', stacks: 1, parsedEffects: {} },
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            casterId: 'attacker',
            kind: 'timed',
            duration: 99,
        },
        undefined,
        targetId
    );
};

const idle = (id: string, position: Position, attack: number, speed: number): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: HP, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const input = (): CombatEngineInput => ({
    enemyAttackers: [
        idle('enemy-a', 'M4', 10, 1000),
        idle('enemy-b', 'M3', 0, 2000),
        idle('enemy-c', 'M1', 0, 500),
    ],
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [marker(), damage()] }],
    },
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
    defence: 0,
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    speed: 1,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
});

/** Who the cast's marker debuff landed on, and who took the damage. */
const castOnce = (seed: number): { marked: string[]; damaged: string[] } => {
    setupKeyedRng(seed);
    const bus = createEventBus();
    const marked: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.buffName === MARKER && e.round === 1) marked.push(e.targetId);
    });
    let engine: StatusEngine | undefined;
    bus.on('round-started', () => {
        markConcentrated(engine!, 'enemy-a');
        markConcentrated(engine!, 'enemy-b');
    });
    const result = runCombat({
        ...input(),
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    const per = result.rounds.find((r) => r.round === 1)?.perTargetDamage ?? {};
    return { marked, damaged: Object.keys(per).filter((k) => (per[k] ?? 0) > 0) };
};

describe('one Concentrate Fire pick per cast', () => {
    const runs = Array.from({ length: 40 }, (_, i) => castOnce(i + 1));

    it('the debuffed enemy is the damaged enemy on every seed', () => {
        for (const r of runs) {
            expect(r.marked).toHaveLength(1);
            expect(r.damaged).toEqual(r.marked);
        }
    });

    it('more than one carrier gets picked across seeds', () => {
        const picked = new Set(runs.flatMap((r) => r.marked));
        expect(picked.size).toBeGreaterThan(1);
    });
});
