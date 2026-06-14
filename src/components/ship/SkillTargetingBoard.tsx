import React from 'react';
import { Position } from '../../types/encounters';
import { SkillTargeting } from '../../utils/targetingParser';
import { ALL_POSITIONS, positionToAxial } from '../../utils/targeting/board';
import { CellRole, resolveCells } from '../../utils/targeting/resolvePattern';
import { pickDisplayAnchor, targetingLabel } from '../../utils/targeting/targetingDisplay';

const W = 44;
const H = 38;
const HEX_RX = 21;
const HEX_RY = 24;

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

interface BoardProps {
    ox: number;
    oy: number;
    mirror: boolean;
    roles: Map<Position, CellRole>;
    label: string;
}

const Board: React.FC<BoardProps> = ({ ox, oy, mirror, roles, label }) => (
    <g data-board={label}>
        {ALL_POSITIONS.map((pos) => {
            const [rawX, y] = rawXY(pos);
            const x = mirror ? 110 - rawX : rawX;
            const cx = ox + x + 30;
            const cy = oy + y + 22;
            const role = roles.get(pos);
            const colors = COLORS[role ?? 'empty'];
            return (
                <g key={pos} data-position={pos} data-role={role ?? 'empty'}>
                    <polygon
                        points={hexPath(cx, cy)}
                        fill={colors.fill}
                        stroke={colors.stroke}
                        strokeWidth={1.4}
                    />
                    <text
                        x={cx}
                        y={cy + 4}
                        textAnchor="middle"
                        fontSize={10}
                        fill={role ? '#fff' : '#6b7794'}
                    >
                        {pos}
                    </text>
                </g>
            );
        })}
    </g>
);

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

    const isSupport =
        targeting.pattern.modifiers.support === true || targeting.target.side === 'ally';
    const caption = targetingLabel(targeting);

    return (
        <div className="mt-2 text-[11px] text-theme-text/70">
            <div className="mb-1">{caption}</div>
            {isSupport ? (
                <svg
                    width={178}
                    height={120}
                    role="img"
                    aria-label={`Targeting footprint: ${caption}`}
                >
                    <Board ox={0} oy={12} mirror={false} roles={roles} label="own" />
                    <text x={89} y={112} textAnchor="middle" fontSize={10} fill="#5a6a86">
                        your board
                    </text>
                </svg>
            ) : (
                <svg
                    width={402}
                    height={120}
                    role="img"
                    aria-label={`Targeting footprint: ${caption}`}
                >
                    <Board ox={0} oy={12} mirror={false} roles={new Map()} label="team" />
                    <text x={201} y={62} textAnchor="middle" fontSize={20} fill="#6ca8ff">
                        ▶
                    </text>
                    <Board ox={224} oy={12} mirror roles={roles} label="enemy" />
                </svg>
            )}
            <div className="flex gap-3 mt-1">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-[#e0455f]" />
                    origin
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-[#e09a45]" />
                    covered
                </span>
            </div>
        </div>
    );
};
