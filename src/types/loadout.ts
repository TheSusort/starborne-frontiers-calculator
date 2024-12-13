import { GearSlotName } from '../constants';

export interface Loadout {
    id: string;
    name: string;
    shipId: string;
    equipment: Record<GearSlotName, string>;
    createdAt: number;
}