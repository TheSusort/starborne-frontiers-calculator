// src/types/importDiff.ts
import { RarityName } from '../constants/rarities';
import { Ship } from './ship';
import { GearPiece } from './gear';

export interface LeveledShip {
    ship: Ship; // post-import ship
    oldLevel: number;
}

export interface RefittedShip {
    ship: Ship; // post-import ship
    oldRefitCount: number;
}

export interface RemovedShip {
    id: string;
    name: string; // from the old ship in context
    rarity: RarityName;
}

export interface ImportDiff {
    isFreshImport: boolean;
    ships: {
        legendary: {
            added: Ship[];
            leveled: LeveledShip[];
            refitted: RefittedShip[];
            removed: RemovedShip[];
        };
        epic: {
            leveled: LeveledShip[];
            refitted: RefittedShip[];
            added: number; // gross count of epics new in this import
            removed: number; // gross count of epics absent from this import
        };
        otherAdded: number;
        otherRemoved: number;
    };
    gear: {
        added: number; // gross non-implant pieces new in this import
        removed: number; // gross non-implant pieces absent from this import
        newLegendary6Star: GearPiece[]; // new non-implant pieces: rarity==='legendary' && stars===6
    };
    implants: {
        added: number;
        removed: number;
        newLegendary: GearPiece[];
    };
    engineeringStatsCount: number;
}
