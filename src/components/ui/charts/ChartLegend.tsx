import React from 'react';

export interface ChartLegendItem {
    label: string;
    color: string;
    /** Optional custom swatch (e.g. a dashed-line glyph). Overrides the default color dot/square. */
    glyph?: React.ReactNode;
}

interface ChartLegendProps {
    items: ChartLegendItem[];
    shape?: 'circle' | 'square';
    className?: string;
}

export const ChartLegend: React.FC<ChartLegendProps> = ({ items, shape = 'circle', className }) => (
    <div
        className={['flex flex-wrap justify-center gap-4 mt-3', className]
            .filter(Boolean)
            .join(' ')}
    >
        {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
                {item.glyph ?? (
                    <div
                        className={shape === 'square' ? 'w-3 h-3' : 'w-3 h-3 rounded-full'}
                        style={{ backgroundColor: item.color }}
                    />
                )}
                <span className="text-sm text-white">{item.label}</span>
            </div>
        ))}
    </div>
);
