import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { SearchInput } from '../ui/SearchInput';
import { Select } from '../ui/Select';
import { FACTION_NAMES, FACTIONS, getFaction } from '../../constants/factions';
import { getRarity } from '../../constants/rarities';
import type { Ship } from '../../types/ship';
import { filterFleet, orderFleet } from './ships/fleetOrder';
import { useShipVisuals } from './ships/useShipVisuals';
import type { ShipVisual } from './ships/shipVisuals';

/** Minimum horizontal pointer travel, in px, that counts as a swipe. */
const SWIPE_THRESHOLD_PX = 40;

const FACTION_OPTIONS = [
    { value: '', label: 'All factions' },
    ...FACTION_NAMES.map((k) => ({ value: k, label: FACTIONS[k].name })),
];

interface FighterSelectProps {
    ships: Ship[];
    initialShipId: string | null;
    onLaunch: (ship: Ship) => void;
    onQuit: () => void;
    /** Draws the selected ship; defaults to its portrait. */
    renderShip?: (ship: Ship, visual: ShipVisual) => React.ReactNode;
}

export const PortraitView: React.FC<{ ship: Ship; visual: ShipVisual }> = ({ ship, visual }) =>
    visual.portraitUrl ? (
        <img
            src={visual.portraitUrl}
            alt={ship.name}
            className="h-48 mx-auto object-contain"
            draggable={false}
        />
    ) : (
        <div className="h-48 flex items-center justify-center bg-dark-lighter text-theme-text-secondary">
            {ship.name}
        </div>
    );

/**
 * Browsing keys are skipped while a text field or a dropdown trigger has focus, so typing and
 * dropdown navigation are untouched; Enter is also left to a focused button's own click.
 */
const keyBelongsToFocus = (key: string): boolean => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    if (el.closest('[role=combobox], [aria-haspopup]')) return true;
    return key === 'Enter' && el.tagName === 'BUTTON';
};

export const FighterSelect: React.FC<FighterSelectProps> = ({
    ships,
    initialShipId,
    onLaunch,
    onQuit,
    renderShip,
}) => {
    const visualOf = useShipVisuals();
    const [query, setQuery] = useState('');
    const [faction, setFaction] = useState('');
    const [index, setIndex] = useState(0);
    const swipeStartRef = useRef<number | null>(null);

    const ordered = useMemo(() => orderFleet(ships, initialShipId), [ships, initialShipId]);
    const visible = useMemo(() => filterFleet(ordered, query, faction), [ordered, query, faction]);
    const current = visible.length > 0 ? visible[Math.min(index, visible.length - 1)] : null;

    useEffect(() => {
        setIndex(0);
    }, [query, faction]);

    const browse = (delta: number) => {
        if (visible.length === 0) return;
        setIndex(
            (i) => (Math.min(i, visible.length - 1) + delta + visible.length) % visible.length
        );
    };

    const launch = () => {
        if (current) onLaunch(current);
    };

    // Window-level keys read the latest closure through refs so the listener binds once.
    const browseRef = useRef(browse);
    const launchRef = useRef(launch);
    browseRef.current = browse;
    launchRef.current = launch;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
            if (keyBelongsToFocus(e.key)) return;
            e.preventDefault();
            if (e.repeat && e.key === 'Enter') return;
            if (e.key === 'ArrowLeft') browseRef.current(-1);
            else if (e.key === 'ArrowRight') browseRef.current(1);
            else launchRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        swipeStartRef.current = e.clientX;
    };
    const onPointerUp = (e: React.PointerEvent) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (start === null) return;
        const dx = e.clientX - start;
        if (Math.abs(dx) > SWIPE_THRESHOLD_PX) browse(dx < 0 ? 1 : -1);
    };

    const rarity = current ? getRarity(current.rarity) : undefined;

    return (
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
            <div className="card hover:bg-dark w-full max-w-md max-h-full overflow-y-auto space-y-4 pointer-events-auto">
                <h2 className="text-xl font-semibold text-center">Choose your ship</h2>
                <SearchInput value={query} onChange={setQuery} placeholder="Search ships..." />
                <Select
                    aria-label="Faction"
                    options={FACTION_OPTIONS}
                    value={faction}
                    onChange={setFaction}
                />
                {current ? (
                    <>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => browse(-1)}
                                aria-label="Previous ship"
                            >
                                Previous
                            </Button>
                            <div
                                className="flex-1 min-w-0 touch-pan-y"
                                onPointerDown={onPointerDown}
                                onPointerUp={onPointerUp}
                                onPointerCancel={() => {
                                    swipeStartRef.current = null;
                                }}
                            >
                                {(
                                    renderShip ??
                                    ((ship, visual) => <PortraitView ship={ship} visual={visual} />)
                                )(current, visualOf(current))}
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => browse(1)}
                                aria-label="Next ship"
                            >
                                Next
                            </Button>
                        </div>
                        <div className="text-center space-y-1">
                            <p className="text-lg font-semibold">{current.name}</p>
                            <p className="text-sm text-theme-text-secondary">
                                {getFaction(current.faction)?.name ?? current.faction}
                            </p>
                            <p className="text-sm">
                                <span className={rarity?.textColor}>{rarity?.label}</span>
                                <span className="text-theme-text-secondary">
                                    {rarity ? ' · ' : ''}Level {current.level ?? '?'}
                                </span>
                            </p>
                            <p className="text-xs text-theme-text-secondary">
                                {Math.min(index, visible.length - 1) + 1} / {visible.length}
                            </p>
                        </div>
                    </>
                ) : (
                    <p className="text-center text-theme-text-secondary py-8">No ships match.</p>
                )}
                <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={onQuit}>
                        Quit
                    </Button>
                    <Button onClick={launch} disabled={!current}>
                        Launch
                    </Button>
                </div>
            </div>
        </div>
    );
};
