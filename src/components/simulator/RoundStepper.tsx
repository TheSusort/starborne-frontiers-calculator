import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, PauseIcon } from '../ui/icons';

interface RoundStepperProps {
    /** Current round (1-based). */
    round: number;
    /** Total number of rounds (>= 1). */
    total: number;
    /** Called with the clamped target round when the user steps/plays. */
    onChange: (round: number) => void;
}

const STEP_INTERVAL_MS = 800;

/**
 * Controlled round-navigation control. Parent owns the `round` state; every action
 * (First/Prev/Next/Last, slider, auto-play tick) calls `onChange` with the next
 * clamped value. Play advances by re-arming a single timeout each render while
 * playing — this reads the latest `round`/`total` from props on every render, so
 * there is no stale-closure interval that keeps advancing from the initial round.
 */
const RoundStepper: React.FC<RoundStepperProps> = ({ round, total, onChange }) => {
    const [playing, setPlaying] = useState(false);

    const clamp = (r: number) => Math.max(1, Math.min(total, r));
    const go = (r: number) => onChange(clamp(r));

    const atStart = round <= 1;
    const atEnd = round >= total;

    // Auto-play: a single re-armed timeout. Re-runs on every change to
    // [playing, round, total] because the effect deps capture the latest values,
    // so the timeout always advances from the current round and stops at total.
    useEffect(() => {
        if (!playing) return;
        if (round >= total) {
            setPlaying(false);
            return;
        }
        const id = setTimeout(() => {
            onChange(Math.min(total, round + 1));
        }, STEP_INTERVAL_MS);
        return () => clearTimeout(id);
        // onChange intentionally excluded — parent passes a stable setter; including
        // it would not change correctness since the timeout reads round/total fresh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, round, total]);

    const togglePlay = () => {
        setPlaying((p) => !p);
    };

    return (
        <div className="card flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => go(1)}
                    disabled={atStart}
                    aria-label="First round"
                >
                    First
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => go(round - 1)}
                    disabled={atStart}
                    aria-label="Previous round"
                >
                    <ChevronLeftIcon aria-hidden="true" />
                    Prev
                </Button>

                <span className="text-sm text-theme-text min-w-[7rem] text-center font-medium">
                    Round {round} / {total}
                </span>

                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => go(round + 1)}
                    disabled={atEnd}
                    aria-label="Next round"
                >
                    Next
                    <ChevronRightIcon aria-hidden="true" />
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => go(total)}
                    disabled={atEnd}
                    aria-label="Last round"
                >
                    Last
                </Button>

                <Button
                    variant="primary"
                    size="sm"
                    onClick={togglePlay}
                    aria-label={playing ? 'Pause' : 'Play'}
                >
                    {playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
                    {playing ? 'Pause' : 'Play'}
                </Button>
            </div>

            <input
                type="range"
                min={1}
                max={total}
                value={round}
                onChange={(e) => go(Number(e.target.value))}
                aria-label="Round"
                className="w-full accent-primary cursor-pointer"
            />
        </div>
    );
};

export default RoundStepper;
