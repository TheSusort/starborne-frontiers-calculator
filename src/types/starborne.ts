// Shared types for Starborne Frontiers data structures

export interface ExportedPlayData {
    Engineering?: Array<{
        Type: string;
        Attribute: string;
        ModifierType: string;
        Level: number;
    }>;

    Units?: Array<{
        Id: string;
        DefinitionId: string;
        Name: string;
        Faction: string;
        Rarity: string;
        ShipType: string;
        Affinity: string;
        Rank: number;
        Level: number;
        Refit: number;
        Attributes: {
            BaseWithLevelAndRank: {
                Initiative: number;
                HullPoints: number;
                ShieldPoints: number;
                Security: number;
                Manipulation: number;
                Power: number;
                CritChance: number;
                CritBoost: number;
                Defense: number;
                CritResistance: number;
                DefensePenetration: number;
                ShieldPenetration: number;
            };
            WithRefitAndEngineering: {
                Initiative: number;
                HullPoints: number;
                ShieldPoints: number;
                Security: number;
                Manipulation: number;
                Power: number;
                CritChance: number;
                CritBoost: number;
                Defense: number;
                CritResistance: number;
                DefensePenetration: number;
                ShieldPenetration: number;
            };
            Total: {
                Initiative: number;
                HullPoints: number;
                ShieldPoints: number;
                Security: number;
                Manipulation: number;
                Power: number;
                CritChance: number;
                CritBoost: number;
                Defense: number;
                CritResistance: number;
                DefensePenetration: number;
                ShieldPenetration: number;
            };
            Refit: Array<{ Attribute: string; Type: 'Percentage'; Value: number }>;
            Engineering: Array<{ Attribute: string; Type: 'Flat'; Value: number }>;
        };
        Skills: Array<string>;
    }>;

    Equipment?: Array<{
        Id: string;
        EquippedOnUnit: string | null;
        Name: string;
        Level: number;
        Rank: number;
        Slot: string;
        Set: string;
        Rarity: string;
        Locked: boolean;
        MainStats: Array<{
            Level: number;
            Attribute: { Attribute: string; Type: string; Value: number };
        }>;
        SubStats: Array<{
            Level: number;
            Attribute: { Attribute: string; Type: string; Value: number };
        }>;
    }>;
}

// Type aliases for better readability
export type Unit = NonNullable<ExportedPlayData['Units']>[0];
export type Equipment = NonNullable<ExportedPlayData['Equipment']>[0];
export type Engineering = NonNullable<ExportedPlayData['Engineering']>[0];

// Union type for items that can be compared
export type StarborneItem = Unit | Equipment | Engineering;

// Type guard to check if parsed JSON is ExportedPlayData
export const isExportedPlayData = (obj: unknown): obj is ExportedPlayData => {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        ('Units' in obj || 'Equipment' in obj || 'Engineering' in obj)
    );
};
