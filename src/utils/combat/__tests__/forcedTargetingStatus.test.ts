import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { buildForcedTargetingStatus, provokerOf } from '../triggers';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { RegisteredAbilityStatus } from '../statusEngine';

// Always-active seed (skillDuration null → appears every round for owner 'attacker';
// enemyDebuffs with no enemyTargetId resolve to the default '__enemy__' target).
const buff = (buffName: string): SelectedGameBuff => ({
    id: buffName,
    buffName,
    stacks: 1,
    parsedEffects: {},
    isStackable: false,
    skillDuration: null,
});

describe('buildForcedTargetingStatus', () => {
    it('reads Stealth and Taunt from the self-buff store', () => {
        const se = createStatusEngine({
            selfBuffs: [buff('Stealth'), buff('Taunt')],
            enemyDebuffs: [],
        });
        se.beginRound(1);
        const map = buildForcedTargetingStatus(se, ['attacker']);
        expect(map.get('attacker')).toMatchObject({
            stealthed: true,
            taunting: true,
            concentrated: false,
        });
    });
    it('reads Concentrate Fire from the per-target enemy-debuff store', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [buff('Concentrate Fire')] });
        se.beginRound(1);
        const map = buildForcedTargetingStatus(se, ['__enemy__']);
        expect(map.get('__enemy__')).toMatchObject({
            concentrated: true,
            stealthed: false,
            taunting: false,
        });
    });
    it('absent statuses → all-false', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        const map = buildForcedTargetingStatus(se, ['attacker']);
        expect(map.get('attacker')).toEqual({
            stealthed: false,
            taunting: false,
            concentrated: false,
        });
    });
});

const timedProvoke = (casterId?: string): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName: 'Provoke', stacks: 1, parsedEffects: {} },
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    ...(casterId !== undefined ? { casterId } : {}),
    kind: 'timed',
    duration: 2,
});

describe('provokerOf', () => {
    it('returns the casterId of a Provoke debuff on the actor', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedProvoke('provoker-1'), undefined, 'victim-1');
        expect(provokerOf(se, 'victim-1')).toBe('provoker-1');
    });
    it('returns undefined when the actor carries no Provoke', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        expect(provokerOf(se, 'victim-1')).toBeUndefined();
    });
    it('returns undefined for a Provoke applied without a casterId', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedProvoke(undefined), undefined, 'victim-1');
        expect(provokerOf(se, 'victim-1')).toBeUndefined();
    });
});
