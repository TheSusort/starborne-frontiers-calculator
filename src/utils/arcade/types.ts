export type Lane = 0 | 1 | 2;
export type ObstacleKind = 'wall' | 'low' | 'high';
export type PickupKind = 'credit' | 'shield' | 'magnet';
export type DuelStakes = 'win-or-die' | 'bonus-or-penalty' | 'power-up';
/** `draw` and `skipped` both apply no stakes; only the summary tells them apart. */
export type DuelOutcome = 'win' | 'lose' | 'draw' | 'skipped';
/** What a checkpoint row asks of the flown ship: a 1v1 (`duel`), a race against the gate ship
 *  (`dps`, `tank`, `heal`) or a 3v3 (`team`). Both gates of a row share it. */
export type ChallengeKind = 'duel' | 'dps' | 'tank' | 'heal' | 'team';

/** A row of two duel gates; the lane in neither gate is free. `gates[slot]` is opponent `slot`. */
export interface Checkpoint {
    id: number;
    z: number;
    gates: [Lane, Lane];
    stakes: DuelStakes;
    challenge: ChallengeKind;
    /** Set once the slow-motion preview for this row has started; each row previews once. */
    previewed: boolean;
    resolved: boolean;
}

export interface PendingDuel {
    checkpointId: number;
    slot: 0 | 1;
    stakes: DuelStakes;
    challenge: ChallengeKind;
}

/** The slow-motion preview of one checkpoint row; `elapsed` is real (unscaled) seconds since it
 *  started. See `previewScale`. */
export interface Preview {
    checkpointId: number;
    elapsed: number;
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

/** `drop`: a duck pressed mid-jump, a fast descent before the duck itself. It is neither a jump
 *  nor a duck, so it clears no barrier. */
export type PlayerAction = 'run' | 'jump' | 'duck' | 'drop';
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
    /** Shared by every pickup of one credit trail; see `GameState.trails`. */
    trailId: number;
}

/** A jump or duck press waiting for the current action to allow it; `age` is seconds held. */
export interface BufferedPress {
    action: 'jump' | 'duck';
    age: number;
}

export interface PlayerState {
    lane: Lane;
    action: PlayerAction;
    /** Seconds left in the current jump/duck/drop; 0 while running. */
    actionTime: number;
    /** The jump's arc (see `jumpArc`) when a drop cancelled it; the drop descends from it. */
    dropArc: number;
    /** `GameState.time` when the current jump or duck press was taken; a duck reached through a
     *  drop counts from the drop's press. */
    actionStartedAt: number;
    /** `GameState.time` each lane was last left, by lane; `-Infinity` if never. */
    laneLeftAt: [number, number, number];
    buffered: BufferedPress | null;
    shield: boolean;
    magnetTime: number;
}

/** Something a step did that the view shows; the frame loop drains `GameState.events`. */
export type RunEvent =
    | { kind: 'near-miss'; points: number; chain: number; lane: Lane }
    | { kind: 'streak-on' }
    | { kind: 'streak-lost' };

/** A credit trail still being passed: its pickups not yet resolved, and whether it has missed a
 *  credit. */
export interface TrailProgress {
    pending: number;
    missed: boolean;
}

export interface GameState {
    /** The seed the run was created with; `rngState` moves on from it. */
    seed: number;
    rngState: number;
    /** Whether checkpoint rows may draw the `team` challenge (see `GameOptions.teamChallenges`). */
    teamChallenges: boolean;
    /** The factor `step` multiplies its `dt` by: 1, or less during a checkpoint preview. */
    timeScale: number;
    /** The running checkpoint preview, if any; `preview.checkpointId` is the row being shown. */
    preview: Preview | null;
    time: number;
    speed: number;
    /** World units travelled; see `metersTravelled` for the displayed figure. */
    distance: number;
    credits: number;
    /** Points from duels and near misses, added to the score as-is. */
    bonus: number;
    /** Appended to by `step`; the caller reads and clears it. */
    events: RunEvent[];
    /** Near misses in the current chain, which ends when an obstacle row passes with no near
     *  miss in it, and on any hit. */
    nearMissChain: number;
    bestNearMissChain: number;
    /** Points near misses have paid into `bonus` this run. */
    nearMissPoints: number;
    /** Finished credit trails in a row; at `STREAK_TRAILS` or more, credits count double. */
    creditStreak: number;
    /** Trails with pickups still to resolve, by `Pickup.trailId`. */
    trails: Record<number, TrailProgress>;
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
    bestNearMissChain: number;
    nearMissPoints: number;
}
