/**
 * stasisBreakExemptionSubjects.test.ts — the tripwire for `attackBreaksStasis`'s gate context.
 *
 * `ShipSkills.stasisBreakExemptWhen` is a `Condition[]`, but the engine evaluates it against a
 * NEUTRAL context carrying exactly one live field: `selfShielded`. Any other subject in that array
 * would evaluate against a fabricated default — reading as UNMET, which silently un-exempts the
 * ship and turns the whole mechanic off with no type error and no failing assertion.
 *
 * So the contract is a corpus fact, and this file is where it is measured: every gate the parser
 * builds from real ship text names `self-shield` and nothing else. If this goes red, a new row
 * introduced a gate the engine cannot see — widen `attackBreaksStasis`'s ctx (and this list)
 * together, never one without the other.
 *
 * CORPUS ACCESS: `docs/ship-skills.csv` is gitignored, so this file skips on a clean checkout —
 * the same pattern the other corpus-scanning tests use.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip, type RefitLevel } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

/** The only subject `attackBreaksStasis`'s gate context can answer. */
const SUPPORTED_SUBJECTS = ['self-shield'];

const REFIT_LEVELS: RefitLevel[] = [0, 2, 4];

interface Exemption {
    ship: string;
    refit: RefitLevel;
    unconditional: boolean;
    subjects: string[];
}

const exemptions = (): Exemption[] => {
    const out: Exemption[] = [];
    for (const rec of loadShipSkillRecords()) {
        for (const refit of REFIT_LEVELS) {
            const ship = buildTraceShip(rec.name, { refitLevel: refit });
            if (!ship) continue;
            const built = buildShipAbilities(ship);
            if (!built.doesntBreakStasis && !built.stasisBreakExemptWhen) continue;
            out.push({
                ship: rec.name,
                refit,
                unconditional: built.doesntBreakStasis === true,
                subjects: (built.stasisBreakExemptWhen ?? []).map((c) => c.subject),
            });
        }
    }
    return out;
};

describe.skipIf(!csvAvailable())('Stasis-break exemption gates (tripwire)', () => {
    it('every gate the corpus builds names only subjects the engine ctx carries', () => {
        const gated = exemptions().filter((e) => e.subjects.length > 0);
        // Non-vacuity: an empty scan would pass this assertion while measuring nothing.
        expect(gated.length).toBeGreaterThan(0);
        for (const e of gated) {
            expect(
                e.subjects.every((s) => SUPPORTED_SUBJECTS.includes(s)),
                `${e.ship} R${e.refit} gates on [${e.subjects.join(', ')}]`
            ).toBe(true);
        }
    });

    it('no ship carries BOTH the unconditional flag and a gate', () => {
        // The engine short-circuits on `doesntBreakStasis` before it ever reads the gate, so a
        // ship holding both would be exempt unconditionally and the gate would be dead text.
        expect(exemptions().filter((e) => e.unconditional && e.subjects.length > 0)).toEqual([]);
    });

    it('pins who is exempt today, and how', () => {
        // A characterisation pin: a ship arriving in or leaving either arm is a kit change that
        // wants looking at, not a number to re-baseline.
        expect(exemptions()).toEqual([
            { ship: 'Akula', refit: 0, unconditional: true, subjects: [] },
            { ship: 'Akula', refit: 2, unconditional: true, subjects: [] },
            { ship: 'Akula', refit: 4, unconditional: true, subjects: [] },
            { ship: 'Tygr', refit: 0, unconditional: true, subjects: [] },
            { ship: 'Tygr', refit: 2, unconditional: true, subjects: [] },
            { ship: 'Tygr', refit: 4, unconditional: true, subjects: [] },
            { ship: 'Zenith', refit: 0, unconditional: false, subjects: ['self-shield'] },
            { ship: 'Zenith', refit: 2, unconditional: false, subjects: ['self-shield'] },
            { ship: 'Zenith', refit: 4, unconditional: false, subjects: ['self-shield'] },
        ]);
    });
});
