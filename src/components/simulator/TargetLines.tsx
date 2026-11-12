import React, { useId, useLayoutEffect, useState } from 'react';
import type { TargetLine } from './turnPlayback';

interface TargetLinesProps {
    /** The lines to draw, from `targetLines`. Pass a stable array: it keys the measurement. */
    lines: readonly TargetLine[];
    /** The positioned box that holds both boards (each wrapped in a `data-board-side`). The overlay
     *  fills it and measures cell centres relative to it. */
    containerRef: React.RefObject<HTMLElement | null>;
}

interface Segment {
    role: TargetLine['role'];
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** How far a line stops short of a cell's centre, as a share of the cell's width. */
const START_GAP = 0.3;
const END_GAP = 0.4;

const STYLE = {
    main: { width: 4, className: 'stroke-primary', arrow: 12, fill: 'fill-primary' },
    splash: {
        width: 1.5,
        className: 'stroke-orange-300',
        arrow: 8,
        fill: 'fill-orange-300',
    },
} as const;

/**
 * Lines from the acting ship's cell to the ships its attacks hit, drawn over the two boards: thick
 * and solid to a main target, thin and dashed to a splash target, each ending in an arrowhead.
 * Cell centres are measured from the DOM (`[data-cell]` inside each `[data-board-side]`) after
 * layout and again whenever the container resizes. Decoration only: it never takes pointer events.
 */
export const TargetLines: React.FC<TargetLinesProps> = ({ lines, containerRef }) => {
    const [segments, setSegments] = useState<Segment[]>([]);
    const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

    useLayoutEffect(() => {
        const root = containerRef.current;
        if (!root) return;
        const measure = () => {
            const box = root.getBoundingClientRect();
            const centre = (side: string, cell: string) => {
                const el = root.querySelector(`[data-board-side="${side}"] [data-cell="${cell}"]`);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {
                    x: r.left - box.left + r.width / 2,
                    y: r.top - box.top + r.height / 2,
                    w: r.width,
                };
            };
            const next: Segment[] = [];
            for (const line of lines) {
                const from = centre(line.from.side, line.from.cell);
                const to = centre(line.to.side, line.to.cell);
                if (!from || !to) continue;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const len = Math.hypot(dx, dy);
                const [ux, uy] = len > 0 ? [dx / len, dy / len] : [0, 0];
                const start = Math.min(from.w * START_GAP, len / 3);
                const end = Math.min(to.w * END_GAP, len / 3);
                next.push({
                    role: line.role,
                    x1: from.x + ux * start,
                    y1: from.y + uy * start,
                    x2: to.x - ux * end,
                    y2: to.y - uy * end,
                });
            }
            setSegments(next);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        return () => observer.disconnect();
    }, [lines, containerRef]);

    if (segments.length === 0) return null;
    // Splash first, so a main line crossing one stays on top.
    const ordered = [...segments].sort(
        (a, b) => Number(a.role === 'main') - Number(b.role === 'main')
    );
    return (
        <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
        >
            <defs>
                {(['main', 'splash'] as const).map((role) => (
                    <marker
                        key={role}
                        id={`${markerId}-${role}`}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerUnits="userSpaceOnUse"
                        markerWidth={STYLE[role].arrow}
                        markerHeight={STYLE[role].arrow}
                        orient="auto"
                    >
                        <path d="M0 0L10 5L0 10z" className={STYLE[role].fill} />
                    </marker>
                ))}
            </defs>
            {ordered.map((s, i) => (
                <path
                    key={i}
                    data-role={s.role}
                    d={`M${s.x1} ${s.y1}L${s.x2} ${s.y2}`}
                    fill="none"
                    strokeWidth={STYLE[s.role].width}
                    strokeDasharray={s.role === 'splash' ? '5 4' : undefined}
                    strokeLinecap="round"
                    className={STYLE[s.role].className}
                    markerEnd={`url(#${markerId}-${s.role})`}
                />
            ))}
        </svg>
    );
};
