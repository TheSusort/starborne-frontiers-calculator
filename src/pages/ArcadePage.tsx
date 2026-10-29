import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
import { StatCard } from '../components/ui/StatCard';
import { CollapsibleAccordion } from '../components/ui/CollapsibleAccordion';
import { ChevronDownIcon } from '../components/ui/icons';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { useShips } from '../contexts/ShipsContext';
import { FLIGHT_END_EVENT, requestFlight } from '../components/arcade/flightEvents';
import { ArcadeLeaderboard } from '../components/arcade/ArcadeLeaderboard';
import { useArcadeLeaderboard } from '../components/arcade/useArcadeLeaderboard';
import { readLocalBestRun } from '../components/arcade/localBest';
import { formatDistance, NO_VALUE, pickBestRun } from '../components/arcade/bestRunSource';
import { readLastShipId } from '../components/arcade/ships/fleetOrder';

/** A score submit can still be in flight when the flight-end event fires; a second refetch picks it up. */
const LEADERBOARD_RECHECK_MS = 1500;

const LEADERBOARD_LIMIT = 20;

const ArcadePage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { ships } = useShips();
    const [localRun, setLocalRun] = useState(readLocalBestRun);
    const [lastShipId, setLastShipId] = useState(readLastShipId);
    const [boardVersion, setBoardVersion] = useState(0);
    const [howToOpen, setHowToOpen] = useState(false);
    const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const board = useArcadeLeaderboard(LEADERBOARD_LIMIT, boardVersion);

    const shipName = useMemo(
        () => (lastShipId ? (ships.find((s) => s.id === lastShipId)?.name ?? null) : null),
        [ships, lastShipId]
    );
    const bestRun = useMemo(() => pickBestRun(board.rows, localRun), [board.rows, localRun]);

    useEffect(() => {
        if (searchParams.get('play') !== '1') return;
        requestFlight();
        const next = new URLSearchParams(searchParams);
        next.delete('play');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const onEnd = () => {
            setLocalRun(readLocalBestRun());
            setLastShipId(readLastShipId());
            setBoardVersion((v) => v + 1);
            if (recheckTimer.current) clearTimeout(recheckTimer.current);
            recheckTimer.current = setTimeout(
                () => setBoardVersion((v) => v + 1),
                LEADERBOARD_RECHECK_MS
            );
        };
        window.addEventListener(FLIGHT_END_EVENT, onEnd);
        return () => {
            window.removeEventListener(FLIGHT_END_EVENT, onEnd);
            if (recheckTimer.current) clearTimeout(recheckTimer.current);
        };
    }, []);

    return (
        <>
            <Seo {...SEO_CONFIG.arcade} />
            <PageLayout
                title="Arcade"
                description="Take the controls of the synthwave fighter and see how far you can fly."
            >
                <div className="mx-auto w-full max-w-3xl space-y-6">
                    <div className="card flex flex-col items-center gap-4 py-8 text-center">
                        <h2 className="arcade-title">Starborne Arcade</h2>
                        <p className="max-w-md text-theme-text">
                            Dodge walls, jump lasers, duck blocks, grab credits. The speed keeps
                            rising.
                        </p>
                        <Button size="lg" onClick={() => requestFlight()}>
                            START
                        </Button>
                        <p className="text-sm text-theme-text-secondary">
                            Flying: {shipName ?? 'neon fighter'}
                        </p>
                    </div>

                    <section className="space-y-2" aria-label="Your best run">
                        {bestRun ? (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <StatCard
                                    title="Your best"
                                    value={bestRun.score.toLocaleString()}
                                />
                                <StatCard
                                    title="Distance"
                                    value={formatDistance(bestRun.distance)}
                                    color="blue"
                                />
                                <StatCard
                                    title="Credits"
                                    value={
                                        bestRun.credits === null
                                            ? NO_VALUE
                                            : bestRun.credits.toLocaleString()
                                    }
                                    color="yellow"
                                />
                                <StatCard
                                    title="Rank"
                                    value={bestRun.rank === null ? NO_VALUE : `#${bestRun.rank}`}
                                />
                            </div>
                        ) : (
                            <p className="card text-center text-theme-text-secondary">
                                No runs yet
                            </p>
                        )}
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-xl font-semibold">High scores</h2>
                        <ArcadeLeaderboard
                            rows={board.rows}
                            loading={board.loading}
                            failed={board.failed}
                            onRetry={board.retry}
                        />
                    </section>

                    <section className="card p-0">
                        <button
                            type="button"
                            className="flex w-full items-center justify-between p-4 text-left font-semibold"
                            aria-expanded={howToOpen}
                            aria-controls="arcade-how-to-play"
                            onClick={() => setHowToOpen((o) => !o)}
                        >
                            How to play
                            <ChevronDownIcon
                                className={`h-5 w-5 transition-transform ${howToOpen ? 'rotate-180' : ''}`}
                            />
                        </button>
                        <CollapsibleAccordion isOpen={howToOpen} id="arcade-how-to-play">
                            <div className="space-y-4">
                                <p className="text-theme-text">
                                    Dodge walls, jump over lasers, duck under raised blocks and
                                    collect credits. The speed keeps rising. Shields absorb one hit;
                                    magnets pull in credits from the next lane. Pick a ship from
                                    your fleet to fly, and fly through a duel gate at a checkpoint
                                    to fight one of your other ships for points, credits or a
                                    power-up.
                                </p>
                                <ul className="text-theme-text space-y-1 list-disc list-inside">
                                    <li>
                                        <strong>Left / Right, A / D, swipe sideways</strong> change
                                        lane
                                    </li>
                                    <li>
                                        <strong>Up, W, Space, swipe up</strong> jump
                                    </li>
                                    <li>
                                        <strong>Down, S, swipe down</strong> duck
                                    </li>
                                    <li>
                                        <strong>P</strong> pauses, <strong>M</strong> toggles music,{' '}
                                        <strong>Esc</strong> quits
                                    </li>
                                </ul>
                            </div>
                        </CollapsibleAccordion>
                    </section>
                </div>
            </PageLayout>
        </>
    );
};

export default ArcadePage;
