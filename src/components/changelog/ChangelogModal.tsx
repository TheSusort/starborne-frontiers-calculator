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
                            <div className={`mb-6 `}>
                                <h3 className="font-bold mb-2">
                                    Version {entry.version} - {entry.date}
                                    {compareVersions(entry.version, lastSeenVersion) && (
                                        <span className="ml-2 text-xs bg-blue-500  px-2 py-1">
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
