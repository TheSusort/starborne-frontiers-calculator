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
        // Auto-filled ids are unique per grant path: name-source-target.
        expect(result.selfBuffs[0].id).toBe('Attack Up III-active-self');
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

    it('keeps same-name grants from DIFFERENT slots as distinct entries', () => {
        // The dedupe key is (buffName, target, source). The same buff granted on two different
        // slots is two distinct grant paths the builder must emit separately — it must NOT collapse.
        const ship = {
            activeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
            firstPassiveSkillText:
                'This Unit gains <unit-skill>Attack Up III</unit-skill> for 2 turns',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        const entries = result.selfBuffs.filter((b) => b.buffName === 'Attack Up III');
        expect(entries).toHaveLength(2);
        expect(new Set(entries.map((b) => b.skillSource))).toEqual(new Set(['active', 'passive1']));
        // Ids are unique so the legacy pickers' key/remove/stacks logic doesn't collide.
        expect(new Set(entries.map((b) => b.id)).size).toBe(2);
    });

    it('keeps same-name grants with DIFFERENT targets as distinct entries (self + all-allies)', () => {
        // "this Unit gains" (active, self) AND receiver-less "grants" on charge (all-allies):
        // the dedupe widening keeps both so the all-allies grant path is not dropped.
        const ship = {
            activeSkillText: 'This Unit gains <unit-skill>Attack Up II</unit-skill> for 1 turn',
            chargeSkillText:
                'Grants <unit-skill>Attack Up II</unit-skill> to all allies for 2 turns',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        const entries = result.selfBuffs.filter((b) => b.buffName === 'Attack Up II');
        expect(entries).toHaveLength(2);
        expect(new Set(entries.map((b) => b.effectTarget))).toEqual(
            new Set(['self', 'all-allies'])
        );
        expect(new Set(entries.map((b) => b.id)).size).toBe(2);
    });

    it('scans ONLY the refit-active passive (no duplicate tier buffs)', () => {
        // R0 grants Defense Up I, R4 grants Defense Up III. With 4 refits, getShipSkillRows
        // selects the R4 passive (thirdPassiveSkillText). The scan must surface ONLY the
        // refit-active tier — not a duplicate from the lower (R0) column.
        const ship = {
            firstPassiveSkillText:
                'This Unit gains <unit-skill>Defense Up I</unit-skill> for 2 turns',
            thirdPassiveSkillText:
                'This Unit gains <unit-skill>Defense Up III</unit-skill> for 2 turns',
            refits: [{}, {}, {}, {}],
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        const defenseUps = result.selfBuffs.filter((b) => b.buffName.startsWith('Defense Up'));
        expect(defenseUps).toHaveLength(1);
        expect(defenseUps[0].buffName).toBe('Defense Up III');
        // Tagged with its original column source so per-round/slot routing is preserved.
        expect(defenseUps[0].skillSource).toBe('passive3');
    });

    it('still collapses a true duplicate (same name, target, and source)', () => {
        // Same slot, same scope, repeated phrasing → one entry (the dedupe key still fires).
        const ship = {
            activeSkillText:
                'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn. This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn.',
        } as unknown as Ship;
        const result = buildSkillBuffAutoFill(ship);
        const count = result.selfBuffs.filter((b) => b.buffName === 'Attack Up III').length;
        expect(count).toBe(1);
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
