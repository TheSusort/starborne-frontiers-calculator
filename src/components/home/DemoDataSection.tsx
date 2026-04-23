import React, { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '../ui';
import { StorageKey } from '../../constants/storage';
import { loadDemoData, isDemoDataLoaded } from '../../utils/demoData';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';

const hasExistingData = (): boolean => {
    return (
        !!localStorage.getItem(StorageKey.SHIPS) ||
        !!localStorage.getItem(StorageKey.ENGINEERING_STATS) ||
        !!localStorage.getItem(StorageKey.LOADOUTS) ||
        !!localStorage.getItem(StorageKey.TEAM_LOADOUTS) ||
        !!localStorage.getItem(StorageKey.AUTOGEAR_CONFIGS)
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
        <div className="border-t border-dark-border pt-4 mt-4 text-center flex flex-col items-center gap-2">
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
        </div>
    );
};
