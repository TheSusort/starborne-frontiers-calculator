import { StatPriority, SetPriority, StatBonus } from './autogear';

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
