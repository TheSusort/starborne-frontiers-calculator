import React, { useState, useEffect, useMemo } from 'react';
import { Ship } from '../../types/ship';
import { useShips } from '../../contexts/ShipsContext';
import { Button, Input, Modal } from '../ui';
import { ShipDisplay } from './ShipDisplay';
import { RARITY_ORDER, SHIP_TYPES, FACTIONS } from '../../constants';

interface ShipSelectorProps {
    selected: Ship | null;
    onSelect: (ship: Ship) => void;
    variant?: 'compact' | 'full' | 'extended';
    children?: React.ReactNode;
    autoOpen?: boolean;
    onClose?: () => void;
    hidden?: boolean;
}

export const ShipSelector: React.FC<ShipSelectorProps> = ({
    selected,
    onSelect,
    variant = 'compact',
    children,
    autoOpen,
    onClose,
    hidden = false,
}) => {
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const { ships } = useShips();
    const [search, setSearch] = useState('');

    const sortConfig = useMemo(() => {
        try {
            const saved = localStorage.getItem('ship-inventory-filters');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.sort?.field && parsed.sort?.direction) {
                    return parsed.sort as { field: string; direction: 'asc' | 'desc' };
                }
            }
        } catch {
            // ignore parse errors
        }
        return { field: 'name', direction: 'asc' as const };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isShipModalOpen]); // re-read when modal opens

    useEffect(() => {
        if (autoOpen) {
            setIsShipModalOpen(true);
        }
    }, [autoOpen]);

    return (
        <div className="space-y-4">
            {selected && !hidden ? (
                <ShipDisplay
                    ship={selected}
                    variant={variant}
                    onClick={() => setIsShipModalOpen(true)}
                >
                    {children}
                </ShipDisplay>
            ) : hidden ? null : (
                <Button
                    aria-label="Select a Ship"
                    variant="secondary"
                    onClick={() => setIsShipModalOpen(true)}
                    className="min-h-[70px]"
                    fullWidth
                >
                    {selected ? 'Select another Ship' : 'Select a Ship'}
                </Button>
            )}

            <Modal
                isOpen={isShipModalOpen}
                onClose={() => {
                    setIsShipModalOpen(false);
                    onClose?.();
                }}
                title="Select a Ship"
                fullHeight
            >
                <Input
                    className="mb-4"
                    placeholder="Search ships"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {ships.length === 0 && <p>No ships available</p>}
                    {ships
                        .filter((ship) => ship.name.toLowerCase().includes(search.toLowerCase()))
                        .sort((a, b) => {
                            const dir = sortConfig.direction === 'asc' ? 1 : -1;
                            switch (sortConfig.field) {
                                case 'name':
                                    return dir * (a.name || '').localeCompare(b.name || '');
                                case 'level':
                                    return dir * ((a.level || 0) - (b.level || 0));
                                case 'type':
                                    return (
                                        dir *
                                        (SHIP_TYPES[a.type]?.name || '').localeCompare(
                                            SHIP_TYPES[b.type]?.name || ''
                                        )
                                    );
                                case 'faction':
                                    return (
                                        dir *
                                        (FACTIONS[a.faction]?.name || '').localeCompare(
                                            FACTIONS[b.faction]?.name || ''
                                        )
                                    );
                                case 'rarity':
                                    return (
                                        dir *
                                        (RARITY_ORDER.indexOf(b.rarity) -
                                            RARITY_ORDER.indexOf(a.rarity))
                                    );
                                case 'gearCount': {
                                    const aCount = Object.values(a.equipment).filter(
                                        Boolean
                                    ).length;
                                    const bCount = Object.values(b.equipment).filter(
                                        Boolean
                                    ).length;
                                    return dir * (aCount - bCount);
                                }
                                default: {
                                    // Fall back to level desc, then refits desc
                                    const levelDiff = (b.level || 0) - (a.level || 0);
                                    if (levelDiff !== 0) return levelDiff;
                                    return (b.refits?.length || 0) - (a.refits?.length || 0);
                                }
                            }
                        })
                        .map((ship) => (
                            <ShipDisplay
                                key={ship.id}
                                ship={ship}
                                variant="compact"
                                selected={selected?.id === ship.id}
                                onClick={() => {
                                    onSelect(ship);
                                    setIsShipModalOpen(false);
                                }}
                            />
                        ))}
                </div>
            </Modal>
        </div>
    );
};
