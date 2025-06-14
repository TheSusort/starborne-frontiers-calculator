import { useState, useEffect } from 'react';

type ViewMode = 'list' | 'image';

export const usePersistedViewMode = (key: string, defaultValue: ViewMode = 'list') => {
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        const stored = localStorage.getItem(key);
        return (stored as ViewMode) || defaultValue;
    });

    useEffect(() => {
        localStorage.setItem(key, viewMode);
    }, [key, viewMode]);

    return [viewMode, setViewMode] as const;
};
