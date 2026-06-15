import React from 'react';
import { SkillTargeting, TargetSide } from '../../utils/targetingParser';
import { AoeCellRole, PatternCell, toPatternCells } from '../../utils/targeting/aoePattern';
import { targetingLabel } from '../../utils/targeting/targetingDisplay';
import { parseEffectScope } from '../../utils/targeting/effectScope';
import { TARGETING_RULES } from '../../constants/targetingRules';

// Pointy-top hexes. Center-to-vertex radius; a small gap shrinks the drawn polygon so cells
// read as separate. The SVG auto-fits its viewBox to the pattern's bounding box, so any
// footprint centers and scales within the fixed-width left pane.
const RADIUS = 22;
const GAP = 2;
const PAD = 6; // viewBox margin so the glow filter isn't clipped

// The excluded caster (notSelf patterns) renders as a neutral gray marker on either side.
const CASTER_COLOR = { fill: 'rgba(148,163,184,0.16)', stroke: '#94a3b8' };

// Cell colors depend on the target side: enemy (attacker) reads red, ally (support) reads
// green. Primary/caster is the stronger shade; splash/allies is the lighter shade.
const ROLE_STYLE: Record<TargetSide, Record<AoeCellRole, { fill: string; stroke: string }>> = {
    enemy: {
        primary: { fill: 'rgba(255,59,92,0.18)', stroke: '#ff3b5c' }, // red
        splash: { fill: 'rgba(255,138,156,0.18)', stroke: '#ff8a9c' }, // lighter red
        caster: CASTER_COLOR,
    },
    ally: {
        primary: { fill: 'rgba(22,163,74,0.26)', stroke: '#16a34a' }, // darker green (caster)
        splash: { fill: 'rgba(74,222,128,0.20)', stroke: '#4ade80' }, // green
        caster: CASTER_COLOR,
    },
};

// Legend labels + swatch classes per side. Swatch classes are written as literals so
// Tailwind's JIT picks them up.
const LEGEND: Record<TargetSide, Record<AoeCellRole, { label: string; dot: string }>> = {
    enemy: {
        primary: { label: 'Primary', dot: 'bg-[#ff3b5c]' },
        splash: { label: 'Splash', dot: 'bg-[#ff8a9c]' },
        caster: { label: 'Caster', dot: 'bg-[#94a3b8]' },
    },
    ally: {
        primary: { label: 'Caster', dot: 'bg-[#16a34a]' },
        splash: { label: 'Allies', dot: 'bg-[#4ade80]' },
        caster: { label: 'Caster', dot: 'bg-[#94a3b8]' },
    },
};

// Pointy-top axial → pixel.
function axialToPixel(q: number, r: number): [number, number] {
    return [RADIUS * Math.sqrt(3) * (q + r / 2), RADIUS * 1.5 * r];
}

function hexPoints(cx: number, cy: number, radius: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 90);
        pts.push(
            `${(cx + radius * Math.cos(a)).toFixed(1)},${(cy + radius * Math.sin(a)).toFixed(1)}`
        );
    }
    return pts.join(' ');
}

interface SkillTargetingBoardProps {
    targeting: SkillTargeting;
    /** Raw skill text — used to surface secondary effect scopes (e.g. "all enemies"). */
    skillText?: string;
}

export const SkillTargetingBoard: React.FC<SkillTargetingBoardProps> = ({
    targeting,
    skillText,
}) => {
    let cells: PatternCell[];
    try {
        cells = toPatternCells(targeting.pattern);
    } catch {
        return null; // unknown pattern signature — show nothing rather than crash
    }
    if (cells.length === 0) return null;

    const side = targeting.target.side;
    const mirror = side === 'enemy'; // attacker footprints face the enemy formation
    const rule = TARGETING_RULES[targeting.target.selection];

    // Place cells (mirrored horizontally for enemy) and compute the bounding box.
    const placed = cells.map((c) => {
        const [px, py] = axialToPixel(c.q, c.r);
        return { cx: mirror ? -px : px, cy: py, role: c.role };
    });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { cx, cy } of placed) {
        minX = Math.min(minX, cx - RADIUS);
        maxX = Math.max(maxX, cx + RADIUS);
        minY = Math.min(minY, cy - RADIUS);
        maxY = Math.max(maxY, cy + RADIUS);
    }
    const viewBox = `${(minX - PAD).toFixed(1)} ${(minY - PAD).toFixed(1)} ${(
        maxX -
        minX +
        2 * PAD
    ).toFixed(1)} ${(maxY - minY + 2 * PAD).toFixed(1)}`;

    const hasCaster = cells.some((c) => c.role === 'caster');
    const hasPrimary = cells.some((c) => c.role === 'primary');
    const hasSplash = cells.some((c) => c.role === 'splash');
    const legend = LEGEND[side];

    // Secondary effect scope (debuffs/buffs that reach beyond the damage hit). Skip when the
    // footprint already covers the whole board — the scope would be redundant.
    const effectScope =
        skillText && targeting.pattern.shape !== 'all' ? parseEffectScope(skillText) : null;

    return (
        <div className="bg-dark-lighter p-2 shadow-lg max-w-sm mb-1 border border-dark-border">
            <div className="flex items-stretch gap-3">
                <div className="w-[130px] shrink-0 flex items-center justify-center">
                    <svg
                        viewBox={viewBox}
                        role="img"
                        aria-label={`Targeting footprint: ${targetingLabel(targeting)}`}
                        className="w-full h-auto max-h-[110px]"
                    >
                        <defs>
                            <filter id="aoe-glow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b" />
                                <feMerge>
                                    <feMergeNode in="b" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <g filter="url(#aoe-glow)" data-cluster="footprint">
                            {placed.map((p, i) => (
                                <polygon
                                    key={i}
                                    data-role={p.role}
                                    points={hexPoints(p.cx, p.cy, RADIUS - GAP)}
                                    fill={ROLE_STYLE[side][p.role].fill}
                                    stroke={ROLE_STYLE[side][p.role].stroke}
                                    strokeWidth={1.5}
                                />
                            ))}
                        </g>
                    </svg>
                </div>

                <div className="border-l border-dark-border" />

                <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-primary">{rule.label}</div>
                    <p className="text-sm text-theme-text mt-1">{rule.description}</p>
                    <div className="flex gap-3 mt-2 text-[11px] text-theme-text/70">
                        {hasCaster && (
                            <span className="inline-flex items-center gap-1">
                                <span
                                    className={`inline-block w-2 h-2 rounded-sm ${legend.caster.dot}`}
                                />
                                {legend.caster.label}
                            </span>
                        )}
                        {hasPrimary && (
                            <span className="inline-flex items-center gap-1">
                                <span
                                    className={`inline-block w-2 h-2 rounded-sm ${legend.primary.dot}`}
                                />
                                {legend.primary.label}
                            </span>
                        )}
                        {hasSplash && (
                            <span className="inline-flex items-center gap-1">
                                <span
                                    className={`inline-block w-2 h-2 rounded-sm ${legend.splash.dot}`}
                                />
                                {legend.splash.label}
                            </span>
                        )}
                    </div>
                    {effectScope && (
                        <p className="text-[11px] text-theme-text/70 mt-1">
                            Also affects: <span className="text-theme-text">{effectScope}</span>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};
