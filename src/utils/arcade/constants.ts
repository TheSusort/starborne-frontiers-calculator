export const LANE_COUNT = 3;
export const STEP_SECONDS = 1 / 120;
/** Speed, in units per second, climbs at ACCELERATION from START_SPEED to RAMP_SPEED, then at
 *  LATE_ACCELERATION up to MAX_SPEED. Duels and countdowns leave it as it is. */
export const START_SPEED = 20;
export const RAMP_SPEED = 48;
export const MAX_SPEED = 72;
export const ACCELERATION = 0.4;
export const LATE_ACCELERATION = 0.15;
export const SPAWN_Z = 80;
export const ROW_GAP = 22;
export const FIRST_ROW_DELAY = 40;
export const DESPAWN_Z = -6;
export const JUMP_SECONDS = 0.75;
/** Drawn heights, in lane widths at the player row: the ship's centre above the ground while
 *  running, the jump's peak above that, and a pickup's centre above the ground. */
export const SHIP_RIDE_HEIGHT = 0.25;
export const JUMP_PEAK = 0.6;
export const PICKUP_HEIGHT = 0.3;
/** A pickup's drawn radius, in lane widths at its row. */
export const PICKUP_RADIUS = 0.12;
/** The ship's drawn half-height on the ground, in lane widths at the player row. */
export const SHIP_HALF_HEIGHT = 0.13;
/** The ship grows by this fraction of the jump arc as it rises. */
export const JUMP_SCALE_GAIN = 0.25;
/** The jump arc (`sin(πt)`, 0 on the ground, 1 at the peak) up to which a jumping ship still
 *  overlaps a pickup in its lane: the vertical gap between their centres is at most the pickup's
 *  radius plus the ship's half-height, which grows to `1 + JUMP_SCALE_GAIN · arc` of its size. */
export const PICKUP_CATCH_ARC =
    (PICKUP_HEIGHT - SHIP_RIDE_HEIGHT + PICKUP_RADIUS + SHIP_HALF_HEIGHT) /
    (JUMP_PEAK - SHIP_HALF_HEIGHT * JUMP_SCALE_GAIN);
export const DUCK_SECONDS = 0.75;
/** A duck pressed mid-jump first drops to the ground for DROP_SECONDS, then ducks in full. */
export const DROP_SECONDS = 0.1;
/** How long a jump or duck press that cannot start yet waits for the current action to allow it. */
export const INPUT_BUFFER_SECONDS = 0.15;
/** A dodge counts as a near miss when it came at most this long before the obstacle crossed. */
export const NEAR_MISS_SECONDS = 0.2;
/** The n-th near miss of a chain pays `min(NEAR_MISS_POINTS · n, NEAR_MISS_MAX_POINTS)`. */
export const NEAR_MISS_POINTS = 25;
export const NEAR_MISS_MAX_POINTS = 150;
/** A chain ends after this long with no near miss, and on any hit. */
export const NEAR_MISS_CHAIN_SECONDS = 3;
/** Finished credit trails in a row that switch the streak on. */
export const STREAK_TRAILS = 2;
/** Credits each credit pickup is worth while the streak is on. */
export const STREAK_CREDIT_VALUE = 2;
export const MAGNET_SECONDS = 8;
export const SHIELD_BREAK_FLASH = 0.5;
export const METERS_PER_UNIT = 0.25;
export const CREDIT_POINTS = 10;
export const CREDITS_PER_TRAIL = 4;
export const CREDIT_SPACING = 4;
export const CREDIT_TRAIL_CHANCE = 0.7;
export const POWERUP_CHANCE = 0.08;
/** Metres at which the chance of a two-obstacle row reaches its cap. */
export const DOUBLE_ROW_RAMP_METERS = 1500;
export const DOUBLE_ROW_MAX_CHANCE = 0.6;
/** Rows before this many metres always carry a single obstacle. */
export const SINGLE_ROW_METERS = 100;

/** Distance range from the start of the track to the first checkpoint. */
export const FIRST_CHECKPOINT_MIN_METERS = 200;
export const FIRST_CHECKPOINT_MAX_METERS = 400;
/** Distance range from one checkpoint to the next. */
export const CHECKPOINT_MIN_METERS = 300;
export const CHECKPOINT_MAX_METERS = 700;
export const DUEL_WIN_BONUS = 500;
export const DUEL_CREDIT_REWARD = 25;
/** Share of credits a lost bonus-or-penalty duel takes, rounded down. */
export const DUEL_CREDIT_PENALTY = 0.25;
