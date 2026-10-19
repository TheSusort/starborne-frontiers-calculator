export type Lane = 0 | 1 | 2;
export type ObstacleKind = 'wall' | 'low' | 'high';
export type PickupKind = 'credit' | 'shield' | 'magnet';
export type DuelStakes = 'win-or-die' | 'bonus-or-penalty' | 'power-up';
export type DuelOutcome = 'win' | 'lose' | 'skipped';

/** A row of two duel gates; the lane in neither gate is free. `gates[slot]` is opponent `slot`. */
export interface Checkpoint {
    id: number;
    z: number;
    gates: [Lane, Lane];
    stakes: DuelStakes;
    resolved: boolean;
}

export interface PendingDuel {
    checkpointId: number;
    slot: 0 | 1;
    stakes: DuelStakes;
}

/** What `resolveDuel` did, for the duel summary to show. */
export type DuelEffect =
    | { kind: 'bonus'; amount: number }
    | { kind: 'credits'; delta: number }
    | { kind: 'shield' }
    | { kind: 'magnet' }
    | { kind: 'shield-absorbed' }
    | { kind: 'game-over' }
    | { kind: 'none' };

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
    /** Points from duels, added to the score as-is. */
    bonus: number;
    player: PlayerState;
    obstacles: Obstacle[];
    pickups: Pickup[];
    checkpoints: Checkpoint[];
    /** Rows left until the next checkpoint row; `null` when duels are off. See `spawnTrackRow`. */
    rowsUntilCheckpoint: number | null;
    pendingDuel: PendingDuel | null;
    untilNextRow: number;
    nextId: number;
    /** `'duel'` halts `step` until `resolveDuel` is called. */
    status: 'running' | 'duel' | 'over';
    shieldBreakTime: number;
}

export interface RunResult {
    score: number;
    credits: number;
    distance: number;
}
