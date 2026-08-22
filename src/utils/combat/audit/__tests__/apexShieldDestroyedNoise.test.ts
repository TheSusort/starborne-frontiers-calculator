import { describe, it, expect, beforeAll } from 'vitest';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import { buildScenarioBattle, SEED } from '../kitFingerprintScenarios';
import { runSeededBattle } from '../seededBattle';
import { resolveSubjectActorId } from '../placementSymmetry';
import { fingerprintActor } from '../fingerprint';
import { PLACEMENTS, type Placement } from '../types';

/**
 * TRIAGE VERDICT — the placement-symmetry sweep's "Apex fires `shield-destroyed` as `enemy` but
 * never as `focus`/`team`" finding (#356) is SEED NOISE. Do not re-triage it.
 *
 * Apex's refit-active passive grants it a Shield worth 3% of max HP (355) every time an enemy gets
 * debuffed, and its active inflicts two debuffs per cast — so the pool GROWS faster than the
 * board's incoming damage drains it. `shield-destroyed` only emits when a direct hit takes a
 * non-empty pool to exactly 0 (engine.ts), which here needs a round where Apex's debuffs fail to
 * land at all, so the standing pool gets spent before the next grant refills it. That is a landing
 * roll, and the RNG is ownerId-keyed and re-drawn per placement, so the kind appears in every
 * placement at DIFFERENT seeds.
 *
 * Measured over 180 consecutive seeds from the harness's own base seed, all three scenarios
 * (occurrences / 540 runs): focus 3, team 12, enemy 21 — every hit reproduced identically in all
 * three scenarios, i.e. the scenario tap does not move this draw. `plain`-only first-hit offsets
 * are +45 (focus), +94 (team) and +20 (enemy), which is exactly why the K=45 sweep the issue was
 * filed from reported enemy 6/135 and a clean 0 on the other two: focus's first hit sits one seed
 * PAST the window and team's is more than twice as far out.
 *
 * The trajectories on the firing seeds are the same shape on both sides — `enemy` +20 and `focus`
 * +45 both grant in round 1, grant nothing in round 2 and destroy in round 3, on mirrored turn
 * orders — which is what rules out a path gap rather than merely failing to prove one.
 *
 * Unlike the Enforcer verdict, `enemy` IS the most frequent path here. That is not evidence either
 * way: the ranking rule is survival across seeds, never direction or frequency agreement.
 */

const BASE_SEED = SEED; // 20260805 — the sweep's own default base seed
const WINDOW = 100;
const LEDGER_K = 45; // the K the standing finding was recorded at

describe('Apex `shield-destroyed` placement asymmetry is seed noise', () => {
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

    it('reproduces the ledger asymmetry inside the K=45 seed window it was filed at', () => {
        const within = (p: Placement) => hitOffsets[p].some((o) => o < LEDGER_K);
        expect(within('enemy')).toBe(true);
        expect(within('focus')).toBe(false);
        expect(within('team')).toBe(false);
    });

    it('but every placement emits it once the seed window is wide enough', () => {
        for (const placement of PLACEMENTS) {
            expect(
                hitOffsets[placement].length,
                `${placement} never emitted shield-destroyed in ${WINDOW} seeds — that WOULD be a real path gap`
            ).toBeGreaterThan(0);
        }
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
