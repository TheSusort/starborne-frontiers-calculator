import React, { useEffect, useRef, useState } from 'react';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';
import OptimizedPlot from './OptimizedPlot';
import { Loader } from '../ui/Loader';

interface StaticChartProps {
    data: Data[];
    layout: Partial<Layout>;
    width?: number;
    height?: number;
    title?: string;
}

const StaticChart: React.FC<StaticChartProps> = ({
    data,
    layout,
    width = 800,
    height = 500,
    title,
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const placeholderRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Create an intersection observer to detect when the chart area is visible
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setIsVisible(true);
                    // Disconnect the observer after triggering load
                    observer.disconnect();
                }
            },
            {
                rootMargin: '200px', // Load a bit before it's actually visible
                threshold: 0.01,
            }
        );

        if (placeholderRef.current) {
            observer.observe(placeholderRef.current);
        }

        return () => {
            observer.disconnect();
        };
    }, []);

    return (
        <div
            ref={placeholderRef}
            style={{ width: '100%', height: `${height}px` }}
            className="static-chart-container"
        >
            {!isVisible ? (
                <Loader />
            ) : (
                <OptimizedPlot
                    data={data}
                    layout={layout}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler={true}
                />
            )}
        </div>
    );
};

export default StaticChart;
