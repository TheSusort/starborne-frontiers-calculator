import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';

const BAR_TOTAL = 22;
const BAR_FINAL_FILLED = 13;

const TERMINAL_LINES = [
    '> INITIALIZING NAV SYSTEMS... [OK]',
    '> SCANNING SECTOR_404...',
    '> ERROR: NULL_SECTOR_REFERENCE',
];

const NotFoundPage: React.FC = () => {
    const navigate = useNavigate();
    const flickerRef = useRef<HTMLDivElement>(null);
    const glitchRef = useRef<HTMLDivElement>(null);
    const [barProgress, setBarProgress] = useState<number | null>(null);
    const [barCorrupted, setBarCorrupted] = useState(false);
    const [show404, setShow404] = useState(false);

    // Sequence: wait for terminal lines → fill bar → corrupt → reveal 404
    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        let fillInterval: ReturnType<typeof setInterval> | null = null;

        // Start after terminal lines have fully appeared (0.2 + 2×0.35 + 0.4 anim + buffer)
        timers.push(
            setTimeout(() => {
                setBarProgress(0);
                let count = 0;
                fillInterval = setInterval(() => {
                    count++;
                    setBarProgress(count);
                    if (count >= BAR_FINAL_FILLED) {
                        if (fillInterval) clearInterval(fillInterval);
                        timers.push(
                            setTimeout(() => {
                                setBarCorrupted(true);
                                timers.push(setTimeout(() => setShow404(true), 400));
                            }, 200)
                        );
                    }
                }, 40);
            }, 1800)
        );

        return () => {
            timers.forEach(clearTimeout);
            if (fillInterval) clearInterval(fillInterval);
        };
    }, []);

    // VHS glitch burst — only starts after 404 is revealed
    useEffect(() => {
        if (!show404) return;

        const flicker = flickerRef.current;
        const glitch = glitchRef.current;

        const triggerBurst = () => {
            if (flicker) {
                flicker.classList.remove('not-found-burst-active');
                void flicker.offsetWidth;
                flicker.classList.add('not-found-burst-active');
            }
            if (glitch) {
                glitch.classList.remove('not-found-glitch-active');
                void glitch.offsetWidth;
                glitch.classList.add('not-found-glitch-active');
            }
        };

        const schedule = () =>
            setTimeout(
                () => {
                    triggerBurst();
                    timeoutRef = schedule();
                },
                3000 + Math.random() * 3000
            );

        const initialTimer = setTimeout(triggerBurst, 600);
        let timeoutRef = schedule();

        return () => {
            clearTimeout(initialTimer);
            clearTimeout(timeoutRef);
        };
    }, [show404]);

    const filled = barProgress ?? 0;
    const barLine = barCorrupted
        ? `> ${'█'.repeat(BAR_FINAL_FILLED)}${'░'.repeat(BAR_TOTAL - BAR_FINAL_FILLED)} [CORRUPTED]`
        : `> ${'█'.repeat(filled)}${'░'.repeat(BAR_TOTAL - filled)}`;

    return (
        <>
            <Seo {...SEO_CONFIG.notFound} />
            <div className="not-found-scanlines fixed inset-0 z-[110] overflow-hidden font-secondary">
                {/* Layer 1: Deep Crevasse */}
                <div className="absolute inset-0 bg-[url('/images/Deep_crevasse_01_extended.webp')] bg-cover bg-top" />

                {/* Layer 2: BG2 HUD chrome */}
                <div className="absolute inset-0 bg-[url('/images/BG2.png')] bg-cover opacity-[0.15] mix-blend-screen" />

                {/* Layer 3: Dark readability overlay */}
                <div className="absolute inset-0 bg-black/40" />

                {/* Layer 4: VHS glitch burst */}
                <div
                    ref={flickerRef}
                    className="not-found-burst absolute inset-0 pointer-events-none bg-[url('/images/transition.webp')] bg-cover mix-blend-darken"
                />

                {/* Content */}
                <div className="relative z-10 flex items-center justify-center h-full p-4">
                    <div className="card max-w-lg w-full space-y-6 backdrop-blur-sm">
                        {/* // label */}
                        <div className="text-[0.65rem] text-primary uppercase tracking-[0.3em] [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
                            {'// STARBORNE PLANNER'}
                        </div>

                        {/* Terminal lines */}
                        <div className="space-y-1 font-mono text-sm">
                            {TERMINAL_LINES.map((line, i) => (
                                <div
                                    key={i}
                                    className="not-found-line text-green-400"
                                    style={{ animationDelay: `${0.2 + i * 0.35}s` }}
                                >
                                    {line}
                                </div>
                            ))}
                            {/* Progress bar — appears after line 2, then fills */}
                            <div
                                className="not-found-line"
                                style={{ animationDelay: `${0.2 + 3 * 0.35}s` }}
                            >
                                <span
                                    className={
                                        barCorrupted
                                            ? 'text-red-400 not-found-corrupt-flash'
                                            : 'text-green-400'
                                    }
                                >
                                    {barLine}
                                </span>
                            </div>
                        </div>

                        {/* 404 + copy + CTA — revealed after sequence completes */}
                        {show404 && (
                            <div className="not-found-reveal space-y-6">
                                <div
                                    ref={glitchRef}
                                    className="text-center text-8xl font-bold text-primary tracking-widest"
                                >
                                    404
                                </div>

                                <div className="text-center space-y-2">
                                    <p className="text-base font-bold tracking-widest uppercase text-primary">
                                        SECTOR_404: SIGNAL LOST
                                    </p>
                                    <p className="text-sm text-gray-400">
                                        The route you&apos;re looking for has been redacted from our
                                        navigation charts.
                                    </p>
                                </div>

                                <div className="flex justify-center gap-3">
                                    <Button variant="primary" onClick={() => void navigate('/')}>
                                        Return to Base
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => void navigate('/ships/lore')}
                                    >
                                        Investigate Further
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default NotFoundPage;
