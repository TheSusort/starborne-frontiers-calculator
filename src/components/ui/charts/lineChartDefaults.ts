export const CHART_LINE_COLORS = [
    '#ec8c37',
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#06b6d4',
    '#f97316',
];

export const LINE_CHART_MARGIN = { top: 5, right: 30, left: 20, bottom: 12 } as const;

export const chartLineDefaults = (color: string) => ({
    strokeWidth: 2 as const,
    dot: false as const,
    activeDot: { r: 6, stroke: color, strokeWidth: 2 },
});
