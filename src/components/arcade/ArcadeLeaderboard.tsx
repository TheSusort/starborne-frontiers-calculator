import React, { useEffect, useMemo, useState } from 'react';
import { DataTable, Column } from '../ui/tables/DataTable';
import { Button } from '../ui/Button';
import { TrophyIcon } from '../ui/icons';
import { useAuth } from '../../contexts/AuthProvider';
import { getArcadeLeaderboard } from '../../services/arcadeService';
import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';
import { isGapRow, withGapRows, type LeaderboardViewRow } from './leaderboardRowsView';

const MEDAL_COLORS: Record<number, string> = {
    1: '#facc15', // gold (yellow-400)
    2: '#d1d5db', // silver (gray-300)
    3: '#d97706', // bronze (amber-600)
};

const medalColor = (r: ArcadeLeaderboardEntry): string | undefined => MEDAL_COLORS[r.rank];

const textSize = (r: ArcadeLeaderboardEntry) => (medalColor(r) ? 'text-lg font-bold' : 'text-base');

const COLUMNS: Column<LeaderboardViewRow>[] = [
    {
        key: 'rank',
        label: '#',
        render: (r) => {
            if (isGapRow(r)) return '\u2026';
            const color = medalColor(r);
            return (
                <span
                    className={`inline-flex items-center gap-1.5 ${textSize(r)}`}
                    style={color ? { color } : undefined}
                >
                    {color && <TrophyIcon className="w-4 h-4" />}#{r.rank}
                </span>
            );
        },
    },
    {
        key: 'username',
        label: 'Pilot',
        render: (r) => {
            if (isGapRow(r)) return '';
            return (
                <span className={`${textSize(r)} ${r.isMe ? 'font-bold' : ''}`}>
                    {r.isMe ? `${r.username} (You)` : r.username}
                </span>
            );
        },
    },
    {
        key: 'bestScore',
        label: 'Score',
        align: 'right',
        render: (r) =>
            isGapRow(r) ? '' : <span className={textSize(r)}>{r.bestScore.toLocaleString()}</span>,
    },
];

const rowClassName = (r: LeaderboardViewRow): string => {
    if (isGapRow(r)) return 'text-theme-text-secondary hover:!bg-transparent';
    const classes: string[] = [];
    if (r.isMe) {
        classes.push('border-l-4 border-primary bg-primary/20 font-bold');
    } else if (r.rank === 1) {
        classes.push('border-l-4 border-yellow-400 bg-yellow-400/10');
    }
    return classes.join(' ');
};

interface Props {
    limit?: number;
    refreshKey?: number;
}

export const ArcadeLeaderboard: React.FC<Props> = ({ limit = 20, refreshKey = 0 }) => {
    const { user } = useAuth();
    const [rows, setRows] = useState<ArcadeLeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setFailed(false);
        getArcadeLeaderboard(limit)
            .then((data) => {
                if (!cancelled) setRows(data);
            })
            .catch((error) => {
                console.error('Error loading arcade leaderboard:', error);
                if (!cancelled) setFailed(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [limit, refreshKey, user?.id, attempt]);

    const viewRows = useMemo(() => withGapRows(rows), [rows]);

    if (failed) {
        return (
            <div className="space-y-2">
                <p className="text-sm text-red-400">Could not load the leaderboard.</p>
                <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <DataTable
            data={viewRows}
            columns={COLUMNS}
            loading={loading}
            emptyMessage="No scores yet. Be the first."
            getRowKey={(r, i) => (isGapRow(r) ? `gap-${i}` : `${r.rank}-${r.username}`)}
            rowClassName={rowClassName}
        />
    );
};
