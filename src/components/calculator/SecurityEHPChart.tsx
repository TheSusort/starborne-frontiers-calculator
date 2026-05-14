import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, LabelList, Customized } from 'recharts';
import { DefenseShipConfig, DefenseBuffTotals } from '../../types/calculator';
import { computeBuffedStats } from '../../utils/calculators/defenseCalculator';
import { calculateEffectiveHP } from '../../utils/autogear/scoring';
import { BaseChart, ChartLegend, ChartLegendItem, LINE_CHART_MARGIN } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';

interface SecurityEHPChartProps {
    configs: DefenseShipConfig[];
    buffTotals: Map<string, DefenseBuffTotals>;
}

interface HeatmapPoint {
    x: number;
    y: number;
    fill: string;
}

interface ShipPoint {
    x: number;
    y: number;
    z: number;
    name: string;
    isBest: boolean;
    isShipPoint: true;
}

interface TooltipProps {
    active?: boolean;
    payload?: Array<{ payload: Partial<ShipPoint> }>;
}

const CustomTooltip = ({ active, payload }: TooltipProps) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    if (d.isShipPoint) {
        return (
            <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
                <p className="font-bold">{d.name}</p>
                <p>Defense: {Math.round(d.x ?? 0).toLocaleString()}</p>
                <p>Security: {Math.round(d.y ?? 0)}</p>
                <p>EHP: {Math.round(d.z ?? 0).toLocaleString()}</p>
            </div>
        );
    }
    return null;
};

const getTankScoreColor = (score: number, maxScore: number): string => {
    const ratio = score / maxScore;
    if (ratio < 0.2) return '#00008B';
    if (ratio < 0.4) return '#0000CD';
    if (ratio < 0.6) return '#1E90FF';
    if (ratio < 0.8) return '#00BFFF';
    if (ratio < 1.0) return '#87CEEB';
    if (ratio < 1.25) return '#FFD700';
    if (ratio < 1.5) return '#FFA500';
    return '#FF4500';
};

interface RechartsAxisEntry {
    scale?: (v: number) => number;
}

interface RechartsInternalProps {
    xAxisMap?: Record<string, RechartsAxisEntry>;
    yAxisMap?: Record<string, RechartsAxisEntry>;
}

interface ShapeProps {
    cx?: number;
    cy?: number;
    payload?: ShipPoint;
}

const ShipStar = ({ cx = 0, cy = 0, payload }: ShapeProps) => {
    if (!payload) return null;
    const size = payload.isBest ? 12 : 7;
    const color = payload.isBest ? '#FFD700' : '#e2e2e2';
    const pts = [
        [cx, cy - size],
        [cx + size * 0.3, cy - size * 0.3],
        [cx + size, cy],
        [cx + size * 0.3, cy + size * 0.3],
        [cx, cy + size],
        [cx - size * 0.3, cy + size * 0.3],
        [cx - size, cy],
        [cx - size * 0.3, cy - size * 0.3],
        [cx, cy - size],
    ]
        .map((p) => p.join(','))
        .join(' ');
    return <path d={`M ${pts}`} fill={color} stroke="#fff" strokeWidth={1} />;
};

const LEGEND_ITEMS: ChartLegendItem[] = [
    { label: '< 20% best score', color: '#00008B' },
    { label: '20–40%', color: '#0000CD' },
    { label: '40–60%', color: '#1E90FF' },
    { label: '60–80%', color: '#00BFFF' },
    { label: '80–100%', color: '#87CEEB' },
    { label: '100–125%', color: '#FFD700' },
    { label: '125–150%', color: '#FFA500' },
    { label: '> 150%', color: '#FF4500' },
];

const X_STEPS = 50;
const Y_STEPS = 30;

export const SecurityEHPChart: React.FC<SecurityEHPChartProps> = ({ configs, buffTotals }) => {
    const colors = useThemeColors();

    const { shipPoints, refHP, defenseMax, securityMax, bestScore } = useMemo(() => {
        const points: ShipPoint[] = configs.map((c) => {
            const { buffedDefense, effectiveHP, buffedSecurity } = computeBuffedStats(
                c.hp,
                c.defense,
                c.security,
                buffTotals.get(c.id)
            );
            return {
                x: buffedDefense,
                y: buffedSecurity,
                z: effectiveHP,
                name: c.name,
                isBest: false,
                isShipPoint: true as const,
            };
        });

        const best = points.reduce((b, p) => (p.z > b.z ? p : b), points[0]);
        points.forEach((p) => {
            p.isBest = p.name === best?.name;
        });

        const maxDef = Math.max(...configs.map((c) => c.defense), 10000);
        const maxSec = Math.max(...configs.map((c) => c.security), 100);
        const hp = configs[0]?.hp ?? 10000;
        const bs = calculateEffectiveHP(hp, maxDef * 1.5) * (maxSec * 1.5);

        return {
            shipPoints: points,
            refHP: hp,
            defenseMax: Math.ceil((maxDef * 1.5) / 1000) * 1000,
            securityMax: Math.ceil((maxSec * 1.5) / 10) * 10,
            bestScore: bs,
        };
    }, [configs, buffTotals]);

    const { heatmapData, xStep, yStep } = useMemo(() => {
        const xs = defenseMax / X_STEPS;
        const ys = securityMax / Y_STEPS;
        const points: HeatmapPoint[] = [];
        for (let xi = 0; xi <= X_STEPS; xi++) {
            const defense = xi * xs;
            const ehp = calculateEffectiveHP(refHP, Math.max(defense, 1));
            for (let yi = 0; yi <= Y_STEPS; yi++) {
                const security = yi * ys;
                points.push({
                    x: defense,
                    y: security,
                    fill: getTankScoreColor(ehp * security, bestScore),
                });
            }
        }
        return { heatmapData: points, xStep: xs, yStep: ys };
    }, [defenseMax, securityMax, refHP, bestScore]);

    const defTicks = useMemo(
        () => Array.from({ length: 6 }, (_, i) => Math.round((defenseMax / 5) * i)),
        [defenseMax]
    );
    const secTicks = useMemo(
        () => Array.from({ length: 6 }, (_, i) => Math.round((securityMax / 5) * i)),
        [securityMax]
    );

    return (
        <div className="card">
            <h2 className="text-xl font-bold mb-2">Defense × Security Heatmap</h2>
            <p className="text-sm text-theme-text-secondary mb-4">
                Color shows combined tank score (Effective HP × Security) across the defense and
                security stat space, using your ship&apos;s HP as reference. Stars mark your ship
                configurations — top-right is strongest on both dimensions.
            </p>
            <div style={{ width: '100%', height: 400, backgroundColor: colors.bg }}>
                <BaseChart height={400}>
                    <ScatterChart margin={LINE_CHART_MARGIN}>
                        <XAxis
                            type="number"
                            dataKey="x"
                            name="Defense"
                            domain={[0, defenseMax]}
                            ticks={defTicks}
                            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                            label={{
                                value: 'Defense',
                                position: 'insideBottom',
                                offset: -10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <YAxis
                            type="number"
                            dataKey="y"
                            name="Security"
                            domain={[0, securityMax]}
                            ticks={secTicks}
                            label={{
                                value: 'Security',
                                angle: -90,
                                position: 'insideLeft',
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={false} />

                        {/* Pixel-perfect heatmap using axis scale functions */}
                        <Customized
                            component={(rProps: RechartsInternalProps) => {
                                const xAxis = Object.values(rProps.xAxisMap ?? {})[0];
                                const yAxis = Object.values(rProps.yAxisMap ?? {})[0];
                                if (!xAxis?.scale || !yAxis?.scale) return null;
                                const xs = xAxis.scale;
                                const ys = yAxis.scale;
                                const cellW = Math.abs(xs(xStep) - xs(0));
                                const cellH = Math.abs(ys(0) - ys(yStep));
                                return (
                                    <g pointerEvents="none">
                                        {heatmapData.map((d, i) => (
                                            <rect
                                                key={i}
                                                x={xs(d.x)}
                                                y={ys(d.y) - cellH}
                                                width={cellW}
                                                height={cellH}
                                                fill={d.fill}
                                                stroke="none"
                                            />
                                        ))}
                                    </g>
                                );
                            }}
                        />

                        <Scatter
                            name="Ships"
                            data={shipPoints}
                            shape={(props: ShapeProps) => (
                                <ShipStar cx={props.cx} cy={props.cy} payload={props.payload} />
                            )}
                            zAxisId={1}
                        >
                            <LabelList
                                dataKey="name"
                                position="top"
                                fill={colors.text}
                                offset={10}
                                width={120}
                            />
                        </Scatter>
                    </ScatterChart>
                </BaseChart>
            </div>
            <ChartLegend items={LEGEND_ITEMS} shape="square" />
        </div>
    );
};
