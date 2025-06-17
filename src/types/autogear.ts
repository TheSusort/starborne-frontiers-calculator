import { StatName } from './stats';
import { ShipTypeName } from '../constants';
import { AutogearAlgorithm } from '../utils/autogear/AutogearStrategy';

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

export interface SavedAutogearConfig {
    shipId: string;
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    algorithm: AutogearAlgorithm;
}
