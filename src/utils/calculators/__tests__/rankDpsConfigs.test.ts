import { describe, it, expect } from 'vitest';
import { rankDpsConfigs } from '../rankDpsConfigs';
import { DPSSimulationSummary } from '../dpsSimulator';

/** Minimal summary fixture — only the fields rankDpsConfigs reads are meaningful. */
function s(partial: Partial<DPSSimulationSummary> & Pick<DPSSimulationSummary, 'survived'>) {
    const summary: DPSSimulationSummary = {
        totalDamage: 0,
        avgDamagePerRound: 0,
        finalHpPct: 0,
        totalDirectDamage: 0,
        totalCorrosionDamage: 0,
        totalInfernoDamage: 0,
        totalDetonationDamage: 0,
        totalSecondaryDamage: 0,
        totalConditionalDamage: 0,
        ...partial,
    };
    return summary;
}

describe('rankDpsConfigs', () => {
    it('ranks killers before survivors, killers by fewest rounds', () => {
        const order = rankDpsConfigs([
            { id: 'survivor', summary: s({ survived: true, finalHpPct: 30, totalDamage: 999 }) },
            { id: 'slow', summary: s({ survived: false, roundsToKill: 6, totalDamage: 200 }) },
            { id: 'fast', summary: s({ survived: false, roundsToKill: 4, totalDamage: 180 }) },
        ]);
        expect(order).toEqual(['fast', 'slow', 'survivor']);
    });

    it('breaks roundsToKill ties by higher total damage', () => {
        const order = rankDpsConfigs([
            { id: 'lo', summary: s({ survived: false, roundsToKill: 4, totalDamage: 100 }) },
            { id: 'hi', summary: s({ survived: false, roundsToKill: 4, totalDamage: 300 }) },
        ]);
        expect(order).toEqual(['hi', 'lo']);
    });

    it('ranks all-survived configs by lower remaining HP%', () => {
        const order = rankDpsConfigs([
            { id: 'a', summary: s({ survived: true, finalHpPct: 40, totalDamage: 100 }) },
            { id: 'b', summary: s({ survived: true, finalHpPct: 12, totalDamage: 100 }) },
        ]);
        expect(order).toEqual(['b', 'a']); // graceful all-survived fallback
    });

    it('returns an empty array for no results', () => {
        expect(rankDpsConfigs([])).toEqual([]);
    });

    it('is stable/pure — does not mutate the input array', () => {
        const input = [
            { id: 'a', summary: s({ survived: false, roundsToKill: 5, totalDamage: 100 }) },
            { id: 'b', summary: s({ survived: false, roundsToKill: 2, totalDamage: 100 }) },
        ];
        const copy = [...input];
        rankDpsConfigs(input);
        expect(input).toEqual(copy);
    });
});
