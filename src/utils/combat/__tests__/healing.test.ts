import { describe, it, expect } from 'vitest';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';

describe('healing-calc engine groundwork', () => {
    it('toSimBuffs carries outgoingHeal/incomingHeal/hotPct', () => {
        const buffs = toSimBuffs([
            {
                id: 'x',
                buffName: 'Out Repair',
                stacks: 2,
                isStackable: false,
                parsedEffects: { outgoingHeal: 15, incomingHeal: 10, hotPct: 10 },
            },
        ]);
        expect(buffs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ stat: 'outgoingHeal', value: 30 }),
                expect.objectContaining({ stat: 'incomingHeal', value: 20 }),
                expect.objectContaining({ stat: 'hotPct', value: 20 }),
            ])
        );
    });
});
