import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// E3: an on-cast purge with ability target 'all-enemies' removes buffs from
// EVERY footprint victim, not just the single resolved anchor.
//
// Harness mirrors purgeCastPath.test.ts (positional two-team battle-sim:
// healTargetId set unlocks the enemy roster; the focus needs position + parsed
// target so selectTurnTarget resolves a REAL enemy as the anchor `targetId`).
// TWO enemies (M4 front + M3) each self-buff "Attack Up" every round. The focus
// fires an 'all'-shape pattern (footprint = all living enemies), so the footprint
// covers BOTH. The control uses a single-'enemy' purge (anchor only).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e3p${++idc}`,
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

const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

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

const buffingEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: allPattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [attackUp(), hit()] }] },
});

const focusSkills = (aoe: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'purge',
                    target: aoe ? 'all-enemies' : 'enemy',
                    config: { type: 'purge', count: 5 },
                }),
                hit(),
            ],
        },
    ],
});

const BASE = (aoe: boolean): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusSkills(aoe),
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: allPattern(),
    enemyAttackers: [buffingEnemy('enemy-front', 'M4'), buffingEnemy('enemy-back', 'M3')],
});

const finalSelfBuffs = (aoe: boolean, enemyId: string): string[] => {
    idc = 0;
    let engine: StatusEngine | undefined;
    runCombat({
        ...BASE(aoe),
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return engine!.timedAbilityStatuses('self', enemyId).map((b) => b.active.buffName);
};

describe('E3: on-cast all-enemies purge removes buffs from every footprint victim', () => {
    it('an all-enemies purge strips the self-buff from BOTH enemies', () => {
        expect(finalSelfBuffs(true, 'enemy-front')).toEqual([]);
        expect(finalSelfBuffs(true, 'enemy-back')).toEqual([]);
    });

    it('CONTROL: a single-enemy purge strips only the anchor (front-most), not the back enemy', () => {
        expect(finalSelfBuffs(false, 'enemy-front')).toEqual([]); // anchor purged
        expect(finalSelfBuffs(false, 'enemy-back')).toEqual(['Attack Up']); // untouched
    });
});
