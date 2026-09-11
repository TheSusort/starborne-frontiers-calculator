import React from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
    seed: number;
    runCount: number;
    onSeedChange: (seed: number) => void;
    onRunCountChange: (count: number) => void;
    onRun: () => void;
    canRun: boolean;
    /** Disables the seed and run-count inputs (and the New seed control) without
     *  affecting whether a run can currently be started. */
    locked?: boolean;
    lockedReason?: string;
}

// SimulatorPage's initial seed state needs this generator; it is not itself a component so
// it does not affect HMR.
// eslint-disable-next-line react-refresh/only-export-components
export const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/** Seed and run-count controls for the Combat Simulator. A run is always seeded: one seed
 *  reproduces a single fight, a run count above one repeats it over consecutive seeds. */
const SeedRunControls: React.FC<Props> = ({
    seed,
    runCount,
    onSeedChange,
    onRunCountChange,
    onRun,
    canRun,
    locked = false,
    lockedReason,
}) => {
    return (
        <div className="flex flex-wrap items-end gap-4">
            <Input
                label="Seed"
                type="number"
                value={seed}
                onChange={(e) => onSeedChange(Number(e.target.value))}
                disabled={locked}
                className="max-w-[10rem]"
            />
            <Input
                label="Runs"
                type="number"
                min={1}
                max={200}
                value={runCount}
                onChange={(e) => onRunCountChange(Number(e.target.value))}
                disabled={locked}
                className="max-w-[6rem]"
            />
            <Button
                variant="secondary"
                size="sm"
                onClick={() => onSeedChange(randomSeed())}
                disabled={locked}
            >
                New seed
            </Button>
            {locked && lockedReason && (
                <span className="text-sm text-theme-text-secondary">{lockedReason}</span>
            )}
            <Button variant="primary" onClick={onRun} disabled={!canRun}>
                Run Simulation
            </Button>
        </div>
    );
};

export default SeedRunControls;
