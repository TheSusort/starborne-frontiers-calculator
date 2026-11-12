import React, { useEffect, useState } from 'react';
import { Pagination } from '../ui/Pagination';
import type { SeedRunSummary } from '../../utils/simulator/seededRuns';

interface Props {
    runs: SeedRunSummary[];
    /** The seed whose fight is on screen, outlined in the strip. */
    openedSeed: number | null;
    onOpenSeed: (seed: number) => void;
}

/** Squares per page. Caps how many buttons a single pass mounts, no matter how large the run. */
const SEEDS_PER_PAGE = 200;

const WINNER_LABEL = { player: 'Your team', enemy: 'Enemy' } as const;
/** Enemy wins carry a diagonal stripe on top of the colour, so the two outcomes differ without
 *  relying on hue. */
const WINNER_STYLE = {
    player: 'bg-blue-500',
    enemy: 'bg-red-500 bg-[repeating-linear-gradient(135deg,transparent_0,transparent_2px,rgba(0,0,0,0.4)_2px,rgba(0,0,0,0.4)_4px)]',
} as const;

/** One small square per seed of a multi-seed run, coloured by winner; clicking one replays that
 *  fight. One seeded run reproduces a fight, so the strip is how a single fight is picked out of
 *  the set.
 *
 *  Memoized: a run in flight ticks `onProgress` up to ~100 times (see `runSeedSetAsync`'s doc),
 *  and this component owns the one unbounded list in the results tree, so it is the render this
 *  memo exists to skip. It only pays off if `onOpenSeed` is referentially stable across those
 *  ticks — `useSimulatorRuns` wraps it in `useCallback` for exactly that reason. */
const SeedStrip: React.FC<Props> = ({ runs, openedSeed, onOpenSeed }) => {
    const [currentPage, setCurrentPage] = useState(1);

    // A new run always opens on page 1, even when the previous page number is still in range for
    // it — a fresh run starts from the top, not wherever the last run's view happened to be.
    useEffect(() => {
        setCurrentPage(1);
    }, [runs]);

    const totalPages = Math.ceil(runs.length / SEEDS_PER_PAGE);
    // Clamped at render time, not just by the effect above: the effect's reset only takes effect
    // on the render after this one, so an unclamped page would slice an empty window for one
    // frame whenever a shorter run replaces a longer one.
    const renderedPage = Math.min(currentPage, Math.max(1, totalPages));
    const visibleRuns = runs.slice(
        (renderedPage - 1) * SEEDS_PER_PAGE,
        renderedPage * SEEDS_PER_PAGE
    );

    const openedIndex = openedSeed === null ? -1 : runs.findIndex((run) => run.seed === openedSeed);

    return (
        <div className="space-y-2">
            {openedIndex >= 0 && (
                <p className="text-sm text-theme-text-secondary">
                    Seed {openedSeed} · {openedIndex + 1} of {runs.length}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-4 text-xs text-theme-text-secondary">
                {(['player', 'enemy'] as const).map((winner) => (
                    <span key={winner} className="inline-flex items-center gap-1.5">
                        <span
                            aria-hidden="true"
                            className={`h-3 w-3 rounded-sm ${WINNER_STYLE[winner]}`}
                        />
                        {winner === 'player' ? 'Your team wins' : 'Enemy wins'}
                    </span>
                ))}
            </div>
            {/* Before the squares, so a keyboard user reaches the page controls without tabbing
                through every seed on the page. Scrolling to top on a page change would yank the
                viewport away from the strip, so it is off. */}
            <Pagination
                currentPage={renderedPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                scrollToTop={false}
                className="!mt-0"
            />
            <div className="flex flex-wrap gap-1">
                {visibleRuns.map((run) => {
                    const label = `Seed ${run.seed}: ${WINNER_LABEL[run.winner]} wins in round ${run.lastRound}`;
                    const isOpened = run.seed === openedSeed;
                    return (
                        <button
                            key={run.seed}
                            type="button"
                            aria-label={label}
                            title={label}
                            aria-pressed={isOpened}
                            onClick={() => onOpenSeed(run.seed)}
                            className={`h-6 w-6 sm:h-4 sm:w-4 rounded-sm ${WINNER_STYLE[run.winner]} ${
                                isOpened
                                    ? 'ring-2 ring-white ring-offset-1 ring-offset-dark'
                                    : 'opacity-70 hover:opacity-100'
                            }`}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default React.memo(SeedStrip);
