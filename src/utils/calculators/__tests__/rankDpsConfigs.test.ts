import { describe, it, expect } from 'vitest';
import { rankDpsConfigs, describeBestVsSecond } from '../rankDpsConfigs';
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

describe('describeBestVsSecond (best-vs-#2 badge under roundsToKill ranking)', () => {
    // (a) two killers with different roundsToKill → rounds advantage, NOT a damage %.
    it('two killers with different rounds → reports the rounds advantage', () => {
        const best = s({ survived: false, roundsToKill: 4, totalDamage: 180 });
        const second = s({ survived: false, roundsToKill: 6, totalDamage: 200 });
        expect(describeBestVsSecond(best, second)).toBe('Kills 2 rounds faster than #2');
    });

    it('singular round wording when exactly 1 round faster', () => {
        const best = s({ survived: false, roundsToKill: 4, totalDamage: 180 });
        const second = s({ survived: false, roundsToKill: 5, totalDamage: 200 });
        expect(describeBestVsSecond(best, second)).toBe('Kills 1 round faster than #2');
    });

    it('two killers tied on rounds → correctly-signed damage delta (tie-break winner has more)', () => {
        const best = s({ survived: false, roundsToKill: 4, totalDamage: 300 });
        const second = s({ survived: false, roundsToKill: 4, totalDamage: 100 });
        expect(describeBestVsSecond(best, second)).toBe('+200.00% damage vs #2');
    });

    // (b) killer vs survivor → sole-killer label, never a rounds delta against a non-killer.
    it('best killed, #2 survived → labels best the only killer', () => {
        const best = s({ survived: false, roundsToKill: 4, totalDamage: 180 });
        const second = s({ survived: true, finalHpPct: 30, totalDamage: 999 });
        expect(describeBestVsSecond(best, second)).toBe('Only config to destroy the target');
    });

    // (c) all survived → correctly-signed damage delta; NEVER '+' before a negative.
    it('all survived, best has more damage → positive damage delta', () => {
        const best = s({ survived: true, finalHpPct: 12, totalDamage: 500 });
        const second = s({ survived: true, finalHpPct: 40, totalDamage: 400 });
        expect(describeBestVsSecond(best, second)).toBe('+25.00% damage vs #2');
    });

    it('all survived, best has LESS damage (ranked by lower HP%) → negative delta, no leading +', () => {
        // best empties more HP (lower finalHpPct) but deals less total damage than #2.
        const best = s({ survived: true, finalHpPct: 10, totalDamage: 300 });
        const second = s({ survived: true, finalHpPct: 50, totalDamage: 500 });
        const label = describeBestVsSecond(best, second);
        expect(label).toBe('-40.00% damage vs #2');
        expect(label).not.toContain('+-');
    });

    it('never renders the nonsensical "+-X%" the old badge produced', () => {
        // The exact regression: fastest killer with LESS damage than #2.
        const best = s({ survived: false, roundsToKill: 4, totalDamage: 180 });
        const second = s({ survived: false, roundsToKill: 6, totalDamage: 500 });
        expect(describeBestVsSecond(best, second)).not.toContain('+-');
    });
});
