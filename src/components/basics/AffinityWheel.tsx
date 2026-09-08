import React, { useState } from 'react';
import { Callout } from '../ui/Callout';
import { hexPoints } from '../ui/hexGeometry';
import type { AffinityName } from '../../types/ship';

/** The three cycle members — the fourth `AffinityName`, antimatter, never wins or loses an
 *  affinity matchup and has no node on the wheel. */
type CycleAffinity = 'electric' | 'thermal' | 'chemical';

/** The three-way cycle, as `[winner, loser]`. Mirrors ADVANTAGE_OVER in
 *  src/utils/calculators/affinityUtils.ts — a test asserts the two agree. */
const CYCLE: [CycleAffinity, CycleAffinity][] = [
    ['electric', 'thermal'],
    ['thermal', 'chemical'],
    ['chemical', 'electric'],
];

const LABEL: Record<AffinityName, string> = {
    electric: 'Electric',
    thermal: 'Thermal',
    chemical: 'Chemical',
    antimatter: 'Antimatter',
};

/** Stroke/text colours matching the in-game loading screen and HexButton's AFFINITY_COLORS.
 *  These are the game's own vocabulary, not palette: they report a value the player reads in
 *  game, which is why they are the one place on this page colour carries meaning. */
const COLOR: Record<AffinityName, string> = {
    electric: '#3b82f6',
    thermal: '#f97316',
    chemical: '#16a34a',
    antimatter: '#a855f7',
};

/** Where each of the three cycle members sits on the wheel, in SVG coordinates. */
const NODE: Record<CycleAffinity, { x: number; y: number }> = {
    electric: { x: 150, y: 54 },
    thermal: { x: 246, y: 220 },
    chemical: { x: 54, y: 220 },
};

const HEX_R = 46;
/** Clears the hex edge plus the arrowhead's tip overshoot, so an arrow starts and ends in open
 *  space rather than under a node. */
const EDGE_GAP = HEX_R + 8;

const AffinityWheel: React.FC = () => {
    /** The node the reader is pointing at, keyboard-focusing or has tapped. Null means the whole
     *  cycle is shown at equal weight. */
    const [focus, setFocus] = useState<CycleAffinity | null>(null);

    const beats = focus ? CYCLE.find(([w]) => w === focus)![1] : null;
    const losesTo = focus ? CYCLE.find(([, l]) => l === focus)![0] : null;

    /** With three members in the cycle, a focused node makes every other node either the one it
     *  beats or the one that beats it — there is no unrelated third. */
    const relationOf = (a: CycleAffinity): 'focus' | 'beaten' | 'beater' | 'none' => {
        if (!focus) return 'none';
        if (a === focus) return 'focus';
        return a === beats ? 'beaten' : 'beater';
    };

    /** An arrow is lit when the focused node is at either end of it. */
    const arrowLit = (winner: CycleAffinity, loser: CycleAffinity): boolean =>
        !focus || winner === focus || loser === focus;

    return (
        <div className="card space-y-4">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] items-center">
                <div>
                    <svg viewBox="0 0 300 280" className="w-full max-w-[20rem] h-auto mx-auto">
                        <defs>
                            {CYCLE.map(([winner]) => (
                                <marker
                                    key={winner}
                                    id={`affinity-arrow-${winner}`}
                                    markerWidth="6"
                                    markerHeight="6"
                                    refX="5"
                                    refY="3"
                                    orient="auto"
                                >
                                    <path d="M0,0 L6,3 L0,6 Z" fill={COLOR[winner]} />
                                </marker>
                            ))}
                        </defs>

                        {CYCLE.map(([winner, loser]) => {
                            const from = NODE[winner];
                            const to = NODE[loser];
                            const dx = to.x - from.x;
                            const dy = to.y - from.y;
                            const t = EDGE_GAP / Math.hypot(dx, dy);
                            return (
                                <line
                                    key={`${winner}-${loser}`}
                                    data-testid={`affinity-beats-${winner}-${loser}`}
                                    x1={from.x + dx * t}
                                    y1={from.y + dy * t}
                                    x2={to.x - dx * t}
                                    y2={to.y - dy * t}
                                    stroke={COLOR[winner]}
                                    strokeWidth={2.5}
                                    markerEnd={`url(#affinity-arrow-${winner})`}
                                    className="transition-opacity duration-200 motion-reduce:transition-none"
                                    opacity={arrowLit(winner, loser) ? 1 : 0.15}
                                />
                            );
                        })}

                        {(Object.keys(NODE) as CycleAffinity[]).map((key) => {
                            const relation = relationOf(key);
                            const { x, y } = NODE[key];
                            const itBeats = CYCLE.find(([w]) => w === key)![1];
                            const itLosesTo = CYCLE.find(([, l]) => l === key)![0];
                            return (
                                <g
                                    key={key}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${LABEL[key]} beats ${LABEL[itBeats]}, and loses to ${LABEL[itLosesTo]}`}
                                    onMouseEnter={() => setFocus(key)}
                                    onMouseLeave={() => setFocus(null)}
                                    onFocus={() => setFocus(key)}
                                    onBlur={() => setFocus(null)}
                                    // Set, never toggle: mouseenter and focus both fire before
                                    // click, so a toggle would read its own hover state and
                                    // clear the isolation the tap was meant to pin.
                                    onClick={() => setFocus(key)}
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return;
                                        event.preventDefault();
                                        setFocus(key);
                                    }}
                                    className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-primary transition-opacity duration-200 motion-reduce:transition-none"
                                >
                                    <polygon
                                        points={hexPoints(x, y, HEX_R)}
                                        fill={COLOR[key]}
                                        fillOpacity={relation === 'focus' ? 0.3 : 0.12}
                                        stroke={COLOR[key]}
                                        strokeWidth={relation === 'focus' ? 3 : 1.5}
                                        className="transition-[fill-opacity,stroke-width] duration-200 motion-reduce:transition-none"
                                    />
                                    <text
                                        x={x}
                                        y={y}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        fill={COLOR[key]}
                                        className="text-[13px] font-semibold"
                                    >
                                        {LABEL[key]}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Sits at the triangle's centroid, which every arrow crosses — the
                            solid card-coloured fill is what keeps the three cycle arrows from
                            running through the label of the affinity that is outside the cycle. */}
                        <polygon
                            points={hexPoints(150, 165, 40)}
                            stroke={COLOR.antimatter}
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            className="fill-dark"
                        />
                        <text
                            x={150}
                            y={161}
                            textAnchor="middle"
                            fill={COLOR.antimatter}
                            className="text-[11px] font-semibold"
                        >
                            {LABEL.antimatter}
                        </text>
                        <text
                            x={150}
                            y={175}
                            textAnchor="middle"
                            className="fill-theme-text-secondary text-[10px]"
                        >
                            not affected
                        </text>
                    </svg>

                    <p
                        aria-live="polite"
                        className="text-xs text-theme-text-secondary mt-2 text-center min-h-[2rem]"
                    >
                        {focus
                            ? `${LABEL[focus]} beats ${LABEL[beats!]}, and loses to ${LABEL[losesTo!]}.`
                            : 'Point at an affinity to isolate its matchups.'}
                    </p>
                </div>

                <div className="space-y-4 text-sm min-w-0">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-theme-text-secondary mb-1">
                            Affinity advantage
                        </p>
                        <ul className="list-disc list-inside text-theme-text">
                            <li>25% increased Damage</li>
                            <li>25% increased Hacking</li>
                        </ul>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wide text-danger mb-1">
                            Affinity disadvantage
                        </p>
                        <ul className="list-disc list-inside text-theme-text">
                            <li>Damage and Hacking decreased by 25%</li>
                            <li>Crit. Rate decreased by 25% (Hard cap at 75%)</li>
                            <li>Effects that do not require hacking will not be applied</li>
                        </ul>
                    </div>
                </div>
            </div>

            <Callout variant="mistake" className="max-w-[68ch]">
                <p>
                    That last line is the one that catches people out. Your damage still lands at a
                    disadvantage — 25% smaller, but it lands — and debuffs that roll against hacking
                    still get their reduced chance. What stops entirely is every debuff that would
                    normally apply with no hacking roll at all: those simply do not happen.
                </p>
            </Callout>
        </div>
    );
};

export default AffinityWheel;
