import { describe, it, expect } from 'vitest';
import { partitionScoreableShips } from '../customFormula';
import type { ScorabilityConfig } from '../customFormula';

const shipA = { id: 'a', name: 'Ship A' };
const shipB = { id: 'b', name: 'Ship B' };

const configFor =
    (configs: Record<string, ScorabilityConfig>) =>
    (shipId: string): ScorabilityConfig =>
        configs[shipId] ?? { shipRole: null };

describe('partitionScoreableShips', () => {
    it('marks a Custom-mode ship with no formula rows unscoreable', () => {
        const { scoreable, unscoreable } = partitionScoreableShips(
            [shipA],
            configFor({ a: { shipRole: null, customFormula: undefined } })
        );
        expect(scoreable).toEqual([]);
        expect(unscoreable).toEqual([shipA]);
    });

    it('scores a Custom-mode ship once its formula has a row', () => {
        const { scoreable, unscoreable } = partitionScoreableShips(
            [shipA],
            configFor({
                a: {
                    shipRole: null,
                    customFormula: {
                        rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
                    },
                },
            })
        );
        expect(scoreable).toEqual([shipA]);
        expect(unscoreable).toEqual([]);
    });

    it('scores a role-based ship regardless of formula state', () => {
        const { scoreable, unscoreable } = partitionScoreableShips(
            [shipA],
            configFor({ a: { shipRole: 'ATTACKER', customFormula: undefined } })
        );
        expect(scoreable).toEqual([shipA]);
        expect(unscoreable).toEqual([]);
    });

    it('splits a mixed selection, keeping the scoreable sibling', () => {
        const { scoreable, unscoreable } = partitionScoreableShips(
            [shipA, shipB],
            configFor({
                a: { shipRole: null, customFormula: undefined },
                b: { shipRole: 'ATTACKER', customFormula: undefined },
            })
        );
        expect(scoreable).toEqual([shipB]);
        expect(unscoreable).toEqual([shipA]);
    });

    it('puts every ship in unscoreable when all are Custom-mode with no formula', () => {
        const { scoreable, unscoreable } = partitionScoreableShips([shipA, shipB], configFor({}));
        expect(scoreable).toEqual([]);
        expect(unscoreable).toEqual([shipA, shipB]);
    });
});
