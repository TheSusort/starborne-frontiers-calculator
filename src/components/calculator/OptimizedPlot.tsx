import React, { useEffect, useState } from 'react';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';
import { Loader } from '../ui/Loader';

// Define Config interface to fix type errors
interface Config {
    responsive?: boolean;
}

// Define PlotParams interface to fix type error
interface PlotParams {
    data: Data[];
    layout: Partial<Layout>;
    style?: React.CSSProperties;
    useResizeHandler?: boolean;
    config?: Partial<Config>;
}

interface OptimizedPlotProps {
    data: Data[];
    layout: Partial<Layout>;
    style?: React.CSSProperties;
    useResizeHandler?: boolean;
}

const OptimizedPlot: React.FC<OptimizedPlotProps> = ({
    data,
    layout,
    style = { width: '100%', height: '500px' },
    useResizeHandler = true,
}) => {
    const [Plot, setPlot] = useState<React.ComponentType<PlotParams> | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadPlotly = async () => {
            try {
                // Dynamically import only what we need using the cartesian-dist-min package
                const Plotly = await import(
                    /* webpackChunkName: "plotly-cartesian" */ 'plotly.js-cartesian-dist-min'
                );
                const createPlotlyComponent = (
                    await import(/* webpackChunkName: "plotly-factory" */ 'react-plotly.js/factory')
                ).default;

                // Create the Plot component with just the basic modules
                const PlotComponent = createPlotlyComponent(Plotly.default || Plotly);
                setPlot(() => PlotComponent);
                setLoading(false);
            } catch (error) {
                console.error('Failed to load Plotly:', error);
                setLoading(false);
            }
        };

        loadPlotly();
    }, []);

    if (loading || !Plot) {
        return (
            <div style={style}>
                <Loader />
            </div>
        );
    }

    return (
        <Plot
            data={data}
            layout={layout}
            style={style}
            useResizeHandler={useResizeHandler}
            config={{ responsive: true }}
        />
    );
};

export default OptimizedPlot;
