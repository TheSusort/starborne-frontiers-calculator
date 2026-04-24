import React, { useState } from 'react';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { useNotification } from '../../hooks/useNotification';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { ConfirmModal } from '../ui/layout/ConfirmModal';
import { CreateAltModal } from './CreateAltModal';
import { RenameAltModal } from './RenameAltModal';

const MAX_ALTS = 5;

export const AltAccountsSection: React.FC = () => {
    const { profiles, activeProfile, switchProfile, togglePublicAlt, deleteAlt } =
        useActiveProfile();
    const { addNotification } = useNotification();
    const [createOpen, setCreateOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const alts = profiles.filter((p) => p.owner_auth_user_id !== null);
    const atCap = alts.length >= MAX_ALTS;

    const handleDelete = async (id: string) => {
        try {
            await deleteAlt(id);
            addNotification('success', 'Alt deleted');
        } catch (err) {
            addNotification(
                'error',
                `Failed to delete alt: ${err instanceof Error ? err.message : 'unknown'}`
            );
        } finally {
            setDeleteTarget(null);
        }
    };

    const deleteTargetAlt = alts.find((a) => a.id === deleteTarget);
    const renameTargetAlt = alts.find((a) => a.id === renameTarget);

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Alt accounts</h3>
                <span className="text-sm text-theme-text-secondary">
                    {alts.length} / {MAX_ALTS}
                </span>
            </div>

            {alts.length === 0 ? (
                <p className="text-sm text-theme-text-secondary mb-4">
                    Manage multiple game accounts under your login. Each alt has its own ships,
                    gear, and engineering, and can have its own public profile.
                </p>
            ) : (
                <ul className="space-y-2 mb-4">
                    {alts.map((alt) => {
                        const isActive = alt.id === activeProfile?.id;
                        return (
                            <li
                                key={alt.id}
                                className="flex items-center gap-3 p-2 border border-dark-border rounded"
                            >
                                <div className="flex-1">
                                    <span className="font-medium">
                                        {alt.username ?? '(unnamed)'}
                                    </span>
                                </div>
                                <Checkbox
                                    label="Public"
                                    checked={alt.is_public}
                                    onChange={(checked) => void togglePublicAlt(alt.id, checked)}
                                />
                                {isActive ? (
                                    <span className="text-xs text-amber-400 px-2">Active</span>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => switchProfile(alt.id)}
                                    >
                                        Switch to
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setRenameTarget(alt.id)}
                                >
                                    Rename
                                </Button>
                                <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => setDeleteTarget(alt.id)}
                                >
                                    Delete
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <Button
                onClick={() => setCreateOpen(true)}
                disabled={atCap}
                title={atCap ? 'Alt limit reached (5)' : undefined}
            >
                Create alt
            </Button>

            {createOpen && <CreateAltModal onClose={() => setCreateOpen(false)} />}

            {renameTarget && renameTargetAlt && (
                <RenameAltModal
                    altId={renameTarget}
                    currentUsername={renameTargetAlt.username ?? ''}
                    onClose={() => setRenameTarget(null)}
                />
            )}

            {deleteTarget && deleteTargetAlt && (
                <ConfirmModal
                    isOpen={true}
                    title="Delete alt account?"
                    message={
                        <p>
                            This will permanently delete{' '}
                            <strong>&ldquo;{deleteTargetAlt.username ?? 'this alt'}&rdquo;</strong>{' '}
                            and all its ships, gear, engineering stats, loadouts, and autogear
                            configs. <strong>This cannot be undone.</strong>
                        </p>
                    }
                    confirmLabel="Delete forever"
                    cancelLabel="Cancel"
                    onConfirm={() => void handleDelete(deleteTarget)}
                    onClose={() => setDeleteTarget(null)}
                />
            )}
        </div>
    );
};
