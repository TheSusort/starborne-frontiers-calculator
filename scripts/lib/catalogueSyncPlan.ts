/**
 * Turns a catalogue diff into writes. Pure.
 *
 * Written: base stats (merged into the row's existing base_stats), charge cost, ascension stats,
 * and skill text when `gate` passes. The gate gets the ship's role and faction: the template row's
 * for a matched ship, the catalogue's for a new one. A gate failure holds EVERY text column of that ship (a
 * half-updated kit is worse than an old one) while its other fields still write. Metadata,
 * id mismatches and rows missing from the catalogue are never written — only reported.
 *
 * A matched unit with mapping errors writes nothing at all (`mappingHeld`). A change that would
 * erase a value (`isDroppedField`) is never written: a dropped charge cost is held on its own,
 * and a dropped text column holds all of that ship's text, without consulting the gate.
 *
 * With `textWrites: false` (a stats-only run) no text is written and no ship is inserted.
 *
 * When more than TEXT_CHANGE_HOLD_RATIO of matched ships change skill text, the run treats text as
 * it would on a stats-only run (`bulkTextHold`) unless `allowBulkText` is set: a change that wide
 * means the catalogue's wording moved under the parser, which the gate cannot see. Stats, charge
 * cost and refit stats still write.
 *
 * The whole run halts (writes nothing) when no unit matched a row, or when more than
 * STATS_CHANGE_HALT_RATIO of matched ships change stats: both point at a mapping break.
 *
 * A pinned column (`opts.pins`, default TEXT_PINS) is removed from a ship's text changes before
 * anything else reads them: it is never written, never held, never counts toward the bulk-text
 * ratio, and the gate audits our text in that column. Every pin is listed in `pinned` on every
 * run that does not halt, including one whose catalogue text equals ours and one no matched ship
 * carries, so a pin that has gone stale is visible. A pin whose catalogue text differs from its
 * `ruledAgainst` is `catalogue-changed`, which `syncStatus` raises to `attention`.
 */
import type { CatalogueDiff, Change, TemplateRow, UnitDiff } from './catalogueDiff';
import type { CatalogueTemplate, SkillColumn, SkillColumns } from './catalogueMapping';
import { pinsFor, TEXT_PINS, withPinnedText, type TextPin } from './catalogueTextPins';
import { EMPTY_SKILLS, type GateResult, type SkillGate } from './skillTextGate';

export const STATS_CHANGE_HALT_RATIO = 0.25;
export const TEXT_CHANGE_HOLD_RATIO = 0.25;

/** Why a ship's text was held. `gate` is the only reason under which `RowPatch.gate` is set. */
export type TextHold = 'gate' | 'dropped-field' | 'text-writes-off' | 'bulk-text';

export interface RowPatch {
    id: string;
    name: string;
    patch: Record<string, unknown>;
    applied: Change[];
    heldText: Change[];
    textHold: TextHold | null;
    /** Non-text changes held because they would erase a value. */
    heldDrops: Change[];
    gate: GateResult | null;
}
export interface PlannedInsert {
    row: Record<string, unknown>;
    unit: CatalogueTemplate;
    findings: string[];
}
/**
 * One applied pin. `catalogue-changed`: the catalogue's text is no longer the text the ruling was
 * made on (`ruledAgainst`), whatever it now is; the ruling needs re-asking. Otherwise
 * `overrides-catalogue`: the catalogue's text differs from ours; `catalogue-agrees`: it equals
 * ours. `no-matched-ship`: no matched ship carries the pin's definition id, and `name` is that id.
 * `suppressed` is the text change kept out of the patch, if any. `shipHeld`: the ship was held for
 * mapping errors, so nothing of it is written whatever the pin says.
 */
export interface PinnedSlot {
    name: string;
    column: SkillColumn;
    reason: string;
    state: 'catalogue-changed' | 'overrides-catalogue' | 'catalogue-agrees' | 'no-matched-ship';
    suppressed: Change | null;
    ruledAgainst: string;
    catalogueText: string | null;
    shipHeld: boolean;
}
export interface SyncPlan {
    halted: string | null;
    bulkTextHold: { changed: number; matched: number } | null;
    patches: RowPatch[];
    inserts: PlannedInsert[];
    refusedInserts: { unit: CatalogueTemplate; reason: string }[];
    mappingHeld: { template: TemplateRow; unit: CatalogueTemplate; reasons: string[] }[];
    metadata: { template: TemplateRow; change: Change }[];
    idMismatches: CatalogueDiff['idMismatches'];
    missingFromCatalogue: TemplateRow[];
    matchedCount: number;
    pinned: PinnedSlot[];
}

const isBlank = (v: string | null): boolean => v === null || v.trim() === '';

/** True when a change would turn a present value into null or blank text. */
export const isDroppedField = (c: Change): boolean => {
    if (c.kind === 'skill-text') return !isBlank(c.before) && isBlank(c.after);
    if (c.kind === 'charge-cost') return typeof c.before === 'number' && c.after === null;
    return false;
};

/** Same rule as `addShipTemplate` in src/services/shipTemplateProposalService.ts. */
export const templateIdFor = (name: string): string => name.toUpperCase().replace(/\s+/g, '_');

const skillsOf = (row: TemplateRow): SkillColumns => ({
    active_skill_text: row.active_skill_text,
    charge_skill_text: row.charge_skill_text,
    first_passive_skill_text: row.first_passive_skill_text,
    second_passive_skill_text: row.second_passive_skill_text,
    third_passive_skill_text: row.third_passive_skill_text,
});

const insertRowFor = (unit: CatalogueTemplate): Record<string, unknown> => ({
    id: templateIdFor(unit.name),
    name: unit.name,
    rarity: unit.rarity,
    faction: unit.faction,
    type: unit.type,
    affinity: unit.affinity,
    image_key: unit.imageKey,
    definition_id: unit.definitionId,
    base_stats: { ...unit.baseStats },
    ascension_stats: unit.ascensionStats,
    charge_skill_charge: unit.chargeSkillCharge,
    ...unit.skills,
    // Targeting needs a pattern key, which the catalogue's hex art does not give; lore is manual.
    active_target: null,
    active_pattern: null,
    charged_target: null,
    charged_pattern: null,
    bio: null,
    quote: null,
    quote_author: null,
});

const emptyPlan = (diff: CatalogueDiff): SyncPlan => ({
    halted: null,
    bulkTextHold: null,
    patches: [],
    inserts: [],
    refusedInserts: [],
    mappingHeld: [],
    metadata: [],
    idMismatches: diff.idMismatches,
    missingFromCatalogue: diff.missingFromCatalogue,
    matchedCount: diff.matched.length,
    pinned: [],
});

const isPinnedText = (c: Change, pins: TextPin[]): boolean =>
    c.kind === 'skill-text' && pins.some((p) => p.column === c.column);

/** Each matched ship's changes with its pinned text columns removed, and every pin as a slot. */
const applyPins = (matched: UnitDiff[], pins: readonly TextPin[]): { matched: UnitDiff[]; pinned: PinnedSlot[] } => {
    const pinned: PinnedSlot[] = [];
    const out = matched.map((m) => {
        const own = pinsFor(m.unit.definitionId, pins);
        for (const p of own) {
            const suppressed = m.changes.find((c) => c.kind === 'skill-text' && c.column === p.column) ?? null;
            const catalogueText = m.unit.skills[p.column];
            pinned.push({
                name: m.template.name,
                column: p.column,
                reason: p.reason,
                state:
                    catalogueText !== p.ruledAgainst
                        ? 'catalogue-changed'
                        : suppressed
                          ? 'overrides-catalogue'
                          : 'catalogue-agrees',
                suppressed,
                ruledAgainst: p.ruledAgainst,
                catalogueText,
                shipHeld: m.unit.mappingErrors.length > 0,
            });
        }
        return own.length ? { ...m, changes: m.changes.filter((c) => !isPinnedText(c, own)) } : m;
    });
    const matchedIds = new Set(matched.map((m) => m.unit.definitionId));
    for (const p of pins) {
        if (!matchedIds.has(p.definitionId)) {
            pinned.push({
                name: p.definitionId,
                column: p.column,
                reason: p.reason,
                state: 'no-matched-ship',
                suppressed: null,
                ruledAgainst: p.ruledAgainst,
                catalogueText: null,
                shipHeld: false,
            });
        }
    }
    return { matched: out, pinned };
};

export const planSync = (
    diff: CatalogueDiff,
    templates: TemplateRow[],
    gate: SkillGate,
    opts: { textWrites: boolean; allowBulkText?: boolean; pins?: readonly TextPin[] }
): SyncPlan => {
    const plan = emptyPlan(diff);
    const pins = opts.pins ?? TEXT_PINS;
    if (diff.matched.length === 0) {
        return { ...plan, halted: 'no catalogue unit matched a template' };
    }
    const statsChanged = diff.matched.filter((m) => m.changes.some((c) => c.kind === 'stats')).length;
    if (statsChanged / diff.matched.length > STATS_CHANGE_HALT_RATIO) {
        return {
            ...plan,
            halted: `${statsChanged}/${diff.matched.length} matched ships changed stats (limit ${STATS_CHANGE_HALT_RATIO * 100}%)`,
        };
    }
    const { matched, pinned } = applyPins(diff.matched, pins);
    plan.pinned = pinned;
    const textChanged = matched.filter((m) => m.changes.some((c) => c.kind === 'skill-text')).length;
    if (opts.textWrites && !opts.allowBulkText && textChanged / matched.length > TEXT_CHANGE_HOLD_RATIO) {
        plan.bulkTextHold = { changed: textChanged, matched: matched.length };
    }

    for (const { template, unit, changes } of matched) {
        if (unit.mappingErrors.length) {
            plan.mappingHeld.push({ template, unit, reasons: [...unit.mappingErrors] });
            continue;
        }
        const patch: Record<string, unknown> = {};
        const applied: Change[] = [];
        const heldDrops: Change[] = [];
        const stats = changes.filter((c): c is Change & { kind: 'stats' } => c.kind === 'stats');
        if (stats.length) {
            const merged = { ...template.base_stats };
            for (const c of stats) merged[c.field] = c.after;
            patch.base_stats = merged;
            applied.push(...stats);
        }
        for (const c of changes) {
            if (c.kind === 'charge-cost' && isDroppedField(c)) {
                heldDrops.push(c);
            } else if (c.kind === 'charge-cost') {
                patch.charge_skill_charge = c.after;
                applied.push(c);
            } else if (c.kind === 'ascension') {
                patch.ascension_stats = c.after;
                applied.push(c);
            } else if (c.kind === 'metadata') {
                plan.metadata.push({ template, change: c });
            }
        }
        const text = changes.filter((c): c is Change & { kind: 'skill-text' } => c.kind === 'skill-text');
        let gateResult: GateResult | null = null;
        let textHold: TextHold | null = null;
        if (text.length && !opts.textWrites) {
            textHold = 'text-writes-off';
        } else if (text.length && plan.bulkTextHold) {
            textHold = 'bulk-text';
        } else if (text.some(isDroppedField)) {
            textHold = 'dropped-field';
        } else if (text.length) {
            const current = skillsOf(template);
            gateResult = gate(template.name, current, withPinnedText(unit.definitionId, current, unit.skills, pins), {
                type: template.type,
                faction: template.faction,
            });
            if (gateResult.pass) {
                for (const c of text) patch[c.column] = c.after;
                applied.push(...text);
            } else {
                textHold = 'gate';
            }
        }
        const heldText = textHold ? text : [];
        if (applied.length || heldText.length || heldDrops.length) {
            plan.patches.push({
                id: template.id,
                name: template.name,
                patch,
                applied,
                heldText,
                textHold,
                heldDrops,
                gate: gateResult,
            });
        }
    }

    const takenIds = new Set(templates.map((t) => t.id));
    for (const unit of diff.newShips) {
        const id = templateIdFor(unit.name);
        if (!opts.textWrites) {
            plan.refusedInserts.push({ unit, reason: 'text writes disabled (--stats-only run)' });
        } else if (plan.bulkTextHold) {
            plan.refusedInserts.push({ unit, reason: 'bulk-text hold: inserting would write its text' });
        } else if (unit.mappingErrors.length) {
            plan.refusedInserts.push({ unit, reason: unit.mappingErrors.join('; ') });
        } else if (takenIds.has(id)) {
            plan.refusedInserts.push({ unit, reason: `id ${id} already exists` });
        } else {
            takenIds.add(id);
            plan.inserts.push({
                row: insertRowFor(unit),
                unit,
                findings: gate(unit.name, EMPTY_SKILLS, unit.skills, { type: unit.type, faction: unit.faction }).newFindings,
            });
        }
    }
    return plan;
};
