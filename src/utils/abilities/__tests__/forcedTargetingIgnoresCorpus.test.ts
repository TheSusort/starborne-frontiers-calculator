import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

/**
 * Tripwire for the Taunt / Provoke ignore split: every corpus ship whose text says it ignores
 * Taunt AND Provoke in one sentence builds BOTH `ignoresTaunt` and `ignoresProvoke`, and no other
 * ship builds either. The census predicate is deliberately broader than the parser's own regex
 * (any "ignor…" followed by both names in the sentence), so a parser that narrows too far fails
 * here instead of silently dropping a flag.
 */
const BOTH_IN_ONE_SENTENCE = /\bignor\w*\b[^.]*\btaunt\b[^.]*\bprovoke\b/i;

function fullRefitShip(rec: ReturnType<typeof loadShipSkillRecords>[number]): Ship {
    return {
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as unknown as Ship;
}

describe.skipIf(!csvAvailable())('corpus Taunt / Provoke ignores', () => {
    const strip = (t: string | null | undefined) =>
        (t ?? '').replace(/<\/?unit-(?:aid|skill|damage)>/gi, '');
    const records = loadShipSkillRecords();
    const ignoresBoth = (rec: (typeof records)[number]) =>
        [rec.active, rec.charge, ...rec.passives].some((t) => BOTH_IN_ONE_SENTENCE.test(strip(t)));

    it('the census finds the ignore ships (not vacuous)', () => {
        expect(records.filter(ignoresBoth).length).toBeGreaterThanOrEqual(8);
    });

    it('every ship that ignores both today builds exactly both flags', () => {
        const wrong = records
            .filter(ignoresBoth)
            .map((rec) => {
                const built = buildShipAbilities(fullRefitShip(rec));
                return { name: rec.name, taunt: built.ignoresTaunt, provoke: built.ignoresProvoke };
            })
            .filter((r) => r.taunt !== true || r.provoke !== true);
        expect(wrong).toEqual([]);
    });

    it('no other ship builds either flag', () => {
        const stray = records
            .filter((rec) => !ignoresBoth(rec))
            .map((rec) => ({ name: rec.name, built: buildShipAbilities(fullRefitShip(rec)) }))
            .filter(({ built }) => built.ignoresTaunt || built.ignoresProvoke)
            .map(({ name }) => name);
        expect(stray).toEqual([]);
    });
});
