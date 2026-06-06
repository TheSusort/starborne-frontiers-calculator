import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
    BaseChart,
    ChartLegend,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { DPSBuffPanel } from './DPSBuffPanel';

interface ShipSimResult {
    id: string;
    name: string;
    result: DPSSimulationResult;
}

interface DPSRoundChartProps {
    ships: ShipSimResult[];
    rounds: number;
    /** Enemy HP pool (combat settings) — marks the round each ship's cumulative damage empties it. */
    enemyHp?: number;
    height?: number;
}

/** Per-ship dataKey for its cumulative team-damage overlay line. */
const teamKey = (shipId: string) => `${shipId}__team`;

/** True when any of the ship's rounds reports walked-team damage. */
const hasTeamDamage = (ship: ShipSimResult): boolean =>
    ship.result.rounds.some((r) => (r.teamDamage ?? 0) > 0);

/**
 * 1-based round in which the enemy HP pool is first emptied, or null.
 *
 * When the ship has walked-team damage, the enemy dies on COMBINED damage
 * (attacker cumulative + team cumulative through that round) — matching how the
 * engine models HP%/gates. Without team damage, it's the attacker cumulative alone.
 */
const killRoundFor = (ship: ShipSimResult, enemyHp?: number): number | null => {
    if (!enemyHp || enemyHp <= 0) return null;
    if (!hasTeamDamage(ship)) {
        const idx = ship.result.rounds.findIndex((r) => r.cumulativeDamage >= enemyHp);
        return idx === -1 ? null : idx + 1;
    }
    let teamRunning = 0;
    for (let i = 0; i < ship.result.rounds.length; i++) {
        const r = ship.result.rounds[i];
        teamRunning += r.teamDamage ?? 0;
        if (r.cumulativeDamage + teamRunning >= enemyHp) return i + 1;
    }
    return null;
};

interface ChartDataPoint {
    round: number;
    [key: string]: number;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{
        name: string;
        value: number;
        color: string;
        dataKey: string;
    }>;
    label?: number;
    shipMap: Map<string, ShipSimResult>;
    enemyHp?: number;
}

const RoundTooltip: React.FC<CustomTooltipProps> = ({
    active,
    payload,
    label,
    shipMap,
    enemyHp,
}) => {
    if (!active || !payload || !label) return null;

    // Only the attacker cumulative series map into shipMap; the dashed team-damage overlay
    // series (dataKey `${id}__team`) are surfaced as their own line inside each ship block,
    // never folded into the attacker stack totals.
    const attackerEntries = payload.filter((e) => shipMap.has(e.dataKey));
    const roundDamageFor = (dataKey: string) =>
        shipMap.get(dataKey)?.result.rounds[label - 1]?.totalRoundDamage ?? 0;
    const sorted = [...attackerEntries].sort(
        (a, b) => roundDamageFor(b.dataKey) - roundDamageFor(a.dataKey)
    );

    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
            <p className="font-bold mb-1">Round {label}</p>
            {sorted.map((entry) => {
                const ship = shipMap.get(entry.dataKey);
                const roundData = ship?.result.rounds[label - 1];
                const roundDamage = roundData?.totalRoundDamage ?? 0;
                return (
                    <div key={entry.dataKey} className="mb-1">
                        <p style={{ color: entry.color }} className="font-medium">
                            {entry.name}: {roundDamage.toLocaleString()}
                            {roundData?.action === 'charged' && (
                                <span className="ml-1 text-yellow-400 text-xs">Charged</span>
                            )}
                            {roundData?.didCrit && (
                                <span className="ml-1 text-red-400 text-xs">Crit</span>
                            )}
                        </p>
                        {roundData && roundData.chargeCount > 0 && (
                            <p className="text-xs text-yellow-400 pl-2">
                                {roundData.action === 'charged'
                                    ? `Consumed ${roundData.chargeCount} charges`
                                    : `${roundData.charges} / ${roundData.chargeCount} charges`}
                            </p>
                        )}
                        {roundData && (
                            <p className="text-xs text-theme-text-secondary pl-2">
                                Enemy HP: {roundData.enemyHpPct}%
                                {ship && killRoundFor(ship, enemyHp) === label && (
                                    <span className="ml-1 text-red-400">reaches 0 this round</span>
                                )}
                            </p>
                        )}
                        {roundData && (
                            <div className="text-xs text-theme-text-secondary pl-2">
                                <span>Direct: {roundData.directDamage.toLocaleString()}</span>
                                {roundData.corrosionDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#6bcc6b' }}>
                                        Corr: {roundData.corrosionDamage.toLocaleString()}
                                    </span>
                                )}
                                {roundData.infernoDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#e67e22' }}>
                                        Inf: {roundData.infernoDamage.toLocaleString()}
                                    </span>
                                )}
                                {roundData.detonationDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#e74c3c' }}>
                                        Detonation: {roundData.detonationDamage.toLocaleString()}
                                    </span>
                                )}
                            </div>
                        )}
                        {roundData && (roundData.teamDamage ?? 0) > 0 && (
                            <p className="text-xs pl-2" style={{ color: '#a78bfa' }}>
                                Team damage: {(roundData.teamDamage ?? 0).toLocaleString()}
                            </p>
                        )}
                        <p className="text-xs text-theme-text-secondary pl-2">
                            Total: {entry.value.toLocaleString()}
                        </p>
                    </div>
                );
            })}
        </div>
    );
};

export const DPSRoundChart: React.FC<DPSRoundChartProps> = ({
    ships,
    rounds,
    enemyHp,
    height = 400,
}) => {
    const colors = useThemeColors();
    const [hoveredRound, setHoveredRound] = useState<number | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMouseMove = (data: any) => {
        if (data?.activeLabel != null) setHoveredRound(Number(data.activeLabel));
    };
    const handleMouseLeave = () => setHoveredRound(null);

    if (ships.length === 0) return null;

    // Ships whose sim included walked team actors get a separate (non-stacked) combined
    // total overlay line: attacker cumulative + team cumulative ("total team effort").
    // The enemy actually dies when this combined total empties the HP pool, so this is
    // the line that carries the kill mark when a team is configured.
    const teamShips = ships.filter(hasTeamDamage);
    const teamCumulative = new Map<string, number>();

    const chartData: ChartDataPoint[] = [];
    for (let r = 1; r <= rounds; r++) {
        const point: ChartDataPoint = { round: r };
        ships.forEach((ship) => {
            const roundData = ship.result.rounds[r - 1];
            point[ship.id] = roundData ? roundData.cumulativeDamage : 0;
        });
        teamShips.forEach((ship) => {
            const roundData = ship.result.rounds[r - 1];
            const running = (teamCumulative.get(ship.id) ?? 0) + (roundData?.teamDamage ?? 0);
            teamCumulative.set(ship.id, running);
            // Combined total = attacker cumulative this round + team cumulative this round.
            point[teamKey(ship.id)] = (roundData?.cumulativeDamage ?? 0) + running;
        });
        chartData.push(point);
    }

    const shipMap = new Map(ships.map((s) => [s.id, s]));

    return (
        <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
                <BaseChart height={height}>
                    <LineChart
                        data={chartData}
                        margin={LINE_CHART_MARGIN}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                        <XAxis
                            dataKey="round"
                            label={{
                                value: 'Round',
                                position: 'insideBottom',
                                offset: -10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <YAxis
                            tickFormatter={(v) =>
                                v >= 1000000
                                    ? `${(v / 1000000).toFixed(1)}M`
                                    : v >= 1000
                                      ? `${(v / 1000).toFixed(0)}k`
                                      : v.toString()
                            }
                            label={{
                                value: 'Cumulative Damage',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <Tooltip content={<RoundTooltip shipMap={shipMap} enemyHp={enemyHp} />} />
                        {ships.map((ship, i) => {
                            const color = CHART_LINE_COLORS[i % CHART_LINE_COLORS.length];
                            // When the ship has team damage the enemy dies on the combined total,
                            // so the kill mark lives on the dashed "with team" line instead — drop
                            // it from the attacker's solid line here.
                            const killRound = hasTeamDamage(ship)
                                ? null
                                : killRoundFor(ship, enemyHp);
                            return (
                                <Line
                                    key={ship.id}
                                    type="monotone"
                                    dataKey={ship.id}
                                    name={ship.name}
                                    stroke={color}
                                    {...chartLineDefaults(color)}
                                    // Kill marker: a ringed dot on the round this ship's cumulative
                                    // damage empties the enemy HP pool (no dot elsewhere).
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    dot={(props: any) =>
                                        killRound !== null && props.index === killRound - 1 ? (
                                            <g key={`${ship.id}-kill`}>
                                                <circle
                                                    cx={props.cx}
                                                    cy={props.cy}
                                                    r={7}
                                                    fill="none"
                                                    stroke={color}
                                                    strokeWidth={2}
                                                />
                                                <circle
                                                    cx={props.cx}
                                                    cy={props.cy}
                                                    r={3}
                                                    fill={color}
                                                />
                                            </g>
                                        ) : (
                                            <g key={`${ship.id}-${props.index}`} />
                                        )
                                    }
                                />
                            );
                        })}
                        {teamShips.map((ship) => {
                            const i = ships.findIndex((s) => s.id === ship.id);
                            const color = CHART_LINE_COLORS[i % CHART_LINE_COLORS.length];
                            const killRound = killRoundFor(ship, enemyHp);
                            return (
                                <Line
                                    key={teamKey(ship.id)}
                                    type="monotone"
                                    dataKey={teamKey(ship.id)}
                                    name={`${ship.name} — with team`}
                                    stroke={color}
                                    strokeDasharray="5 4"
                                    {...chartLineDefaults(color)}
                                    strokeWidth={1.5}
                                    // Kill marker: a ringed dot on the round the combined total
                                    // (attacker + team) empties the enemy HP pool (no dot elsewhere).
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    dot={(props: any) =>
                                        killRound !== null && props.index === killRound - 1 ? (
                                            <g key={`${ship.id}-team-kill`}>
                                                <circle
                                                    cx={props.cx}
                                                    cy={props.cy}
                                                    r={7}
                                                    fill="none"
                                                    stroke={color}
                                                    strokeWidth={2}
                                                />
                                                <circle
                                                    cx={props.cx}
                                                    cy={props.cy}
                                                    r={3}
                                                    fill={color}
                                                />
                                            </g>
                                        ) : (
                                            <g key={`${ship.id}-team-${props.index}`} />
                                        )
                                    }
                                />
                            );
                        })}
                    </LineChart>
                </BaseChart>
                <ChartLegend
                    items={[
                        ...ships.map((ship, i) => ({
                            label: ship.name,
                            color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                        })),
                        ...teamShips.map((ship) => {
                            const i = ships.findIndex((s) => s.id === ship.id);
                            return {
                                label: `${ship.name} — with team`,
                                color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                            };
                        }),
                    ]}
                />
            </div>
            <DPSBuffPanel
                ships={ships
                    .map((s, i) => ({
                        name: s.name,
                        color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                        totalDamage: s.result.summary.totalDamage,
                        roundData:
                            hoveredRound != null
                                ? (s.result.rounds[hoveredRound - 1] ?? null)
                                : null,
                    }))
                    .sort((a, b) => b.totalDamage - a.totalDamage)}
                totalRounds={rounds}
                hoveredRound={hoveredRound}
            />
        </div>
    );
};
