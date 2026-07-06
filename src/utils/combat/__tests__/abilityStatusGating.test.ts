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

    it('passes a derivable enemy-buff condition through unchanged (live subject, item 11)', () => {
        const conds: Condition[] = [
            { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
        ];
        expect(liveGateConditions(conds)).toEqual(conds);
    });

    it('passes a derivable self-debuff condition through unchanged (live subject, item 11)', () => {
        const conds: Condition[] = [
            { subject: 'self-debuff', derivable: true, buffName: 'Defense Down' },
        ];
        expect(liveGateConditions(conds)).toEqual(conds);
    });

    it('passes a derivable self-debuff count-scaling condition through unchanged', () => {
        const conds: Condition[] = [
            {
                subject: 'self-debuff',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 1,
            },
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
        const conds: Condition[] = [{ subject: 'adjacent-ally', derivable: true, anyOf: true }];
        expect(liveGateConditions(conds)).toEqual([
            { subject: 'always', derivable: true, anyOf: true },
        ]);
    });

    it('leaves a manual (non-derivable) condition untouched even on a non-live subject', () => {
        const conds: Condition[] = [{ subject: 'adjacent-ally', derivable: false, manualCount: 0 }];
        expect(liveGateConditions(conds)).toEqual(conds);
    });
});

describe('liveGateConditions — lowest-speed-ally', () => {
    it('keeps a derivable lowest-speed-ally condition (does NOT neutralize to always)', () => {
        const out = liveGateConditions([{ subject: 'lowest-speed-ally', derivable: true }]);
        expect(out).toEqual([{ subject: 'lowest-speed-ally', derivable: true }]);
    });
});

describe('liveGateConditions — target-repaired-this-round (C2b-3)', () => {
    // Guards the LIVE_SUBJECTS membership: if this subject is ever dropped from
    // LIVE_SUBJECTS, the condition would neutralize to 'always' and Nayra's
    // Stasis/Exposed inflicts would silently fire unconditionally again.
    it('keeps a derivable target-repaired-this-round condition (does NOT neutralize to always)', () => {
        const out = liveGateConditions([
            { subject: 'target-repaired-this-round', derivable: true },
        ]);
        expect(out).toEqual([{ subject: 'target-repaired-this-round', derivable: true }]);
    });
});

describe('liveGateConditions — not-hit-this-round (D-PR8)', () => {
    it('keeps a derivable not-hit-this-round condition (live subject, not neutralized)', () => {
        const out = liveGateConditions([{ subject: 'not-hit-this-round', derivable: true }]);
        expect(out[0].subject).toBe('not-hit-this-round');
    });
});

describe('liveGateConditions — enemy-dot-count (SP-D)', () => {
    // Guards the LIVE_SUBJECTS membership: if this subject is ever dropped from LIVE_SUBJECTS,
    // Anemone's Taunt (a timed self-buff) and Belladonna's Stasis (a timed enemy debuff) would
    // both neutralize to 'always' and fire/land unconditionally, ignoring the "3+ DoT effects"
    // gate entirely.
    it('keeps a derivable enemy-dot-count condition (does NOT neutralize to always)', () => {
        const conds: Condition[] = [
            {
                subject: 'enemy-dot-count',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 3,
            },
        ];
        expect(liveGateConditions(conds)).toEqual(conds);
    });

    it('keeps a derivable named-family enemy-dot-count condition (Belladonna Acidic Decay)', () => {
        const conds: Condition[] = [
            {
                subject: 'enemy-dot-count',
                derivable: true,
                buffName: 'Acidic Decay',
                countComparator: 'gte',
                countThreshold: 3,
            },
        ];
        expect(liveGateConditions(conds)).toEqual(conds);
    });
});
