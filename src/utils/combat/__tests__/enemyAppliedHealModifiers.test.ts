import { describe, expect, it } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { victimOwnEnemyHealModifiers } from '../triggers';
import type { RegisteredAbilityStatus } from '../statusEngine';
import type { ParsedBuffEffects } from '../../../types/calculator';

// A timed enemy-side ability debuff carrying a parsed heal-channel effect. `side: 'enemy'` is
// what routes it into the per-victim enemy store keyed by the targetId passed to
// applyTimedAbilityStatus.
const timedEnemyDebuff = (
    buffName: string,
    parsedEffects: ParsedBuffEffects,
    stacks = 1
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration: 3,
    casterId: 'attacker',
    payload: { buffName, stacks, parsedEffects },
});

const engineWith = (victimId: string, ...statuses: ReturnType<typeof timedEnemyDebuff>[]) => {
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    se.beginRound(1);
    for (const s of statuses) se.applyTimedAbilityStatus(1, s, undefined, victimId);
    return se;
};

describe('victimOwnEnemyHealModifiers (#367)', () => {
    it('returns zeros for an actor carrying nothing', () => {
        const se = engineWith('nobody');
        expect(victimOwnEnemyHealModifiers(se, 'tank')).toEqual({
            incomingHealPct: 0,
            outgoingHealPct: 0,
        });
    });

    it('reads an enemy-applied Inc. Repair Down II off the victim', () => {
        const se = engineWith(
            'tank',
            timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 })
        );
        expect(victimOwnEnemyHealModifiers(se, 'tank').incomingHealPct).toBe(-50);
    });

    it('reads an enemy-applied Out. Repair Down II off the victim', () => {
        const se = engineWith(
            'medic',
            timedEnemyDebuff('Out. Repair Down II', { outgoingHeal: -50 })
        );
        expect(victimOwnEnemyHealModifiers(se, 'medic').outgoingHealPct).toBe(-50);
    });

    it('is keyed per victim — a debuff on the tank is invisible on the medic', () => {
        const se = engineWith(
            'tank',
            timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 })
        );
        expect(victimOwnEnemyHealModifiers(se, 'medic').incomingHealPct).toBe(0);
    });

    it('R1: a lower tier is already absent from the store, so the fold sees only the higher one', () => {
        // Both applications are made; the family-key/tier upsert keeps only Down II. The fold does
        // NOT implement this rule — it inherits it. If this ever returns -75, the status engine's
        // tier upsert changed and the additive fold is no longer safe.
        const se = engineWith(
            'tank',
            timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 }),
            timedEnemyDebuff('Inc. Repair Down I', { incomingHeal: -25 })
        );
        expect(victimOwnEnemyHealModifiers(se, 'tank').incomingHealPct).toBe(-50);
    });

    it('sums DIFFERENT families additively and multiplies each by its stacks', () => {
        const se = engineWith(
            'tank',
            timedEnemyDebuff('Inc. Repair Down II', { incomingHeal: -50 }),
            timedEnemyDebuff('Out. Repair Down II', { outgoingHeal: -20 }, 2)
        );
        expect(victimOwnEnemyHealModifiers(se, 'tank')).toEqual({
            incomingHealPct: -50,
            outgoingHealPct: -40,
        });
    });

    it('ignores debuffs with no heal-channel effect', () => {
        const se = engineWith('tank', timedEnemyDebuff('Defense Shred', { defense: -30 }));
        expect(victimOwnEnemyHealModifiers(se, 'tank')).toEqual({
            incomingHealPct: 0,
            outgoingHealPct: 0,
        });
    });
});
