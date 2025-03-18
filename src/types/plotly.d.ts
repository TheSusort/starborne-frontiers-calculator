declare module 'plotly.js-dist-min' {
    export * from 'plotly.js';
}

declare module 'plotly.js-basic-dist-min' {
    export * from 'plotly.js';
}

declare module 'plotly.js-cartesian-dist-min' {
    export * from 'plotly.js';
}

// Augment the Data type to include additional valid values
declare namespace Plotly {
    interface PlotData {
        mode?: string;
        textposition?: string;
    }
}
