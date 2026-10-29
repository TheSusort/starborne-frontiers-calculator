import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { getArcadeLeaderboard } from '../../services/arcadeService';
import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';

export interface ArcadeLeaderboardState {
    rows: ArcadeLeaderboardEntry[];
    loading: boolean;
    failed: boolean;
    retry: () => void;
}

/** Fetches the leaderboard; refetches when `refreshKey` or the viewer changes, or on `retry`. */
export function useArcadeLeaderboard(limit = 20, refreshKey = 0): ArcadeLeaderboardState {
    const { user, guestUserId } = useAuth();
    const viewerId = user?.id ?? guestUserId;
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
    }, [limit, refreshKey, viewerId, attempt]);

    return { rows, loading, failed, retry: () => setAttempt((a) => a + 1) };
}
