import React, { useState } from 'react';
import { Button, ConfirmModal } from '../ui';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';
import { firebaseStorage } from '../../services/firebaseStorage';
import { STORAGE_KEYS, StorageKey } from '../../constants/storage';
import { deleteUser } from 'firebase/auth';
import { db } from '../../config/firebase';
import { doc, deleteDoc } from 'firebase/firestore';

const BACKUP_KEYS = Object.values(STORAGE_KEYS);
type StorageData = {
    [K in StorageKey]?: string;
};

export const BackupRestoreData: React.FC = () => {
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleBackup = () => {
        try {
            const backup: StorageData = {};
            BACKUP_KEYS.forEach((key) => {
                const data = localStorage.getItem(key);
                if (data) {
                    backup[key as StorageKey] = data;
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
                    if (BACKUP_KEYS.includes(key as StorageKey) && value) {
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

    const handleDeleteAccount = async () => {
        if (!user) return;

        try {
            // Delete Firestore data
            await deleteDoc(doc(db, 'users', user.uid));

            // Clear local storage
            Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));

            // Delete user account
            await deleteUser(user);

            addNotification('success', 'Account deleted successfully');
        } catch (error) {
            console.error('Error deleting account:', error);
            addNotification('error', 'Failed to delete account. You may need to re-authenticate.');
        }
    };

    return (
        <div className="space-y-4">
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
                    <Button
                        variant="secondary"
                        onClick={handleRestoreClick}
                        aria-label="Restore data"
                    >
                        Restore Data
                    </Button>
                </div>
            </div>
            {user && (
                <div className="border-t pt-4 mt-4">
                    <h3 className="text-lg font-medium mb-2">Danger Zone</h3>
                    <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                        Delete Account
                    </Button>
                </div>
            )}

            <ConfirmModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={handleDeleteAccount}
                title="Delete Account"
                message="Are you sure you want to delete your account? This action cannot be undone and will delete all your data."
                confirmLabel="Delete Account"
                cancelLabel="Cancel"
            />
        </div>
    );
};
