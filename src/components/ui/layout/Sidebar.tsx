import React, { useState, useEffect, useCallback, memo, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import logo from '/favicon.ico?url';
import { Sun, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { LoginButton } from '../../auth/LoginButton';
import { MenuIcon } from '../icons/MenuIcon';
import { ChevronDownIcon } from '../icons';
import { APP_NAME, CURRENT_VERSION } from '../../../constants';
import { useAuth } from '../../../contexts/AuthProvider';
import { ImportButton } from '../../import/ImportButton';
import { isAdmin } from '../../../services/adminService';
import { useTheme } from '../../../contexts/ThemeContext';
import { Offcanvas } from './Offcanvas';
import { Tooltip } from './Tooltip';

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
        const tooltipRef = useRef<HTMLDivElement>(null);
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
                    ref={tooltipRef}
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
                                    ? 'text-primary after:bg-primary after:border-primary border-dark-border bg-dark/50'
                                    : 'border-dark-border bg-dark hover:after:border-r'
                            }
                        `}
                        >
                            {item.label}
                        </Link>
                    )}
                    <Tooltip
                        isVisible={showTooltip}
                        className="bg-dark border border-dark-border p-2"
                        targetElement={tooltipRef.current}
                    >
                        Login to access this feature
                    </Tooltip>
                </div>
            );
        }

        // Expandable menu item
        return (
            <div
                ref={tooltipRef}
                className="mb-2 relative"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <button
                    onClick={toggleExpanded}
                    disabled={isDisabled}
                    aria-disabled={isDisabled}
                    aria-expanded={isExpanded}
                    aria-label={`Toggle ${item.label} menu`}
                    className={`
                    w-[calc(100%-6px)] px-4 py-2 max-w-full
                    transition-all duration-200 ease-in-out
                    transform hover:scale-105 border
                    section-split-effect text-right flex justify-between items-center
                    ${
                        isDisabled
                            ? 'border-dark-border bg-dark opacity-50 cursor-not-allowed'
                            : isItemActive || hasActiveChild
                              ? 'text-primary after:bg-primary after:border-primary border-dark-border bg-dark'
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
                    className="bg-dark border border-dark-border p-2"
                    targetElement={tooltipRef.current}
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
    const [shareData, setShareData] = useState(false);
    const { user } = useAuth();
    const { theme, setTheme } = useTheme();
    const isSynthwave = theme === 'synthwave';
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const tracksRef = useRef<string[]>([]);
    const trackIndexRef = useRef(0);
    const [isUserAdmin, setIsUserAdmin] = useState(false);

    // Initialize audio with shuffled playlist
    useEffect(() => {
        const tracks = [
            '/audio/disco.mp3',
            '/audio/disco2.mp3',
            '/audio/disco3.mp3',
            '/audio/disco4.mp3',
        ];
        // Shuffle
        for (let i = tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        tracksRef.current = tracks;
        trackIndexRef.current = 0;

        const audio = new Audio(tracks[0]);
        audio.volume = 0.3;
        audio.addEventListener('ended', () => {
            trackIndexRef.current = (trackIndexRef.current + 1) % tracksRef.current.length;
            audio.src = tracksRef.current[trackIndexRef.current];
            void audio.play();
        });
        audioRef.current = audio;
        return () => {
            audio.pause();
            audio.removeEventListener('ended', () => {});
            audio.src = '';
        };
    }, []);

    // Pause music when leaving synthwave
    useEffect(() => {
        if (!isSynthwave && audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
        }
    }, [isSynthwave]);

    // Check if user is admin
    useEffect(() => {
        const checkAdmin = async () => {
            if (user?.id) {
                const adminStatus = await isAdmin(user.id);
                setIsUserAdmin(adminStatus);
            } else {
                setIsUserAdmin(false);
            }
        };
        void checkAdmin();
    }, [user?.id]);

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
    const publicNavigationLinks = useMemo<NavigationItem[]>(() => {
        const links = [
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
                    { path: '/statistics', label: 'Statistics' },
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
                    { path: '/recruitment', label: 'Beacon Calculator' },
                    { path: '/speed', label: 'Speed Calculator' },
                    { path: '/chrono-reaver', label: 'Chrono Reaver' },
                ],
            },
            {
                path: '/database',
                label: 'Database',
                children: [
                    { path: '/ships/index', label: 'Ships' },
                    { path: '/ships/lore', label: 'Lore' },
                    { path: '/implants', label: 'Implants' },
                    { path: '/buffs', label: 'Effects' },
                ],
            },
            { path: '/shared-encounters', label: 'Shared Encounters' },
            { path: '/documentation', label: 'Help' },
        ];

        // Add admin link only if user is admin
        if (isUserAdmin) {
            links.push({ path: '/admin', label: 'Admin Panel' });
        }

        return links;
    }, [isUserAdmin]);

    // Combine navigation links
    const navigationLinks = useMemo(() => {
        return [...publicNavigationLinks];
    }, [publicNavigationLinks]);

    // NOTE: renderSidebarContent is a plain JSX helper, not a React component.
    // Making it a component (`const X = memo(...)` inside this function) would
    // give it a new identity every render, which caused React to unmount and
    // remount every descendant — wiping local state like LoginButton's modal
    // open flag on any Sidebar re-render.
    const renderSidebarContent = () => (
        <div className="space-y-2 flex flex-col h-full">
            <div className="hidden lg:flex items-center justify-between">
                <span className="text-xs text-theme-text-secondary">v{CURRENT_VERSION}</span>
                <div className="flex items-center gap-2">
                    {isSynthwave && (
                        <button
                            onClick={() => {
                                if (audioRef.current) {
                                    if (isPlaying) {
                                        audioRef.current.pause();
                                    } else {
                                        void audioRef.current.play();
                                    }
                                    setIsPlaying(!isPlaying);
                                }
                            }}
                            className="text-xs text-theme-text-secondary hover:text-theme-text transition-colors"
                            title={isPlaying ? 'Pause music' : 'Play music'}
                        >
                            {isPlaying ? <Volume2 size={14} /> : <VolumeX size={14} />}
                        </button>
                    )}
                    <button
                        onClick={() => setTheme(theme === 'dark' ? 'synthwave' : 'dark')}
                        className="text-xs text-theme-text-secondary hover:text-theme-text transition-colors"
                        title={`Switch to ${theme === 'dark' ? 'Synthwave' : 'Dark'} theme`}
                    >
                        {theme === 'dark' ? <Sparkles size={14} /> : <Sun size={14} />}
                    </button>
                </div>
            </div>
            <Link to="/" data-sidebar-title>
                <h1
                    className={`${theme === 'synthwave' ? '' : 'text-xl'} font-bold mb-2 hidden lg:flex gap-2 items-center`}
                >
                    <img src={logo} alt="logo" className="w-8 h-8" />
                    {APP_NAME}
                </h1>
            </Link>

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
                <div data-tutorial="sidebar-import-button">
                    <ImportButton
                        className="w-full text-right"
                        shareData={shareData}
                        setShareData={setShareData}
                        testId="import-game-data-input"
                    />
                </div>
                <LoginButton />
            </div>
        </div>
    );

    return (
        <>
            {/* Mobile Header */}
            <div
                className={`lg:hidden fixed top-0 left-0 right-0 px-4 py-3 z-20 ${isSynthwave ? 'bg-black/90' : "bg-dark bg-[url('/images/Deep_crevasse_01.png')] bg-cover bg-center"}`}
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
                    <Link to="/" data-sidebar-title>
                        <h1 className="text-white text-xl font-bold flex items-center gap-2">
                            <img src={logo} alt="logo" className="w-8 h-8" />
                            {APP_NAME}
                        </h1>
                    </Link>
                    <div className="flex items-center gap-2">
                        {isSynthwave && (
                            <button
                                onClick={() => {
                                    if (audioRef.current) {
                                        if (isPlaying) {
                                            audioRef.current.pause();
                                        } else {
                                            void audioRef.current.play();
                                        }
                                        setIsPlaying(!isPlaying);
                                    }
                                }}
                                className="text-xs text-theme-text-secondary hover:text-theme-text transition-colors"
                                title={isPlaying ? 'Pause music' : 'Play music'}
                            >
                                {isPlaying ? <Volume2 size={14} /> : <VolumeX size={14} />}
                            </button>
                        )}
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'synthwave' : 'dark')}
                            className="text-xs text-theme-text-secondary hover:text-theme-text transition-colors"
                            title={`Switch to ${theme === 'dark' ? 'Synthwave' : 'Dark'} theme`}
                        >
                            {theme === 'dark' ? <Sparkles size={14} /> : <Sun size={14} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Desktop Sidebar */}
            <div
                data-testid="desktop-sidebar"
                className={`hidden lg:block fixed top-0 left-0 h-full w-64 z-20 ${isSynthwave ? 'bg-black/70 lg:backdrop-blur-sm' : "bg-dark bg-[url('/images/Deep_crevasse_01.png')] bg-cover bg-right"}`}
            >
                <div className="p-4 h-full">{renderSidebarContent()}</div>
            </div>

            {/* Mobile Offcanvas */}
            <Offcanvas
                isOpen={isMobileMenuOpen}
                onClose={() => setIsMobileMenuOpen(false)}
                position="left"
                width="w-72"
                hideCloseButton
                scrollable={false}
            >
                {renderSidebarContent()}
            </Offcanvas>
        </>
    );
};
