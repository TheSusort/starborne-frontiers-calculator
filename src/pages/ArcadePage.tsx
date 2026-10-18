import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { FLIGHT_END_EVENT, requestFlight } from '../components/arcade/flightEvents';
import { readLocalBest } from '../components/arcade/localBest';

const ArcadePage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [best, setBest] = useState(readLocalBest);

    useEffect(() => {
        if (searchParams.get('play') !== '1') return;
        requestFlight();
        const next = new URLSearchParams(searchParams);
        next.delete('play');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const onEnd = () => setBest(readLocalBest());
        window.addEventListener(FLIGHT_END_EVENT, onEnd);
        return () => window.removeEventListener(FLIGHT_END_EVENT, onEnd);
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
                        Dodge walls, jump over lasers, duck under arches and collect credits. The
                        speed keeps rising. Shields absorb one hit; magnets pull in credits from the
                        next lane.
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
            </PageLayout>
        </>
    );
};

export default ArcadePage;
