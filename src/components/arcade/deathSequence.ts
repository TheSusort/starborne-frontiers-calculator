/**
 * What a run's end shows, by seconds since the crash: the explosion alone, then the "YOU DIED"
 * screen over it, then the game-over panel. Under reduced motion the explosion is a short flash,
 * so the screen comes sooner. The player can skip straight to the panel at any point.
 */
export type DeathStage = 'explosion' | 'you-died' | 'panel';

export const DEATH_TIMING = {
    youDiedAt: 0.9,
    panelAt: 4.6,
} as const;

export const REDUCED_DEATH_TIMING = {
    youDiedAt: 0.45,
    panelAt: 3.4,
} as const;

export function deathStage(elapsed: number, reducedMotion: boolean): DeathStage {
    const timing = reducedMotion ? REDUCED_DEATH_TIMING : DEATH_TIMING;
    if (elapsed >= timing.panelAt) return 'panel';
    if (elapsed >= timing.youDiedAt) return 'you-died';
    return 'explosion';
}

/** Input in the first moments after the crash is not taken as a skip, so a jump or lane change
 *  pressed just too late does not dismiss the explosion. */
export const DEATH_SKIP_GRACE = 0.35;

export const canSkipDeath = (elapsed: number): boolean => elapsed >= DEATH_SKIP_GRACE;
