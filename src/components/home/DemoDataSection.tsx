import React, { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '../ui';
import { StorageKey, StorageKeyType } from '../../constants/storage';
import { loadDemoData, isDemoDataLoaded } from '../../utils/demoData';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';

const storageKeyHasContent = (key: StorageKeyType): boolean => {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.length > 0;
        if (parsed && typeof parsed === 'object') {
            // EngineeringStats wraps its list in { stats: [...] }
            const stats = (parsed as { stats?: unknown }).stats;
            if (Array.isArray(stats)) return stats.length > 0;
            return Object.keys(parsed).length > 0;
        }
        return !!parsed;
    } catch {
        return false;
    }
};

const hasExistingData = (): boolean => {
    return (
        storageKeyHasContent(StorageKey.SHIPS) ||
        storageKeyHasContent(StorageKey.ENGINEERING_STATS) ||
        storageKeyHasContent(StorageKey.LOADOUTS) ||
        storageKeyHasContent(StorageKey.TEAM_LOADOUTS) ||
        storageKeyHasContent(StorageKey.AUTOGEAR_CONFIGS)
    );
};

export const DemoDataSection: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const { addNotification } = useNotification();
    const { user } = useAuth();

    if (user || isDemoDataLoaded() || hasExistingData()) return null;

    const runLoad = async () => {
        try {
            setLoading(true);
            await loadDemoData();
            window.location.reload();
        } catch (error) {
            console.error('Failed to load demo data:', error);
            addNotification('error', 'Failed to load demo data');
            setLoading(false);
        }
    };

    return (
        <section className="card p-8">
            <p className="text-theme-text-secondary text-sm mb-3">
                No game data? Try the app with sample data.
            </p>
            <Button
                variant="secondary"
                onClick={() => void runLoad()}
                disabled={loading}
                className="flex items-center gap-2"
            >
                <FlaskConical size={16} />
                {loading ? 'Loading...' : 'Load Demo Data'}
            </Button>
        </section>
    );
};
