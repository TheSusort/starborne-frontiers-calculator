import React, { useMemo, useState } from 'react';
import { Position } from '../../types/encounters';
import { Button } from '../ui/Button';
import { HEX_RADIUS, axialToPixel, hexPoints } from '../ui/hexGeometry';
import { PATTERN_SHAPES, TARGETING_RULES } from '../../constants/targetingRules';
import { ALL_POSITIONS, positionToAxial } from '../../utils/targeting/board';
import { selectTargets } from '../../utils/targeting/selectTargets';
import { resolveCells } from '../../utils/targeting/resolvePattern';
import type { ParsedPattern, ParsedTarget, TargetSelection } from '../../utils/targetingParser';
import { DEMO_CASTER, DEMO_ENEMIES, DEMO_PATTERNS, DEMO_RULES } from './targetingBoardDemo';

// Re-exported so the test can pin the fixture (see targetingBoardDemo.ts for why these live in
// a plain module rather than being declared directly in this component file).
export { DEMO_CASTER, DEMO_ENEMIES };

type HitRole = 'primary' | 'splash' | 'coveredEmpty';

// Six-state visual vocabulary. `enemy` (a ship, untouched) and `empty` (no ship) must be
// unmistakable at a glance, not merely a shade of border apart — the section's whole lesson is
// which enemy cells are occupied. Stroke width and dash are baked in per-role rather than shared
// across the whole polygon, since `coveredEmpty` needs a dashed outline the other roles don't.
const FILL: Record<'primary' | 'splash' | 'coveredEmpty' | 'enemy' | 'caster' | 'empty', string> = {
    primary: 'fill-[rgba(255,59,92,0.35)] stroke-[#ff3b5c] [stroke-width:2]',
    splash: 'fill-[rgba(255,138,156,0.22)] stroke-[#ff8a9c] [stroke-width:1.5]',
    // In the pattern's footprint, but no ship sits here: outline only, no fill, so it can
    // never be mistaken for a hit ship (primary/splash) or an untouched one (enemy).
    coveredEmpty: 'fill-transparent stroke-[#ff3b5c] [stroke-width:2] [stroke-dasharray:4,3]',
    // A ship, untouched by the pattern: solid, obvious fill — must read as "a ship is here"
    // at a glance, not just a slightly brighter border than `empty`.
    enemy: 'fill-[rgba(148,163,184,0.6)] stroke-[#cbd5e1] [stroke-width:2]',
    caster: 'fill-[rgba(74,222,128,0.28)] stroke-[#4ade80] [stroke-width:1.5]',
    // No ship, not covered: a faint outline only — must read as "obviously not a ship".
    empty: 'fill-transparent stroke-[rgba(148,163,184,0.18)] [stroke-width:1]',
};

const PAD = 8;

interface BoardProps {
    /** Prefix for each cell's test id, e.g. "enemy" -> `enemy-cell-T4`. */
    idPrefix: string;
    /** Draw the front column on the LEFT. The enemy fleet faces you, so its board is mirrored. */
    mirror: boolean;
    occupied: readonly Position[];
    caster?: Position;
    hits?: Map<Position, HitRole>;
    ariaLabel: string;
}

const Board: React.FC<BoardProps> = ({ idPrefix, mirror, occupied, caster, hits, ariaLabel }) => {
    const placed = useMemo(
        () =>
            ALL_POSITIONS.map((position) => {
                const { q, r } = positionToAxial(position);
                const [px, py] = axialToPixel(q, r);
                return { position, cx: mirror ? -px : px, cy: py };
            }),
        [mirror]
    );

    const xs = placed.map((p) => p.cx);
    const ys = placed.map((p) => p.cy);
    const minX = Math.min(...xs) - HEX_RADIUS - PAD;
    const maxX = Math.max(...xs) + HEX_RADIUS + PAD;
    const minY = Math.min(...ys) - HEX_RADIUS - PAD;
    const maxY = Math.max(...ys) + HEX_RADIUS + PAD;

    return (
        <svg
            viewBox={`${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(
                maxY - minY
            ).toFixed(1)}`}
            role="img"
            aria-label={ariaLabel}
            className="w-full h-auto max-h-[200px]"
        >
            {placed.map(({ position, cx, cy }) => {
                const hit = hits?.get(position);
                const isCaster = position === caster;
                const style = hit
                    ? FILL[hit]
                    : isCaster
                      ? FILL.caster
                      : occupied.includes(position)
                        ? FILL.enemy
                        : FILL.empty;
                return (
                    <g
                        key={position}
                        data-testid={`${idPrefix}-cell-${position}`}
                        data-position={position}
                        data-hit={hit ?? 'none'}
                        data-caster={isCaster ? 'true' : 'false'}
                    >
                        <polygon points={hexPoints(cx, cy, HEX_RADIUS - 2)} className={style} />
                        <text
                            x={cx}
                            y={cy + 4}
                            textAnchor="middle"
                            className="fill-theme-text text-[10px]"
                        >
                            {position}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
};

const TargetingBoard: React.FC = () => {
    const [ruleId, setRuleId] = useState<TargetSelection>('front');
    const [patternIndex, setPatternIndex] = useState(0);

    const pattern: ParsedPattern = useMemo(() => {
        const { shape, range } = DEMO_PATTERNS[patternIndex];
        return { raw: `demo-${shape}-${range}`, shape, range, modifiers: {} };
    }, [patternIndex]);

    const hits = useMemo(() => {
        const target: ParsedTarget = { raw: ruleId, side: 'enemy', selection: ruleId };
        const { ordered, anchor } = selectTargets(target, {
            casterPosition: DEMO_CASTER,
            enemyOccupied: DEMO_ENEMIES,
        });

        const out = new Map<Position, HitRole>();

        // 'all' has no single anchor to stamp a footprint around — every living enemy is primary.
        if (ruleId === 'all') {
            for (const pos of ordered) out.set(pos, 'primary');
            return out;
        }
        if (!anchor) return out;
        out.set(anchor, 'primary');

        // resolveCells works in the SAME axial frame as the board — do not negate its offsets.
        // Mirroring is a pixel-space concern handled by <Board mirror>.
        const cells = resolveCells(pattern, anchor);
        for (const cell of cells) {
            if (cell.role !== 'covered') continue;
            if (cell.position === anchor) continue;
            // A covered cell shows as a hit (splash) if a ship is there, or as the distinct
            // "in the pattern, no ship there" state otherwise — the pattern's true footprint
            // is shown either way, not just the cells that happen to connect.
            out.set(
                cell.position,
                DEMO_ENEMIES.includes(cell.position) ? 'splash' : 'coveredEmpty'
            );
        }
        return out;
    }, [ruleId, pattern]);

    const rule = TARGETING_RULES[ruleId];

    return (
        <div className="card space-y-4">
            <div className="flex flex-wrap gap-2">
                {DEMO_RULES.map((id) => (
                    <Button
                        key={id}
                        size="sm"
                        variant={id === ruleId ? 'primary' : 'secondary'}
                        onClick={() => setRuleId(id)}
                    >
                        {TARGETING_RULES[id].label}
                    </Button>
                ))}
            </div>

            <div className="flex flex-wrap gap-2">
                {DEMO_PATTERNS.map((p, i) => (
                    <Button
                        key={p.shape}
                        size="sm"
                        variant={i === patternIndex ? 'primary' : 'secondary'}
                        onClick={() => setPatternIndex(i)}
                        disabled={ruleId === 'all'}
                    >
                        {PATTERN_SHAPES[p.shape].label}
                    </Button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-4 items-center">
                <div>
                    <p className="text-xs text-theme-text-secondary mb-1">Your fleet</p>
                    <Board
                        idPrefix="player"
                        mirror={false}
                        occupied={[DEMO_CASTER]}
                        caster={DEMO_CASTER}
                        ariaLabel="Your fleet. Your attacker is in the bottom row, position 2."
                    />
                </div>
                <div>
                    <p className="text-xs text-theme-text-secondary mb-1 text-right">Enemy fleet</p>
                    <Board
                        idPrefix="enemy"
                        mirror
                        occupied={DEMO_ENEMIES}
                        hits={hits}
                        ariaLabel={`Enemy fleet, showing which ships the ${rule.label} rule hits.`}
                    />
                </div>
            </div>

            <div>
                <p className="font-semibold text-primary">{rule.label}</p>
                <p className="text-sm text-theme-text">{rule.description}</p>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-theme-text-secondary">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#4ade80]" /> Your attacker
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#ff3b5c]" /> Main target
                    (full damage)
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#ff8a9c]" /> Also hit (half
                    damage)
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm border-2 border-dashed border-[#ff3b5c]" />{' '}
                    In the pattern, no ship there
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#cbd5e1]" /> Enemy ship,
                    untouched
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm border border-[rgba(148,163,184,0.3)]" />{' '}
                    Empty space
                </span>
            </div>
        </div>
    );
};

export default TargetingBoard;
