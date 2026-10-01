/**
 * Diffs mapped catalogue units against `ship_templates` rows. Pure.
 *
 * Units join rows on `definition_id` (exact, untrimmed). A unit with no id match but a
 * case-insensitive NAME match is an id mismatch: the row exists under a broken id, so inserting
 * it as a new ship would duplicate it. Shield is not a base-stat key and is never compared.
 *
 * The join keys must be unambiguous: `diffCatalogue` throws, naming the duplicated key(s), when
 * two templates share a non-null `definition_id`, two catalogue units share a `definitionId`, or
 * two templates share a name after `trim().toLowerCase()`. A throw aborts the sync run rather than
 * guess which row a unit belongs to. Exact id matches resolve before the name fallback runs; a row
 * claimed either way is never offered again, so a later unit whose name matches an already-claimed
 * row becomes a new ship candidate instead of a second id mismatch.
 */
import {
    BASE_STAT_KEYS,
    SKILL_COLUMNS,
    type AscensionStatRow,
    type CatalogueTemplate,
    type SkillColumn,
    type TemplateBaseStats,
} from './catalogueMapping';

export interface TemplateRow {
    id: string;
    name: string;
    rarity: string;
    faction: string;
    type: string;
    affinity: string | null;
    image_key: string | null;
    definition_id: string | null;
    base_stats: Record<string, unknown>;
    ascension_stats: unknown;
    charge_skill_charge: number | null;
    active_skill_text: string | null;
    charge_skill_text: string | null;
    first_passive_skill_text: string | null;
    second_passive_skill_text: string | null;
    third_passive_skill_text: string | null;
}

export type MetadataField = 'name' | 'rarity' | 'faction' | 'type' | 'affinity' | 'image_key';

export type Change =
    | { kind: 'stats'; field: keyof TemplateBaseStats; before: number | null; after: number }
    | { kind: 'charge-cost'; before: number | null; after: number | null }
    | { kind: 'ascension'; before: unknown; after: AscensionStatRow[] }
    | { kind: 'skill-text'; column: SkillColumn; before: string | null; after: string | null }
    | { kind: 'metadata'; field: MetadataField; before: string | null; after: string };

export interface UnitDiff {
    template: TemplateRow;
    unit: CatalogueTemplate;
    changes: Change[];
}

export interface CatalogueDiff {
    matched: UnitDiff[];
    newShips: CatalogueTemplate[];
    idMismatches: { unit: CatalogueTemplate; template: TemplateRow }[];
    missingFromCatalogue: TemplateRow[];
}

export const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
        );
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
};

const ascensionKey = (rows: unknown): string =>
    Array.isArray(rows) ? rows.map(stableStringify).sort().join('|') : stableStringify(rows);

const METADATA: [MetadataField, (u: CatalogueTemplate) => string | null][] = [
    ['name', (u) => u.name],
    ['rarity', (u) => u.rarity],
    ['faction', (u) => u.faction],
    ['type', (u) => u.type],
    ['affinity', (u) => u.affinity],
    ['image_key', (u) => u.imageKey],
];

const diffUnit = (unit: CatalogueTemplate, row: TemplateRow): Change[] => {
    const changes: Change[] = [];
    for (const field of BASE_STAT_KEYS) {
        const raw = row.base_stats[field];
        const before = typeof raw === 'number' ? raw : null;
        if (before !== unit.baseStats[field]) {
            changes.push({ kind: 'stats', field, before, after: unit.baseStats[field] });
        }
    }
    if ((row.charge_skill_charge ?? null) !== unit.chargeSkillCharge) {
        changes.push({
            kind: 'charge-cost',
            before: row.charge_skill_charge ?? null,
            after: unit.chargeSkillCharge,
        });
    }
    if (unit.ascensionStats && ascensionKey(row.ascension_stats) !== ascensionKey(unit.ascensionStats)) {
        changes.push({ kind: 'ascension', before: row.ascension_stats ?? null, after: unit.ascensionStats });
    }
    for (const column of SKILL_COLUMNS) {
        const before = row[column] ?? null;
        const after = unit.skills[column];
        if (before !== after) changes.push({ kind: 'skill-text', column, before, after });
    }
    for (const [field, read] of METADATA) {
        const after = read(unit);
        if (after !== null && after !== (row[field] ?? null)) {
            changes.push({ kind: 'metadata', field, before: row[field] ?? null, after });
        }
    }
    return changes;
};

/** Throws if `key(item)` repeats across `items`, naming every duplicated key via `describe`. */
const assertUniqueKeys = <T>(items: T[], key: (item: T) => string | null, describe: (key: string) => string): void => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const item of items) {
        const k = key(item);
        if (k === null) continue;
        if (seen.has(k)) dupes.add(k);
        seen.add(k);
    }
    if (dupes.size > 0) throw new Error(`diffCatalogue: duplicate ${[...dupes].map(describe).join(', ')}`);
};

export const diffCatalogue = (
    units: CatalogueTemplate[],
    templates: TemplateRow[]
): CatalogueDiff => {
    assertUniqueKeys(
        templates,
        (t) => t.definition_id,
        (id) => `ship_templates.definition_id "${id}"`
    );
    assertUniqueKeys(
        units,
        (u) => u.definitionId,
        (id) => `catalogue unit definitionId "${id}"`
    );
    assertUniqueKeys(
        templates,
        (t) => t.name.trim().toLowerCase(),
        (name) => `ship_templates.name "${name}" (after trim/lowercase)`
    );

    const byDefinitionId = new Map<string, TemplateRow>();
    for (const t of templates) if (t.definition_id) byDefinitionId.set(t.definition_id, t);
    const byName = new Map(templates.map((t) => [t.name.trim().toLowerCase(), t]));
    const claimed = new Set<string>();
    const out: CatalogueDiff = { matched: [], newShips: [], idMismatches: [], missingFromCatalogue: [] };

    // Resolve every exact id match first, claiming its row, before any name fallback runs.
    const unresolved: CatalogueTemplate[] = [];
    for (const unit of units) {
        const exact = byDefinitionId.get(unit.definitionId);
        if (exact) {
            claimed.add(exact.id);
            out.matched.push({ template: exact, unit, changes: diffUnit(unit, exact) });
        } else {
            unresolved.push(unit);
        }
    }

    // Name fallback, skipping rows an exact match or an earlier unit here already claimed.
    for (const unit of unresolved) {
        const named = byName.get(unit.name.trim().toLowerCase());
        if (named && !claimed.has(named.id)) {
            claimed.add(named.id);
            out.idMismatches.push({ unit, template: named });
        } else {
            out.newShips.push(unit);
        }
    }

    out.missingFromCatalogue = templates.filter((t) => !claimed.has(t.id));
    return out;
};
