import type { SynthwaveTrack } from './synthwaveMusic';

/** A track's beat grid: its tempo and the time of its first bar's downbeat, in seconds. */
export interface BeatGrid {
    bpm: number;
    firstBeat: number;
}

export const BEATS_PER_BAR = 4;

/**
 * Measured from the mp3s: the tempo that keeps the kick in phase over the whole track (each
 * holds within a few ms from the first bar to the last), and the downbeat as the strongest of
 * the bar's four beats.
 */
export const TRACK_BEATS: Record<SynthwaveTrack, BeatGrid> = {
    '/audio/disco.mp3': { bpm: 108, firstBeat: 0.049 },
    '/audio/disco2.mp3': { bpm: 100, firstBeat: 1.108 },
    '/audio/disco3.mp3': { bpm: 135, firstBeat: 1.183 },
    '/audio/disco4.mp3': { bpm: 122, firstBeat: 1.076 },
};

/** How fast a beat's pulse decays, per beat: `exp(-PULSE_DECAY × fraction of the beat)`. */
export const PULSE_DECAY = 6;
/** A beat's peak against the bar's first beat, which peaks at 1. */
export const OFF_BAR_PEAK = 0.55;

/**
 * The beat pulse, 0..1, `time` seconds into a track on `grid`: it peaks on each beat and decays
 * through it, highest on the bar's first beat. There is none while the music is not playing,
 * before the first beat or for a track without a grid.
 */
export function beatPulse(time: number, grid: BeatGrid | undefined, playing: boolean): number {
    if (!playing || !grid || !(time >= grid.firstBeat)) return 0;
    const beats = ((time - grid.firstBeat) * grid.bpm) / 60;
    const beat = Math.floor(beats);
    const peak = beat % BEATS_PER_BAR === 0 ? 1 : OFF_BAR_PEAK;
    return peak * Math.exp(-PULSE_DECAY * (beats - beat));
}
