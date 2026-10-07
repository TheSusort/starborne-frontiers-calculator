import { describe, it, expect } from 'vitest';
import { extendDebuffEntries } from '../state';

const dot = (over: object = {}) => ({
    stacks: 2,
    tier: 1,
    remainingRounds: 1,
    sourceId: 's',
    ...over,
});
const holder = () => ({
    // Acidic Decay is a Corrosion entry re-tagged by Belladonna's conversion.
    corrosionEntries: [dot(), dot({ stacks: 1, family: 'Acidic Decay', unremovable: true })],
    infernoEntries: [dot({ stacks: 1 })],
    genericDoTEntries: [dot()],
    pendingBombs: [
        {
            countdown: 1,
            damagePerStack: 10,
            stacks: 1,
            tier: 1,
            sourceId: 's',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 0,
        },
    ],
    pendingAccumulators: [{ roundsRemaining: 1, pct: 50, accumulated: 0, sourceId: 's' }],
});

describe('extendDebuffEntries — every DoT, Bomb and accumulator is a debuff (R109)', () => {
    it('extends corrosion (Acidic Decay too), inferno, generic, bombs and accumulators', () => {
        const h = holder();
        const n = extendDebuffEntries(h, 1);
        expect(h.corrosionEntries[0].remainingRounds).toBe(2);
        expect(h.corrosionEntries[1].remainingRounds).toBe(2);
        expect(h.infernoEntries[0].remainingRounds).toBe(2);
        expect(h.genericDoTEntries[0].remainingRounds).toBe(2);
        expect(h.pendingBombs[0].countdown).toBe(2);
        expect(h.pendingAccumulators[0].roundsRemaining).toBe(2);
        expect(n).toBe(2 + 1 + 1 + 2 + 1 + 1);
    });
    it.each([0, -1, NaN, Infinity])('turns=%s changes nothing', (t) => {
        const h = holder();
        expect(extendDebuffEntries(h, t)).toBe(0);
        expect(h.pendingBombs[0].countdown).toBe(1);
    });
});
