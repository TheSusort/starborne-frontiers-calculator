/** Each turn plays for this long, unless the fight has so many turns that the whole playback
 *  would run past `MAX_PLAYBACK_SECONDS`; then every turn shrinks to fit. */
export const BEAT_SECONDS = 0.5;
export const MAX_PLAYBACK_SECONDS = 10;
export const beatSeconds = (beats: number) =>
    beats > 0 ? Math.min(BEAT_SECONDS, MAX_PLAYBACK_SECONDS / beats) : 0;
