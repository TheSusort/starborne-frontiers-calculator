export const LANE_COUNT = 3;
export const STEP_SECONDS = 1 / 120;
export const START_SPEED = 20;
export const MAX_SPEED = 48;
export const ACCELERATION = 0.4;
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
/** Vertical distance between the ship's and a pickup's centres at which they still overlap: the
 *  pickup's drawn radius (0.12) plus the ship's drawn half-height (about 0.13). */
export const PICKUP_CATCH_REACH = 0.25;
/** The jump arc (`sin(πt)`, 0 on the ground, 1 at the peak) up to which a jumping ship still
 *  passes through a pickup in its lane, from the heights above. */
export const PICKUP_CATCH_ARC = (PICKUP_HEIGHT - SHIP_RIDE_HEIGHT + PICKUP_CATCH_REACH) / JUMP_PEAK;
export const DUCK_SECONDS = 0.75;
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
