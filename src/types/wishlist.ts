import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { GearSetName } from '../constants/gearSets';
import { StatName, StatType } from './stats';

export interface WishlistEntry {
    id: string;
    name: string; // max 64 chars
    filters: {
        slot?: GearSlotName[]; // OR: piece.slot must be one of these
        stars?: number[]; // OR: piece.stars must be one of these values
        rarity?: RarityName[]; // OR: piece.rarity must be one of these
        setBonus?: GearSetName[]; // OR: piece.setBonus must be one of these
        mainStat?: { name: StatName; type?: StatType }[]; // OR: piece.mainStat.name+type must match one of these
        subStats?: { name: StatName; type?: StatType }[]; // piece must have at least subStatsMin of these
        subStatsMin?: number; // how many of subStats must match (default = all)
    };
}
