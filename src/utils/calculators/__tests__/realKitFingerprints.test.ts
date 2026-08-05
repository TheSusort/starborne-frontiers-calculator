/**
 * Real-kit behaviour fingerprints — the golden suite's ONLY real-ship coverage.
 *
 * Every other golden fixture in this directory is synthetic (see simGoldenFixtures.ts's header:
 * the author had no local corpus), which is why 22 commits of real ship-behaviour change in #296
 * and the Malvex gate fix in #297 moved zero snapshots.
 *
 * Each of the 147 corpus ships is run through three fixed scenarios and reduced to the SET of
 * `kind[:slot]` behaviour tokens it produced. A diff means that ship's behaviour changed. The
 * suite is deliberately STRUCTURAL, not numeric: it answers "does this clause still fire", which
 * is the dominant defect class in the changelog ("now does something", "was a name in the buff
 * list with no effect", "the condition was not being read at all"). Numeric drift is
 * dpsGoldenParity / healingGoldenParity's job.
 *
 * `vitest -u` on this file is FORBIDDEN except as a deliberate, audited behaviour move. A moved
 * snapshot is a real behaviour change and must be explained in the commit that moves it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runSeededBattle } from '../../combat/audit/seededBattle';
import { fingerprintActorTokens } from '../../combat/audit/fingerprint';
import {
    buildScenarioBattle,
    SCENARIOS,
    SEED,
    type ScenarioName,
} from '../../combat/audit/kitFingerprintScenarios';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../types/ship';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

/** The focus ship is always the first player placement, and simulateBattle mints the first player
 *  actor with the reserved id 'attacker' (battleSimulator's minting scheme; the rest are
 *  `p:<shipId>:<idx>`). So the focus actor id is fixed. */
const FOCUS_ACTOR_ID = 'attacker';

/** Fingerprint one ship across all three scenarios. Every battle goes through runSeededBattle —
 *  its `finally` restores Math.random rather than any ambient seed, so a raw simulateBattle call
 *  afterwards would be nondeterministic. */
export function fingerprintShip(ship: Ship): Record<ScenarioName, string[]> {
    const out = {} as Record<ScenarioName, string[]>;
    for (const scenario of SCENARIOS) {
        const result = runSeededBattle(buildScenarioBattle(ship, scenario), SEED);
        out[scenario] = fingerprintActorTokens(result, FOCUS_ACTOR_ID);
    }
    return out;
}

/** Corpus ship names, sorted for a stable it.each order (CSV row order is not guaranteed). */
function corpusNames(): string[] {
    return loadShipSkillRecords()
        .map((r) => r.name)
        .sort((a, b) => a.localeCompare(b));
}

describe('kit fingerprints', () => {
    beforeAll(requireReferenceData);

    it.each(corpusNames().map((n) => [n] as const))('%s', (name) => {
        const ship = buildTraceShip(name);
        expect(ship, `${name} did not resolve from the corpus`).not.toBeNull();
        expect(fingerprintShip(ship!)).toMatchSnapshot();
    });
});
