export type SwipeDirection = 'next' | 'prev';

export const SWIPE_THRESHOLD_PX = 40;

/**
 * Maps a touch drag to a carousel direction. A swipe left (negative `dx`) goes to the next slide,
 * a swipe right to the previous one. Returns null when the horizontal travel is under `threshold`
 * or the drag is mostly vertical (a page scroll, not a swipe).
 */
export const swipeDirection = (
    dx: number,
    dy: number,
    threshold: number = SWIPE_THRESHOLD_PX
): SwipeDirection | null => {
    if (Math.abs(dx) < threshold) return null;
    if (Math.abs(dy) > Math.abs(dx)) return null;
    return dx < 0 ? 'next' : 'prev';
};
