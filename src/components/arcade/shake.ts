import { SHIELD_BREAK_FLASH } from '../../utils/arcade/constants';

/** How long the screen shakes after the shield breaks, and its peak amplitude as a share of the
 *  canvas height. It rises to the peak over `SHAKE_ATTACK_SECONDS`, then decays quadratically to
 *  0. The rise keeps a break the game has not stepped past yet still: a duel's break is set while
 *  the game is stopped for the duel and its countdown, and shakes once the run resumes. */
export const SHAKE_SECONDS = 0.3;
export const SHAKE_AMPLITUDE = 0.015;
export const SHAKE_ATTACK_SECONDS = 1 / 60;
/** The shake's frequencies on each axis, unequal so its path does not repeat within a shake. */
const SHAKE_HZ_X = 19;
const SHAKE_HZ_Y = 27;

export interface ShakeOffset {
    x: number;
    y: number;
    /** The current amplitude in pixels; both offsets are within it. */
    amplitude: number;
}

/**
 * Writes the canvas shake into `out` for a canvas `h` tall, from the game's `shieldBreakTime`
 * (`SHIELD_BREAK_FLASH` when the shield breaks, counting down with game time, so the shake holds
 * still while the game does not step). Nothing shakes under reduced motion. Returns
 * `out.amplitude`.
 */
export function shakeOffset(
    out: ShakeOffset,
    shieldBreakTime: number,
    h: number,
    reducedMotion: boolean
): number {
    const elapsed = SHIELD_BREAK_FLASH - shieldBreakTime;
    if (reducedMotion || shieldBreakTime <= 0 || elapsed >= SHAKE_SECONDS) {
        out.x = 0;
        out.y = 0;
        out.amplitude = 0;
        return 0;
    }
    const left = 1 - Math.max(0, elapsed) / SHAKE_SECONDS;
    const attack = Math.min(1, Math.max(0, elapsed) / SHAKE_ATTACK_SECONDS);
    const amplitude = SHAKE_AMPLITUDE * h * left * left * attack;
    out.x = amplitude * Math.cos(2 * Math.PI * SHAKE_HZ_X * elapsed);
    out.y = amplitude * Math.cos(2 * Math.PI * SHAKE_HZ_Y * elapsed + 1);
    out.amplitude = amplitude;
    return amplitude;
}
