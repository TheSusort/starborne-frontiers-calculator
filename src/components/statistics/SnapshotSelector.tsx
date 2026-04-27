import React from 'react';
import { Select } from '../ui';
import { SnapshotListItem } from '../../types/statisticsSnapshot';

interface SnapshotSelectorProps {
    snapshots: SnapshotListItem[];
    selectedMonth: string | null;
    onChange: (month: string | null) => void;
    loading: boolean;
}

function formatMonth(isoDate: string): string {
    const date = new Date(isoDate + 'T12:00:00');
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export const SnapshotSelector: React.FC<SnapshotSelectorProps> = ({
    snapshots,
    selectedMonth,
    onChange,
    loading,
}) => {
    if (snapshots.length === 0 && !loading) {
        return (
            <div className="text-sm text-theme-text-secondary">
                Snapshots are saved automatically each month. Check back next month to compare your
                progress.
            </div>
        );
    }

    const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;

    const options = [
        { value: 'none', label: 'No comparison' },
        ...snapshots
            .filter((s) => s.snapshotMonth !== currentMonthStr)
            .map((s) => ({
                value: s.snapshotMonth,
                label: formatMonth(s.snapshotMonth),
            })),
    ];

    return (
        <div className="flex items-center gap-3">
            <label className="text-sm text-theme-text-secondary whitespace-nowrap">
                Compare with:
            </label>
            <Select
                value={selectedMonth || 'none'}
                onChange={(val) => onChange(val === 'none' ? null : val)}
                options={options}
                disabled={loading}
            />
        </div>
    );
};
