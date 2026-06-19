/**
 * B1 Task 3 — Per-victim ability-debuff routing test.
 *
 * Verifies that after Edit A (targetId threaded for player→enemy in buildTurnArgs),
 * a player's ability-sourced enemy debuff routes to the SPECIFIC enemy targeted
 * (not leaked to __enemy__ / not spread to all enemies).
 *
 * Setup: 1-player focus at M4 (targeting 'front') vs 2 positioned enemies.
 *   - enemy-front at M4 (selection='front' anchor — matches front-most position)
 *   - enemy-back at M1 (selection='back')
 *   Focus fires an active slot with a 'debuff' ability (Defense Down, defense:-50, timed).
 *   `application: 'apply'` → always lands (affinity gate, no affinity disadvantage).
 *
 * Assertion (via __testTapVictimEnemyModifiers):
 *   - victimEnemyModifiers('enemy-front') = { enemyDefenseModifier: -50, incomingDamageModifier: 0 }
 *     (ability debuff routed to front's per-victim store via targetId)
 *   - victimEnemyModifiers('enemy-back')  = { enemyDefenseModifier: 0,   incomingDamageModifier: 0 }
 *     (debuff did NOT bleed to back's store)
 *
 * Damage-number assertions are Task 4 scope — here we assert the per-victim READ only.
 * Healing mode (healTargetId) is required to unlock the positioned enemy roster.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvd${++idc}`,
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

// Active slot: single-hit damage + timed Defense Down debuff (application='apply' → always lands).
const damageWithDefenseDownSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
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
});

// Minimal passive enemy: no abilities that apply debuffs, so enemy turns do not muddy the stores.
const basicEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 10_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
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

describe('B1 Task 3 — per-victim ability-debuff routing (perVictimDebuffRouting)', () => {
    it('ability Defense Down routes to front enemy only (not leaked to back enemy)', () => {
        idc = 0;
        let captured:
            | ((victimId: string) => {
                  enemyDefenseModifier: number;
                  incomingDamageModifier: number;
              })
            | undefined;

        runCombat({
            // Focus player at M4, fires 'front' (enemy-front is the front-most enemy).
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [damageWithDefenseDownSlot()] },
            enemyDefense: 0,
            enemyHp: 10_000_000,
            numRounds: 1,
            selfBuffs: [],
            // No scheduled debuffs — ability-sourced only.
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 10_000_000,
            // Healing mode: required to unlock the positioned enemy roster.
            healTargetId: 'attacker',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            // Two enemies: front (M4) and back (M1). Focus targets 'front' → enemy-front.
            enemyAttackers: [
                basicEnemyAt('enemy-front', 'M4', 'front'),
                basicEnemyAt('enemy-back', 'M1', 'back'),
            ],
            __testTapVictimEnemyModifiers: (fn) => {
                captured = fn;
            },
        });

        expect(captured).toBeDefined();

        // enemy-front was the targetId of the player's turn (focus at M4 targeting 'front').
        // Edit A threads tgt.id='enemy-front' as targetId → applyTimedAbilityStatus routes
        // 'Defense Down' to the 'enemy-front' per-victim store.
        // victimEnemyBuffs reads the ability (timed) channel for this victimId → -50.
        expect(captured!('enemy-front')).toEqual({
            enemyDefenseModifier: -50,
            incomingDamageModifier: 0,
        });

        // enemy-back was NOT targeted → its per-victim ability store is empty.
        // No scheduled debuffs either → both modifiers are 0.
        expect(captured!('enemy-back')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
    });
});
