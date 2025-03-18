declare module 'plotly.js-dist-min' {
    export * from 'plotly.js';
}

declare module 'plotly.js-basic-dist-min' {
    export * from 'plotly.js';
}

declare module 'plotly.js-cartesian-dist-min' {
    export * from 'plotly.js';

    // Add the low-level DOM API
    export function newPlot(
        graphDiv: HTMLElement,
        data: any[],
        layout?: any,
        config?: any
    ): Promise<any>;

    export function react(
        graphDiv: HTMLElement,
        data: any[],
        layout?: any,
        config?: any
    ): Promise<any>;

    export function purge(graphDiv: HTMLElement): void;
}

// Augment the Data type to include additional valid values
declare namespace Plotly {
    interface PlotData {
        mode?: string;
        textposition?: string;
    }
}

// Add Plotly global object to window
interface Window {
    Plotly?: {
        newPlot: (graphDiv: HTMLElement, data: any[], layout?: any, config?: any) => Promise<any>;
        react: (graphDiv: HTMLElement, data: any[], layout?: any, config?: any) => Promise<any>;
        purge: (graphDiv: HTMLElement) => void;
    };
}
