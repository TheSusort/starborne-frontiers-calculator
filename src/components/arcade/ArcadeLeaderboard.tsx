import React, { useEffect, useState } from 'react';
import { DataTable, Column } from '../ui/tables/DataTable';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthProvider';
import { getArcadeLeaderboard } from '../../services/arcadeService';
import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';

const COLUMNS: Column<ArcadeLeaderboardEntry>[] = [
    { key: 'rank', label: '#', render: (r) => `#${r.rank}` },
    {
        key: 'username',
        label: 'Pilot',
        render: (r) => (r.isMe ? `${r.username} (You)` : r.username),
    },
    {
        key: 'bestScore',
        label: 'Score',
        align: 'right',
        render: (r) => r.bestScore.toLocaleString(),
    },
];

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
            data={rows}
            columns={COLUMNS}
            loading={loading}
            emptyMessage="No scores yet. Be the first."
            getRowKey={(r) => `${r.rank}-${r.username}`}
            rowClassName={(r) => (r.isMe ? 'bg-primary/10 font-semibold' : '')}
        />
    );
};
