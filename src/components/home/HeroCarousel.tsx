import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { Button } from '../ui/Button';

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
        backgroundImage: '/images/Besieged_Station_01.png',
        gradientClass: 'bg-gradient-to-br from-blue-900 via-slate-900 to-orange-900',
    },
    {
        id: 2,
        title: 'Intelligent Gear Optimization',
        subtitle: 'AI-powered autogear recommendations to maximize your ship performance',
        ctaText: 'Try Autogear',
        ctaLink: '/autogear',
        backgroundImage: '/images/hero1.png',
        gradientClass: 'bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900',
    },
    {
        id: 3,
        title: 'Manage Your Entire Fleet',
        subtitle: 'Ships, gear, loadouts, simulations, and encounter tracking all in one place',
        ctaText: 'View Ships',
        ctaLink: '/ships',
        backgroundImage: '/images/Strange_encounter_01.png',
        gradientClass: 'bg-gradient-to-br from-orange-900 via-red-900 to-rose-900',
    },
    {
        id: 4,
        title: 'Advanced Combat Calculators',
        subtitle: 'DPS, defense, healing calculators and damage deconstruction tools',
        ctaText: 'Explore Tools',
        ctaLink: '/damage',
        backgroundImage: '/images/Deep_crevasse_01.png',
        gradientClass: 'bg-gradient-to-br from-cyan-900 via-teal-900 to-emerald-900',
    },
];

export const HeroCarousel: React.FC = () => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isHovered, setIsHovered] = useState(false);

    const nextSlide = useCallback(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, []);

    const prevSlide = useCallback(() => {
        setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
    }, []);

    const goToSlide = useCallback((index: number) => {
        setCurrentSlide(index);
    }, []);

    // Auto-advance slides
    useEffect(() => {
        if (!isPlaying || isHovered) return;

        const interval = setInterval(() => {
            nextSlide();
        }, 5000); // 5 seconds per slide

        return () => clearInterval(interval);
    }, [isPlaying, isHovered, nextSlide]);

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
        >
            {/* Slides */}
            <div className="relative w-full h-full">
                {slides.map((slide, index) => (
                    <div
                        key={slide.id}
                        className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
                            index === currentSlide
                                ? 'opacity-100 pointer-events-auto'
                                : 'opacity-0 pointer-events-none'
                        }`}
                        style={{
                            backgroundImage: `url(${slide.backgroundImage})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center top',
                        }}
                    >
                        {/* Gradient overlay for text readability */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10" />

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
                                <p className="text-lg text-gray-200 mb-8 max-w-3xl drop-shadow-md animate-fadeIn animation-delay-200">
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

            {/* Navigation Arrows */}
            <Button
                onClick={prevSlide}
                variant="secondary"
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 transition-all duration-300 opacity-0 group-hover:opacity-100 border-0"
                aria-label="Previous slide"
            >
                <ChevronLeft size={24} />
            </Button>
            <Button
                onClick={nextSlide}
                variant="secondary"
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 transition-all duration-300 opacity-0 group-hover:opacity-100 border-0"
                aria-label="Next slide"
            >
                <ChevronRight size={24} />
            </Button>

            {/* Dot Indicators */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex space-x-3">
                {slides.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        className={`w-3 h-3 rounded-full transition-all duration-300 ${
                            index === currentSlide
                                ? 'bg-primary w-8'
                                : 'bg-white/50 hover:bg-white/75'
                        }`}
                        aria-label={`Go to slide ${index + 1}`}
                    />
                ))}
            </div>

            {/* Play/Pause Button */}
            <Button
                onClick={() => setIsPlaying(!isPlaying)}
                variant="secondary"
                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 transition-all duration-300 opacity-0 group-hover:opacity-100 border-0"
                aria-label={isPlaying ? 'Pause' : 'Play'}
            >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </Button>
        </div>
    );
};
