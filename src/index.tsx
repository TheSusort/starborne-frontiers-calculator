import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';
import { installAutogearSessionResets } from './utils/autogear/autogearSession';

// Redirect the legacy netlify.app URL to the canonical custom domain.
// This fires after the service worker auto-updates and serves new code.
if (window.location.hostname === 'starborne-planner.netlify.app') {
    window.location.replace(
        'https://starborneplanner.com' +
            window.location.pathname +
            window.location.search +
            window.location.hash
    );
}

installAutogearSessionResets();

// Register the service worker with auto-update
registerSW({
    immediate: true,
    onRegisteredSW(_swScriptUrl, registration) {
        if (!registration) return;
        setInterval(() => void registration.update(), 5 * 60 * 1000);
    },
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
