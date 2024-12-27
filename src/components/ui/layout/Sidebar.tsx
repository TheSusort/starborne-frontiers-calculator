import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { APP_NAME, CURRENT_VERSION } from '../../../constants';
import { Offcanvas } from './Offcanvas';

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const navigationLinks = [
    { path: '/ships', label: 'Ships' },
    { path: '/gear', label: 'Gear' },
    { path: '/loadouts', label: 'Loadouts' },
    { path: '/engineering', label: 'Engineering' },
    { path: '/simulation', label: 'Simulation' },
    { path: '/autogear', label: 'Autogear' },
  ];

  const SidebarContent = () => (
    <div className="space-y-2">
      <span className="text-xs text-gray-400 hidden lg:block">{CURRENT_VERSION}</span>
      <h1 className="text-gray-200 text-xl font-bold mb-8 hidden lg:block">{APP_NAME}</h1>

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
                            ${
                              isActive(path)
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
  );

  return (
    <>
      {/* Mobile Menu Button */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-dark px-4 py-3 z-20" role="banner">
        <div className="flex justify-between items-center">
          <button
            aria-label="Open mobile menu"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="text-gray-300 hover:text-white focus:outline-none focus:text-white transition-colors duration-200"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isMobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
          <h1 className="text-white text-xl font-bold">{APP_NAME}</h1>
          <span className="text-xs text-gray-400">{CURRENT_VERSION}</span>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div
        data-testid="desktop-sidebar"
        className="hidden lg:block fixed top-0 left-0 h-full w-64 bg-dark z-20"
      >
        <div className="p-4">
          <SidebarContent />
        </div>
      </div>

      {/* Mobile Offcanvas */}
      <Offcanvas
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        title={APP_NAME}
        position="left"
        width="w-64"
        hideCloseButton
      >
        <SidebarContent />
      </Offcanvas>
    </>
  );
};
