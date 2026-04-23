import React, { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button, ConfirmModal } from '../ui';
import { StorageKey } from '../../constants/storage';
import { loadDemoData, isDemoDataLoaded } from '../../utils/demoData';
import { useNotification } from '../../hooks/useNotification';

export const DemoDataSection: React.FC = () => {
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const { addNotification } = useNotification();

    const hasExistingData = () => {
        return (
            !!localStorage.getItem(StorageKey.SHIPS) ||
            !!localStorage.getItem(StorageKey.ENGINEERING_STATS) ||
            !!localStorage.getItem(StorageKey.LOADOUTS) ||
            !!localStorage.getItem(StorageKey.TEAM_LOADOUTS) ||
            !!localStorage.getItem(StorageKey.AUTOGEAR_CONFIGS)
        );
    };

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

    const handleClick = () => {
        if (hasExistingData()) {
            setShowConfirm(true);
        } else {
            void runLoad();
        }
    };

    if (isDemoDataLoaded()) return null;

    return (
        <>
            <div className="border-t border-dark-border pt-4 mt-4 text-center">
                <p className="text-theme-text-secondary text-sm mb-3">
                    No game data? Try the app with sample data.
                </p>
                <Button
                    variant="secondary"
                    onClick={handleClick}
                    disabled={loading}
                    className="gap-2"
                >
                    <FlaskConical size={16} />
                    {loading ? 'Loading...' : 'Load Demo Data'}
                </Button>
            </div>

            <ConfirmModal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                onConfirm={() => {
                    setShowConfirm(false);
                    void runLoad();
                }}
                title="Load Demo Data"
                message="You already have data. Loading demo data will replace your current ships, gear, and engineering stats. Continue?"
                confirmLabel="Replace with Demo Data"
                cancelLabel="Cancel"
            />
        </>
    );
};
