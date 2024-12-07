import { StatName } from './stats';

export interface StatPriority {
    stat: StatName;
    maxLimit?: number;
    weight: number;
}

export interface GearSuggestion {
    slotName: string;
    gearId: string;
    score: number;
}