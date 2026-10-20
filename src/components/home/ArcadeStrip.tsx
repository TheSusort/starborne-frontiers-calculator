import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gamepad2 } from 'lucide-react';
import { Button } from '../ui';
import { getArcadeLeaderboard } from '../../services/arcadeService';
import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';

/** The all-time Arcade #1; renders nothing while loading, on error, or for an empty board. */
export const ArcadeStrip: React.FC = () => {
    const [top, setTop] = useState<ArcadeLeaderboardEntry | null>(null);

    useEffect(() => {
        let cancelled = false;
        getArcadeLeaderboard(1)
            .then((rows) => {
                if (!cancelled) setTop(rows[0] ?? null);
            })
            .catch(() => {
                if (!cancelled) setTop(null);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!top) return null;

    return (
        <div className="card flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
                <Gamepad2 className="text-primary" size={28} />
                <p className="text-theme-text">
                    Arcade #1: <span className="font-semibold text-primary">{top.username}</span>
                    {' - '}
                    {top.bestScore.toLocaleString()}
                </p>
            </div>
            <Link to="/arcade">
                <Button variant="primary">Play</Button>
            </Link>
        </div>
    );
};
