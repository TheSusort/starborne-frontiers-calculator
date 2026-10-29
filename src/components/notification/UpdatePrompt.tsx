import React, { useState, useSyncExternalStore } from 'react';
import {
    applyServiceWorkerUpdate,
    getNeedRefresh,
    subscribeNeedRefresh,
} from '../../utils/serviceWorkerUpdate';
import { Button } from '../ui';

/**
 * Shown when a new version is waiting; stays until the player acts. "Later" hides it for this
 * page load, and the waiting worker re-prompts on the next load.
 */
export const UpdatePrompt: React.FC = () => {
    const [dismissed, setDismissed] = useState(false);
    const needRefresh = useSyncExternalStore(subscribeNeedRefresh, getNeedRefresh);

    if (!needRefresh || dismissed) return null;

    return (
        <div
            className="card fixed bottom-4 left-4 z-[110] w-[calc(100vw-2rem)] sm:w-96 shadow-lg"
            role="status"
        >
            <p className="text-theme-text mb-3">
                A new version is available. Refresh when ready; unsaved work on this page will be
                lost.
            </p>
            <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDismissed(true)}>
                    Later
                </Button>
                <Button size="sm" onClick={applyServiceWorkerUpdate}>
                    Refresh
                </Button>
            </div>
        </div>
    );
};
