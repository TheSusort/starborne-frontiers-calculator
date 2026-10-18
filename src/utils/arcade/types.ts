export type Lane = 0 | 1 | 2;
export type ObstacleKind = 'wall' | 'low' | 'high';
export type PickupKind = 'credit' | 'shield' | 'magnet';
export type PlayerAction = 'run' | 'jump' | 'duck';
export type InputAction = 'left' | 'right' | 'jump' | 'duck';

/** `z` is world units ahead of the player; the player sits at z = 0. */
export interface Obstacle {
    id: number;
    kind: ObstacleKind;
    lane: Lane;
    z: number;
    /** Set when the obstacle crosses z = 0; collision is decided exactly once, at that crossing. */
    resolved: boolean;
}

export interface Pickup {
    id: number;
    kind: PickupKind;
    lane: Lane;
    z: number;
    resolved: boolean;
    collected: boolean;
}

export interface PlayerState {
    lane: Lane;
    action: PlayerAction;
    /** Seconds left in the current jump/duck; 0 while running. */
    actionTime: number;
    shield: boolean;
    magnetTime: number;
}

export interface GameState {
    rngState: number;
    time: number;
    speed: number;
    /** World units travelled; see `metersTravelled` for the displayed figure. */
    distance: number;
    credits: number;
    player: PlayerState;
    obstacles: Obstacle[];
    pickups: Pickup[];
    untilNextRow: number;
    nextId: number;
    status: 'running' | 'over';
    shieldBreakTime: number;
}

export interface RunResult {
    score: number;
    credits: number;
    distance: number;
}
