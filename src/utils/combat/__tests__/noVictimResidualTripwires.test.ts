/**
 * SP-4d Task 7 — this file, migrated. It held three SP-4c-2b residual tripwires; two are now
 * retired and one is not.
 *
 * RETIRED — Tasks 1-4 of this rung made both phantoms directly assertable, so the corpus-wide
 * "nothing can observe this" scan they used to require is no longer the only proof available:
 *
 *   (a) `enemyHpPct` answering a fabricated 100 for "there is no enemy" — discharged by
 *       `absentSubject.test.ts`'s "an enemy hp-threshold ABOVE gate does not fire with no enemy"
 *       (mechanism, unit-level) and `noVictimAbsentSubject.integration.test.ts`'s "an enemy
 *       hp-threshold ABOVE gate does not grant the shield against nobody" plus its drain-time
 *       sibling (engine, integration-level).
 *   (c) the owner-vs-target STAT comparison reading the target at a fabricated 0 — discharged by
 *       `absentSubject.test.ts`'s "Cobalt's clause shape does not fire against nobody" and
 *       `noVictimAbsentSubject.integration.test.ts`'s "Cobalt's HP-vs-target clause does not grant
 *       the shield against nobody".
 *
 * NOT RETIRED — (b), the phantom booking of a footprint of 1 for `enemies-hit-this-cast`, is a
 * genuinely live residual today, not a superseded one. `enemiesHitThisCastByActor`'s three
 * booking sites in engine.ts (the focus/team/enemy `.set(actor.id, …aoeVictimIds?.length ?? 1)`
 * call sites) still fabricate 1 for a REAL cast that resolves no victim. SP-4d Fix wave 1 fixed a
 * DIFFERENT case at the delegate that reads that map (`enemiesHitThisCastFor`, engine.ts): an
 * owner with NO recorded turn at all (e.g. a round-1 start-of-round drain, before anyone has
 * cast) now reads `undefined` instead of a fabricated 1 — pinned by
 * `enemiesHitThisCastAbsentFootprint.integration.test.ts`. That is a narrower case than "a cast
 * that hit nobody"; the booking sites were deliberately left alone (see their own "Left alone
 * deliberately" comment in engine.ts), so this file's case below is still the only place the
 * ally-cast-hits-nobody shape is tripwired. It stays inert by CORPUS CONTENT (no ally-target ship
 * reads this gate, and the two ships that do need ≥2/≥3), not by mechanism — which is exactly the
 * shape this file's corpus-scan method exists for, and exactly why it cannot be converted into a
 * direct assertion the way (a) and (c) were.
 *
 * WHAT SURVIVES BELOW, AND WHY:
 *   - residual (b)'s tripwire, for the reason above;
 *   - the corpus-census non-vacuity check and the `ALLY_TARGET_SHIPS` staleness pin — both the
 *     spec's §6 inertness claims and residual (b)'s own inertness claim rest on this census being
 *     real and the ally-target list being complete, so they stay live guards rather than retiring
 *     with (a) and (c).
 *
 * The file keeps its name: it was never a name for "three residuals", it is a name for the
 * corpus-scan method this class of residual needs once a phantom cannot be asserted against
 * directly.
 *
 * They assert over the PARSED corpus abilities rather than the skill TEXT on purpose: the parser is
 * what the engine actually gates on, and a text regex would miss a phrasing it happens not to match
 * while a parsed-condition scan sees exactly what `evaluateConditions` will see.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { corpusNames } from '../audit/kitFingerprintScenarios';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Condition } from '../../../types/abilities';

/**
 * The 24 ally-target ships (contract §A.2) — every healer, shielder and buffer, i.e. exactly the
 * ships whose cast resolves NO victim and therefore the only ones that can reach the residual.
 * Hardcoded rather than derived because the derivation (parsed `activeTarget` → `TARGET_MAP` side)
 * lives in the targeting parser and a copy of it here would test the copy, not the corpus.
 */
const ALLY_TARGET_SHIPS: readonly string[] = [
    'AEGIS',
    'Chimei',
    'Cultivator',
    'Faust',
    'Flamel',
    'Graphite',
    'Grif',
    'Harvester',
    'Hayyan',
    'Heliodor',
    'Hermes',
    'Howler',
    'Makoli',
    'Meatshield',
    'Mender',
    'Nyxen',
    'Oleander',
    'Paracelsus',
    'Purifier',
    'Refine',
    'Salvation',
    'Sentinel',
    'Shelter',
    'Volk',
];

/** Every parsed condition in the corpus, tagged with where it came from. */
const allCorpusConditions = (): { ship: string; slot: string; cond: Condition }[] => {
    const rows: { ship: string; slot: string; cond: Condition }[] = [];
    for (const ship of corpusNames()) {
        const built = buildTraceShip(ship);
        if (!built) continue;
        for (const { slot, abilities } of buildShipAbilities(built).slots) {
            for (const ability of abilities) {
                for (const cond of ability.conditions ?? []) rows.push({ ship, slot, cond });
            }
        }
    }
    return rows;
};

describe('SP-4d no-victim residual tripwires (migrated from SP-4c-2b)', () => {
    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                    '(gitignored reference data) — these tripwires scan the real corpus.'
            );
        }
    });

    it('ALLY_TARGET_SHIPS is not stale: every name still resolves, and the count is pinned', () => {
        // The hardcoded list is this file's own staleness hole: leg 1 of the case below filters by
        // it, so a NEWLY SHIPPED ally-target ship would be invisible to it and its green would
        // mean nothing. A resolvability check plus a length pin is the cheap half of the guard — it
        // catches a renamed or removed ship, and it forces anyone who changes the corpus's support
        // roster to come here and re-read what the list is for.
        //
        // Deliberately NOT re-derived from the corpus (parsed `activeTarget` → `TARGET_MAP` side):
        // a derivation here would be a copy of the targeting parser's own logic, and the test would
        // then pass by agreeing with itself. A resolvability check is not a copy of the derivation.
        const unresolvable = ALLY_TARGET_SHIPS.filter((n) => buildTraceShip(n) === null);
        expect(
            unresolvable,
            `ally-target ship name(s) that no longer exist in the corpus: ${unresolvable.join(', ')} ` +
                '— a rename or removal. Update ALLY_TARGET_SHIPS.'
        ).toEqual([]);
        expect(
            ALLY_TARGET_SHIPS.length,
            'ALLY_TARGET_SHIPS changed length. If the corpus gained an ally-target ship, add it here ' +
                'AND re-read the residual case below: its inertness rests on this list being complete.'
        ).toBe(24);
    });

    it('is non-vacuous: the corpus scan really produces conditions', () => {
        // Without this, a parser/loader change that yields zero abilities would make the tripwire
        // below pass trivially — the classic "green because nothing was observed" failure.
        const rows = allCorpusConditions();
        expect(rows.length).toBeGreaterThan(100);
        // And the shape the case below filters on must itself be present, or the filter proves
        // nothing.
        expect(rows.filter((r) => r.cond.subject === 'hp-threshold').length).toBeGreaterThan(0);
    });

    it('NO ally-target ship gates on enemies-hit-this-cast — the phantom booking of 1 is unobservable', () => {
        // Two conditions must BOTH hold for the phantom to matter: the same ship must take a
        // no-victim turn (i.e. be one of the 24) AND read this gate. Corpus today: Berserker and
        // Tygr read it, neither is an ally-target ship.
        const readers = allCorpusConditions().filter(
            (r) => r.cond.subject === 'enemies-hit-this-cast'
        );
        expect(
            readers.length,
            'nobody reads this gate any more — the scan has gone stale'
        ).toBeGreaterThan(0);

        const offenders = readers
            .filter((r) => ALLY_TARGET_SHIPS.includes(r.ship))
            .map((r) => `${r.ship}/${r.slot}`);
        expect(
            offenders,
            'An ALLY-TARGET ship now gates on enemies-hit-this-cast. Its ally-targeted cast hits ' +
                'nobody, but the engine still books 1 for it at the `enemiesHitThisCastByActor.set` ' +
                'sites in engine.ts (deliberately left as-is by SP-4d), so the gate would read a ' +
                'phantom footprint. Either book 0 on a no-victim turn at those sites, or fence the ' +
                'gate itself, then delete this case.'
        ).toEqual([]);

        // Second, independent guard: every reader needs at least 2 enemies hit, so a phantom 1 could
        // not satisfy one even if an ally-target ship acquired the gate. If a `gte 1` (or a lte/eq)
        // reader ever appears, this rung's "inert twice over" claim loses its second leg.
        const satisfiableByOne = readers.filter(
            (r) =>
                r.cond.countComparator !== 'gte' ||
                r.cond.countThreshold === undefined ||
                r.cond.countThreshold <= 1
        );
        expect(
            satisfiableByOne.map((r) => `${r.ship}/${r.slot}`),
            'An enemies-hit-this-cast gate appeared that a phantom booking of 1 COULD satisfy. The ' +
                'residual now rests on the ally-target check alone — re-read the note at the ' +
                '`enemiesHitThisCastByActor.set` sites before shipping anything that relies on it.'
        ).toEqual([]);
    });
});
