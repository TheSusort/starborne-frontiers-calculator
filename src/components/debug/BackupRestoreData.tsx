import React from 'react';
import { Button } from '../ui';
import { useNotification } from '../../hooks/useNotification';

const STORAGE_KEYS = [
    'changelogState',
    'encounterNotes',
    'engineeringStats',
    'gear-inventory',
    'shipLoadouts',
    'ships',
    'teamLoadouts',
] as const;

type StorageData = {
    [K in (typeof STORAGE_KEYS)[number]]?: string;
};

export const BackupRestoreData: React.FC = () => {
    const { addNotification } = useNotification();
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleBackup = () => {
        try {
            const backup: StorageData = {};
            STORAGE_KEYS.forEach((key) => {
                const data = localStorage.getItem(key);
                if (data) {
                    backup[key] = data;
                }
            });

            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `starborne-planner-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            addNotification('success', 'Backup created successfully');
        } catch (error) {
            console.error('Backup failed:', error);
            addNotification('error', 'Failed to create backup');
        }
    };

    const handleRestore = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const backup = JSON.parse(e.target?.result as string) as StorageData;

                Object.entries(backup).forEach(([key, value]) => {
                    if (STORAGE_KEYS.includes(key as (typeof STORAGE_KEYS)[number]) && value) {
                        localStorage.setItem(key, value);
                    }
                });

                addNotification('success', 'Data restored successfully. Please refresh the page.');
            } catch (error) {
                console.error('Restore failed:', error);
                addNotification('error', 'Failed to restore backup');
            }
        };

        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    };

    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={handleBackup} aria-label="Backup data">
                Backup Data
            </Button>

            <div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleRestore}
                    className="hidden"
                />
                <Button variant="secondary" onClick={handleRestoreClick} aria-label="Restore data">
                    Restore Data
                </Button>
            </div>
        </div>
    );
};
