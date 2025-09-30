export interface AutogearSuggestion {
    shipRole: string;
    statPriorities: Array<{
        stat: string;
        minLimit?: number;
        maxLimit?: number;
        reasoning?: string;
    }>;
    statBonuses: Array<{
        stat: string;
        weight: number;
        reasoning?: string;
    }>;
    setPriorities: Array<{
        setName: string;
    }>;
    reasoning: string;
}
