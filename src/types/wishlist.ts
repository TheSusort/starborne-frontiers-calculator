import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { GearSetName } from '../constants/gearSets';
import { StatName } from './stats';

export interface WishlistEntry {
    id: string;
    name: string; // max 64 chars
    filters: {
        slot?: GearSlotName;
        stars?: number; // minimum: piece.stars >= entry.filters.stars
        rarity?: RarityName;
        setBonus?: GearSetName;
        mainStat?: { name: StatName };
        subStats?: { name: StatName }[];
    };
}
