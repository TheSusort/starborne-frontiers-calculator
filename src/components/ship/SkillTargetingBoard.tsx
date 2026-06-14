import React from 'react';
import { Position } from '../../types/encounters';
import { SkillTargeting } from '../../utils/targetingParser';
import { ALL_POSITIONS, positionToAxial } from '../../utils/targeting/board';
import { CellRole, resolveCells } from '../../utils/targeting/resolvePattern';
import { pickDisplayAnchor, targetingLabel } from '../../utils/targeting/targetingDisplay';

// Compact single-board footprint. One board for both ally and enemy targets — the
// resolved cells are identical regardless of side, so we draw one un-mirrored board
// and let the caption convey which side it targets.
const W = 24;
const H = 20;
const HEX_RX = 11;
const HEX_RY = 13;
// Padding added to rawXY so the leftmost/topmost hex stays inside the SVG frame.
// rawX ∈ [-12, 72], rawY ∈ [0, 40]. Hex half-extents: HEX_RX·cos(30°) ≈ 9.5 px wide,
// HEX_RY = 13 px tall.
// GRID_PAD_X=24: leftmost cx = -12+24 = 12, left vertex = 12-9.5 ≈ 2.5 ✓;
//                rightmost cx = 72+24 = 96, right vertex = 96+9.5 ≈ 105.5 → width 108 ✓
// GRID_PAD_Y=15: top vertex = 0+15-13 = 2 ✓; bottom vertex = 40+15+13 = 68 → height 70 ✓
const GRID_PAD_X = 24;
const GRID_PAD_Y = 15;
const SVG_W = 108;
const SVG_H = 70;

const COLORS: Record<CellRole | 'empty', { fill: string; stroke: string }> = {
    origin: { fill: '#7a1020', stroke: '#e0455f' },
    covered: { fill: '#6a4012', stroke: '#e09a45' },
    empty: { fill: '#222a3d', stroke: '#37445e' },
};

function rawXY(pos: Position): [number, number] {
    const { q, r } = positionToAxial(pos);
    return [(q + r / 2) * W, r * H];
}

function hexPath(cx: number, cy: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 90);
        pts.push(
            `${(cx + HEX_RX * Math.cos(a)).toFixed(1)},${(cy + HEX_RY * Math.sin(a)).toFixed(1)}`
        );
    }
    return pts.join(' ');
}

interface SkillTargetingBoardProps {
    targeting: SkillTargeting;
}

export const SkillTargetingBoard: React.FC<SkillTargetingBoardProps> = ({ targeting }) => {
    let roles: Map<Position, CellRole>;
    try {
        const anchor = pickDisplayAnchor(targeting.pattern);
        roles = new Map(resolveCells(targeting.pattern, anchor).map((c) => [c.position, c.role]));
    } catch {
        return null; // unknown pattern signature — show nothing rather than crash
    }

    const caption = targetingLabel(targeting);
    const roleValues = Array.from(roles.values());
    const hasOrigin = roleValues.includes('origin');
    const hasCovered = roleValues.includes('covered');

    return (
        <div className="mt-2 text-[11px] text-theme-text/70">
            <div className="mb-1">{caption}</div>
            <svg
                width={SVG_W}
                height={SVG_H}
                role="img"
                aria-label={`Targeting footprint: ${caption}`}
            >
                <g data-board="footprint">
                    {ALL_POSITIONS.map((pos) => {
                        const [x, y] = rawXY(pos);
                        const cx = x + GRID_PAD_X;
                        const cy = y + GRID_PAD_Y;
                        const role = roles.get(pos);
                        const colors = COLORS[role ?? 'empty'];
                        return (
                            <polygon
                                key={pos}
                                data-position={pos}
                                data-role={role ?? 'empty'}
                                points={hexPath(cx, cy)}
                                fill={colors.fill}
                                stroke={colors.stroke}
                                strokeWidth={1.4}
                            />
                        );
                    })}
                </g>
            </svg>
            <div className="flex gap-3 mt-1">
                {hasOrigin && (
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2 h-2 bg-[#e0455f]" />
                        origin
                    </span>
                )}
                {hasCovered && (
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-2 h-2 bg-[#e09a45]" />
                        covered
                    </span>
                )}
            </div>
        </div>
    );
};
