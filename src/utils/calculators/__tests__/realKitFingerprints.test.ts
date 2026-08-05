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
import {
    SCENARIOS,
    fingerprintShip,
    corpusNames,
} from '../../combat/audit/kitFingerprintScenarios';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

describe('kit fingerprints', () => {
    beforeAll(requireReferenceData);

    it.each(corpusNames().map((n) => [n] as const))('%s', (name) => {
        const ship = buildTraceShip(name);
        expect(ship, `${name} did not resolve from the corpus`).not.toBeNull();
        expect(fingerprintShip(ship!)).toMatchSnapshot();
    });
});

describe('pinned regression: Malvex target-shield gates (#296, #297)', () => {
    beforeAll(requireReferenceData);

    it('gates BOTH the active self-shield and the charged Barrier on a shielded target', () => {
        // The case the whole suite exists for. Pre-#297 the active self-shield fired on every cast
        // regardless of target, and pre-#296 the charged Barrier did too — so both tokens sat in
        // all three scenarios. They must now appear ONLY where the target actually carries a
        // Shield. Note bare `shield` (Malvex's passive on-damaged grant) is expected EVERYWHERE and
        // is exactly why a bare-`kind` fingerprint could not have caught this.
        const malvex = buildTraceShip('Malvex');
        expect(malvex).not.toBeNull();
        const fp = fingerprintShip(malvex!);

        expect(fp.richEnemy).toContain('shield:active');
        expect(fp.plain).not.toContain('shield:active');
        expect(fp.hurtAllies).not.toContain('shield:active');

        expect(fp.richEnemy).toContain('buff:charged');
        expect(fp.plain).not.toContain('buff:charged');
        expect(fp.hurtAllies).not.toContain('buff:charged');
    });
});

describe('suite health', () => {
    beforeAll(requireReferenceData);

    it('is non-vacuous: every ship produces tokens, and the roster covers many kinds', () => {
        // Without this, a harness bug that fingerprints nothing yields 147 empty snapshots and
        // reads as passing.
        const all = new Set<string>();
        const empty: string[] = [];
        for (const name of corpusNames()) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            const fp = fingerprintShip(ship);
            const tokens = SCENARIOS.flatMap((s) => fp[s]);
            if (tokens.length === 0) empty.push(name);
            for (const t of tokens) all.add(t);
        }
        expect(empty, `ships producing NO tokens in any scenario: ${empty.join(', ')}`).toEqual([]);
        // 18 kinds exist; the roster should exercise a broad share of them.
        expect(new Set([...all].map((t) => t.split(':')[0])).size).toBeGreaterThanOrEqual(10);
    }, 20_000);
    // ^ Re-fingerprints all 147 ships (441 battles) on top of the it.each block above already
    // having done so — the default 5s vitest timeout is comfortable in isolation (~4s) but gets
    // squeezed under full-suite worker contention. 20s is a generous margin, not a tuned value.

    it('is deterministic: fingerprinting the same ship twice gives identical tokens', () => {
        // Guards against RNG leaking across scenarios — runSeededBattle restores Math.random in
        // its finally, so a battle run outside it would drift between calls.
        const ship = buildTraceShip('Malvex');
        expect(ship).not.toBeNull();
        expect(fingerprintShip(ship!)).toEqual(fingerprintShip(ship!));
    });

    it('pins the corpus shape so a data refresh announces itself in ONE diff', () => {
        // 147 snapshots derived from gitignored data would otherwise churn with no explanation.
        // This entry moving ALONGSIDE many ship entries means "the corpus changed"; ship entries
        // moving while this one holds still means "the engine changed".
        const rows = loadShipSkillRecords();
        const digest = rows
            .map(
                (r) =>
                    `${r.name}|${r.active.length}|${r.charge.length}|${r.passives.join('').length}`
            )
            .sort()
            .join('\n');
        let hash = 0;
        for (let i = 0; i < digest.length; i++) hash = (hash * 31 + digest.charCodeAt(i)) | 0;
        expect({ shipCount: rows.length, digest: hash }).toMatchSnapshot();
    });
});
