import { GearSetName } from '../constants/gearSets';
import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { Stat, StatName } from './stats';

export interface GearPiece {
    id: string;
    slot: GearSlotName;
    level: number;
    stars: number;
    rarity: RarityName;
    mainStat: Stat;
    subStats: Stat[];
    setBonus: GearSetName;
    shipId?: string;
}

export interface GearSetBonus {
    name: GearSetName;
    stats: Stat[];
    iconUrl: string;
    minPieces?: number;
}

export interface GearLoadout {
    weapon?: GearPiece;
    hull?: GearPiece;
    generator?: GearPiece;
    sensor?: GearPiece;
    software?: GearPiece;
    thrusters?: GearPiece;
}

export type GearSlot = {
    label: GearSlotName;
    availableMainStats: StatName[];
    expectedContribution: number;
};
