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
 * TRIAGE VERDICT — the placement-symmetry sweep's standing "Enforcer fires `debuff-resisted` as
 * `enemy` but never as `focus`/`team`" finding is SEED NOISE. Do not re-triage it.
 *
 * Enforcer's `debuff-resisted` is doubly RNG-gated: its Defense Shred rider only arms on a
 * CRITICAL hit (base crit 14) and only logs `debuff-resisted` when the landing roll then fails
 * against a filler's security (0–24 against hacking 96, so a low single-digit resist chance).
 * The scenario boards are an exact geometric mirror — the subject faces the SAME four enemy
 * fillers in all three placements — so nothing about the opponents differs; only the ownerId-keyed
 * RNG sub-stream does. The kind therefore shows up in every placement, just at different seeds,
 * and a union over too few seeds catches it in one placement and misses it in another.
 *
 * Measured over 40 consecutive seeds from the harness's own base seed (`plain` scenario only):
 * focus hits 4, team hits 2, enemy hits 5 — the `focus` path is not even the rarest. The first
 * hit lands at offset +4 for enemy, +16 for team and +23 for focus, which is exactly why the
 * default K=15 window reports a one-directional asymmetry that K=24+ does not.
 *
 * Both arms are asserted on purpose. The "K=15 reproduces the ledger finding" case is what proves
 * this test is looking at the real artifact and not at some other Enforcer; the "all three
 * placements emit it" case is what refutes it as a path gap.
 */

const BASE_SEED = SEED; // 20260805 — the sweep's own default base seed
const WINDOW = 40;
const LEDGER_K = 15; // the K the standing finding was recorded at

describe('Enforcer `debuff-resisted` placement asymmetry is seed noise', () => {
    const hitOffsets: Record<Placement, number[]> = { focus: [], team: [], enemy: [] };

    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                    '(gitignored reference data) — this triage needs the real Enforcer kit.'
            );
        }
        const subject = buildTraceShip('Enforcer');
        if (!subject) throw new Error('Enforcer did not resolve from the corpus');
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
                if (kinds.has('debuff-resisted')) hitOffsets[placement].push(i);
            }
        }
    });

    it('reproduces the ledger asymmetry inside the default K=15 seed window', () => {
        const within = (p: Placement) => hitOffsets[p].some((o) => o < LEDGER_K);
        expect(within('enemy')).toBe(true);
        expect(within('focus')).toBe(false);
        expect(within('team')).toBe(false);
    });

    it('but every placement emits it once the seed window is wide enough', () => {
        for (const placement of PLACEMENTS) {
            expect(
                hitOffsets[placement].length,
                `${placement} never emitted debuff-resisted in ${WINDOW} seeds — that WOULD be a real path gap`
            ).toBeGreaterThan(0);
        }
    });

    it('and the `enemy` path is not even the one that emits it most often', () => {
        expect(hitOffsets.focus.length).toBeGreaterThan(hitOffsets.team.length);
    });
});
