import { GearSlotName } from '../constants';

export interface Loadout {
    id: string;
    name: string;
    shipId: string;
    // A ship's own `equipment` (the shape a loadout is saved from) never guarantees every
    // slot is filled — `Partial` here matches that, rather than claiming a completeness
    // nothing enforces.
    equipment: Partial<Record<GearSlotName, string>>;
    createdAt: number;
}

export interface TeamLoadout {
    id: string;
    name: string;
    shipLoadouts: {
        position: number; // 1-5 for team position
        shipId: string;
        equipment: Partial<Record<GearSlotName, string>>;
    }[];
    createdAt: number;
}
