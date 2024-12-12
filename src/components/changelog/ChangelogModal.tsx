import React from 'react';
import { ChangelogEntry } from '../../types/changelog';
import { Modal } from '../layout/Modal';

interface ChangelogModalProps {
    isOpen: boolean;
    onClose: () => void;
    entries: ChangelogEntry[];
    lastSeenVersion: string;
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({
    isOpen,
    onClose,
    entries,
    lastSeenVersion
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="What's New"
        >
            <div className="overflow-y-auto max-h-[60vh]">
                {entries.map((entry) => (
                    <div key={entry.version}>
                        {entry.version > lastSeenVersion && (
                            <div
                                className={`mb-6 ${
                                    entry.version > lastSeenVersion ? 'text-gray-200' : 'text-gray-400'
                                }`}
                            >
                                <h3 className="font-bold mb-2">
                                    Version {entry.version} - {entry.date}
                                    {entry.version > lastSeenVersion && (
                                        <span className="ml-2 text-xs bg-blue-500 text-gray-200 px-2 py-1 rounded">
                                            New
                                        </span>
                                    )}
                                </h3>
                                <ul className="list-disc list-inside space-y-1">
                                    {entry.changes.map((change, index) => (
                                        <li key={index}>{change}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </Modal>
    );
};