/**
 * B1 Task 3 — `victimEnemyModifiers(victimId)` per-victim enemy-debuff reader.
 *
 * DESIGN (post-Task-3 `victimEnemyBuffs` helper):
 *   victimEnemyModifiers now delegates to victimEnemyBuffs (triggers.ts), which folds
 *   BOTH channels:
 *
 *   1. Scheduled channel (__enemy__): non-payload entries written by sourceFired →
 *      upsertBuff → DEFAULT_ENEMY_TARGET ('__enemy__'). These are GLOBAL — they apply to
 *      EVERY positioned victim. victimEnemyBuffs always reads this channel regardless of
 *      victimId, so scheduled debuffs appear for ALL victim ids.
 *
 *   2. Ability channel (per-victim payload): timed + aura/accum entries written by
 *      applyTimedAbilityStatus keyed by targetId. These are PER-VICTIM — only the targeted
 *      victim's store carries them. After Edit A threads targetId for player→enemy, player
 *      ability debuffs route to the specific named victim, not __enemy__.
 *
 * TEST CONTRACT:
 *   Case 1 (scheduled): a scheduled Defense Down fires → modifiers are -30 for BOTH
 *     '__enemy__', 'front-enemy', and 'back-enemy' (global scheduled aura applies to all).
 *   Case 2 (ability channel isolation): an ability Defense Down applied to 'front-id' →
 *     victimEnemyModifiers('front-id') = -30, victimEnemyModifiers('back-id') = 0. The
 *     ability portion does NOT bleed across victims.
 *
 * NOTE: the ability-channel case requires Edit A (targetId threaded for player→enemy). The
 *   test creates a positioned battle where the player fires an ability enemyDebuffs
 *   Defense Down at the front enemy. After Edit A routes targetId, the debuff sits under
 *   'front-id', not '__enemy__', so back-id sees 0 for the ability portion.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// A timed scheduled Defense Down: fires on 'active' turns, duration 3.
// skillSource='active' + skillDuration=3 → timed entry (not always-active/accumulating).
// Goes to DEFAULT_ENEMY_TARGET ('__enemy__') via sourceFired → upsertBuff.
// Non-payload so it appears in snapshot().activeEnemyDebuffs.
const defenseDown: SelectedGameBuff = {
    id: 'vem-dd',
    buffName: 'Defense Down',
    stacks: 1,
    parsedEffects: { defense: -30 },
    isStackable: false,
    skillSource: 'active',
    skillDuration: 3,
};

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `vem${++idc}`,
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

const damageSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// Ability slot that fires a damage ability + a Defense Down enemy debuff payload (two abilities).
const damageWithDebuffSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Ability Defense Down',
                parsedEffects: { defense: -30 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 3,
            },
        }),
    ],
});

// Minimal focus attacker (no positioning) that fires its active slot (so sourceFired fires 'active').
const BASE_INPUT = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [damageSlot()] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [defenseDown],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 10_000_000,
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    hp: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [damageSlot()] },
    }) as EnemyAttacker;

describe('B1 Task 3 — victimEnemyModifiers: scheduled channel is global, ability channel is per-victim', () => {
    it('Case 1 (scheduled): a scheduled Defense Down applies to ALL victim ids (global __enemy__)', () => {
        idc = 0;
        let captured:
            | ((victimId: string) => {
                  enemyDefenseModifier: number;
                  incomingDamageModifier: number;
              })
            | undefined;

        runCombat(
            BASE_INPUT({
                __testTapVictimEnemyModifiers: (fn) => {
                    captured = fn;
                },
            })
        );

        expect(captured).toBeDefined();

        // Scheduled Defense Down lives on '__enemy__' (global) → appears for EVERY victim id.
        // victimEnemyBuffs always folds the __enemy__ scheduled channel, so every named victim
        // inherits the global debuffs (scheduled auras apply to every positioned victim).
        expect(captured!('__enemy__')).toEqual({
            enemyDefenseModifier: -30,
            incomingDamageModifier: 0,
        });
        expect(captured!('front-enemy')).toEqual({
            enemyDefenseModifier: -30,
            incomingDamageModifier: 0,
        });
        expect(captured!('back-enemy')).toEqual({
            enemyDefenseModifier: -30,
            incomingDamageModifier: 0,
        });
    });

    it('Case 2 (ability channel): ability Defense Down routes to front-id only (not back-id)', () => {
        idc = 0;
        // Positioned battle: focus player at M4 fires front enemy (id='front-id').
        // Active slot fires an ability with enemyDebuffs=[abilityDefenseDown].
        // After Edit A threads targetId for player→enemy, the debuff routes to 'front-id',
        // not '__enemy__'. So victimEnemyModifiers('front-id') = -30, ('back-id') = 0
        // for the ability portion. No scheduled debuffs → base = 0 for both.
        let captured:
            | ((victimId: string) => {
                  enemyDefenseModifier: number;
                  incomingDamageModifier: number;
              })
            | undefined;

        runCombat({
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // Active slot fires damage + ability Defense Down on the enemy.
            shipSkills: { slots: [damageWithDebuffSlot()] },
            enemyDefense: 0,
            enemyHp: 10_000_000,
            numRounds: 1,
            selfBuffs: [],
            // No scheduled debuffs — ability-only.
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
            // Positioned battle: focus at M4 fires front; healTargetId unlocks enemy roster.
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            // Two enemy targets at positions M4 (front-id) and M1 (back-id).
            enemyAttackers: [
                offensiveEnemyAt('front-id', 'M4', 'front', 10_000_000),
                offensiveEnemyAt('back-id', 'M1', 'back', 10_000_000),
            ],
            __testTapVictimEnemyModifiers: (fn) => {
                captured = fn;
            },
        });

        expect(captured).toBeDefined();

        // Ability Defense Down routed to 'front-id' via targetId threading (Edit A).
        // front-id carries the ability debuff (defense: -30) in its per-victim store.
        expect(captured!('front-id')).toEqual({
            enemyDefenseModifier: -30,
            incomingDamageModifier: 0,
        });
        // back-id has no ability debuff applied → 0 (the debuff did NOT bleed across victims).
        expect(captured!('back-id')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
    });
});
