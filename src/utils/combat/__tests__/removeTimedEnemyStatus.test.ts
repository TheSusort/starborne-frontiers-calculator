import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';

function timedEnemyStatus(
    buffName: string,
    duration: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    };
}

describe('removeTimedEnemyStatus — targeted enemy status removal', () => {
    it('removes ONLY the named family, preserving co-applied debuffs on the same victim', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const stasisStatus = timedEnemyStatus('Stasis', 2);
        const defDownStatus = timedEnemyStatus('Defense Down', 3);

        se.beginRound(1);
        se.applyTimedAbilityStatus(1, stasisStatus, undefined, 'victim-1');
        se.applyTimedAbilityStatus(1, defDownStatus, undefined, 'victim-1');

        // Both are present before removal
        const before = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        const buffNamesBefore = before.map((s) => s.payload.buffName);
        expect(buffNamesBefore).toContain('Stasis');
        expect(buffNamesBefore).toContain('Defense Down');

        se.removeTimedEnemyStatus('victim-1', 'Stasis');

        // After removal: Stasis gone, Defense Down preserved
        const after = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        const buffNamesAfter = after.map((s) => s.payload.buffName);
        expect(buffNamesAfter).not.toContain('Stasis');
        expect(buffNamesAfter).toContain('Defense Down');
    });

    it('is a safe no-op for an unknown targetId', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        // No beginRound needed — just verify no throw
        expect(() => se.removeTimedEnemyStatus('nonexistent', 'Stasis')).not.toThrow();
    });

    it('is a safe no-op for an unknown buffName on a real victim', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 2), undefined, 'victim-1');

        // Removing a name that was never applied — no throw, Defense Down still present
        expect(() => se.removeTimedEnemyStatus('victim-1', 'Nonexistent')).not.toThrow();
        const after = se.timedAbilityStatuses('enemy', undefined, 'victim-1');
        expect(after.map((s) => s.payload.buffName)).toContain('Defense Down');
    });
});

describe('reduceTimedEnemyStatus — shave one turn (direct-damage Stasis break)', () => {
    const stasisNames = (se: ReturnType<typeof createStatusEngine>) =>
        se.timedAbilityStatuses('enemy', undefined, 'victim-1').map((s) => s.payload.buffName);

    it('reduces the named status by one turn, deleting it only when it reaches 0', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Stasis', 2), undefined, 'victim-1');

        // Stasis(2): one reduce leaves it at 1 turn (still present)…
        se.reduceTimedEnemyStatus('victim-1', 'Stasis');
        expect(stasisNames(se)).toContain('Stasis');

        // …a second reduce takes it to 0 → deleted.
        se.reduceTimedEnemyStatus('victim-1', 'Stasis');
        expect(stasisNames(se)).not.toContain('Stasis');
    });

    it('reduces ONLY the named family, preserving co-applied debuffs on the same victim', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Stasis', 1), undefined, 'victim-1');
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 3), undefined, 'victim-1');

        // A single reduce clears the 1-turn Stasis but leaves Defense Down untouched.
        se.reduceTimedEnemyStatus('victim-1', 'Stasis');
        const after = se
            .timedAbilityStatuses('enemy', undefined, 'victim-1')
            .map((s) => s.payload.buffName);
        expect(after).not.toContain('Stasis');
        expect(after).toContain('Defense Down');
    });

    it('is a safe no-op for an unknown targetId or unknown buffName', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 2), undefined, 'victim-1');
        expect(() => se.reduceTimedEnemyStatus('nonexistent', 'Stasis')).not.toThrow();
        expect(() => se.reduceTimedEnemyStatus('victim-1', 'Nonexistent')).not.toThrow();
        expect(stasisNames(se)).toContain('Defense Down');
    });
});
