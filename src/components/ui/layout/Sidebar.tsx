import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, CURRENT_VERSION } from '../../../constants';
import { Offcanvas } from './Offcanvas';
import logo from '/favicon.ico?url';
import { LoginButton } from '../../auth/LoginButton';
import { MenuIcon } from '../icons/MenuIcon';

export const Sidebar: React.FC = () => {
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const isActive = (path: string) => location.pathname === path;

    const navigationLinks = [
        { path: '/', label: 'Home' },
        { path: '/ships', label: 'Ships' },
        { path: '/gear', label: 'Gear' },
        { path: '/loadouts', label: 'Loadouts' },
        { path: '/engineering', label: 'Engineering' },
        { path: '/simulation', label: 'Simulation' },
        { path: '/autogear', label: 'Autogear' },
        { path: '/encounters', label: 'Encounters' },
        { path: '/ships/index', label: 'Ship Database' },
    ];

    const SidebarContent = () => (
        <div className="space-y-2 flex flex-col h-full">
            <span className="text-xs text-gray-400 hidden lg:block">{CURRENT_VERSION}</span>
            <h1 className=" text-xl font-bold mb-8 hidden lg:flex gap-2 items-center">
                <img src={logo} alt="logo" className="w-8 h-8" />
                {APP_NAME}
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
                            transform hover:scale-105 border
                            section-split-effect text-right
                            ${
                                isActive(path)
                                    ? 'bg-primary hover:bg-primary-hover text-dark border-primary hover:border-primary-hover'
                                    : 'border-dark-border bg-dark'
                            }
                        `}
                    >
                        {label}
                    </Link>
                ))}
            </nav>

            <div className="!mt-auto">
                <LoginButton />
            </div>
        </div>
    );

    return (
        <>
            {/* Mobile Header */}
            <div
                className="lg:hidden fixed top-0 left-0 right-0 bg-dark px-4 py-3 z-20 bg-[url('/images/Deep_crevasse_01.png')] bg-cover bg-center"
                role="banner"
            >
                <div className="flex justify-between items-center">
                    <button
                        aria-label="Open mobile menu"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className=" hover:text-white focus:outline-none focus:text-white transition-colors duration-200"
                    >
                        <MenuIcon className="h-6 w-6" />
                    </button>
                    <h1 className="text-white text-xl font-bold flex items-center gap-2">
                        <img src={logo} alt="logo" className="w-8 h-8" />
                        {APP_NAME}
                    </h1>
                    <span className="text-xs text-gray-400">{CURRENT_VERSION}</span>
                </div>
            </div>

            {/* Desktop Sidebar */}
            <div
                data-testid="desktop-sidebar"
                className="hidden lg:block fixed top-0 left-0 h-full w-64 bg-dark z-20 bg-[url('/images/Deep_crevasse_01.png')] bg-cover bg-right"
            >
                <div className="p-4 h-full">
                    <SidebarContent />
                </div>
            </div>

            {/* Mobile Offcanvas */}
            <Offcanvas
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
                position="left"
                width="w-64"
                hideCloseButton
            >
                <SidebarContent />
            </Offcanvas>
        </>
    );
};
