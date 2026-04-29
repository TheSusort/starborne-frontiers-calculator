import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

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

// Register the service worker with auto-update
registerSW({
    immediate: true,
    onRegisteredSW(_swScriptUrl, registration) {
        if (!registration) return;
        setInterval(() => registration.update(), 5 * 60 * 1000);
    },
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
