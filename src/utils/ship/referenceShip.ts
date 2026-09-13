import { Ship, Refit } from '../../types/ship';
import { BaseStats, Stat } from '../../types/stats';
import { statFromGameTriple } from './gameStatVocabulary';
import {
    applyGuaranteedCrit,
    getDamageReduction,
    getHpRegen,
    padEmptyRefits,
} from './perShipRules';

/**
 * One row of the official unit catalogue's `ascensionStats`: the stats a single refit level
 * grants. `level` runs 0-6. Level 0 is INNATE — it applies to an unrefitted ship and is not
 * part of the catalogue's own base stat block (an unrefitted Snapdragon reads ~21% crit, not
 * the 1% its base block shows), so it is folded into `baseStats` here rather than into a refit.
 */
export interface AscensionStat {
    level: number;
    attribute: string;
    type: string;
    value: number;
}

/** Every unit in the catalogue tops out at refit 6, across all five rarities. */
export const MAX_REFITS = 6;

export type ReferenceVariant = 'r0' | 'refitted';

/** Rejects anything that is not a usable ascension row. */
export const isAscensionStat = (value: unknown): value is AscensionStat => {
    if (typeof value !== 'object' || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
        typeof row.level === 'number' &&
        Number.isInteger(row.level) &&
        row.level >= 0 &&
        row.level <= MAX_REFITS &&
        typeof row.attribute === 'string' &&
        typeof row.type === 'string' &&
        typeof row.value === 'number' &&
        Number.isFinite(row.value)
    );
};

/**
 * All or nothing: one unusable row rejects the whole column.
 *
 * Keeping the readable rows would leave a unit whose grants are silently incomplete while
 * `canBeFullyRefitted` still says yes, so the picker would offer a "fully refitted" version
 * that is missing refits. No data is a visible absence; partial data is a wrong number.
 */
export const parseAscensionStats = (value: unknown): AscensionStat[] | null => {
    if (!Array.isArray(value) || value.length === 0) return null;
    return value.every(isAscensionStat) ? value : null;
};

const statsForLevel = (rows: AscensionStat[], level: number): Stat[] =>
    rows
        .filter((row) => row.level === level)
        .flatMap((row) => {
            const stat = statFromGameTriple(row.attribute, row.type, row.value);
            if (!stat) {
                console.error(`Unknown ascension attribute ${row.attribute}`);
                return [];
            }
            return [stat];
        });

/**
 * The refits a fully refitted ship carries: one per level 1-`MAX_REFITS`, in order.
 *
 * A level the unit grants no stats at still gets an entry with `stats: []` — it grants a skill
 * instead, and the refit COUNT is what `getShipSkillRows` reads to decide which passive is
 * active. Dropping the empty levels would silently downgrade a fully refitted ship's passive.
 */
export const refitsFromAscensionStats = (rows: AscensionStat[]): Refit[] =>
    Array.from({ length: MAX_REFITS }, (_, index) => ({
        id: `ascension-${index + 1}`,
        stats: statsForLevel(rows, index + 1),
    }));

const applyInnateStats = (baseStats: BaseStats, rows: AscensionStat[]): BaseStats => {
    const result = { ...baseStats };
    for (const stat of statsForLevel(rows, 0)) {
        result[stat.name] = (result[stat.name] ?? 0) + stat.value;
    }
    return result;
};

/**
 * Build a reference ship: a unit at a stated investment level rather than a ship someone owns.
 *
 * It carries no gear and no implants, so the simulator shows what the unit itself does. The
 * caller's engineering stats still apply — `shipFinalStats` resolves those off `ship.type` —
 * which means a setup built on reference ships is not reproducible across accounts.
 *
 * `ascensionStats` absent means the fully-refitted variant is unavailable, never that it is
 * unrefitted-but-called-refitted; callers gate the option on `canBeFullyRefitted`.
 */
export const referenceShip = (
    template: Ship,
    variant: ReferenceVariant,
    ascensionStats: AscensionStat[] | null
): Ship => {
    const rows = ascensionStats ?? [];
    const refitCount = variant === 'refitted' ? MAX_REFITS : 0;
    const baseStats: BaseStats = {
        ...applyInnateStats(template.baseStats, rows),
        hpRegen: getHpRegen(template.name),
        damageReduction: getDamageReduction(template.name, refitCount),
    };
    const refits = variant === 'refitted' ? refitsFromAscensionStats(rows) : [];
    applyGuaranteedCrit(template.name, refitCount, refits, baseStats.crit);
    padEmptyRefits(refits);

    return {
        ...template,
        id: referenceShipId(template, variant),
        baseStats,
        equipment: {},
        implants: {},
        refits,
        level: 60,
        rank: 0,
        copies: undefined,
        starred: false,
        equipmentLocked: false,
    };
};

/**
 * Reference ships are not rows anyone owns, so their id only has to be stable and distinct from
 * an owned ship's uuid. Two copies of one reference ship on a board are fine: the engine mints
 * actor ids as `p:<ship.id>:<index>` / `e:<ship.id>:<index>`, so side and index disambiguate.
 */
export const referenceShipId = (template: Ship, variant: ReferenceVariant): string =>
    `template:${template.id}:${variant}`;

const REFERENCE_ID_PREFIX = 'template:';

export const isReferenceShipId = (id: string): boolean => id.startsWith(REFERENCE_ID_PREFIX);

/**
 * Reads a reference ship id back into the template and variant that built it, so a stored
 * board (a saved encounter, a shared setup) can rebuild the ship rather than looking it up
 * among the ships the viewer owns — where it will never be.
 *
 * `null` for an owned ship's id, and for a reference id whose variant this app no longer has.
 */
export const parseReferenceShipId = (
    id: string
): { templateId: string; variant: ReferenceVariant } | null => {
    if (!isReferenceShipId(id)) return null;
    const rest = id.slice(REFERENCE_ID_PREFIX.length);
    // Split at the LAST separator: a template id may contain one, a variant never does.
    const separator = rest.lastIndexOf(':');
    if (separator <= 0) return null;
    const variant = rest.slice(separator + 1);
    if (variant !== 'r0' && variant !== 'refitted') return null;
    return { templateId: rest.slice(0, separator), variant };
};

export const canBeFullyRefitted = (ascensionStats: AscensionStat[] | null): boolean =>
    (ascensionStats?.length ?? 0) > 0;
