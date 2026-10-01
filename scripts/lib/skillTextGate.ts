/**
 * Decides whether a ship's candidate skill text may replace its current text: it may unless the
 * `audit:skills` rules report a finding on the candidate that the current text does not have.
 * Findings are compared by (slot, rule) with multiplicity; clause wording is ignored. The audit
 * detects coverage gaps only — a reword that parses into a different valid ability passes.
 */
import { findingsForShip, type Finding, type ShipRow } from '../auditSkills';
import type { SkillColumn, SkillColumns } from './catalogueMapping';

export interface GateResult {
    pass: boolean;
    newFindings: string[];
}
export type SkillGate = (shipName: string, before: SkillColumns, after: SkillColumns) => GateResult;

export const EMPTY_SKILLS: SkillColumns = {
    active_skill_text: null,
    charge_skill_text: null,
    first_passive_skill_text: null,
    second_passive_skill_text: null,
    third_passive_skill_text: null,
};

const SLOT_OF: Record<SkillColumn, string> = {
    active_skill_text: 'active',
    charge_skill_text: 'charged',
    first_passive_skill_text: 'passive1',
    second_passive_skill_text: 'passive2',
    third_passive_skill_text: 'passive3',
};

const toShipRow = (name: string, skills: SkillColumns): ShipRow => ({
    name,
    slots: (Object.keys(SLOT_OF) as SkillColumn[])
        .map((column) => ({ slot: SLOT_OF[column], text: skills[column] ?? '' }))
        .filter((s) => s.text.trim().length > 0),
});

export const compareFindings = (before: Finding[], after: Finding[]): GateResult => {
    const remaining = new Map<string, number>();
    for (const b of before) {
        const k = `${b.slot}::${b.rule}`;
        remaining.set(k, (remaining.get(k) ?? 0) + 1);
    }
    const newFindings: string[] = [];
    for (const a of after) {
        const k = `${a.slot}::${a.rule}`;
        const left = remaining.get(k) ?? 0;
        if (left > 0) remaining.set(k, left - 1);
        else newFindings.push(`${a.slot} · ${a.rule}: ${a.clause}`);
    }
    return { pass: newFindings.length === 0, newFindings };
};

export const auditGate: SkillGate = (shipName, before, after) =>
    compareFindings(
        findingsForShip(toShipRow(shipName, before)),
        findingsForShip(toShipRow(shipName, after))
    );
