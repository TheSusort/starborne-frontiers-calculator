/** Pointy-top hex geometry shared by every hex SVG in the app (skill targeting footprints,
 *  the Game Basics targeting board). One implementation so two boards cannot drift apart.
 *
 *  Axial coordinates match `src/utils/targeting/board.ts`: +q is one step right, +r is one
 *  step down and half a hex right (the row stagger that makes the middle row sit between the
 *  top and bottom rows on the real board). */

/** Centre-to-vertex radius in SVG user units. */
export const HEX_RADIUS = 22;

/** Axial (q, r) -> pixel centre, pointy-top layout. */
export function axialToPixel(q: number, r: number): [number, number] {
    return [HEX_RADIUS * Math.sqrt(3) * (q + r / 2), HEX_RADIUS * 1.5 * r];
}

/** The six vertices of a pointy-top hexagon as an SVG `points` string. */
export function hexPoints(cx: number, cy: number, radius: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 90);
        pts.push(
            `${(cx + radius * Math.cos(a)).toFixed(1)},${(cy + radius * Math.sin(a)).toFixed(1)}`
        );
    }
    return pts.join(' ');
}
