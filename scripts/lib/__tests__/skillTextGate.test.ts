import { describe, it, expect } from 'vitest';
import { compareFindings, auditGate, EMPTY_SKILLS } from '../skillTextGate';
import type { Finding } from '../../auditSkills';

const f = (slot: string, rule: string, clause = 'x'): Finding => ({
    ship: 'S', slot, rule, severity: 'high', clause,
});

describe('compareFindings', () => {
    it('passes when the candidate adds nothing', () => {
        expect(compareFindings([f('active', 'base-damage')], [])).toEqual({ pass: true, newFindings: [] });
    });

    it('fails on a finding the current text lacks', () => {
        expect(compareFindings([], [f('charged', 'detonation', 'detonates stuff')])).toEqual({
            pass: false,
            newFindings: ['charged · detonation: detonates stuff'],
        });
    });

    it('counts duplicates: a second copy of an existing finding is new', () => {
        const r = compareFindings([f('active', 'x')], [f('active', 'x'), f('active', 'x')]);
        expect(r.pass).toBe(false);
    });

    it('ignores clause wording when slot and rule match', () => {
        expect(compareFindings([f('active', 'x', 'old')], [f('active', 'x', 'new')]).pass).toBe(true);
    });
});

describe('auditGate (real audit rules)', () => {
    const plain = { ...EMPTY_SKILLS, active_skill_text: 'This Unit deals <unit-damage>150% damage</unit-damage>.' };

    it('passes identical text', () => {
        expect(auditGate('GateTestShip', plain, plain).pass).toBe(true);
    });

    it('fails text carrying a live audit finding', () => {
        // The always-crit rule in auditSkills.ts is never parser-handled by design (`handled: ()
        // => false`), so this clause yields a finding for any ship without an allowlist entry —
        // allowlisting is per ship name, so GateTestShip is not exempt.
        const alwaysCritPassive = "This Unit's attacks are always critical.";
        const r = auditGate('GateTestShip', plain, { ...plain, first_passive_skill_text: alwaysCritPassive });
        expect(r.pass).toBe(false);
        expect(r.newFindings[0]).toMatch(/^passive1 · always-crit/);
    });
});
