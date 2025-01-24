import React from 'react';
import { Button } from '../ui';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';
import { firebaseStorage } from '../../services/firebaseStorage';

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
    const { user } = useAuth();
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

    const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backup = JSON.parse(e.target?.result as string) as StorageData;

                // First update localStorage
                Object.entries(backup).forEach(([key, value]) => {
                    if (STORAGE_KEYS.includes(key as (typeof STORAGE_KEYS)[number]) && value) {
                        localStorage.setItem(key, value);
                    }
                });

                // If user is logged in, sync to Firebase
                if (user?.uid) {
                    try {
                        const firebaseData: Record<string, unknown> = {};
                        Object.entries(backup).forEach(([key, value]) => {
                            if (value) {
                                firebaseData[key] = JSON.parse(value);
                            }
                        });

                        await firebaseStorage.saveUserData(user.uid, firebaseData);
                        addNotification('success', 'Data restored and synced to cloud storage');
                    } catch (error) {
                        console.error('Failed to sync with Firebase:', error);
                        addNotification(
                            'warning',
                            'Data restored locally but failed to sync to cloud'
                        );
                    }
                } else {
                    addNotification('success', 'Data restored locally');
                }

                addNotification('info', 'Please refresh the page to see the changes');
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
