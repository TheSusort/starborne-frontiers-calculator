import { describe, it, expect } from 'vitest';
import { collectFindings, csvAvailable } from '../../../../scripts/auditSkills';

/**
 * Regression guard for parser coverage. Runs the skill audit over docs/ship-skills.csv and
 * fails if any non-allowlisted coverage gap appears — catching a parser regression or new ship
 * data that introduces an unhandled mechanic.
 *
 * The reference CSV is gitignored (dev-only), so this skips in CI / clean checkouts. Triage a
 * failure by running `npm run audit:skills` and reading docs/skill-audit.md: fix the gap, or
 * add an intentional case to scripts/auditSkills.allowlist.ts.
 */
describe('skill parser coverage audit', () => {
    it.skipIf(!csvAvailable())('has zero non-allowlisted findings', () => {
        const { findings, shipCount } = collectFindings();
        expect(shipCount).toBeGreaterThan(0);
        // Surface the offending entries in the failure message.
        const summary = findings.map((f) => `${f.ship}/${f.slot} [${f.rule}]: ${f.clause}`);
        expect(summary).toEqual([]);
    });
});
