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

export interface SharedShipPosition {
    shipName: string;
    position: Position;
}

export interface BaseEncounterNote {
    id: string;
    name: string;
    createdAt: number;
    description?: string;
    isPublic?: boolean;
}

export interface LocalEncounterNote extends BaseEncounterNote {
    formation: ShipPosition[];
}

export interface SharedEncounterNote extends BaseEncounterNote {
    formation: SharedShipPosition[];
    userId: string;
    userName: string;
    votes: number;
    userVotes: Record<string, number>; // userId -> vote (-1, 0, or 1)
}

export type EncounterNote = LocalEncounterNote | SharedEncounterNote;
