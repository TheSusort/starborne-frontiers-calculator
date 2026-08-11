import type { Position } from '../../types/encounters';

/**
 * Default board slots for the DPS calculator's positional run.
 *
 * Column 4 is the FRONT of the board. Both sides default to the middle-front slot so a 1v1 DPS
 * run has no adjacency and patterns collapse to single-target — the closest positional equivalent
 * of the scalar opponent this replaces.
 *
 * Positions are required, not cosmetic: `isPositional` (positionalBinding.ts) needs BOTH the acting
 * actor and an opposing actor to carry one, otherwise `selectTurnTarget` falls back to the
 * vestigial dummy and the focus never damages the real enemy.
 */
export const DEFAULT_ATTACKER_SLOT: Position = 'M4';
export const DEFAULT_ENEMY_SLOT: Position = 'M4';

/** Every slot a player-side ship (attacker config or team ship) may occupy. */
export const ATTACKER_SLOT_OPTIONS: readonly Position[] = [
    'T1',
    'T2',
    'T3',
    'T4',
    'M1',
    'M2',
    'M3',
    'M4',
    'B1',
    'B2',
    'B3',
    'B4',
] as const;
