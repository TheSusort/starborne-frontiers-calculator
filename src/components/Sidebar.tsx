import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

export const Sidebar: React.FC = () => {
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const isActive = (path: string) => location.pathname === path;

    const navigationLinks = [
        { path: '/ships', label: 'Ships' },
        { path: '/gear', label: 'Gear' },
        { path: '/simulation', label: 'Simulation' },
        { path: '/autogear', label: 'Autogear' },
    ];

    return (
        <>
            {/* Mobile Menu Button */}
            <div className="lg:hidden fixed top-0 left-0 right-0 bg-dark px-4 py-3 z-20">
                <div className="flex justify-between items-center">
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="text-gray-300 hover:text-white focus:outline-none focus:text-white transition-colors duration-200"
                    >
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {isMobileMenuOpen ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            )}
                        </svg>
                    </button>
                    <h1 className="text-white text-xl font-bold">
                        Starborne Planner
                    </h1>
                    <span className="text-xs text-gray-400">v0.1</span>
                </div>
            </div>

            {/* Sidebar for desktop */}
            <div
                className={`
                    fixed top-10 lg:top-0 left-0 h-full bg-dark z-20
                    w-64
                    transform transition-all duration-300 ease-in-out
                    lg:translate-x-0
                    ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:block
                `}
            >
                <div className={`
                    p-4
                    transition-opacity duration-300 ease-in-out
                    ${isMobileMenuOpen ? 'opacity-100' : 'lg:opacity-100 opacity-0'}
                `}>
                    <span className="text-xs text-gray-400">v0.1</span>
                    <h1 className="text-white text-xl font-bold mb-8 hidden lg:block">
                        Starborne Planner
                    </h1>

                    <nav className="space-y-2">
                        {navigationLinks.map(({ path, label }) => (
                            <Link
                                key={path}
                                to={path}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`
                                    block px-4 py-2
                                    transition-all duration-200 ease-in-out
                                    transform hover:scale-105
                                    ${isActive(path)
                                        ? 'bg-primary hover:bg-primary-hover'
                                        : 'text-gray-300 hover:bg-dark-border'
                                    }
                                `}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Overlay for mobile */}
            <div
                onClick={() => setIsMobileMenuOpen(false)}
                className={`
                    fixed inset-0 bg-black lg:hidden
                    transition-opacity duration-300 ease-in-out z-10
                    ${isMobileMenuOpen
                        ? 'opacity-50 pointer-events-auto'
                        : 'opacity-0 pointer-events-none'
                    }
                `}
            />
        </>
    );
};