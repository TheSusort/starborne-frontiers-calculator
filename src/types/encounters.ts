export type Position =
    | 'T1'
    | 'T2'
    | 'T3'
    | 'T4'
    | 'M1'
    | 'M2'
    | 'M3'
    | 'M4'
    | 'B1'
    | 'B2'
    | 'B3'
    | 'B4';

export interface ShipPosition {
    shipId: string;
    position: Position;
}

export interface EncounterNote {
    id: string;
    name: string;
    formation: ShipPosition[];
    createdAt: number;
}
