import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { FLIGHT_END_EVENT, requestFlight } from '../components/arcade/flightEvents';
import { ArcadeLeaderboard } from '../components/arcade/ArcadeLeaderboard';
import { readLocalBest } from '../components/arcade/localBest';

/** A score submit can still be in flight when the flight-end event fires; a second refetch picks it up. */
const LEADERBOARD_RECHECK_MS = 1500;

const ArcadePage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [best, setBest] = useState(readLocalBest);
    const [boardVersion, setBoardVersion] = useState(0);
    const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (searchParams.get('play') !== '1') return;
        requestFlight();
        const next = new URLSearchParams(searchParams);
        next.delete('play');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const onEnd = () => {
            setBest(readLocalBest());
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
                <div className="card space-y-4">
                    <p className="text-theme-text">
                        Dodge walls, jump over lasers, duck under raised blocks and collect credits.
                        The speed keeps rising. Shields absorb one hit; magnets pull in credits from
                        the next lane. Pick a ship from your fleet to fly, and fly through a duel
                        gate at a checkpoint to fight one of your other ships for points, credits or
                        a power-up.
                    </p>
                    <ul className="text-theme-text space-y-1 list-disc list-inside">
                        <li>
                            <strong>Left / Right, A / D, swipe sideways</strong> change lane
                        </li>
                        <li>
                            <strong>Up, W, Space, swipe up</strong> jump
                        </li>
                        <li>
                            <strong>Down, S, swipe down</strong> duck
                        </li>
                        <li>
                            <strong>P</strong> pauses, <strong>Esc</strong> quits
                        </li>
                    </ul>
                    <p className="text-theme-text-secondary">
                        Personal best: {best.toLocaleString()}
                    </p>
                    <Button onClick={() => requestFlight()}>Start</Button>
                </div>
                <div className="card space-y-2">
                    <h2 className="text-xl font-semibold">Leaderboard</h2>
                    <ArcadeLeaderboard refreshKey={boardVersion} />
                </div>
            </PageLayout>
        </>
    );
};

export default ArcadePage;
