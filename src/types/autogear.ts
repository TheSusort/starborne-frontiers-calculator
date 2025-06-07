import { StatName } from './stats';

export interface StatPriority {
    stat: StatName;
    weight?: number;
    minLimit?: number;
    maxLimit?: number;
}

export interface SetPriority {
    setName: string;
    count: number;
}

export interface GearSuggestion {
    slotName: string;
    gearId: string;
    score: number;
}

export interface StatBonus {
    stat: string;
    percentage: number;
}
