/**
 * Decides whether a ship's candidate skill text may replace its current text. Two gates compose
 * (`combineGates`):
 *
 * - `auditGate` fails on an `audit:skills` finding the candidate has and the current text does
 *   not. Findings are compared by (slot, rule) with multiplicity; clause wording is ignored. The
 *   audit sees coverage gaps only.
 * - `structuralGate` fails when the candidate's parse loses, gains, retargets or retriggers an
 *   ability: any difference in the multiset of `abilitySignature`s, per slot, at refit 0, 2 and 4.
 *   It catches a reword that changes what the parse produces. A reword that keeps every signature
 *   but changes a config value still passes; the report's per-clause before/after is the record.
 *
 * Ship-level flags (`ignoresStealth`, `doesntBreakStasis`) are not slot abilities, so neither
 * gate sees a change to one.
 */
import { findingsForShip, type Finding, type ShipRow } from '../auditSkills';
import type { SkillColumn, SkillColumns } from './catalogueMapping';
import type { ShipSkillRecord } from './shipSkillCsv';
import { diffCorpora, type ParseDiffRow } from './skillParseDiff';
import { slotParser } from './skillSlotParser';
import type { Ship } from '../../src/types/ship';

export interface GateResult {
    pass: boolean;
    newFindings: string[];
    /** Findings `acceptingFor` let through; present only when there are some. */
    accepted?: string[];
}
/** Template fields handed to the parse with the text; the role (`type`) decides some recipients. */
export interface GateShip {
    type?: string | null;
    faction?: string | null;
}
export type SkillGate = (shipName: string, before: SkillColumns, after: SkillColumns, ship?: GateShip) => GateResult;

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

const isBlankSkills = (skills: SkillColumns): boolean =>
    (Object.keys(SLOT_OF) as SkillColumn[]).every((c) => !skills[c]?.trim());

const recordOf = (name: string, skills: SkillColumns): ShipSkillRecord => ({
    name,
    active: skills.active_skill_text ?? '',
    charge: skills.charge_skill_text ?? '',
    chargeCharge: 0,
    passives: [
        skills.first_passive_skill_text ?? '',
        skills.second_passive_skill_text ?? '',
        skills.third_passive_skill_text ?? '',
    ],
});

const slotLabel = (r: ParseDiffRow): string => (r.slot === 'passive' ? `passive R${r.refit}` : r.slot);

/**
 * Parses both texts on a ship built from `ship` alone (no docs/ reference data), so it runs
 * wherever the sync runs. A ship with no current text passes: there is no parse to compare.
 */
export const structuralGate: SkillGate = (shipName, before, after, ship = {}) => {
    if (isBlankSkills(before)) return { pass: true, newFindings: [] };
    const base = { type: ship.type ?? undefined, faction: ship.faction ?? undefined } as Partial<Ship>;
    const parse = slotParser(() => base);
    const rows = diffCorpora([recordOf(shipName, before)], [recordOf(shipName, after)], parse);
    const newFindings = rows.flatMap((r) => [
        ...r.lost.map((sig) => `${slotLabel(r)} · lost ${sig}`),
        ...r.gained.map((sig) => `${slotLabel(r)} · gained ${sig}`),
    ]);
    return { pass: newFindings.length === 0, newFindings };
};

/** Passes only when every gate passes; findings and accepted findings concatenate in gate order. */
export const combineGates =
    (...gates: SkillGate[]): SkillGate =>
    (shipName, before, after, ship) => {
        const results = gates.map((g) => g(shipName, before, after, ship));
        const accepted = results.flatMap((r) => r.accepted ?? []);
        return {
            pass: results.every((r) => r.pass),
            newFindings: results.flatMap((r) => r.newFindings),
            ...(accepted.length ? { accepted } : {}),
        };
    };

/**
 * `gate`, except that a failure for a ship named in `names` (case-insensitive) passes, with its
 * findings moved to `accepted` so the report still lists them. Only `gate`'s own findings are
 * accepted: wrap one gate, then combine it with the others.
 */
export const acceptingFor = (names: Iterable<string>, gate: SkillGate): SkillGate => {
    const accept = new Set([...names].map((n) => n.toLowerCase()));
    return (shipName, before, after, ship) => {
        const r = gate(shipName, before, after, ship);
        if (r.pass || !accept.has(shipName.toLowerCase())) return r;
        return { pass: true, newFindings: [], accepted: [...(r.accepted ?? []), ...r.newFindings] };
    };
};
