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

type HitRole = 'primary' | 'splash';

const FILL: Record<'primary' | 'splash' | 'enemy' | 'caster' | 'empty', string> = {
    primary: 'fill-[rgba(255,59,92,0.35)] stroke-[#ff3b5c]',
    splash: 'fill-[rgba(255,138,156,0.22)] stroke-[#ff8a9c]',
    enemy: 'fill-[rgba(148,163,184,0.14)] stroke-[#94a3b8]',
    caster: 'fill-[rgba(74,222,128,0.28)] stroke-[#4ade80]',
    empty: 'fill-transparent stroke-[rgba(148,163,184,0.3)]',
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
                        <polygon
                            points={hexPoints(cx, cy, HEX_RADIUS - 2)}
                            className={`${style} [stroke-width:1.5]`}
                        />
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
        let cells: ReturnType<typeof resolveCells>;
        try {
            cells = resolveCells(pattern, anchor);
        } catch {
            return out; // unknown signature — show the anchor alone rather than crash
        }
        for (const cell of cells) {
            if (cell.role !== 'covered') continue;
            if (cell.position === anchor) continue;
            // A covered cell with nobody in it is not a hit; only show ships that take damage.
            if (!DEMO_ENEMIES.includes(cell.position)) continue;
            out.set(cell.position, 'splash');
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
                        ariaLabel={`Enemy fleet, showing which ships a ${rule.label} skill hits.`}
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
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#94a3b8]" /> Untouched
                </span>
            </div>
        </div>
    );
};

export default TargetingBoard;
