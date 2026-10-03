import { describe, it, expect, beforeAll } from 'vitest';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import { buildScenarioBattle, SEED } from '../kitFingerprintScenarios';
import { runSeededBattle } from '../../../simulator/seededRuns';
import { resolveSubjectActorId } from '../placementSymmetry';
import { fingerprintActor } from '../fingerprint';
import { PLACEMENTS, type Placement } from '../types';

/**
 * TRIAGE VERDICT — the placement-symmetry sweep's "Apex fires `shield-destroyed` as `enemy` but
 * never as `focus`/`team`" finding (#356) is SEED NOISE: `shield-destroyed` is a landing-roll
 * outcome, not a path, and on this window it appears on no placement.
 *
 * Apex's refit-active passive grants it a Shield worth 3% of max HP every time an enemy gets
 * debuffed, and its active inflicts two debuffs on EVERY enemy its pattern strikes (the plain
 * scenario puts two enemies in it), so each cast grants once per debuff per struck enemy — the
 * pool grows far faster than the board's incoming damage drains it. `shield-destroyed` only emits
 * when a direct hit takes a non-empty pool to exactly 0 (engine.ts), which needs a round where
 * Apex's debuffs fail to land at all, so the standing pool gets spent before the next grant
 * refills it. That is a landing roll on every struck enemy at once, and over the window below it
 * never happens on any placement: the kind appears nowhere, symmetrically.
 *
 * The fewer enemies a cast debuffs, the more often that roll fails and the kind appears — at
 * DIFFERENT seeds per placement, because the RNG is ownerId-keyed. So if `shield-destroyed`
 * appears on one placement only, that is landing-roll noise, not a path gap — the grant arm below
 * is what separates the two.
 */

const BASE_SEED = SEED; // 20260805 — the sweep's own default base seed
const WINDOW = 100;

describe('Apex `shield-destroyed` is placement-symmetric', () => {
    const hitOffsets: Record<Placement, number[]> = { focus: [], team: [], enemy: [] };
    const grantCounts: Record<Placement, number> = { focus: 0, team: 0, enemy: 0 };

    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                    '(gitignored reference data) — this triage needs the real Apex kit.'
            );
        }
        const subject = buildTraceShip('Apex');
        if (!subject) throw new Error('Apex did not resolve from the corpus');
        for (const placement of PLACEMENTS) {
            for (let i = 0; i < WINDOW; i++) {
                const result = runSeededBattle(
                    buildScenarioBattle(subject, 'plain', placement),
                    BASE_SEED + i
                );
                const kinds = fingerprintActor(
                    result,
                    resolveSubjectActorId(result, 'plain', placement)
                );
                if (kinds.has('shield-destroyed')) hitOffsets[placement].push(i);
                if (kinds.has('shield')) grantCounts[placement]++;
            }
        }
    });

    it('no placement destroys the shield inside the window — the asymmetry is gone', () => {
        expect(hitOffsets).toEqual({ focus: [], team: [], enemy: [] });
    });

    it('and the shield GRANT itself is not path-gated at all — every seed, every placement', () => {
        // Separates "the passive never fires on this path" (a real gap) from "the pool never
        // happened to reach exactly 0" (this verdict). If a future change makes a placement stop
        // granting, this arm fails and the verdict above stops being the right explanation.
        for (const placement of PLACEMENTS) {
            expect(grantCounts[placement], `${placement} shield grants`).toBe(WINDOW);
        }
    });
});
