import React, { useEffect, useState } from 'react';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import { Button } from '../ui/Button';
import RoundStepper from './RoundStepper';
import BattlePlayback, { outcomeLabel } from './BattlePlayback';

interface DivergencePlaybackProps {
    seed: number;
    /** The pinned baseline's fight at this seed. */
    baseline: BattleResult;
    /** The current run's fight at the same seed. */
    current: BattleResult;
    onClose: () => void;
}

/**
 * One seed's two fights, stacked and stepped together. A single `RoundStepper` drives both
 * playbacks so round N of the baseline sits directly above round N of the current run, which is
 * the comparison this view exists to make. Its total is the longer fight's round count; the
 * shorter fight clamps to its own last round (see `BattlePlayback`'s `round` prop).
 *
 * Stacked rather than side by side because each `BattlePlayback` already renders two mirrored
 * boards, so two columns of them do not fit the narrowest supported width.
 */
const DivergencePlayback: React.FC<DivergencePlaybackProps> = ({
    seed,
    baseline,
    current,
    onClose,
}) => {
    const [round, setRound] = useState(1);
    const total = Math.max(baseline.rounds.length, current.rounds.length);

    // A different seed is a different pair of fights, so playback restarts.
    useEffect(() => {
        setRound(1);
    }, [seed, baseline, current]);

    return (
        <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">Seed {seed}</h2>
                    <p className="text-sm text-theme-text-secondary">
                        Baseline: {outcomeLabel(baseline)} in {baseline.outcome.lastRound} rounds.
                        Current: {outcomeLabel(current)} in {current.outcome.lastRound} rounds.
                    </p>
                </div>
                <Button variant="secondary" size="sm" onClick={onClose}>
                    Close
                </Button>
            </div>

            {total > 0 && (
                <RoundStepper round={Math.min(round, total)} total={total} onChange={setRound} />
            )}

            <div className="space-y-4">
                <section className="space-y-4">
                    <h3 className="text-base font-semibold">Baseline</h3>
                    <BattlePlayback result={baseline} round={round} />
                </section>
                <section className="space-y-4">
                    <h3 className="text-base font-semibold">Current</h3>
                    <BattlePlayback result={current} round={round} />
                </section>
            </div>
        </div>
    );
};

export default DivergencePlayback;
