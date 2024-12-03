import { StatName } from './gear';

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