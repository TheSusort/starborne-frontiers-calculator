import React from 'react';
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

/** Stroke/text colours matching the in-game loading screen and HexButton's AFFINITY_COLORS. */
const COLOR: Record<AffinityName, string> = {
    electric: '#3b82f6',
    thermal: '#f97316',
    chemical: '#16a34a',
    antimatter: '#a855f7',
};

/** Where each of the three cycle members sits on the wheel, in SVG coordinates. */
const NODE: Record<CycleAffinity, { x: number; y: number }> = {
    electric: { x: 110, y: 26 },
    thermal: { x: 196, y: 172 },
    chemical: { x: 24, y: 172 },
};

const AffinityWheel: React.FC = () => (
    <div className="card space-y-4">
        <div className="flex flex-col md:flex-row gap-6 items-center">
            <svg
                viewBox="-12 0 244 200"
                role="img"
                aria-label="Affinity cycle: Electric beats Thermal, Thermal beats Chemical, Chemical beats Electric. Antimatter is unaffected."
                className="w-full max-w-[240px] h-auto shrink-0"
            >
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
                    // Shorten both ends so the arrow does not run under the labels. 36px
                    // clears the widest label (8-char "Chemical"/"Electric" at 13px
                    // font-semibold) with the marker's ~2.5px tip overshoot included.
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const len = Math.hypot(dx, dy);
                    const t = 36 / len;
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
                        />
                    );
                })}

                {(Object.keys(NODE) as CycleAffinity[]).map((key) => (
                    <text
                        key={key}
                        x={NODE[key].x}
                        y={NODE[key].y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={COLOR[key]}
                        className="text-[13px] font-semibold"
                    >
                        {LABEL[key]}
                    </text>
                ))}

                <text
                    x={110}
                    y={112}
                    textAnchor="middle"
                    fill={COLOR.antimatter}
                    className="text-[13px] font-semibold"
                >
                    {LABEL.antimatter}
                </text>
                <text
                    x={110}
                    y={128}
                    textAnchor="middle"
                    className="fill-theme-text-secondary text-[10px]"
                >
                    not affected
                </text>
            </svg>

            <div className="space-y-4 text-sm">
                <div>
                    <p className="font-semibold text-primary">Affinity advantage</p>
                    <ul className="list-disc list-inside text-theme-text">
                        <li>25% increased Damage</li>
                        <li>25% increased Hacking</li>
                    </ul>
                </div>
                <div>
                    <p className="font-semibold text-red-400">Affinity disadvantage</p>
                    <ul className="list-disc list-inside text-theme-text">
                        <li>Damage and Hacking decreased by 25%</li>
                        <li>Crit. Rate decreased by 25% (Hard cap at 75%)</li>
                        <li>Effects that do not require hacking will not be applied</li>
                    </ul>
                </div>
            </div>
        </div>

        <p className="text-sm text-theme-text-secondary">
            That last line is the one that catches people out. Your damage still lands at a
            disadvantage — 25% smaller, but it lands — and debuffs that roll against hacking still
            get their reduced chance. What stops entirely is every effect that would normally apply
            with no hacking roll at all: those simply do not happen.
        </p>
    </div>
);

export default AffinityWheel;
