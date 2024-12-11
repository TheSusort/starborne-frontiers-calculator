import React from 'react';
import { ChangelogEntry } from '../../types/changelog';

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
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-dark-lighter rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-white">What's New</h2>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>
                    <div className="overflow-y-auto max-h-[60vh]">
                        {entries.map((entry) => (
                            <div
                                key={entry.version}
                                className={`mb-6 ${
                                    entry.version > lastSeenVersion ? 'text-white' : 'text-gray-400'
                                }`}
                            >
                                <h3 className="font-bold mb-2">
                                    Version {entry.version} - {entry.date}
                                    {entry.version > lastSeenVersion && (
                                        <span className="ml-2 text-xs bg-blue-500 text-white px-2 py-1 rounded">
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
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}; 