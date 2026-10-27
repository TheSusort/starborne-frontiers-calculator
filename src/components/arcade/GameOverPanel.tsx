import React from 'react';
import { Button } from '../ui/Button';
import type { RunResult } from '../../utils/arcade/types';

interface GameOverPanelProps {
    result: RunResult;
    localBest: number;
    /** The best before this run; only a run that beats it is a new best. */
    previousBest: number;
    onRetry: () => void;
    onQuit: () => void;
    children?: React.ReactNode;
}

export const GameOverPanel: React.FC<GameOverPanelProps> = ({
    result,
    localBest,
    previousBest,
    onRetry,
    onQuit,
    children,
}) => {
    const isBest = result.score > 0 && result.score > previousBest;
    return (
        <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/50">
            <div className="card w-full max-w-md space-y-4 text-center max-h-full overflow-y-auto">
                <h2 className="text-2xl font-bold">Game over</h2>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <div className="text-theme-text-secondary text-sm">Score</div>
                        <div className="text-xl font-semibold">{result.score.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="text-theme-text-secondary text-sm">Distance</div>
                        <div className="text-xl font-semibold">
                            {result.distance.toLocaleString()} m
                        </div>
                    </div>
                    <div>
                        <div className="text-theme-text-secondary text-sm">Credits</div>
                        <div className="text-xl font-semibold">{result.credits}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <div className="text-theme-text-secondary text-sm">
                            Best near-miss chain
                        </div>
                        <div className="text-lg font-semibold">{result.bestNearMissChain}</div>
                    </div>
                    <div>
                        <div className="text-theme-text-secondary text-sm">Near-miss points</div>
                        <div className="text-lg font-semibold">
                            {result.nearMissPoints.toLocaleString()}
                        </div>
                    </div>
                </div>
                <p className={isBest ? 'text-primary font-semibold' : 'text-theme-text-secondary'}>
                    {isBest ? 'New personal best' : `Personal best: ${localBest.toLocaleString()}`}
                </p>
                {children}
                <div className="flex gap-2 justify-center">
                    <Button onClick={onRetry}>Try again</Button>
                    <Button variant="secondary" onClick={onQuit}>
                        Quit
                    </Button>
                </div>
            </div>
        </div>
    );
};
