import React, { useState, useEffect, useCallback, memo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, CURRENT_VERSION } from '../../../constants';
import { Offcanvas } from './Offcanvas';
import logo from '/favicon.ico?url';
import { LoginButton } from '../../auth/LoginButton';
import { MenuIcon } from '../icons/MenuIcon';
import { ChevronDownIcon } from '../icons/ChevronIcons';

// Define the type for navigation items
type NavigationItem = {
    path: string;
    label: string;
    children?: NavigationItem[];
};

// Simple collapsible component wrapped in memo to prevent unnecessary re-renders
const CollapsibleSection: React.FC<{
    isOpen: boolean;
    children: React.ReactNode;
}> = memo(({ isOpen, children }) => {
    return (
        <div
            className="transition-all duration-300 ease-in-out"
            style={{
                maxHeight: isOpen ? '1000px' : '0',
                opacity: isOpen ? 1 : 0,
                padding: isOpen ? '8px 0' : '0',
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
}> = memo(({ item, depth = 0, isActive, initialExpanded = false, setIsMobileMenuOpen }) => {
    const [isExpanded, setIsExpanded] = useState(initialExpanded);
    const hasChildren = item.children && item.children.length > 0;
    const isItemActive = isActive(item.path);
    const hasActiveChild = hasChildren
        ? item.children!.some((child) => isActive(child.path))
        : false;

    // Update expanded state when initialExpanded prop changes
    useEffect(() => {
        setIsExpanded(initialExpanded);
    }, [initialExpanded]);

    const toggleExpanded = useCallback(() => {
        setIsExpanded((prev) => !prev);
    }, []);

    if (!hasChildren) {
        // Regular link
        return (
            <div className="mb-2">
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
            </div>
        );
    }

    // Expandable menu item
    return (
        <div className="mb-2 relative">
            <button
                onClick={toggleExpanded}
                type="button"
                className={`
                    w-[calc(100%-6px)] px-4 py-2 max-w-full
                    transition-all duration-200 ease-in-out
                    transform hover:scale-105 border
                    section-split-effect text-right flex justify-between items-center
                    ${
                        isItemActive || hasActiveChild
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
                    />
                ))}
            </CollapsibleSection>
        </div>
    );
});
NavigationItem.displayName = 'NavigationItem';

export const Sidebar: React.FC = () => {
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

    // Hierarchical navigation structure
    const navigationLinks: NavigationItem[] = [
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
        { path: '/ships/index', label: 'Ship Database' },
        { path: '/shared-encounters', label: 'Shared Encounters' },
        {
            path: '/calculators',
            label: 'Calculators',
            children: [
                { path: '/defense', label: 'Defense Calculator' },
                { path: '/damage', label: 'Damage Calculator' },
                { path: '/healing', label: 'Healing Calculator' },
                { path: '/damage-deconstruction', label: 'Hit Deconstruction' },
            ],
        },
    ];

    const SidebarContent = memo(() => (
        <div className="space-y-2 flex flex-col h-full">
            <span className="text-xs text-gray-400 hidden lg:block">{CURRENT_VERSION}</span>
            <h1 className=" text-xl font-bold mb-8 hidden lg:flex gap-2 items-center">
                <img src={logo} alt="logo" className="w-8 h-8" />
                {APP_NAME}
            </h1>

            <nav className="space-y-2">
                {navigationLinks.map((item) => (
                    <NavigationItem
                        key={item.path}
                        item={item}
                        isActive={isActive}
                        initialExpanded={item.children && isActiveOrHasActiveChild(item)}
                        setIsMobileMenuOpen={setIsMobileMenuOpen}
                    />
                ))}
            </nav>

            <div className="!mt-auto">
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
