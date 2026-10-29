import React from 'react';
import { ArcadeLeaderboard } from './ArcadeLeaderboard';
import { useArcadeLeaderboard } from './useArcadeLeaderboard';

/** The leaderboard with its own fetch, for the game-over panel (the start page fetches once itself). */
export const GameOverLeaderboard: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
    const board = useArcadeLeaderboard(20, refreshKey);
    return (
        <ArcadeLeaderboard
            rows={board.rows}
            loading={board.loading}
            failed={board.failed}
            onRetry={board.retry}
        />
    );
};
