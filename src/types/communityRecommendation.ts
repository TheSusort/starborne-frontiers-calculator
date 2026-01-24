import { StatPriority, SetPriority, StatBonus } from './autogear';

/**
 * AIRecommendation type for backward compatibility with AlternativeRecommendations component.
 * This type represents the format used by the alternatives display, with weight-based stat bonuses.
 */
export interface AIRecommendation {
    id: string;
    ship_name: string;
    ship_refit_level: number;
    ship_implants: Record<string, string>;
    ship_role: string;
    stat_priorities: { stat: string; minLimit?: number; maxLimit?: number }[];
    stat_bonuses: { stat: string; weight: number }[];
    set_priorities: { setName: string }[];
    reasoning: string;
    upvotes?: number;
    downvotes?: number;
    total_votes?: number;
    score?: number;
    created_by?: string;
    created_at?: string;
    updated_at?: string;
}

export interface CommunityRecommendation {
    id: string;
    ship_name: string;
    ship_refit_level: number;
    title: string;
    description?: string;
    is_implant_specific: boolean;
    ultimate_implant?: string;
    ship_role: string;
    stat_priorities: StatPriority[];
    stat_bonuses: StatBonus[];
    set_priorities: SetPriority[];
    reasoning?: string;
    upvotes: number;
    downvotes: number;
    total_votes: number;
    score: number;
    created_by?: string;
    created_at: string;
    updated_at?: string;
}

export interface CreateCommunityRecommendationInput {
    shipName: string;
    title: string;
    description?: string;
    isImplantSpecific: boolean;
    ultimateImplant?: string;
    shipRole: string;
    statPriorities: StatPriority[];
    statBonuses: StatBonus[];
    setPriorities: SetPriority[];
}
