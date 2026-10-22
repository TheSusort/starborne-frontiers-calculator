/**
 * Compares the stats a unit enters a simulated fight with against the official catalogue.
 *
 * "Ours" is the app's own pipeline end to end, not a re-implementation: a catalogue unit becomes a
 * `ship_templates` row (`toCatalogueTemplate`, the sync's mapping), the row becomes a `Ship`
 * (`transformShipTemplate`), the ship is built as the simulator's reference ship
 * (`referenceShip`), and its final stats are resolved exactly as `buildTeam` does
 * (`shipFinalStats` -> `combatStatsFromShip`) with no gear, implants or engineering.
 * `battleSimulator`'s `resolveStats` then only reads those values back, so they ARE the actor stats.
 *
 * "Expected" is derived from the catalogue alone, with its own mapping tables, so a mapping slip
 * in the pipeline cannot also be in the oracle.
 */
import type { CatalogueUnit } from './catalogueSchema';
import { toCatalogueTemplate } from './catalogueMapping';
import { transformShipTemplate, type ShipTemplate } from '../../src/utils/ship/shipTemplate';
import {
    MAX_REFITS,
    parseAscensionStats,
    referenceShip,
    type AscensionStat,
} from '../../src/utils/ship/referenceShip';
import { combatStatsFromShip, shipFinalStats } from '../../src/utils/ship/combatStats';
import type { Ship } from '../../src/types/ship';

export const STAT_KEYS = [
    'hp',
    'attack',
    'defence',
    'hacking',
    'security',
    'crit',
    'critDamage',
    'speed',
    'defensePenetration',
    'shieldPenetration',
] as const;
export type AuditStat = (typeof STAT_KEYS)[number];
export type StatBlock = Record<AuditStat, number>;

/** Deliberate faults, used to prove the comparison can fail (instrument validity). */
export type Injection =
    'none' | 'drop-innate' | 'swap-hp-attack' | 'drop-refit-5' | 'swap-affinity';

export const INJECTIONS: readonly Injection[] = [
    'drop-innate',
    'swap-hp-attack',
    'drop-refit-5',
    'swap-affinity',
];

const CATALOGUE_ATTRIBUTE: Record<string, AuditStat> = {
    HullPoints: 'hp',
    Power: 'attack',
    Defense: 'defence',
    Manipulation: 'hacking',
    Security: 'security',
    CritChance: 'crit',
    CritBoost: 'critDamage',
    Initiative: 'speed',
    DefensePenetration: 'defensePenetration',
    ShieldPenetration: 'shieldPenetration',
};

/** Oracle-side vocabulary. Deliberately not shared with `catalogueMapping`. */
const EXPECTED_FACTION: Record<string, string> = {
    Atlas: 'ATLAS_SYNDICATE',
    Binderburg: 'BINDERBURG',
    Everliving: 'EVERLIVING',
    Gelecek: 'GELECEK',
    Legion: 'FRONTIER_LEGION',
    MPL: 'MPL',
    Marauders: 'MARAUDERS',
    Terran: 'TERRAN_COMBINE',
    Tianchao: 'TIANCHAO',
    Tianchen: 'TIANCHAO',
    XAOC: 'XAOC',
};
const EXPECTED_ROLE: Record<string, string> = {
    Attacker: 'ATTACKER',
    Debuffer: 'DEBUFFER',
    Defender: 'DEFENDER',
    Supporter: 'SUPPORTER',
};
const EXPECTED_AFFINITY: Record<string, string> = {
    Red: 'thermal',
    Blue: 'electric',
    Green: 'chemical',
    None: 'antimatter',
};
const EXPECTED_RARITY: Record<string, string> = {
    Common: 'common',
    Uncommon: 'uncommon',
    Rare: 'rare',
    Epic: 'epic',
    Legendary: 'legendary',
};

/** `crit`/`critDamage` are catalogue fractions (x100); everything else is a plain number. */
const isFractionStat = (stat: AuditStat) =>
    stat === 'crit' ||
    stat === 'critDamage' ||
    stat === 'defensePenetration' ||
    stat === 'shieldPenetration';

/**
 * Stats no data source carries that a named ship is nonetheless fought with (`perShipRules.ts`):
 * "always critically hits" pins crit at 100 from the refit named.
 */
const GUARANTEED_CRIT_FROM_REFIT: Record<string, number> = { Tormenter: 0, Asphodel: 2 };

export interface ExpectedOptions {
    /** What percentage rows scale: the catalogue block plus its innate flat grants (default), or the block alone. */
    percentageBasis?: 'block+innate' | 'block';
}

/**
 * What the game gives `unit` at refit `refits` (0..6), no gear. Level 0 rows are innate and always
 * apply; level 1..`refits` rows apply when earned. Flat rows add, percentage rows add a fraction
 * of the basis, crit/critDamage rows add fractions.
 */
export const expectedStats = (
    unit: CatalogueUnit,
    refits: number,
    options: ExpectedOptions = {}
): StatBlock => {
    const basisMode = options.percentageBasis ?? 'block+innate';
    const basis = {} as StatBlock;
    for (const stat of STAT_KEYS) basis[stat] = 0;
    for (const [attribute, stat] of Object.entries(CATALOGUE_ATTRIBUTE)) {
        // penetrations are not in the catalogue's stat block: they come only from ascension rows
        const raw = unit.stats[attribute as keyof CatalogueUnit['stats']] ?? 0;
        basis[stat] = isFractionStat(stat) ? raw * 100 : raw;
    }
    const result = { ...basis };
    const pct = {} as Record<AuditStat, number>;
    for (const stat of STAT_KEYS) pct[stat] = 0;
    for (const row of unit.ascensionStats) {
        if (row.level > refits) continue;
        const stat = CATALOGUE_ATTRIBUTE[row.attribute];
        if (!stat) continue; // shield points are not part of the compared block
        if (isFractionStat(stat)) {
            result[stat] += row.value * 100;
        } else if (row.type === 'Percentage') {
            pct[stat] += row.value;
        } else {
            result[stat] += row.value;
            if (row.level === 0 && basisMode === 'block+innate') basis[stat] += row.value;
        }
    }
    for (const stat of STAT_KEYS) {
        if (!isFractionStat(stat)) result[stat] += basis[stat] * pct[stat];
    }
    const pinFrom = GUARANTEED_CRIT_FROM_REFIT[unit.name];
    if (pinFrom !== undefined && refits >= pinFrom) result.crit = Math.max(result.crit, 100);
    return result;
};

const applyInjectionToRow = (row: ShipTemplate, injection: Injection): ShipTemplate => {
    const next: ShipTemplate = { ...row, base_stats: { ...row.base_stats } };
    if (injection === 'swap-hp-attack') {
        next.base_stats.hp = row.base_stats.attack;
        next.base_stats.attack = row.base_stats.hp;
    }
    if (injection === 'swap-affinity') {
        next.affinity = row.affinity === 'thermal' ? 'electric' : 'thermal';
    }
    const rows = Array.isArray(row.ascension_stats) ? (row.ascension_stats as AscensionStat[]) : [];
    if (injection === 'drop-innate') next.ascension_stats = rows.filter((r) => r.level !== 0);
    if (injection === 'drop-refit-5') next.ascension_stats = rows.filter((r) => r.level !== 5);
    return next;
};

/** The `ship_templates` row the sync writes for `unit`. */
export const templateRowFor = (
    unit: CatalogueUnit,
    injection: Injection = 'none'
): ShipTemplate => {
    const t = toCatalogueTemplate(unit);
    const row: ShipTemplate = {
        id: t.definitionId,
        name: t.name,
        rarity: t.rarity ?? '',
        faction: t.faction ?? '',
        type: t.type ?? '',
        affinity: t.affinity,
        image_key: t.imageKey ?? '',
        definition_id: t.definitionId,
        base_stats: {
            ...t.baseStats,
            shield: 0,
            shield_penetration: 0,
            defense_penetration: 0,
        },
        ascension_stats: t.ascensionStats ?? undefined,
    };
    return injection === 'none' ? row : applyInjectionToRow(row, injection);
};

const noDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

/** Reference ships exist for refit 0 and 6 only; 1..5 reuse `referenceShip` over the rows earned so far. */
export const buildOursShip = (row: ShipTemplate, refits: number): Ship | null => {
    const template = transformShipTemplate(row);
    if (!template) return null;
    const all = parseAscensionStats(row.ascension_stats);
    if (refits === 0) return referenceShip(template, 'r0', all);
    if (refits === MAX_REFITS) return referenceShip(template, 'refitted', all);
    return referenceShip(template, 'refitted', all ? all.filter((r) => r.level <= refits) : all);
};

export const oursStats = (row: ShipTemplate, refits: number): StatBlock | null => {
    const ship = buildOursShip(row, refits);
    if (!ship) return null;
    const c = combatStatsFromShip(shipFinalStats(ship, noDeps));
    return Object.fromEntries(STAT_KEYS.map((k) => [k, c[k]])) as StatBlock;
};

export type MismatchKind = 'mismatch' | 'rounding' | 'pipeline-dropped-unit';
export interface Mismatch {
    unit: string;
    definitionId: string;
    /** -1 for a refit-independent field (affinity, role, faction, rarity). */
    refits: number;
    field: string;
    ours: number | string | null;
    catalogue: number | string;
    kind: MismatchKind;
    note?: string;
}

/** A refit level `referenceShip` cannot build faithfully: a per-ship rule keyed to the full refit count. */
export const isConstructible = (unitName: string, refits: number): boolean =>
    !(unitName === 'Asphodel' && refits > 0 && refits < 2);

export interface AuditResult {
    compared: number;
    skipped: number;
    metaCompared: number;
    unitCount: number;
    mismatches: Mismatch[];
}

const TOLERANCE = 0.5 + 1e-9;

export const auditUnits = (units: CatalogueUnit[], injection: Injection = 'none'): AuditResult => {
    const mismatches: Mismatch[] = [];
    let compared = 0;
    let skipped = 0;
    let metaCompared = 0;
    for (const unit of units) {
        const row = templateRowFor(unit, injection);
        const ship = transformShipTemplate(row);
        const base = { unit: unit.name, definitionId: unit.id };
        if (!ship) {
            mismatches.push({
                ...base,
                refits: -1,
                field: 'template',
                ours: null,
                catalogue: unit.id,
                kind: 'pipeline-dropped-unit',
            });
            continue;
        }
        const meta: [string, string, string | undefined, string][] = [
            ['affinity', ship.affinity ?? '', EXPECTED_AFFINITY[unit.affinity], unit.affinity],
            ['role', ship.type ?? '', EXPECTED_ROLE[unit.role], unit.role],
            ['faction', ship.faction, EXPECTED_FACTION[unit.faction], unit.faction],
            ['rarity', ship.rarity, EXPECTED_RARITY[unit.rarity], unit.rarity],
        ];
        for (const [field, ours, expected, rawValue] of meta) {
            metaCompared++;
            if (ours !== expected) {
                mismatches.push({
                    ...base,
                    refits: -1,
                    field,
                    ours,
                    catalogue: expected ?? `(unmapped ${rawValue})`,
                    kind: 'mismatch',
                });
            }
        }
        for (let n = 0; n <= MAX_REFITS; n++) {
            if (!isConstructible(unit.name, n)) {
                skipped++;
                continue;
            }
            const ours = oursStats(row, n);
            if (!ours) continue;
            const expected = expectedStats(unit, n);
            const alt = expectedStats(unit, n, { percentageBasis: 'block' });
            compared++;
            for (const stat of STAT_KEYS) {
                const diff = Math.abs(ours[stat] - expected[stat]);
                if (diff <= TOLERANCE) continue;
                mismatches.push({
                    ...base,
                    refits: n,
                    field: stat,
                    ours: ours[stat],
                    catalogue: Math.round(expected[stat] * 100) / 100,
                    kind: diff <= 1 + 1e-9 ? 'rounding' : 'mismatch',
                    note:
                        Math.abs(ours[stat] - alt[stat]) <= TOLERANCE
                            ? 'matches the percentage-of-block-only basis'
                            : undefined,
                });
            }
        }
    }
    return { compared, skipped, metaCompared, unitCount: units.length, mismatches };
};

const mismatchKey = (m: Mismatch) => `${m.definitionId}|${m.refits}|${m.field}|${m.ours}|${m.kind}`;

/** The non-rounding mismatches an injected run reports that the clean run does not: the evidence
 *  that the injection itself is what the audit caught, not a pre-existing catalogue mismatch. */
export const injectionCaused = (clean: AuditResult, injected: AuditResult): Mismatch[] => {
    const before = new Set(clean.mismatches.map(mismatchKey));
    return injected.mismatches.filter((m) => m.kind !== 'rounding' && !before.has(mismatchKey(m)));
};
