import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { buildForcedTargetingStatus } from '../triggers';
import type { SelectedGameBuff } from '../../../types/calculator';

// Always-active seed (skillDuration null → appears every round for owner 'attacker';
// enemyDebuffs with no enemyTargetId resolve to the default '__enemy__' target).
const buff = (buffName: string): SelectedGameBuff =>
    ({
        id: buffName,
        buffName,
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        skillDuration: null,
    }) as SelectedGameBuff;

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
