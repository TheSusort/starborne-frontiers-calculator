/**
 * A reactive damage proc reads its owner's own passive `outgoingDamage` modifiers
 * (`reactiveOutgoingModifiersOf`), each subject live at the hit. Judge's start-of-round hit
 * carries his "20% more direct damage for each destroyed enemy": the owner's Mamma fight (#519)
 * measured it at 27,943, which the replay test pins; this fixture separates the ENEMY kill count
 * from the owner's own side's losses, which that fight cannot (both were 2 by round 5).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `lcs${++idc}`,
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
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** An inert enemy: no skills, no attack, so it only ever contributes its POSITION (and, in the
 *  kill-count suite, its death). Speed 1 keeps it behind the focus actor in turn order. */
const enemyAt = (id: string, position: Position, hp = 1_000_000_000): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** Judge-shape kit: a plain active hit, a start-of-round passive hit, and the destroyed-enemy
 *  ramp as a passive self modifier (value 0, the whole bonus in `scaling`), as the parser emits. */
const judgeKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'damage',
                    trigger: 'start-of-round',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'modifier',
                    target: 'self',
                    conditions: [{ subject: 'enemy-destroyed', derivable: false }],
                    config: {
                        type: 'modifier',
                        channel: 'outgoingDamage',
                        value: 0,
                        isMultiplicative: true,
                    },
                    scaling: { conditionIndex: 0, perUnit: 20, cap: 100 },
                }),
            ],
        },
    ],
});

const engineBase = (
    shipSkills: ShipSkills,
    enemyAttackers: EnemyAttacker[],
    over: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    speed: 100, // acts first, before any (speed-1) enemy
    enemyAttackers,
    ...over,
});

/** The focus actor's start-of-round proc damage, per round. */
const startOfRoundHits = (input: CombatEngineInput): Map<number, number> => {
    const bus = createEventBus();
    const hits = new Map<number, number>();
    bus.on('reactive-damage-performed', (e) => {
        const ev = e;
        if (ev.sourceId === 'attacker') hits.set(ev.round, (hits.get(ev.round) ?? 0) + ev.amount);
    });
    runCombat({ ...input, bus });
    return hits;
};

describe("a reactive proc reads its owner's destroyed-enemy bonus", () => {
    it('counts the enemies destroyed so far, not its own side’s losses', () => {
        idc = 0;
        // Round 1: nothing dead at round start, so the proc is the base 10,000; the active then
        // kills the 1-HP enemy. Round 2: one enemy destroyed, none of the owner's side → +20%.
        const hits = startOfRoundHits(
            engineBase(judgeKit(), [enemyAt('a', 'M4', 1), enemyAt('b', 'M3')], { numRounds: 2 })
        );
        expect(hits.get(1)).toBe(10_000);
        expect(hits.get(2)).toBe(12_000);
    });
});
