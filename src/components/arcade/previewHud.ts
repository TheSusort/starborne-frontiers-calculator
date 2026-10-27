import { previewScale, PREVIEW_TOTAL_SECONDS } from '../../utils/arcade/engine';
import { PREVIEW_SCALE } from '../../utils/arcade/constants';
import type { Checkpoint, GameState } from '../../utils/arcade/types';
import type { Ship } from '../../types/ship';
import type { RowPicks } from './duel/pickOpponents';
import { challengeBanner } from './duel/stakesText';
import type { PreviewBannerContent } from './PreviewBanner';

/** How visible the preview's labels over the gates are `elapsed` real seconds into a checkpoint
 *  preview: 0 at full speed, 1 at full slow motion, tracking the slow-down in between, so they
 *  fade in and out with it. */
export function previewAlpha(elapsed: number): number {
    if (elapsed <= 0 || elapsed >= PREVIEW_TOTAL_SECONDS) return 0;
    return Math.max(0, Math.min(1, (1 - previewScale(elapsed)) / (1 - PREVIEW_SCALE)));
}

/** The preview label alpha for checkpoint `checkpointId` in `game`: 0 unless it is the row being
 *  previewed. */
export const previewAlphaFor = (game: GameState, checkpointId: number): number =>
    game.preview?.checkpointId === checkpointId ? previewAlpha(game.preview.elapsed) : 0;

/**
 * Centres for two labels `width` wide wanted at `xs` (left gate first), pushed apart about their
 * midpoint until `gap` separates them, then shifted as a pair to stay `margin` inside a screen
 * `screenW` wide where it is wide enough. Far away the two gates are only a few pixels apart, so
 * their labels would otherwise overlap.
 */
export function spreadLabels(
    xs: readonly [number, number],
    width: number,
    gap: number,
    screenW: number,
    margin: number
): [number, number] {
    let [a, b] = xs[0] <= xs[1] ? xs : [xs[1], xs[0]];
    const need = width + gap;
    if (b - a < need) {
        const mid = (a + b) / 2;
        a = mid - need / 2;
        b = mid + need / 2;
    }
    const lo = margin + width / 2;
    const hi = screenW - margin - width / 2;
    if (hi - lo >= b - a) {
        const shift = a < lo ? lo - a : b > hi ? hi - b : 0;
        a += shift;
        b += shift;
    }
    return xs[0] <= xs[1] ? [a, b] : [b, a];
}

/** The preview banner for checkpoint row `c`: its challenge and stakes and, on a `team` row, the
 *  player's two allies from `picks`. */
export function previewBannerContent(
    c: Pick<Checkpoint, 'id' | 'challenge' | 'stakes'>,
    picks: RowPicks | undefined,
    portraitOf: (ship: Ship) => string | null
): PreviewBannerContent {
    return {
        checkpointId: c.id,
        text: challengeBanner(c.challenge, c.stakes),
        allies:
            picks?.kind === 'team'
                ? picks.allies.map((ship) => ({ name: ship.name, portraitUrl: portraitOf(ship) }))
                : [],
    };
}

/** A preview card's column width, portrait size and total width for `n` ships, each portrait
 *  `wanted` pixels wide at most: capped so two cards, the `gap` between them and a `margin` on
 *  each side fit inside `screenW`, with no portrait wider than its column. */
export function previewCardSize(
    screenW: number,
    n: number,
    wanted: number,
    team: boolean,
    { pad, gap, margin }: { pad: number; gap: number; margin: number }
): { colW: number; portrait: number; width: number } {
    const maxWidth = (screenW - 2 * margin - gap) / 2;
    const maxColW = Math.max(0, (maxWidth - (n + 1) * pad) / n);
    const colW = Math.min(team ? wanted + 16 : Math.max(wanted, 120), maxColW);
    const portrait = Math.min(wanted, colW);
    return { colW, portrait, width: n * colW + (n + 1) * pad };
}
