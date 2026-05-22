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
        expect(result.selfBuffs).toHaveLength(1);
        expect(result.selfBuffs[0].buffName).toBe('Attack Up III');
        expect(result.selfBuffs[0].autoFilled).toBe(true);
        expect(result.selfBuffs[0].id).toBe('Attack Up III');
    });

    it('routes enemy effects to enemyDebuffs', () => {
        const ship = {
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        expect(result.enemyDebuffs).toHaveLength(1);
        expect(result.enemyDebuffs[0].buffName).toBe('Defense Down II');
        expect(result.enemyDebuffs[0].autoFilled).toBe(true);
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

    it('replaces stale auto-filled entries when a new ship is selected', () => {
        const staleOverload = makeEntry('Overload', true); // auto-filled by old ship
        const manualAtk = makeEntry('Attack Up III'); // manually added
        const newOverload = makeEntry('Overload', true); // auto-filled by new ship
        const result = mergeAutoFill([staleOverload, manualAtk], [newOverload]);
        // Stale auto-fill replaced; manual entry preserved; new auto-fill added
        expect(result).toHaveLength(2);
        expect(result.filter((b) => b.buffName === 'Overload')).toHaveLength(1);
        expect(result.some((b) => b.buffName === 'Attack Up III')).toBe(true);
    });

    it('removes stale auto-fills when the new ship has a completely different buff', () => {
        const staleAuto = makeEntry('Old Buff', true); // auto-filled by old ship
        const manual = makeEntry('Attack Up III'); // manually added
        const result = mergeAutoFill([staleAuto, manual], [makeEntry('New Buff', true)]);
        expect(result.some((b) => b.buffName === 'Old Buff')).toBe(false);
        expect(result.some((b) => b.buffName === 'New Buff')).toBe(true);
        expect(result.some((b) => b.buffName === 'Attack Up III')).toBe(true);
        expect(result).toHaveLength(2);
    });

    it('manual entry with same name as incoming auto-fill takes precedence', () => {
        const manualAtk = makeEntry('Attack Up III'); // manually added (autoFilled=false)
        const autoAtk = makeEntry('Attack Up III', true); // incoming auto-fill
        const result = mergeAutoFill([manualAtk], [autoAtk]);
        expect(result).toHaveLength(1);
        expect(result[0].autoFilled).toBeFalsy();
    });
});
