import { GearSlotName } from '../constants/gearTypes';

export interface UpgradeSuggestion {
    slotName: GearSlotName;
    currentLevel: number;
    priority?: number;
    reasons: UpgradeReason[];
}

export interface UpgradeReason {
    title: string;
    reason: string;
}
