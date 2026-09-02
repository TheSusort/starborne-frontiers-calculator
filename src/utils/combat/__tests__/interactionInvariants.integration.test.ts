import { describe, it, expect, beforeAll } from 'vitest';
import { checkInvariants } from '../audit/invariants';
import { checkReproducibility } from '../audit/reproducibility';
import { composeBattle, type TaggedShip } from '../audit/compose';
import { tagShip } from '../audit/classes';
import { runSeededBattle } from '../audit/seededBattle';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

// Permanent regression gate for the interaction-audit harness. Fuzzes a FIXED small
// seed set (1..25) over the real tagged corpus and asserts the pure result invariants
// (hp-bounds, no-dead-acts, damage-conservation — see audit/invariants.ts) hold for every
// composition, so a future change that reintroduces an interaction bug fails `npm test`.
//
// Corpus-loading pattern matches compose.test.ts / scripts/auditInteractions.ts: names
// collected from BOTH docs/ship-skills.csv and docs/ship-data.json (de-duped
// case-insensitively), resolved via buildTraceShip, filtered for the (should-be-zero) names
// that resolve from neither source. Built ONCE in beforeAll, not per-test, for speed.
//
// Skipped (not failed) when the gitignored docs/ reference data is absent from this worktree
// (fresh worktrees / CI routinely lack it) — see csvAvailable()/shipDataAvailable() below. The
// whole describe is gated via skipIf so nothing (including corpus construction) runs at all in
// that case, matching xcellenceOnResistShieldDamage.integration.test.ts's `describe.skipIf`
// convention rather than throwing at module/collection time.
//
// NOTE — seed↔corpus coupling: the fixed seeds below are coupled to the CURRENT docs/
// reference-data snapshot. A `fetch:ship-data` / `fetch:ship-skills` refresh can reorder,
// rename, or add ships, which can re-roll which ships each seed's composeBattle(seed, tagged)
// draws. If this gate goes red immediately after such a data refresh (with no engine/oracle
// code changed), treat it as a DATA change to investigate first — not necessarily a real
// engine regression.
function buildTaggedCorpus(): TaggedShip[] {
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName()) {
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    }

    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (!ship) continue; // filtered out — no CSV record and no snapshot entry
        tagged.push({ ship, classes: tagShip(ship) });
    }
    return tagged;
}

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'interaction invariants regression gate',
    () => {
        let tagged: TaggedShip[];

        beforeAll(() => {
            tagged = buildTaggedCorpus();
        });

        it('corpus is non-empty', () => {
            expect(tagged.length).toBeGreaterThan(0);
        });

        for (let seed = 1; seed <= 25; seed++) {
            it(`seed ${seed} composition holds all invariants`, () => {
                const input = composeBattle(seed, tagged);
                const result = runSeededBattle(input, seed);
                expect(checkInvariants(result)).toEqual([]);
            });
        }

        // Spot-check reproducibility (two seeded runs of the same input must be byte-identical) on
        // a couple of seeds — cheap, and guards non-RNG nondeterminism (Map iteration order, leaked
        // global state) rather than duplicating the invariant checks above.
        for (const seed of [1, 13]) {
            it(`seed ${seed} composition is reproducible across two runs`, () => {
                const input = composeBattle(seed, tagged);
                expect(checkReproducibility(input, seed)).toEqual([]);
            });
        }
    }
);
