import React, { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { useTheme } from '../../contexts/ThemeContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { swipeDirection } from './swipe';

interface Slide {
    id: number;
    title: string;
    subtitle: string;
    ctaText: string;
    ctaLink: string;
    backgroundImage: string;
    gradientClass: string; // Fallback gradient
}

const slides: Slide[] = [
    {
        id: 1,
        title: 'Optimize Your Starborne Fleet',
        subtitle: 'Advanced gear calculations and fleet management for Starborne Frontiers',
        ctaText: 'Import Game Data',
        ctaLink: '#',
        backgroundImage: '/images/hero-fleet.webp',
        gradientClass: 'bg-gradient-to-br from-blue-900 via-slate-900 to-orange-900',
    },
    {
        id: 2,
        title: 'NEW: Arcade',
        subtitle:
            'Fly your own fleet through a synthwave lane-runner and climb the global leaderboard',
        ctaText: 'Play Now',
        ctaLink: '/arcade',
        backgroundImage: '/images/hero-arcade.webp',
        gradientClass: 'bg-gradient-to-br from-fuchsia-900 via-purple-900 to-indigo-900',
    },
    {
        id: 3,
        title: 'Combat Simulator',
        subtitle: 'Set up a battle and watch every turn, skill and buff play out',
        ctaText: 'Open Simulator',
        ctaLink: '/simulator',
        backgroundImage: '/images/hero-simulator.webp',
        gradientClass: 'bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900',
    },
    {
        id: 4,
        title: 'NEW: Bounty Credits Calculator',
        subtitle: 'Work out your Bounty Credit income from normal and background battles',
        ctaText: 'Calculate Credits',
        ctaLink: '/bounty-credits',
        backgroundImage: '/images/hero-bounty.webp',
        gradientClass: 'bg-gradient-to-br from-orange-900 via-red-900 to-slate-900',
    },
    {
        id: 5,
        title: 'New to Starborne Frontiers?',
        subtitle: 'Learn the essentials: turn order, roles, stats, affinities and targeting',
        ctaText: 'Read Game Basics',
        ctaLink: '/basics',
        backgroundImage: '/images/hero-basics.webp',
        gradientClass: 'bg-gradient-to-br from-cyan-900 via-teal-900 to-emerald-900',
    },
    {
        id: 6,
        title: 'How-To Video Guides',
        subtitle:
            'New to the calculator? Watch step-by-step tutorials on importing data, autogear, and more',
        ctaText: 'Watch on YouTube',
        ctaLink: 'https://www.youtube.com/playlist?list=PLinS17lD0vaA9PcYZwcFCQwglbmogOwqo',
        backgroundImage: '/images/hero1.webp',
        gradientClass: 'bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900',
    },
];

export const HeroCarousel: React.FC = () => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [loadedSlides, setLoadedSlides] = useState<Set<number>>(() => new Set([0]));
    const [isHovered, setIsHovered] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const { theme } = useTheme();
    const isSynthwave = theme === 'synthwave';
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const isPaused = isHovered || isFocused;

    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index);
        setLoadedSlides((prev) => new Set(prev).add(index));
    }, []);

    const stepSlide = useCallback((step: 1 | -1) => {
        setCurrentSlide((prev) => {
            const next = (prev + step + slides.length) % slides.length;
            setLoadedSlides((loaded) => new Set(loaded).add(next));
            return next;
        });
    }, []);

    // The active dot's progress animation drives auto-advance: it pauses with the carousel and
    // restarts on each slide change. Under reduced motion it never runs, so nothing auto-advances.
    const handleProgressEnd = useCallback(() => stepSlide(1), [stepSlide]);

    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        const start = touchStart.current;
        const touch = e.changedTouches[0];
        touchStart.current = null;
        if (!start || !touch) return;
        const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y);
        if (direction) stepSlide(direction === 'next' ? 1 : -1);
    };

    const handleCtaClick = (link: string, e: React.MouseEvent) => {
        // If link is '#', trigger the Import Game Data modal
        if (link === '#') {
            e.preventDefault();
            // Find and click the import button in the sidebar
            const importButton = document.querySelector(
                '[data-import-button]'
            ) as HTMLButtonElement;
            if (importButton) {
                importButton.click();
            }
        }
    };

    return (
        <div
            className="relative w-[calc(100%+2rem)] lg:w-[calc(100vw-16rem)] h-[600px] overflow-hidden mb-8 mt-[-2rem] group mx-[-1rem] lg:mx-0 lg:ml-[calc(-1rem-max(0px,((100vw-16rem-80rem-2rem)/2)))]"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setIsFocused(false);
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Slides */}
            <div className="relative w-full h-full">
                {slides.map((slide, index) => (
                    <div
                        key={slide.id}
                        className={`absolute inset-0 ${
                            reduceMotion ? '' : 'transition-opacity duration-700 ease-in-out'
                        } ${
                            index === currentSlide
                                ? 'opacity-100 pointer-events-auto'
                                : 'opacity-0 pointer-events-none'
                        }`}
                    >
                        {/* Background layer, separate so Ken Burns never scales the text */}
                        {!isSynthwave && loadedSlides.has(index) && (
                            <div
                                className={`absolute inset-0 bg-cover bg-[center_top] ${
                                    reduceMotion
                                        ? ''
                                        : index === currentSlide
                                          ? 'animate-kenburns'
                                          : 'scale-[1.08]'
                                }`}
                                style={{
                                    backgroundImage: `url(${slide.backgroundImage})`,
                                    animationPlayState: isPaused ? 'paused' : 'running',
                                }}
                            />
                        )}

                        {/* Gradient overlay for text readability */}
                        {!isSynthwave && (
                            <div className="absolute inset-0 bg-gradient-to-tr from-black/90 via-black/30 to-black/10" />
                        )}

                        {/* Content */}
                        <div className="relative h-full flex flex-col justify-end items-start pb-12">
                            {/* Content wrapper that aligns with page content */}
                            <div className="w-full px-4 sm:px-6 lg:px-4 lg:max-w-7xl lg:mx-auto">
                                {/* Use h1 for the first slide for SEO, h2 for others */}
                                {index === 0 ? (
                                    <h1 className="text-4xl font-bold text-white mb-4 drop-shadow-lg animate-fadeIn">
                                        {slide.title}
                                    </h1>
                                ) : (
                                    <h2 className="text-4xl font-bold text-white mb-4 drop-shadow-lg animate-fadeIn">
                                        {slide.title}
                                    </h2>
                                )}
                                <p className="text-lg text-theme-text mb-8 max-w-3xl drop-shadow-md animate-fadeIn animation-delay-200">
                                    {slide.subtitle}
                                </p>
                                {slide.ctaLink === '#' ? (
                                    <Button
                                        onClick={(e) => handleCtaClick(slide.ctaLink, e)}
                                        variant="primary"
                                        size="lg"
                                        className="transition-all duration-300 transform hover:scale-105 shadow-lg animate-fadeIn animation-delay-400"
                                    >
                                        {slide.ctaText}
                                    </Button>
                                ) : slide.ctaLink.startsWith('http') ? (
                                    <a
                                        href={slide.ctaLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <Button
                                            variant="primary"
                                            size="lg"
                                            className="transition-all duration-300 transform hover:scale-105 shadow-lg animate-fadeIn animation-delay-400"
                                        >
                                            {slide.ctaText}
                                        </Button>
                                    </a>
                                ) : (
                                    <Link to={slide.ctaLink}>
                                        <Button
                                            variant="primary"
                                            size="lg"
                                            className="transition-all duration-300 transform hover:scale-105 shadow-lg animate-fadeIn animation-delay-400"
                                        >
                                            {slide.ctaText}
                                        </Button>
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Dot Indicators */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex space-x-3">
                {slides.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        className={`relative h-3 overflow-hidden rounded-full transition-all duration-300 ${
                            index === currentSlide
                                ? `w-8 ${reduceMotion ? 'bg-primary' : 'bg-white/40'}`
                                : 'w-3 bg-white/50 hover:bg-white/75'
                        }`}
                        aria-label={`Go to slide ${index + 1}`}
                        aria-current={index === currentSlide ? 'true' : undefined}
                    >
                        {index === currentSlide && !reduceMotion && (
                            <span
                                key={currentSlide}
                                className="animate-carousel-progress absolute inset-0 origin-left rounded-full bg-primary"
                                style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
                                onAnimationEnd={handleProgressEnd}
                            />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};
