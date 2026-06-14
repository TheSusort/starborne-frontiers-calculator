import React from 'react';
import { Position } from '../../types/encounters';
import { SkillTargeting } from '../../utils/targetingParser';
import { ALL_POSITIONS, positionToAxial } from '../../utils/targeting/board';
import { CellRole, resolveCells } from '../../utils/targeting/resolvePattern';
import { pickDisplayAnchor, targetingLabel } from '../../utils/targeting/targetingDisplay';

// Compact single-board footprint shown as its own hovercard box (sibling to the
// buff-description boxes). One board per skill; the enemy board is mirrored so its
// front column faces the viewer the way enemies appear in-game.
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
// Mirroring maps x → (rawXmin + rawXmax) − x = 60 − x, which keeps the x-range onto
// itself so the SVG dimensions stay valid for the mirrored (enemy) board.
const MIRROR_CONST = -12 + 72;

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

    const mirror = targeting.target.side === 'enemy';

    return (
        <div className="bg-dark-lighter p-2 shadow-lg max-w-xs mb-1 border border-dark-border">
            <div className="font-semibold text-sm text-primary">Targeting</div>
            <div className="text-sm text-theme-text capitalize mb-1">
                {targeting.target.selection}
            </div>
            <svg
                width={SVG_W}
                height={SVG_H}
                role="img"
                aria-label={`Targeting footprint: ${targetingLabel(targeting)}`}
            >
                <g data-board="footprint">
                    {ALL_POSITIONS.map((pos) => {
                        const [rawX, y] = rawXY(pos);
                        const cx = (mirror ? MIRROR_CONST - rawX : rawX) + GRID_PAD_X;
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
        </div>
    );
};
