import { describe, it, expect } from 'vitest';
import { collectFindings, csvAvailable, ungatedFinding } from '../../../../scripts/auditSkills';
import { Ability } from '../../../types/abilities';

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

/**
 * Damage-reaction parity (Phase 4c PR 1): self-subject "when directly damaged" /
 * "when critically hit" clauses are parser-modeled (on-attacked trigger), so an effect
 * from such a clause that parses UNGATED on-cast is a parser regression the audit must
 * FLAG — not skip via the blanket reactive-trigger exclusion. Ally-subject reactions
 * stay skipped (4c PR 2 deferral), as do reactive triggers we don't model at all.
 */
describe('ungatedFinding damage-reaction parity', () => {
    const ungatedBuff = (buffName: string): Ability => ({
        id: 'test-buff',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'buff', buffName, parsedEffects: {}, stacks: 1, isStackable: false },
    });

    it('flags a self-subject damage-reaction clause whose effect parsed ungated on-cast', () => {
        const plain = 'When directly damaged, this Unit gains Fortify II for 1 turn.';
        expect(ungatedFinding([ungatedBuff('Fortify II')], plain)).toContain('Fortify II');
    });

    it('flags a crit-hit reaction clause whose effect parsed ungated on-cast', () => {
        const plain = 'When this Unit is critically hit, it gains Defense Up III for 2 turns.';
        expect(ungatedFinding([ungatedBuff('Defense Up III')], plain)).toContain('Defense Up III');
    });

    it('flags an ally-subject damage-reaction clause whose effect parsed ungated on-cast', () => {
        // Flipped in 4c PR 2 Task 7: the detector now classifies ally-subject reactions
        // (on-ally-attacked), so the parity guard covers them too — buildShipAbilities
        // assigns the trigger, meaning a real-corpus build never parses these ungated.
        // auditSkills' own ally-reaction comments/skip-list get reconciled in Task 10.
        const plain = 'When an ally is directly damaged, this Unit gains Fortify II for 1 turn.';
        expect(ungatedFinding([ungatedBuff('Fortify II')], plain)).toContain('Fortify II');
    });

    it('still skips reactive triggers the parser does not model (on-kill)', () => {
        const plain = 'Upon killing an enemy, this Unit gains Stealth for 1 turn.';
        expect(ungatedFinding([ungatedBuff('Stealth')], plain)).toBeNull();
    });

    it('still flags non-reactive trigger phrasing (existing behaviour)', () => {
        const plain = 'While afflicted with a debuff, this Unit gains Attack Up I.';
        expect(ungatedFinding([ungatedBuff('Attack Up I')], plain)).toContain('Attack Up I');
    });
});
