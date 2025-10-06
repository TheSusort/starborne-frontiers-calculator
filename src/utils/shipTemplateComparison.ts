import { ExportedPlayData } from '../types/exportedPlayData';
import { Ship } from '../types/ship';

export interface ShipStatDifference {
    stat: string;
    currentValue: number | undefined;
    proposedValue: number;
    difference: number;
}

export interface ShipTemplateProposal {
    shipName: string;
    shipId: string;
    proposedStats: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit_rate: number;
        crit_damage: number;
        speed: number;
        shield_penetration: number;
        defense_penetration: number;
        // shield: excluded - not properly implemented in game
        hp_regen: number;
    };
    currentStats?: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit_rate: number;
        crit_damage: number;
        speed: number;
        shield_penetration: number;
        defense_penetration: number;
        // shield: excluded - not properly implemented in game
        hp_regen: number;
    };
    statDifferences: ShipStatDifference[];
}

const STAT_THRESHOLD = 0.01; // 1% threshold for considering a difference significant

/**
 * Extracts level 60 ships from exported game data
 */
export const extractLevel60Ships = (data: ExportedPlayData): ExportedPlayData['Units'][0][] => {
    return data.Units.filter((unit) => unit.Level === 60);
};

/**
 * Converts game stats to our template format
 * Note: shield is excluded as it's not properly implemented in the game
 */
const convertToTemplateStats = (unit: ExportedPlayData['Units'][0]) => {
    const baseStats = unit.Attributes.BaseWithLevelAndRank;

    return {
        hp: baseStats.HullPoints,
        attack: baseStats.Power,
        defence: baseStats.Defense,
        hacking: baseStats.Manipulation,
        security: baseStats.Security,
        crit_rate: Math.round(baseStats.CritChance * 100),
        crit_damage: Math.round(baseStats.CritBoost * 100),
        speed: baseStats.Initiative,
        shield_penetration: Math.round(baseStats.ShieldPenetration * 100),
        defense_penetration: Math.round(baseStats.DefensePenetration * 100),
        // shield: excluded - not properly implemented in game, would overwrite on approval
        hp_regen: getHpRegen(unit.Name),
    };
};

/**
 * Gets HP regen for specific ships
 */
const getHpRegen = (name: string): number => {
    if (name === 'Isha') {
        return 5;
    } else if (name === 'Heliodor') {
        return 8;
    }
    return 0;
};

/**
 * Compares proposed stats against current template stats
 */
const compareStats = (
    proposed: ReturnType<typeof convertToTemplateStats>,
    current?: Ship['baseStats']
): ShipStatDifference[] => {
    if (!current) return [];

    const differences: ShipStatDifference[] = [];

    // Map our template stat names to Ship baseStats names
    // Note: shield is excluded as it's not properly implemented in the game
    const statMapping: Record<
        string,
        { proposedKey: keyof typeof proposed; currentKey: keyof Ship['baseStats'] }
    > = {
        hp: { proposedKey: 'hp', currentKey: 'hp' },
        attack: { proposedKey: 'attack', currentKey: 'attack' },
        defence: { proposedKey: 'defence', currentKey: 'defence' },
        hacking: { proposedKey: 'hacking', currentKey: 'hacking' },
        security: { proposedKey: 'security', currentKey: 'security' },
        crit_rate: { proposedKey: 'crit_rate', currentKey: 'crit' },
        crit_damage: { proposedKey: 'crit_damage', currentKey: 'critDamage' },
        speed: { proposedKey: 'speed', currentKey: 'speed' },
        shield_penetration: { proposedKey: 'shield_penetration', currentKey: 'shieldPenetration' },
        defense_penetration: {
            proposedKey: 'defense_penetration',
            currentKey: 'defensePenetration',
        },
        // shield: excluded - not properly implemented in game
        hp_regen: { proposedKey: 'hp_regen', currentKey: 'hpRegen' },
    };

    Object.entries(statMapping).forEach(([statName, { proposedKey, currentKey }]) => {
        const proposedValue = proposed[proposedKey];
        const currentValue = current[currentKey];

        if (proposedValue !== currentValue) {
            const diff = proposedValue - (currentValue ?? 0);
            const percentDiff = currentValue ? Math.abs(diff / currentValue) : 1;

            // Only include if difference is significant
            if (percentDiff > STAT_THRESHOLD || Math.abs(diff) >= 1) {
                differences.push({
                    stat: statName,
                    currentValue,
                    proposedValue,
                    difference: diff,
                });
            }
        }
    });

    return differences;
};

/**
 * Compares level 60 ships against existing templates
 * Returns proposals for ships that have different stats
 */
export const compareShipsAgainstTemplates = (
    level60Ships: ExportedPlayData['Units'][0][],
    existingTemplates: Ship[]
): ShipTemplateProposal[] => {
    const proposals: ShipTemplateProposal[] = [];

    level60Ships.forEach((unit) => {
        const proposedStats = convertToTemplateStats(unit);

        // Find matching template by name
        const existingTemplate = existingTemplates.find((t) => t.name === unit.Name);

        if (!existingTemplate) {
            // New ship not in templates - create proposal with no current stats
            proposals.push({
                shipName: unit.Name,
                shipId: unit.Name.toUpperCase().replace(/\s+/g, '_'),
                proposedStats,
                statDifferences: [],
            });
            return;
        }

        // Compare stats
        const differences = compareStats(proposedStats, existingTemplate.baseStats);

        // Only create proposal if there are differences
        if (differences.length > 0) {
            proposals.push({
                shipName: unit.Name,
                shipId: existingTemplate.id,
                proposedStats,
                currentStats: {
                    hp: existingTemplate.baseStats.hp,
                    attack: existingTemplate.baseStats.attack,
                    defence: existingTemplate.baseStats.defence,
                    hacking: existingTemplate.baseStats.hacking,
                    security: existingTemplate.baseStats.security,
                    crit_rate: existingTemplate.baseStats.crit,
                    crit_damage: existingTemplate.baseStats.critDamage,
                    speed: existingTemplate.baseStats.speed,
                    shield_penetration: existingTemplate.baseStats.shieldPenetration || 0,
                    defense_penetration: existingTemplate.baseStats.defensePenetration || 0,
                    // shield: excluded - not properly implemented in game
                    hp_regen: existingTemplate.baseStats.hpRegen || 0,
                },
                statDifferences: differences,
            });
        }
    });

    return proposals;
};
