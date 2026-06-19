import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// C2a Task 3: cast-path PURGE removes an enemy's self-buffs (enemy side).
//
// Positional two-team battle-sim harness (mirrors twoTeamBattle.test.ts —
// healTargetId MUST be set, which unlocks the enemy roster; the focus needs a
// position + parsed target so selectTurnTarget resolves the REAL enemy id as
// `targetId`, not the dummy `enemy` sink). The enemy attacker carries an active
// skill that applies a removable self-buff ("Attack Up", duration 99) to
// ITSELF every round; the player focus's ACTIVE skill purges enemy buffs while
// also firing a basic hit at the enemy (positional, so targetId resolves to the
// real enemy).
//
// Observed directly off the enemy's self-buff store via
// statusEngine.timedAbilityStatuses('self', enemyId) (= selfMaps.get(enemyId)),
// read after the run settles through the __testTapStatusEngine tap. With no
// purger the enemy keeps Attack Up; with a purger it is removed.
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pp${++idc}`,
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

describe('C2a Task 3: cast-path purge removes enemy self-buffs', () => {
    // The enemy's removable self-buff applied on its active each round.
    const attackUp = (): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // The enemy attacker (positioned 'front', fires the focus): buffs itself then hits.
    const buffingEnemy = () => ({
        id: 'enemy-front',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active' as const, abilities: [attackUp(), hit()] }] },
    });

    // Player focus skill: either a purge active (with a basic hit so it fires positionally) or
    // a plain hit-only active (the control).
    const focusSkills = (purge: boolean): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: purge
                    ? [
                          ab({
                              type: 'purge',
                              target: 'enemy',
                              config: { type: 'purge', count: 5 },
                          }),
                          hit(),
                      ]
                    : [hit()],
            },
        ],
    });

    const BASE = (purge: boolean): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(purge),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 3,
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
        hp: 1_000_000_000, // focus immortal so the battle runs all rounds
        // Healing mode + position + target unlock the enemy roster and positional targeting.
        healTargetId: 'attacker',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [buffingEnemy()],
    });

    const finalEnemySelfBuffs = (purge: boolean): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(purge),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // selfMaps.get('enemy-front') — the enemy's own buff store (the purge target).
        return engine!.timedAbilityStatuses('self', 'enemy-front').map((b) => b.active.buffName);
    };

    it('CONTROL (no purger): the enemy keeps its self-buff after the run', () => {
        expect(finalEnemySelfBuffs(false)).toEqual(['Attack Up']);
    });

    it('an active-skill purge removes the enemy self-buff (gone from the enemy store)', () => {
        expect(finalEnemySelfBuffs(true)).toEqual([]);
    });
});
