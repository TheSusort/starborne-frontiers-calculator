export interface ArenaSeason {
    id: string;
    name: string;
    active: boolean;
    ends_at: string | null;
    rules: ArenaSeasonRule[];
    created_at: string;
    updated_at: string;
}

export interface ArenaSeasonRule {
    id: string;
    season_id: string;
    factions: string[] | null;
    rarities: string[] | null;
    ship_types: string[] | null;
    modifiers: Record<string, number>;
    created_at: string;
}

export interface ArenaSeasonRuleInput {
    factions: string[] | null;
    rarities: string[] | null;
    ship_types: string[] | null;
    modifiers: Record<string, number>;
}
