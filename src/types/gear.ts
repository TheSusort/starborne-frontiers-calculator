import type { RarityName } from '../constants/rarities';
import { Stat, StatName } from './stats';

export interface GearPiece {
    id: string;
    /** A gear piece and an implant share this one type — `slot` is a `GearSlotName` for the
     *  former, an `ImplantSlotName` for the latter (see `EquipmentSlotName`'s doc).
     *
     *  Typed `string` because that is the honest type of stored data: a piece loaded from
     *  IndexedDB or Supabase may carry a slot the app doesn't recognise (a legacy or hand-edited
     *  value), and it must not be dropped or rewritten — it is the player's own gear. Narrow with
     *  `isEquipmentSlotName` / `isGearSlotName` / `isImplantSlotName` before using it as a key.
     *  Autogear never sees such a piece (`availableInventoryForShip`). */
    slot: string;
    level: number;
    stars: number;
    rarity: RarityName;
    mainStat: Stat | null;
    subStats: Stat[];
    /** The raw stored set name, for the same reason as `slot`: an unrecognised set is kept, not
     *  rewritten. Read through `getGearSet` / `getImplantData`, or narrow with `isGearSetName`
     *  before counting it toward a set bonus — an unrecognised set grants no bonus. */
    setBonus: string | null;
    shipId?: string;
    cost?: number;
    /** Calibration data - only applicable to level 16 gear with 5-6 stars */
    calibration?: {
        /** The ship ID this gear is calibrated to */
        shipId: string;
    };
}

export interface GearSetBonus {
    /** The human-readable label shown in the UI ('Fortitude', 'Attack', …) — NOT a
     *  `GearSetName`; the set's own identity is the key it sits under in `GEAR_SETS`. */
    name: string;
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
