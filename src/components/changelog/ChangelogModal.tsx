import React from 'react';
import { ChangelogEntry } from '../../types/changelog';
import { Modal } from '../ui';

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
    lastSeenVersion,
}) => {
    // create a function to compare versions of the format x.y.z, all numbers, return true if version1 is greater than version2
    const compareVersions = (version1: string, version2: string) => {
        const [major1, minor1, patch1] = version1.split('.');
        const [major2, minor2, patch2] = version2.split('.');
        return (
            parseInt(major1) > parseInt(major2) ||
            (parseInt(major1) === parseInt(major2) && parseInt(minor1) > parseInt(minor2)) ||
            (parseInt(major1) === parseInt(major2) &&
                parseInt(minor1) === parseInt(minor2) &&
                parseInt(patch1) > parseInt(patch2))
        );
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="What's New">
            <div className="overflow-y-auto max-h-[60vh]">
                {entries.map((entry) => (
                    <div key={entry.version}>
                        {compareVersions(entry.version, lastSeenVersion) && (
                            <div className={`${entry.version === '1.0.0' ? 'animate-bounce' : ''}`}>
                                <div
                                    className={`mb-6 ${
                                        entry.version === '1.0.0'
                                            ? 'mt-8 p-4 text-dark rounded-lg bg-gradient-to-r from-red-500 via-yellow-500 to-purple-500 bg-[length:200%_100%] animate-gradient'
                                            : ''
                                    }`}
                                    style={
                                        entry.version === '1.0.0'
                                            ? {
                                                  animation: 'gradient 3s ease infinite',
                                              }
                                            : undefined
                                    }
                                >
                                    <h3 className="font-bold mb-2">
                                        Version {entry.version} - {entry.date}
                                        {compareVersions(entry.version, lastSeenVersion) && (
                                            <span
                                                className={`ml-2 text-xs px-2 py-1 ${
                                                    entry.version === '1.0.0'
                                                        ? 'animate-ping bg-dark text-white'
                                                        : 'bg-blue-500'
                                                }`}
                                            >
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
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <style>
                {`
                    @keyframes gradient {
                        0% {
                            background-position: 0% 50%;
                        }
                        50% {
                            background-position: 100% 50%;
                        }
                        100% {
                            background-position: 0% 50%;
                        }
                    }
                `}
            </style>
        </Modal>
    );
};

export default ChangelogModal;
