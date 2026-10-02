import { describe, it, expect } from 'vitest';
import {
    compareFindings,
    auditGate,
    structuralGate,
    combineGates,
    acceptingFor,
    syncGate,
    EMPTY_SKILLS,
    type SkillGate,
} from '../skillTextGate';
import { staleAllowEntries, type Finding } from '../../auditSkills';

describe('staleAllowEntries', () => {
    const audited = new Set(['A']);
    const entry = (catalogueOnly?: boolean) => ({
        ship: 'A',
        rules: ['r'],
        reason: 'x',
        ...(catalogueOnly ? { catalogueOnly } : {}),
    });

    it('reports an audited, unconsulted entry as stale', () => {
        expect(staleAllowEntries([entry()], audited, new Set())).toHaveLength(1);
    });

    it('does not report a catalogueOnly entry as stale', () => {
        expect(staleAllowEntries([entry(true)], audited, new Set())).toEqual([]);
    });

    it('does not report a consulted entry', () => {
        expect(staleAllowEntries([entry()], audited, new Set(['A::r']))).toEqual([]);
    });
});

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

const skills = (passive: string) => ({ ...EMPTY_SKILLS, first_passive_skill_text: passive });

describe('structuralGate', () => {
    it('holds a reword that demotes a kill trigger to on-cast', () => {
        // Stand-in wording the parser does NOT recognise as a kill reaction, so the buff falls to on-cast.
        const before = skills('When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.');
        const after = skills('This Unit gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns whenever a foe is vanquished.');
        const r = structuralGate('Gallant', before, after);
        expect(r.pass).toBe(false);
        expect(r.newFindings.join(' ')).toMatch(/on-enemy-destroyed/);
    });

    it('names the slot and refit of each lost and gained signature', () => {
        const r = structuralGate(
            'Gallant',
            skills('When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.'),
            skills('This Unit gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns whenever a foe is vanquished.')
        );
        expect(r.newFindings).toEqual([
            'passive R0 · lost buff|self|on-enemy-destroyed|Legion Discipline I',
            'passive R0 · gained buff|self|on-cast|Legion Discipline I',
        ]);
    });

    it('reads a refit passive at its own refit level', () => {
        const base = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
        const r = structuralGate(
            'Gallant',
            { ...skills(base), second_passive_skill_text: 'When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.' },
            { ...skills(base), second_passive_skill_text: 'This Unit gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns whenever a foe is vanquished.' }
        );
        expect(r.newFindings[0]).toMatch(/^passive R2 · lost /);
        expect(r.newFindings.some((f) => f.startsWith('passive R0'))).toBe(false);
    });

    it('passes a number change that keeps every signature', () => {
        const r = structuralGate('X', skills('This Unit deals <unit-damage>100% damage</unit-damage>.'), skills('This Unit deals <unit-damage>120% damage</unit-damage>.'));
        expect(r.pass).toBe(true);
    });

    it('passes a ship with no current text: there is no parse to compare against', () => {
        expect(structuralGate('New', EMPTY_SKILLS, skills('When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.'))).toEqual({
            pass: true,
            newFindings: [],
        });
    });

    it('parses with the ship role it is given', () => {
        // A bare cleanse-triggered repair goes to the cleansed ally only for a SUPPORTER.
        const heal = 'When this Unit cleanses a <unit-aid>debuff</unit-aid>, it repairs <unit-aid>10%</unit-aid> of its max HP.';
        const r = structuralGate('S', skills(heal), skills('This Unit deals <unit-damage>100% damage</unit-damage>.'), { type: 'SUPPORTER' });
        expect(r.newFindings).toContain('passive R0 · lost heal|ally|on-own-cleanse|heal');
    });
});

describe('combineGates', () => {
    it('combineGates fails when either gate fails and reports both', () => {
        const pass = () => ({ pass: true, newFindings: [] });
        const fail = () => ({ pass: false, newFindings: ['x'] });
        expect(combineGates(pass, fail)('S', EMPTY_SKILLS, EMPTY_SKILLS)).toEqual({ pass: false, newFindings: ['x'] });
    });

    it('concatenates findings and accepted findings in gate order', () => {
        const a: SkillGate = () => ({ pass: false, newFindings: ['a'] });
        const b: SkillGate = () => ({ pass: true, newFindings: [], accepted: ['b'] });
        const c: SkillGate = () => ({ pass: false, newFindings: ['c'] });
        expect(combineGates(a, b, c)('S', EMPTY_SKILLS, EMPTY_SKILLS)).toEqual({
            pass: false,
            newFindings: ['a', 'c'],
            accepted: ['b'],
        });
    });

    it('hands every gate the ship it is given', () => {
        const seen: unknown[] = [];
        const spy: SkillGate = (_n, _b, _a, ship) => (seen.push(ship), { pass: true, newFindings: [] });
        combineGates(spy, spy)('S', EMPTY_SKILLS, EMPTY_SKILLS, { type: 'DEFENDER' });
        expect(seen).toEqual([{ type: 'DEFENDER' }, { type: 'DEFENDER' }]);
    });
});

describe('acceptingFor', () => {
    const fail: SkillGate = () => ({ pass: false, newFindings: ['passive R0 · lost x'] });

    it('passes a listed ship and reports its findings as accepted', () => {
        expect(acceptingFor(['Gallant'], fail)('Gallant', EMPTY_SKILLS, EMPTY_SKILLS)).toEqual({
            pass: true,
            newFindings: [],
            accepted: ['passive R0 · lost x'],
        });
    });

    it('matches names case-insensitively', () => {
        expect(acceptingFor(['gallant'], fail)('Gallant', EMPTY_SKILLS, EMPTY_SKILLS).pass).toBe(true);
    });

    it('still holds a ship that is not listed', () => {
        expect(acceptingFor(['Other'], fail)('Gallant', EMPTY_SKILLS, EMPTY_SKILLS)).toEqual({
            pass: false,
            newFindings: ['passive R0 · lost x'],
        });
    });

    it('accepts only the wrapped gate: an audit finding on a listed ship still holds', () => {
        const audit: SkillGate = () => ({ pass: false, newFindings: ['passive1 · always-crit: x'] });
        const r = combineGates(audit, acceptingFor(['Gallant'], fail))('Gallant', EMPTY_SKILLS, EMPTY_SKILLS);
        expect(r).toEqual({ pass: false, newFindings: ['passive1 · always-crit: x'], accepted: ['passive R0 · lost x'] });
    });
});

describe('syncGate', () => {
    const kill = 'When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.';
    // Replaces the kill buff with a plain attack: a parse change the audit rules do not flag.
    const replaced = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
    const alwaysCrit = "This Unit's attacks are always critical.";

    it('holds a pure structural change unless the ship is accepted', () => {
        expect(syncGate(new Set())('X', skills(kill), skills(replaced)).pass).toBe(false);
        const r = syncGate(new Set(['X']))('X', skills(kill), skills(replaced));
        expect(r.pass).toBe(true);
        expect(r.accepted?.join(' ')).toMatch(/lost buff\|self\|on-enemy-destroyed/);
    });

    it('holds an audit-only finding, accepted or not', () => {
        // The always-crit sentence parses to nothing, so the slot's signatures are unchanged.
        const before = skills(kill);
        const after = skills(`${kill} ${alwaysCrit}`);
        expect(structuralGate('GateTestShip', before, after)).toEqual({ pass: true, newFindings: [] });
        for (const accept of [new Set<string>(), new Set(['GateTestShip'])]) {
            const r = syncGate(accept)('GateTestShip', before, after);
            expect(r.pass).toBe(false);
            expect(r.newFindings).toEqual([expect.stringMatching(/^passive1 · always-crit: /)]);
            expect(r.accepted).toBeUndefined();
        }
    });
});
