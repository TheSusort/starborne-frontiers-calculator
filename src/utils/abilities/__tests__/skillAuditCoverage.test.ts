import { describe, it, expect } from 'vitest';
import {
    collectFindings,
    csvAvailable,
    findingsForShip,
    ruleById,
    ungatedFinding,
} from '../../../../scripts/auditSkills';
import { Ability, Condition, ScalingRule } from '../../../types/abilities';

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
 * Damage-reaction parity (Phase 4c): self-subject "when directly damaged" / "when
 * critically hit" clauses (PR 1, on-attacked) and ally-subject "when an ally is directly
 * damaged / is critically hit" clauses (PR 2, on-ally-attacked) are parser-modeled, so an
 * effect from such a clause that parses UNGATED on-cast is a parser regression the audit
 * must FLAG — not skip via the reactive-trigger exclusion. Reactive triggers the parser
 * does not model at all (on-kill, Panon's "If directly damaged", Provider's ally-outgoing
 * inflicts-a-debuff) stay skipped.
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
        // Flipped in 4c PR 2 Task 7: the detector classifies ally-subject reactions
        // (on-ally-attacked), so the parity guard covers them too — buildShipAbilities
        // assigns the trigger, meaning a real-corpus build never parses these ungated.
        // auditSkills' INTENTIONAL_REACTIVE_RE no longer skips ally-damage shapes (Task 10).
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

/**
 * HP-threshold parity: "when HP drops/falls below N%" CROSSING grants
 * (Tycho/Shelter/Los/Kafa/Redeemer) ride the on-hp-threshold-crossed trigger and Hermes's
 * "If an ally has less than N% HP" Cheat-Death grant carries a per-recipient HP filter —
 * both parser-modeled, so an effect from such a clause that parses UNGATED on-cast is a parser
 * regression the audit must FLAG via the detectHpCrossingTrigger / detectTargetHpGate parity
 * guards. STATIC "while its HP is below N%" gates (no drops/falls verb) stay skipped.
 */
describe('ungatedFinding hp-threshold parity', () => {
    const ungatedBuff = (buffName: string): Ability => ({
        id: 'test-buff',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'buff', buffName, parsedEffects: {}, stacks: 1, isStackable: false },
    });

    it('flags a "when HP drops below N%" crossing clause whose effect parsed ungated on-cast', () => {
        const plain = 'Once per battle, when HP drops below 40%, this Unit gains Cheat Death.';
        expect(ungatedFinding([ungatedBuff('Cheat Death')], plain)).toContain('Cheat Death');
    });

    it('flags a "when HP falls below N%" crossing clause whose effect parsed ungated on-cast', () => {
        const plain =
            'Once per battle when HP falls below 50%, this Unit gains Everliving Regeneration III.';
        expect(ungatedFinding([ungatedBuff('Everliving Regeneration III')], plain)).toContain(
            'Everliving Regeneration III'
        );
    });

    it('flags Hermes\'s "If an ally has less than N% HP" Cheat-Death gate parsed ungated', () => {
        const plain = 'If an ally has less than 40% HP, it grants that ally Cheat Death.';
        expect(ungatedFinding([ungatedBuff('Cheat Death')], plain)).toContain('Cheat Death');
    });

    it('still skips a static "while its HP is below N%" gate (no drops/falls verb)', () => {
        // A standing gate carries no crossing verb — HP_CROSSING_RE skips it, so it falls
        // through to the INTENTIONAL_REACTIVE_RE "hp is below" skip rather than flagging.
        const plain = 'When its HP is below 50%, this Unit gains Attack Up III.';
        expect(ungatedFinding([ungatedBuff('Attack Up III')], plain)).toBeNull();
    });
});

describe('instead-replacement rule', () => {
    const gallant =
        'This Unit deals <unit-damage>115% damage</unit-damage>, if the target is a defender it instead deals <unit-damage>155% damage</unit-damage>.';
    const rulesFor = (text: string) =>
        findingsForShip({ name: 'Probe', slots: [{ slot: 'active', text }] }).map((f) => f.rule);

    it('accepts the defender-gated "instead deals" shape', () => {
        expect(rulesFor(gallant)).not.toContain('instead-replacement');
    });

    it('still flags an "instead deals" clause with no modelled gate', () => {
        const text =
            'This Unit deals <unit-damage>115% damage</unit-damage>, if it is a full moon it instead deals <unit-damage>155% damage</unit-damage>.';
        expect(rulesFor(text)).toContain('instead-replacement');
    });

    describe('handled predicate', () => {
        const { handled } = ruleById('instead-replacement');
        const damage = (conditions: Condition[], scaling?: ScalingRule): Ability => ({
            id: 'test-damage',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions,
            ...(scaling ? { scaling } : {}),
            config: { type: 'damage', multiplier: 115 },
        });
        const defenderGate: Condition = {
            subject: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
        };

        it('does not accept an enemy-type gate with no replacement delta', () => {
            expect(handled([damage([defenderGate])], '')).toBe(false);
        });

        it('accepts an enemy-type gate carrying the replacement delta as scaling', () => {
            expect(handled([damage([defenderGate], { conditionIndex: 0, perUnit: 40 })], '')).toBe(
                true
            );
        });

        it("accepts Panon's negated-base plus anyOf-replacement pair", () => {
            const negatedBase = damage([
                {
                    subject: 'self-buff',
                    derivable: true,
                    countComparator: 'eq',
                    countThreshold: 0,
                },
            ]);
            const replacement = damage([
                { subject: 'self-buff', derivable: true, buffName: 'Taunt', anyOf: true },
                { subject: 'self-buff', derivable: true, buffName: 'Provoke', anyOf: true },
            ]);
            expect(handled([negatedBase, replacement], '')).toBe(true);
        });
    });
});

describe('findingsForShip reads catalogue status-name spellings', () => {
    // The parse names the buff by its engine name (Tianchao Precision II); the clause lookup must
    // find that name in the text, so the text is canonicalised before the audit reads it.
    const text =
        'This Unit deals <unit-damage>100% damage</unit-damage>. This Unit gains <unit-skill>Tianchen Precision II</unit-skill> for 2 turns while an ally is in Stealth. It gains <unit-skill>Attack Up I</unit-skill> every turn.';

    it("scopes an ungated finding to the aliased buff's own clause", () => {
        const findings = findingsForShip({
            name: 'AuditAliasShip',
            slots: [{ slot: 'active', text }],
        });
        expect(findings).toEqual([
            expect.objectContaining({
                rule: 'ungated-effect-with-trigger',
                clause: 'This Unit gains Tianchao Precision II for 2 turns while an ally is in Stealth.',
            }),
        ]);
    });
});

describe('base-damage audit rule keyword', () => {
    const rules = (text: string) =>
        findingsForShip({ name: 'RuleProbe', slots: [{ slot: 'passive1', text }] }).map(
            (f) => f.rule
        );

    it('does not read "N% damage reduction" as base damage', () => {
        expect(rules('This Unit has 35% damage reduction from critical hits.')).not.toContain(
            'base-damage'
        );
    });

    it('still flags a real damage clause the parse does not handle', () => {
        expect(rules('Something unparseable deals 120% damage to the target.')).toContain(
            'base-damage'
        );
    });
});
