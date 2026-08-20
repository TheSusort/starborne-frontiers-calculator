/**
 * SP-4d Task 7 migrated this file's three SP-4c-2b residual tripwires; Task 8 now retires the
 * third and last one. All three are RETIRED.
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
 *   (b) the phantom booking of a footprint of 1 for `enemies-hit-this-cast` on a cast that
 *       resolved no victim — SP-4d Task 8 fixed all three `enemiesHitThisCastByActor.set(...)`
 *       booking sites in engine.ts (focus/team/enemy) to `aoeVictimIds?.length ?? (<a victim
 *       resolved this turn> ? 1 : 0)`, replacing the unconditional `?? 1`, and the SAME fix at the
 *       cast-path ctx (playerTurn.ts:2687) restored a genuine single-target cast's footprint to 1
 *       (a regression an earlier task introduced by dropping that site's `?? 1` outright).
 *       Discharged by `enemiesHitThisCastFootprint.integration.test.ts`'s drain-booking describe
 *       block — "a FOCUS cast that resolves NO victim: an `eq 0` reactive gate FIRES" and its
 *       WALKED-TEAM mirror — both mutation-verified against the old `?? 1` expression. The
 *       cast-path half (the single-target regression, and the same no-victim value) is pinned by
 *       that file's cast-path describe block via a direct `runPlayerTurn` harness (`runCombat`
 *       cannot express the "victim resolved, no AoE footprint computed" shape post-SP-4b-1's
 *       roster-normalization boundary — see that file's header for the measurement).
 *
 * WHAT SURVIVES BELOW, AND WHY:
 *   - the corpus-census non-vacuity check and the `ALLY_TARGET_SHIPS` staleness pin — the spec's
 *     §6 inertness claims (which motivated this file's corpus-scan method in the first place) rest
 *     on this census being real and the ally-target list being complete, so they stay live guards
 *     even with all three cases now discharged elsewhere.
 *
 * The file keeps its name: it was never a name for "three residuals", it is a name for the
 * corpus-scan method this class of residual needs once a phantom cannot be asserted against
 * directly — kept alive here so a FUTURE phantom of this shape has a template to extend rather
 * than reinvent.
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
        // The hardcoded list is this file's own staleness hole — kept live for a FUTURE residual
        // of this shape (see the file header), even though no case below currently filters by it.
        // A resolvability check plus a length pin is the cheap half of the guard — it catches a
        // renamed or removed ship, and it forces anyone who changes the corpus's support roster to
        // come here and re-read what the list is for.
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
            'ALLY_TARGET_SHIPS changed length. Update the count here — this pin exists so a future ' +
                'residual of this shape starts from an accurate list, not a silently stale one.'
        ).toBe(24);
    });

    it('is non-vacuous: the corpus scan really produces conditions', () => {
        // Without this, a parser/loader change that yields zero abilities would make a future
        // residual case built on this scan pass trivially — the classic "green because nothing was
        // observed" failure. Kept live alongside the census above for the same reason.
        const rows = allCorpusConditions();
        expect(rows.length).toBeGreaterThan(100);
        expect(rows.filter((r) => r.cond.subject === 'hp-threshold').length).toBeGreaterThan(0);
    });
});
