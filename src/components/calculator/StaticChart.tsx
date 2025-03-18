import React, { useState, useEffect } from 'react';
import { Loader } from '../ui/Loader';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';

interface StaticChartProps {
    data: Data[];
    layout: Partial<Layout>;
    height?: number;
    _width?: number; // Marked as unused
    _title?: string; // Marked as unused
}

const StaticChart: React.FC<StaticChartProps> = ({ data, layout, height = 400 }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [hasError, setHasError] = useState(false);

    // We track visibility separately from loading state
    useEffect(() => {
        // Use IntersectionObserver to load the chart only when it's visible
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.1 }
        );

        const element = document.getElementById('chart-container');
        if (element) {
            observer.observe(element);
        }

        return () => {
            observer.disconnect();
        };
    }, []);

    // Wrapper to safely render chart
    const OptimizedPlot = React.lazy(() =>
        import('./OptimizedPlot').catch((error) => {
            console.error('Failed to load Plotly:', error);
            setHasError(true);
            // Return a minimal component to avoid breaking the app
            return { default: () => <div className="text-red-500">Chart could not be loaded</div> };
        })
    );

    // Ensure data is valid
    const safeData = Array.isArray(data) ? data : [];
    const safeLayout = layout || {};

    return (
        <div id="chart-container" className="w-full relative" style={{ height: `${height}px` }}>
            {!isVisible ? (
                <div className="absolute inset-0 flex items-center justify-center">
                    <Loader />
                </div>
            ) : hasError ? (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-red-500 bg-dark p-4 rounded">
                        Failed to load chart. Please try refreshing the page.
                    </div>
                </div>
            ) : (
                <React.Suspense fallback={<Loader />}>
                    <div className="w-full h-full">
                        <OptimizedPlot
                            data={safeData}
                            layout={safeLayout}
                            useResizeHandler={true}
                            style={{ width: '100%', height: '100%' }}
                        />
                    </div>
                </React.Suspense>
            )}
        </div>
    );
};

export default StaticChart;
