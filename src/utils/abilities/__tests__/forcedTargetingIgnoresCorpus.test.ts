import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { getShipSkillRows } from '../../ship/skillRows';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

/**
 * Tripwire for the Taunt / Provoke ignore split. Over the skill rows the builder reads (the
 * full-refit ship's active, charge and refit-active passive): every ship whose text says it ignores
 * Taunt AND Provoke in one sentence, in either order, builds BOTH `ignoresTaunt` and
 * `ignoresProvoke`; and a ship builds a flag only when its text names that status after an
 * "ignor..." verb (a Taunt-only ship builds `ignoresTaunt` alone). The census predicate is
 * deliberately broader than the parser's own regex, so a parser that narrows too far fails here
 * instead of silently dropping a flag.
 */
const BOTH_IN_ONE_SENTENCE =
    /\bignor\w*\b[^.]*\b(?:taunt\b[^.]*\bprovoke|provoke\b[^.]*\btaunt)\b/i;
const NAMES_TAUNT = /\bignor\w*\b[^.]*\btaunt\b/i;
const NAMES_PROVOKE = /\bignor\w*\b[^.]*\bprovoke\b/i;

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
    // The same refit-resolved rows `buildShipAbilities` reads for the full-refit ship.
    const builtRowTexts = (rec: (typeof records)[number]) =>
        getShipSkillRows(fullRefitShip(rec)).map((row) => strip(row.text));
    const ignoresBoth = (rec: (typeof records)[number]) =>
        builtRowTexts(rec).some((t) => BOTH_IN_ONE_SENTENCE.test(t));

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

    it('no ship builds a flag its own text does not name', () => {
        const stray = records
            .map((rec) => {
                const built = buildShipAbilities(fullRefitShip(rec));
                const texts = builtRowTexts(rec);
                return {
                    name: rec.name,
                    strayTaunt: !!built.ignoresTaunt && !texts.some((t) => NAMES_TAUNT.test(t)),
                    strayProvoke:
                        !!built.ignoresProvoke && !texts.some((t) => NAMES_PROVOKE.test(t)),
                };
            })
            .filter((r) => r.strayTaunt || r.strayProvoke);
        expect(stray).toEqual([]);
    });
});
