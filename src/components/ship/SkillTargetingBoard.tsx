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
// Padding added to each board's rawXY so the leftmost/topmost hex stays
// inside the SVG frame.  rawX ∈ [-22, 132], rawY ∈ [0, 76].
// Half-extents per hex: HEX_RX*cos(30°) ≈ 18 px wide, HEX_RY = 24 px tall.
// With GRID_PAD_X=41: leftmost cx = -22+41 = 19, left vertex = 19-18 = 1 ✓
// With GRID_PAD_Y=26: top vertex = 0+26-24 = 2, bottom vertex = 76+26+24 = 126 ✓
const GRID_PAD_X = 41;
const GRID_PAD_Y = 26;

// ---- Support (single-board) SVG dimensions ----
// Board cx ∈ [19, 173], right vertex = 173 + 18 = 191 → width 194 with 3 px spare.
// Board cy ∈ [26, 102], bottom vertex = 102 + 24 = 126 → footer at y=138, height 142.
const SUPPORT_SVG_W = 194;
const SUPPORT_SVG_H = 142;
const SUPPORT_LABEL_X = 97; // horizontal centre of the single board
const SUPPORT_LABEL_Y = 138;

// ---- Attacker (dual-board) SVG dimensions ----
// Team board: ox=0, cx ∈ [19, 173], right vertex = 191.
// Enemy board (mirrored, ox=ENEMY_OX): cx ∈ [ox+19, ox+173], right vertex = ox+191.
// Arrow sits at horizontal midpoint between the two boards.
// Choose ENEMY_OX=212 → vertex-to-vertex gap = (212+19) - 191 = 40 px? No:
//   right vertex of team board  = 191 (HEX_RX·cos30° ≈ 18 → 173+18 = 191)
//   left  vertex of enemy board = ENEMY_OX + 19 - 18 = 212 + 1 = 213
//   true vertex-to-vertex gap   = 213 - 191 = 22 px ≈ 21 px — fine for the ▶ glyph.
// Arrow x = midpoint of gap = (191 + 213)/2 = 202, but computed below as midpoint of board centres.
// Total width = ENEMY_OX + 191 + 3 = 212 + 191 + 3 = 406.
const ENEMY_OX = 212;
const ATTACKER_SVG_W = ENEMY_OX + 191 + 3; // = 406
const ATTACKER_SVG_H = SUPPORT_SVG_H; // same row geometry, same height
const ARROW_X = Math.round((191 + ENEMY_OX + 19) / 2); // midpoint of gap ≈ 211

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
    mirror: boolean;
    roles: Map<Position, CellRole>;
    label: string;
}

const Board: React.FC<BoardProps> = ({ ox, mirror, roles, label }) => (
    <g data-board={label}>
        {ALL_POSITIONS.map((pos) => {
            const [rawX, y] = rawXY(pos);
            const x = mirror ? 110 - rawX : rawX;
            const cx = ox + x + GRID_PAD_X;
            const cy = y + GRID_PAD_Y;
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
    const roleValues = Array.from(roles.values());
    const hasOrigin = roleValues.includes('origin');
    const hasCovered = roleValues.includes('covered');

    return (
        <div className="mt-2 text-[11px] text-theme-text/70">
            <div className="mb-1">{caption}</div>
            {isSupport ? (
                <svg
                    width={SUPPORT_SVG_W}
                    height={SUPPORT_SVG_H}
                    role="img"
                    aria-label={`Targeting footprint: ${caption}`}
                >
                    <Board ox={0} mirror={false} roles={roles} label="own" />
                    <text
                        x={SUPPORT_LABEL_X}
                        y={SUPPORT_LABEL_Y}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#5a6a86"
                    >
                        your board
                    </text>
                </svg>
            ) : (
                <svg
                    width={ATTACKER_SVG_W}
                    height={ATTACKER_SVG_H}
                    role="img"
                    aria-label={`Targeting footprint: ${caption}`}
                >
                    <Board ox={0} mirror={false} roles={new Map()} label="team" />
                    <text
                        x={ARROW_X}
                        y={Math.round(ATTACKER_SVG_H / 2)}
                        textAnchor="middle"
                        fontSize={20}
                        fill="#6ca8ff"
                    >
                        ▶
                    </text>
                    <Board ox={ENEMY_OX} mirror roles={roles} label="enemy" />
                    <text
                        x={97}
                        y={SUPPORT_LABEL_Y}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#5a6a86"
                    >
                        your fleet
                    </text>
                    <text
                        x={ENEMY_OX + 97}
                        y={SUPPORT_LABEL_Y}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#5a6a86"
                    >
                        enemies
                    </text>
                </svg>
            )}
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
