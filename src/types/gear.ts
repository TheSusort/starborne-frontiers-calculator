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
    mainStat: Stat | null;
    subStats: Stat[];
    setBonus: GearSetName | null;
    shipId?: string;
    cost?: number;
    /** Calibration data - only applicable to level 16 gear with 5-6 stars */
    calibration?: {
        /** The ship ID this gear is calibrated to */
        shipId: string;
    };
}

export interface GearSetBonus {
    name: GearSetName;
    stats: Stat[];
    iconUrl?: string;
    minPieces?: number;
    description?: string | Record<string, string>;
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

export interface Implant {
    id: string;
    subStats: Stat[];
    description?: string;
    shipId?: string;
}
