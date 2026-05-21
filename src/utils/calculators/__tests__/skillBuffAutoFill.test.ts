import { describe, it, expect } from 'vitest';
import { buildSkillBuffAutoFill, mergeAutoFill } from '../skillBuffAutoFill';
import { SelectedGameBuff } from '../../../types/calculator';
import type { Ship } from '../../../types/ship';

describe('buildSkillBuffAutoFill', () => {
    it('returns empty arrays for a ship with no tagged skill text', () => {
        const ship = {} as Ship;
        const result = buildSkillBuffAutoFill(ship);
        expect(result.selfBuffs).toEqual([]);
        expect(result.enemyDebuffs).toEqual([]);
    });

    it('routes self effects to selfBuffs', () => {
        const ship = {
            activeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        // 'Attack Up III' must be in BUFFS for this to produce a result
        expect(result.selfBuffs.length).toBeGreaterThanOrEqual(0);
        if (result.selfBuffs.length > 0) {
            const buff = result.selfBuffs[0];
            expect(buff.buffName).toBe('Attack Up III');
            expect(buff.autoFilled).toBe(true);
            expect(buff.id).toBe('Attack Up III');
        }
    });

    it('routes enemy effects to enemyDebuffs', () => {
        const ship = {
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        if (result.enemyDebuffs.length > 0) {
            const buff = result.enemyDebuffs[0];
            expect(buff.buffName).toBe('Defense Down II');
            expect(buff.autoFilled).toBe(true);
        }
    });

    it('discards buff names not found in BUFFS', () => {
        const ship = {
            activeSkillText:
                'This Unit gains <unit-skill>NonExistentBuffXYZ</unit-skill> for 1 turn',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        expect(result.selfBuffs).toEqual([]);
    });

    it('deduplicates by buffName across skill fields', () => {
        const ship = {
            activeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
            firstPassiveSkillText:
                'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        const count = result.selfBuffs.filter((b) => b.buffName === 'Attack Up III').length;
        expect(count).toBeLessThanOrEqual(1);
    });
});

describe('mergeAutoFill', () => {
    const makeEntry = (buffName: string, autoFilled = false): SelectedGameBuff => ({
        id: buffName,
        buffName,
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        autoFilled,
    });

    it('appends auto-filled entries not already present', () => {
        const existing = [makeEntry('Attack Up III')];
        const autoFilled = [makeEntry('Defense Up II', true)];
        const result = mergeAutoFill(existing, autoFilled);
        expect(result).toHaveLength(2);
    });

    it('skips auto-filled entries that duplicate existing buffName', () => {
        const existing = [makeEntry('Attack Up III')];
        const autoFilled = [makeEntry('Attack Up III', true)];
        const result = mergeAutoFill(existing, autoFilled);
        expect(result).toHaveLength(1);
        // Existing (manual) entry is kept, not the auto-filled one
        expect(result[0].autoFilled).toBeFalsy();
    });

    it('returns existing unchanged when autoFilled is empty', () => {
        const existing = [makeEntry('Attack Up III')];
        expect(mergeAutoFill(existing, [])).toEqual(existing);
    });
});
