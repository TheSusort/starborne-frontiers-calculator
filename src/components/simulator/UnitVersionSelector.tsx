import React, { useEffect, useMemo, useState } from 'react';
import { Ship } from '../../types/ship';
import { useShips } from '../../contexts/ShipsContext';
import { useShipsData } from '../../hooks/useShipsData';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/layout/Modal';
import { Loader } from '../ui/Loader';
import { ShipDisplay } from '../ship/ShipDisplay';
import {
    canBeFullyRefitted,
    referenceShip,
    ReferenceVariant,
} from '../../utils/ship/referenceShip';

interface UnitVersionSelectorProps {
    /** Fires with the chosen version, already resolved to a Ship. */
    onSelect: (ship: Ship) => void;
    /** Fires when the picker is dismissed at either step. */
    onClose: () => void;
}

/**
 * Two-step picker for a simulator board cell: any unit in the game, then a version of it.
 *
 * Mount/unmount drives the modal, matching `ShipSelector`'s contract — the caller mounts this
 * only while a cell is selected, and `onClose` is what unmounts it.
 *
 * Step 2's owned branch is a LIST: a player can own no copy of a unit, or several.
 */
export const UnitVersionSelector: React.FC<UnitVersionSelectorProps> = ({ onSelect, onClose }) => {
    const { ships: ownedShips } = useShips();
    const { ships: units, loading, error, getAscensionStats } = useShipsData();
    const [search, setSearch] = useState('');
    const [unit, setUnit] = useState<Ship | null>(null);

    // Re-focus the search when stepping back, so the keyboard path is unbroken.
    useEffect(() => {
        if (!unit) setSearch('');
    }, [unit]);

    const ownedByName = useMemo(() => {
        const map = new Map<string, Ship[]>();
        for (const ship of ownedShips) {
            const key = ship.name.toLowerCase();
            map.set(key, [...(map.get(key) ?? []), ship]);
        }
        return map;
    }, [ownedShips]);

    const matches = useMemo(() => {
        const term = search.toLowerCase();
        return units
            .filter((candidate) => candidate.name.toLowerCase().includes(term))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [units, search]);

    const ownedCopies = unit ? (ownedByName.get(unit.name.toLowerCase()) ?? []) : [];
    const ascensionStats = unit ? getAscensionStats(unit.id) : null;

    const referenceVersions: Array<{ variant: ReferenceVariant; label: string }> = [
        { variant: 'r0', label: 'R0 level 60' },
        ...(canBeFullyRefitted(ascensionStats)
            ? [{ variant: 'refitted' as const, label: 'Fully refitted' }]
            : []),
    ];

    const pick = (ship: Ship) => {
        onSelect(ship);
        onClose();
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={unit ? `Select a version of ${unit.name}` : 'Select a unit'}
            headerActions={
                unit ? (
                    <Button variant="secondary" size="sm" onClick={() => setUnit(null)}>
                        Back
                    </Button>
                ) : undefined
            }
            fullHeight
        >
            {unit ? (
                <div className="space-y-4">
                    {ownedCopies.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold text-theme-text">Your ships</h3>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {ownedCopies.map((ship) => (
                                    <ShipDisplay
                                        key={ship.id}
                                        ship={ship}
                                        variant="compact"
                                        onClick={() => pick(ship)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-theme-text">Reference</h3>
                        <p className="text-xs text-theme-text-secondary">
                            A reference version carries no gear, so the fight shows what the unit
                            itself does. Your engineering bonuses still apply.
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {referenceVersions.map(({ variant, label }) => {
                                const built = referenceShip(unit, variant, ascensionStats);
                                return (
                                    <ShipDisplay
                                        key={variant}
                                        ship={built}
                                        variant="compact"
                                        onClick={() => pick(built)}
                                    >
                                        <span className="text-xs text-primary">{label}</span>
                                    </ShipDisplay>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <Input
                        className="mb-4"
                        placeholder="Search units"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                    />
                    {loading && <Loader />}
                    {/* An empty list after a failed fetch is not an empty SEARCH — saying "no
                        matches" there sends the player looking for a typo that is not theirs. */}
                    {!loading && error && units.length === 0 && (
                        <p className="text-red-400">
                            The unit list could not be loaded. Check your connection and reopen this
                            picker.
                        </p>
                    )}
                    {!loading && !error && matches.length === 0 && (
                        <p>No units match that search</p>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {matches.map((candidate) => (
                            <ShipDisplay
                                key={candidate.id}
                                ship={candidate}
                                variant="compact"
                                onClick={() => setUnit(candidate)}
                            >
                                {ownedByName.has(candidate.name.toLowerCase()) && (
                                    <span className="text-xs text-primary">Owned</span>
                                )}
                            </ShipDisplay>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );
};
