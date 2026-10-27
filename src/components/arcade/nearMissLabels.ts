/** A "NEAR MISS +N" label floating up from the ship. `at` is the game time it appeared, so it
 *  holds still while the game does not step (paused, countdown, duel). */
export interface NearMissLabel {
    points: number;
    at: number;
}

/** How long a label shows. */
export const NEAR_MISS_LABEL_SECONDS = 0.8;
/** How far a label rises over its life, in lane widths at the player row. */
const LABEL_RISE = 0.45;
/** The share of its life a label holds full opacity before it starts fading. */
const LABEL_HOLD = 0.35;
/** Labels that appear on the same step stack this far apart, in lane widths. */
const LABEL_STACK = 0.14;
const LABEL_COLOUR = '#ffe066';
const LABEL_GLOW = '#ff4fd8';

/** A label's opacity and rise (lane widths) at `age` seconds, or `null` once it has gone. Under
 *  reduced motion it fades without rising. */
export function nearMissLabelStyle(
    age: number,
    reducedMotion: boolean
): { alpha: number; rise: number } | null {
    if (age < 0 || age >= NEAR_MISS_LABEL_SECONDS) return null;
    const t = age / NEAR_MISS_LABEL_SECONDS;
    const alpha = t <= LABEL_HOLD ? 1 : 1 - (t - LABEL_HOLD) / (1 - LABEL_HOLD);
    const rise = reducedMotion ? 0 : LABEL_RISE * (1 - (1 - t) * (1 - t));
    return { alpha, rise };
}

/** Drops labels that have finished showing at game time `time`. */
export function pruneNearMissLabels(labels: NearMissLabel[], time: number): void {
    let keep = 0;
    for (const label of labels) {
        if (time - label.at < NEAR_MISS_LABEL_SECONDS) labels[keep++] = label;
    }
    labels.length = keep;
}

/** Draws the labels above the point (`x`, `top`), the ship's top; `u` is a lane width there. */
export function drawNearMissLabels(
    ctx: CanvasRenderingContext2D,
    labels: readonly NearMissLabel[],
    time: number,
    x: number,
    top: number,
    u: number,
    reducedMotion: boolean
): void {
    if (labels.length === 0) return;
    const fontPx = Math.max(12, 0.12 * u);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.fillStyle = LABEL_COLOUR;
    ctx.shadowColor = LABEL_GLOW;
    ctx.shadowBlur = fontPx * 0.5;
    labels.forEach((label, i) => {
        const style = nearMissLabelStyle(time - label.at, reducedMotion);
        if (!style) return;
        let stack = 0;
        for (let j = 0; j < i; j++) if (labels[j].at === label.at) stack++;
        const y = top - u * (0.08 + style.rise + LABEL_STACK * stack);
        ctx.globalAlpha = style.alpha;
        ctx.fillText(`NEAR MISS +${label.points}`, x, y);
    });
    ctx.restore();
}
