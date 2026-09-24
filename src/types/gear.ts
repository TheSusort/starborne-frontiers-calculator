import type { GearSetName } from '../constants/gearSets';
import type { EquipmentSlotName } from '../constants/gearTypes';
import type { RarityName } from '../constants/rarities';
import { Stat, StatName } from './stats';

export interface GearPiece {
    id: string;
    /** A gear piece and an implant share this one type — `slot` is a `GearSlotName` for the
     *  former, an `ImplantSlotName` for the latter (see `EquipmentSlotName`'s doc). */
    slot: EquipmentSlotName;
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
    color?: string;
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
    /** A display label ('Weapon', 'Sensors', ...), not a `GearSlotName` — `GEAR_SLOTS`' keys
     *  are the lowercase slot identifiers; this is what the UI renders for them. */
    label: string;
    availableMainStats: StatName[];
    expectedContribution: number;
};

export interface Implant {
    id: string;
    subStats: Stat[];
    description?: string;
    shipId?: string;
}
