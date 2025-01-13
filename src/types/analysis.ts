import { GearSlotName } from '../constants/gearTypes';
import { SlotContribution } from '../utils/analysis/statDistribution';

export interface EnhancedStatDistribution {
    slotContributions: SlotContribution[]; // Keep existing slot analysis
}

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
