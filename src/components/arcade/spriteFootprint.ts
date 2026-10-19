/** Where a sprite's visible pixels sit, as fractions of its frame measured from the frame's
 *  centre: `halfWidth` to the farther side, `top` and `bottom` signed (negative is up). */
export interface Footprint {
    halfWidth: number;
    top: number;
    bottom: number;
}

/** Alpha at or above which a pixel counts as part of the ship. */
const OPAQUE = 24;

/**
 * The footprint of the pixels whose alpha is at least `OPAQUE`, in an RGBA buffer `width` by
 * `height`; `null` when there are none.
 */
export function opaqueFootprint(
    rgba: ArrayLike<number>,
    width: number,
    height: number
): Footprint | null {
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (rgba[(y * width + x) * 4 + 3] < OPAQUE) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    if (right < 0) return null;
    const cx = width / 2;
    const cy = height / 2;
    return {
        halfWidth: Math.max(cx - left, right + 1 - cx) / width,
        top: (top - cy) / height,
        bottom: (bottom + 1 - cy) / height,
    };
}

const measured = new WeakMap<HTMLCanvasElement, Footprint | null>();

/** The footprint of a rendered frame, measured once per canvas. */
export function frameFootprint(frame: HTMLCanvasElement): Footprint | null {
    if (measured.has(frame)) return measured.get(frame) ?? null;
    let footprint: Footprint | null = null;
    try {
        const data = frame.getContext('2d')?.getImageData(0, 0, frame.width, frame.height).data;
        if (data) footprint = opaqueFootprint(data, frame.width, frame.height);
    } catch {
        footprint = null;
    }
    measured.set(frame, footprint);
    return footprint;
}
