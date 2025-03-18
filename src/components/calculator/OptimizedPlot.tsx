import React, { useEffect, useState, useMemo } from 'react';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';
import { Loader } from '../ui/Loader';

// Define Config interface to fix type errors
interface Config {
    responsive?: boolean;
    displayModeBar?: boolean;
}

// Define a proper type for the Plot component
type PlotlyComponent = React.ComponentType<{
    data: Data[];
    layout: Partial<Layout>;
    style?: React.CSSProperties;
    useResizeHandler?: boolean;
    config?: Partial<Config>;
    onError?: (err: Error) => void;
    onInitialized?: () => void;
}>;

interface OptimizedPlotProps {
    data: Data[];
    layout: Partial<Layout>;
    style?: React.CSSProperties;
    useResizeHandler?: boolean;
    onLoad?: () => void;
}

const OptimizedPlot: React.FC<OptimizedPlotProps> = ({
    data,
    layout,
    style,
    useResizeHandler,
    onLoad,
}) => {
    const [Plot, setPlot] = useState<PlotlyComponent | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [plotError, setPlotError] = useState<Error | null>(null);

    // Default config with better performance options
    const config = useMemo(
        () => ({
            responsive: true,
            displayModeBar: false, // Hide the modebar to simplify UI
        }),
        []
    );

    // Validate data before rendering - moved up before conditional returns
    const validData = useMemo(() => {
        try {
            // Do some basic validation checks on data
            if (!Array.isArray(data)) {
                console.error('Plot data is not an array');
                return [];
            }

            // Check for any badly formed data structures
            for (const trace of data) {
                if (
                    trace.type === 'contour' &&
                    (!trace.z || !Array.isArray(trace.z) || trace.z.length === 0)
                ) {
                    console.error('Invalid contour data:', trace);
                    return data.filter((item) => item.type !== 'contour'); // Remove bad contour plot
                }
            }

            return data;
        } catch (err) {
            console.error('Error validating plot data:', err);
            setPlotError(err instanceof Error ? err : new Error('Data validation failed'));
            return [];
        }
    }, [data]);

    useEffect(() => {
        // Import the Plot component dynamically
        let isMounted = true;
        const loadPlot = async () => {
            try {
                // We need to dynamically import react-plotly.js to avoid SSR issues
                const module = await import('react-plotly.js');
                if (isMounted) {
                    setPlot(() => module.default as PlotlyComponent);
                    setLoading(false);
                    if (onLoad && typeof onLoad === 'function') {
                        onLoad();
                    }
                }
            } catch (err) {
                console.error('Failed to load Plotly:', err);
                if (isMounted) {
                    setError(err instanceof Error ? err : new Error('Failed to load Plotly'));
                    setLoading(false);
                }
            }
        };

        loadPlot();

        return () => {
            isMounted = false;
        };
    }, [onLoad]);

    if (loading) {
        return <Loader />;
    }

    if (error) {
        return <div className="text-red-500 p-4">Failed to load chart: {error.message}</div>;
    }

    if (plotError) {
        return (
            <div className="text-red-500 bg-dark p-4 rounded">
                <p>Error rendering chart: {plotError.message}</p>
                <p className="text-sm mt-2">
                    Try refreshing the page or changing the ship configurations.
                </p>
            </div>
        );
    }

    if (!Plot) {
        return <div className="text-red-500 p-4">Plotting library not available</div>;
    }

    try {
        return (
            <Plot
                data={validData || []}
                layout={layout || {}}
                style={style || { width: '100%', height: '100%' }}
                useResizeHandler={useResizeHandler}
                config={config}
                onError={(err: Error) => {
                    console.error('Plotly Error:', err);
                    setPlotError(err);
                }}
                onInitialized={() => {
                    // Reset any previous errors on successful initialization
                    if (plotError) setPlotError(null);
                }}
            />
        );
    } catch (err) {
        console.error('Fatal error rendering Plotly:', err);
        setPlotError(err instanceof Error ? err : new Error('Failed to render plot'));
        return (
            <div className="text-red-500 bg-dark p-4 rounded">
                <p>Error rendering chart</p>
                <p className="text-sm mt-2">
                    Try refreshing the page or changing the ship configurations.
                </p>
            </div>
        );
    }
};

export default OptimizedPlot;
