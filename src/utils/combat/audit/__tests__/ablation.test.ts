import { describe, it, expect, beforeAll } from 'vitest';
import { runAblation } from '../ablation';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../../types/ship';

// Real ships resolved from docs/ship-skills.csv via buildTraceShip, same loader convention
// as classes.test.ts / invariants.test.ts / reproducibility.test.ts.
//
// Vanguard (attacker, ignores Taunt/Provoke, plain damage kit) + Hermes (healer whose first
// passive is "When an ally critically hits an enemy, this Unit gains 1 charge to its Charged
// Skill" — a reactive trigger that can ONLY fire when there's an ally to crit) are a plausible
// combining-changes-behavior pair: Hermes solo has no ally, so the on-ally-crit charge-gain
// path is structurally unreachable solo but reachable in the {Vanguard, Hermes} composition.
// We do NOT hard-assert `diverges` for this real pair (RNG-gated on a crit landing within the
// round budget) — only the AblationResult SHAPE and determinism, per the oracle's noisy-by-
// design contract (its output is needs-triage, never a confirmed finding).
function requireCsv(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                'tests need it to resolve real ship skill text.'
        );
    }
}

describe('runAblation', () => {
    beforeAll(() => {
        requireCsv();
    });

    it('returns an AblationResult shape (boolean diverges, non-empty detail) for a real pair', () => {
        const a = buildTraceShip('Vanguard') as Ship;
        const b = buildTraceShip('Hermes') as Ship;
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();

        const result = runAblation(a, b, 1);

        expect(typeof result.diverges).toBe('boolean');
        expect(typeof result.detail).toBe('string');
        expect(result.detail.length).toBeGreaterThan(0);
    });

    it('is deterministic: the same ships + seed give the same result on repeated calls', () => {
        const a = buildTraceShip('Vanguard') as Ship;
        const b = buildTraceShip('Hermes') as Ship;

        const r1 = runAblation(a, b, 7);
        const r2 = runAblation(a, b, 7);

        expect(r2).toEqual(r1);
    });

    it('returns a well-formed result for a second, unrelated pair (two plain attackers)', () => {
        // Bedrock/Crusher are both plain 90%-damage attackers with no charge/passives (the
        // same "no interaction primitives" ships classes.test.ts documents) — a low-interaction
        // control pair, still asserted structurally rather than diverges===false to avoid
        // coupling to engine specifics (RNG-gated crit fingerprints can still differ).
        const a = buildTraceShip('Crusher') as Ship;
        const b = buildTraceShip('Custodian') as Ship;

        const result = runAblation(a, b, 3);

        expect(typeof result.diverges).toBe('boolean');
        expect(typeof result.detail).toBe('string');
        expect(result.detail.length).toBeGreaterThan(0);
    });
});
