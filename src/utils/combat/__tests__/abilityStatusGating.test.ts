import { describe, expect, it } from 'vitest';
import { Condition } from '../../../types/abilities';
import { liveGateConditions } from '../abilityStatusGating';

describe('liveGateConditions', () => {
    it('passes a live derivable condition (enemy-debuff threshold) through unchanged', () => {
        const conds: Condition[] = [
            { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 3 },
        ];
        expect(liveGateConditions(conds)).toEqual(conds);
    });

    it('passes hp-threshold and enemy-type derivable conditions through unchanged', () => {
        const conds: Condition[] = [
            { subject: 'hp-threshold', derivable: true, hpComparator: 'above', hpPercent: 50 },
            { subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' },
        ];
        expect(liveGateConditions(conds)).toEqual(conds);
    });

    it('neutralizes a derivable non-live subject (adjacent-ally) to always', () => {
        const conds: Condition[] = [
            {
                subject: 'adjacent-ally',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 2,
            },
        ];
        expect(liveGateConditions(conds)).toEqual([{ subject: 'always', derivable: true }]);
    });

    it('preserves the anyOf flag when neutralizing', () => {
        const conds: Condition[] = [{ subject: 'enemy-buff', derivable: true, anyOf: true }];
        expect(liveGateConditions(conds)).toEqual([
            { subject: 'always', derivable: true, anyOf: true },
        ]);
    });

    it('leaves a manual (non-derivable) condition untouched even on a non-live subject', () => {
        const conds: Condition[] = [{ subject: 'adjacent-ally', derivable: false, manualCount: 0 }];
        expect(liveGateConditions(conds)).toEqual(conds);
    });
});
