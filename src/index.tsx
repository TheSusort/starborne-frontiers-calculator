import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installAutogearSessionResets } from './utils/autogear/autogearSession';
import { registerServiceWorker } from './utils/serviceWorkerUpdate';

// Redirect the legacy netlify.app URL to the canonical custom domain.
// This fires once the updated service worker serves new code.
if (window.location.hostname === 'starborne-planner.netlify.app') {
    window.location.replace(
        'https://starborneplanner.com' +
            window.location.pathname +
            window.location.search +
            window.location.hash
    );
}

installAutogearSessionResets();
registerServiceWorker();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
