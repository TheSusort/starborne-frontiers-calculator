import React, { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, CURRENT_VERSION } from '../../../constants';
import { Offcanvas } from './Offcanvas';
import logo from '/favicon.ico?url';
import { LoginButton } from '../../auth/LoginButton';
import { MenuIcon } from '../icons/MenuIcon';
import { ChevronDownIcon } from '../icons/ChevronIcons';
import { useAuth } from '../../../contexts/AuthProvider';
import { Tooltip } from './Tooltip';
import { ImportButton } from '../../import/ImportButton';

// Define the type for navigation items
type NavigationItem = {
    path: string;
    label: string;
    children?: NavigationItem[];
    requiresAuth?: boolean;
};

// Simple collapsible component wrapped in memo to prevent unnecessary re-renders
const CollapsibleSection: React.FC<{
    isOpen: boolean;
    children: React.ReactNode;
}> = memo(({ isOpen, children }) => {
    return (
        <div
            className="transition-all duration-300 ease-in-out overflow-hidden"
            style={{
                maxHeight: isOpen ? '1000px' : '0',
                opacity: isOpen ? 1 : 0,
                padding: isOpen ? '8px' : '0',
                margin: isOpen ? '0 -8px' : '0',
            }}
        >
            <div className="pl-4 border-l border-dark-border">{children}</div>
        </div>
    );
});
CollapsibleSection.displayName = 'CollapsibleSection';

// Self-contained navigation item that manages its own expanded state
const NavigationItem: React.FC<{
    item: NavigationItem;
    depth?: number;
    isActive: (path: string) => boolean;
    initialExpanded?: boolean;
    setIsMobileMenuOpen: (isOpen: boolean) => void;
    isAuthenticated: boolean;
}> = memo(
    ({
        item,
        depth = 0,
        isActive,
        initialExpanded = false,
        setIsMobileMenuOpen,
        isAuthenticated,
    }) => {
        const [isExpanded, setIsExpanded] = useState(initialExpanded);
        const [showTooltip, setShowTooltip] = useState(false);
        const hasChildren = item.children && item.children.length > 0;
        const isItemActive = isActive(item.path);
        const hasActiveChild = hasChildren
            ? item.children!.some((child) => isActive(child.path))
            : false;
        const isDisabled = item.requiresAuth && !isAuthenticated;

        // Update expanded state when initialExpanded prop changes
        useEffect(() => {
            setIsExpanded(initialExpanded);
        }, [initialExpanded]);

        const toggleExpanded = useCallback(() => {
            if (isDisabled) return;
            setIsExpanded((prev) => !prev);
        }, [isDisabled]);

        const handleMouseEnter = useCallback(() => {
            if (isDisabled) {
                setShowTooltip(true);
            }
        }, [isDisabled]);

        const handleMouseLeave = useCallback(() => {
            setShowTooltip(false);
        }, []);

        if (!hasChildren) {
            // Regular link
            return (
                <div
                    className="mb-2 relative"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    {isDisabled ? (
                        <div
                            className={`
                            block px-4 py-2
                            transition-all duration-200 ease-in-out
                            transform hover:scale-105 border
                            section-split-effect text-right
                            border-dark-border bg-dark opacity-50 cursor-not-allowed
                        `}
                        >
                            {item.label}
                        </div>
                    ) : (
                        <Link
                            to={item.path}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`
                            block px-4 py-2
                            transition-all duration-200 ease-in-out
                            transform hover:scale-105 border
                            section-split-effect text-right
                            ${
                                isActive(item.path)
                                    ? 'bg-primary hover:bg-primary-hover text-dark border-primary hover:border-primary-hover'
                                    : 'border-dark-border bg-dark'
                            }
                        `}
                        >
                            {item.label}
                        </Link>
                    )}
                    <Tooltip
                        isVisible={showTooltip}
                        className="bg-dark border border-dark-border p-2 rounded"
                    >
                        Login to access this feature
                    </Tooltip>
                </div>
            );
        }

        // Expandable menu item
        return (
            <div
                className="mb-2 relative"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <button
                    onClick={toggleExpanded}
                    type="button"
                    disabled={isDisabled}
                    className={`
                    w-[calc(100%-6px)] px-4 py-2 max-w-full
                    transition-all duration-200 ease-in-out
                    transform hover:scale-105 border
                    section-split-effect text-right flex justify-between items-center
                    ${
                        isDisabled
                            ? 'border-dark-border bg-dark opacity-50 cursor-not-allowed'
                            : isItemActive || hasActiveChild
                              ? 'bg-primary hover:bg-primary-hover text-dark border-primary hover:border-primary-hover'
                              : 'border-dark-border bg-dark'
                    }
                `}
                >
                    <ChevronDownIcon
                        className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                    <span>{item.label}</span>
                </button>

                <CollapsibleSection isOpen={isExpanded}>
                    {item.children!.map((child) => (
                        <NavigationItem
                            key={child.path}
                            item={child}
                            depth={depth + 1}
                            isActive={isActive}
                            initialExpanded={
                                isActive(child.path) ||
                                (child.children &&
                                    child.children.some((grandchild) => isActive(grandchild.path)))
                            }
                            setIsMobileMenuOpen={setIsMobileMenuOpen}
                            isAuthenticated={isAuthenticated}
                        />
                    ))}
                </CollapsibleSection>
                <Tooltip
                    isVisible={showTooltip}
                    className="bg-dark border border-dark-border p-2 rounded"
                >
                    Login to access this feature
                </Tooltip>
            </div>
        );
    }
);
NavigationItem.displayName = 'NavigationItem';

export const Sidebar: React.FC = () => {
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { user } = useAuth();

    // Memoize the isActive function to maintain stable reference
    const isActive = useCallback((path: string) => location.pathname === path, [location.pathname]);

    // Check if an item or any of its children is active
    const isActiveOrHasActiveChild = useCallback(
        (item: NavigationItem): boolean => {
            if (isActive(item.path)) return true;
            if (item.children) {
                return item.children.some((child) => location.pathname === child.path);
            }
            return false;
        },
        [isActive, location.pathname]
    );

    // Public navigation items
    const publicNavigationLinks = useMemo<NavigationItem[]>(
        () => [
            { path: '/', label: 'Home' },
            {
                path: '/manager',
                label: 'Manager',
                children: [
                    { path: '/ships', label: 'Ships' },
                    { path: '/gear', label: 'Gear' },
                    { path: '/loadouts', label: 'Loadouts' },
                    { path: '/engineering', label: 'Engineering' },
                    { path: '/simulation', label: 'Simulation' },
                    { path: '/autogear', label: 'Autogear' },
                    { path: '/encounters', label: 'Encounters' },
                ],
            },
            {
                path: '/calculators',
                label: 'Calculators',
                children: [
                    { path: '/defense', label: 'Defense Calculator' },
                    { path: '/damage', label: 'Damage Calculator' },
                    { path: '/healing', label: 'Healing Calculator' },
                    { path: '/damage-deconstruction', label: 'Hit Deconstruction' },
                    { path: '/json-diff', label: 'JSON Diff Calculator' },
                ],
            },
            { path: '/ships/index', label: 'Ship Database' },
            { path: '/implants', label: 'Implants' },
            { path: '/shared-encounters', label: 'Shared Encounters' },
            { path: '/documentation', label: 'Help' },
        ],
        []
    );

    // Combine navigation links
    const navigationLinks = useMemo(() => {
        return [...publicNavigationLinks];
    }, [publicNavigationLinks]);

    const SidebarContent = memo(() => (
        <div className="space-y-2 flex flex-col h-full">
            <span className="text-xs text-gray-400 hidden lg:block">v{CURRENT_VERSION}</span>
            <h1 className=" text-xl font-bold mb-8 hidden lg:flex gap-2 items-center">
                <img src={logo} alt="logo" className="w-8 h-8" />
                {APP_NAME}
            </h1>

            <nav className="space-y-2 h-[calc(100vh-100px)] overflow-y-auto w-[calc(100%+24px)] px-[12px] translate-x-[-12px] pt-[4px] translate-y-[-4px]">
                {navigationLinks.map((item) => (
                    <NavigationItem
                        key={item.path}
                        item={item}
                        isActive={isActive}
                        initialExpanded={item.children && isActiveOrHasActiveChild(item)}
                        setIsMobileMenuOpen={setIsMobileMenuOpen}
                        isAuthenticated={!!user}
                    />
                ))}
            </nav>

            <div className="!mt-auto flex flex-col gap-2 pt-2">
                <ImportButton className="w-full text-right" />
                <LoginButton />
            </div>
        </div>
    ));
    SidebarContent.displayName = 'SidebarContent';

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
                    <span className="text-xs text-gray-400">v{CURRENT_VERSION}</span>
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
                scrollable={false}
            >
                <SidebarContent />
            </Offcanvas>
        </>
    );
};
