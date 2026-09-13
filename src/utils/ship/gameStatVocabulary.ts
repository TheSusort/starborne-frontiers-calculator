import {
    FlexibleStats,
    PERCENTAGE_ONLY_STATS,
    PercentageOnlyStats,
    Stat,
    StatName,
    StatType,
} from '../../types/stats';

/**
 * The game's own stat vocabulary, as it appears in both sources that speak it: a player's
 * exported play data (`Attributes.*`, gear rolls, refit rolls) and the official unit
 * catalogue's `ascensionStats`. Both use the same `{attribute, type, value}` triple, so
 * both read this module — a second mapping elsewhere is a future contradiction.
 *
 * `null` for an attribute this app does not model. Callers drop it rather than coercing.
 */
export function getStatName(exportStatName: string): StatName | null {
    switch (exportStatName) {
        case 'HullPoints':
            return 'hp';
        case 'Power':
            return 'attack';
        case 'Defense':
            return 'defence';
        case 'Manipulation':
            return 'hacking';
        case 'Security':
            return 'security';
        case 'CritChance':
            return 'crit';
        case 'CritBoost':
            return 'critDamage';
        case 'Initiative':
            return 'speed';
        case 'ShieldPoints':
            return 'shield';
        case 'DefensePenetration':
            return 'defensePenetration';
        case 'ShieldPenetration':
            return 'shieldPenetration';
        default:
            return null;
    }
}

const isPercentageOnly = (attribute: string): boolean =>
    PERCENTAGE_ONLY_STATS.includes(getStatName(attribute) as PercentageOnlyStats);

/**
 * A stat in `PERCENTAGE_ONLY_STATS` is stored as an integer percentage (crit 70, not 0.70)
 * whatever the source calls its type — the game sends crit and crit damage as fractions
 * typed `Flat`. So the ×100 is keyed on the STAT, and only then on the declared type.
 */
export const getPercentageStatValue = (
    value: number,
    modifierType: string,
    attribute: string
): number => {
    if (isPercentageOnly(attribute)) {
        return Math.round(value * 100);
    }

    if (modifierType === 'Percentage') {
        return Math.round(value * 100);
    }
    return value;
};

export const getStatType = (modifierType: string, attribute: string): StatType => {
    if (isPercentageOnly(attribute)) {
        return 'percentage';
    }

    if (modifierType === 'Percentage') {
        return 'percentage';
    }
    return 'flat';
};

export function createStat(name: StatName, value: number, type: StatType): Stat {
    if (PERCENTAGE_ONLY_STATS.includes(name as PercentageOnlyStats) || type === 'percentage') {
        return { name, value, type: 'percentage' };
    }
    return { name: name as FlexibleStats, value, type: 'flat' };
}

/**
 * One `{attribute, type, value}` triple from either source, mapped to a `Stat`.
 * `null` when the attribute is not one this app models.
 */
export const statFromGameTriple = (
    attribute: string,
    modifierType: string,
    value: number
): Stat | null => {
    const name = getStatName(attribute);
    if (!name) return null;
    return createStat(
        name,
        getPercentageStatValue(value, modifierType, attribute),
        getStatType(modifierType, attribute)
    );
};
