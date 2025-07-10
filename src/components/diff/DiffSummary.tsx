import React from 'react';
import { DiffSummary } from '../../types/diff';

interface DiffSummaryProps {
    summary: DiffSummary;
}

export const DiffSummaryComponent: React.FC<DiffSummaryProps> = ({ summary }) => {
    const totalChanges = summary.added + summary.removed + summary.modified;

    if (totalChanges === 0) {
        return (
            <div className="bg-green-900/20 border border-green-500/30 p-4 mb-6">
                <h3 className="text-lg font-semibold text-green-400 mb-2">No Changes Detected</h3>
                <p className="text-green-300">
                    The files are identical or have no meaningful differences.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-dark border border-dark-border p-4 mb-6">
            <h3 className="text-lg font-semibold mb-3">Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">{summary.added}</div>
                    <div className="text-sm text-gray-400">Added</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-red-400">{summary.removed}</div>
                    <div className="text-sm text-gray-400">Removed</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-400">{summary.modified}</div>
                    <div className="text-sm text-gray-400">Modified</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-gray-400">{summary.unchanged}</div>
                    <div className="text-sm text-gray-400">Unchanged</div>
                </div>
            </div>
        </div>
    );
};
