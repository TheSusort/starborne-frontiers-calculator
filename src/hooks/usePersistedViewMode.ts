import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthProvider';

type ViewMode = 'list' | 'image';

export const usePersistedViewMode = (key: string, defaultValue: ViewMode = 'list') => {
    const { user } = useAuth();
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        const stored = user ? localStorage.getItem(key) : null;
        return (stored as ViewMode) || defaultValue;
    });

    useEffect(() => {
        localStorage.setItem(key, viewMode);
    }, [key, viewMode]);

    return [viewMode, setViewMode] as const;
};
