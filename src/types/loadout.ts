import { GearSlotName } from '../constants';

export interface Loadout {
  id: string;
  name: string;
  shipId: string;
  equipment: Record<GearSlotName, string>;
  createdAt: number;
}

export interface TeamLoadout {
  id: string;
  name: string;
  shipLoadouts: {
    position: number; // 1-5 for team position
    shipId: string;
    equipment: Record<GearSlotName, string>;
  }[];
  createdAt: number;
}
