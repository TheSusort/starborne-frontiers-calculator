import React, { useState, useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, RARITIES } from '../../constants';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button } from '../ui';
import { CloseIcon } from '../ui/icons/CloseIcon';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { sortRarities } from '../../constants/rarities';

interface Props {
    inventory: GearPiece[];
    onRemove: (id: string) => void;
    onEdit: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    mode?: 'manage' | 'select';
}

export const GearInventory: React.FC<Props> = ({
    inventory,
    onRemove,
    onEdit,
    onEquip,
    mode = 'manage'
}) => {
    const [selectedSets, setSelectedSets] = useState<string[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    const hasActiveFilters = selectedSets.length > 0 || selectedTypes.length > 0 || selectedRarities.length > 0;

    const filteredInventory = useMemo(() => {
        return inventory.filter(piece => {
            const matchesSet = selectedSets.length === 0 || selectedSets.includes(piece.setBonus);
            const matchesType = selectedTypes.length === 0 || selectedTypes.includes(piece.slot);
            const matchesRarity = selectedRarities.length === 0 || selectedRarities.includes(piece.rarity);
            return matchesSet && matchesType && matchesRarity;
        });
    }, [inventory, selectedSets, selectedTypes, selectedRarities]);

    const uniqueSets = useMemo(() => {
        const sets = new Set(inventory.map(piece => piece.setBonus));
        return Array.from(sets).sort((a, b) => GEAR_SETS[a].name.localeCompare(GEAR_SETS[b].name));
    }, [inventory]);

    const uniqueTypes = useMemo(() => {
        const types = new Set(inventory.map(piece => piece.slot));
        return Array.from(types).sort((a, b) => GEAR_SLOTS[a].label.localeCompare(GEAR_SLOTS[b].label));
    }, [inventory]);

    const uniqueRarities = useMemo(() => {
        const rarities = new Set(inventory.map(piece => piece.rarity));
        return sortRarities(Array.from(rarities));
    }, [inventory]);

    const filters: FilterConfig[] = [
        {
            id: 'set',
            label: 'Sets',
            values: selectedSets,
            onChange: setSelectedSets,
            options: uniqueSets.map(set => ({
                value: set,
                label: GEAR_SETS[set].name
            }))
        },
        {
            id: 'type',
            label: 'Slots',
            values: selectedTypes,
            onChange: setSelectedTypes,
            options: uniqueTypes.map(type => ({
                value: type,
                label: GEAR_SLOTS[type].label
            }))
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: selectedRarities,
            onChange: setSelectedRarities,
            options: uniqueRarities.map(rarity => ({
                value: rarity,
                label: RARITIES[rarity].label
            }))
        }
    ];

    const clearFilters = () => {
        setSelectedSets([]);
        setSelectedTypes([]);
        setSelectedRarities([]);
    };

    return (
        <div className="space-y-6">
            <FilterPanel
                filters={filters}
                isOpen={isFilterOpen}
                onToggle={() => setIsFilterOpen(!isFilterOpen)}
                onClear={clearFilters}
                hasActiveFilters={hasActiveFilters}
            />

            {
                filteredInventory.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                        {inventory.length === 0 ? 'No gear pieces added yet' : 'No matching gear pieces found'}
                    </div>
                ) : (
                    <>
                        <span className="text-sm text-gray-400">
                            Showing {filteredInventory.length} gear pieces
                        </span>
                        <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${mode === 'manage' ? 'xl:grid-cols-4' : ''} gap-4`}>
                            {filteredInventory.map(piece => (
                                <div key={piece.id} className="relative flex flex-col">
                                    <GearPieceDisplay gear={piece} />
                                    <div className="py-4">
                                        {mode === 'manage' ? (
                                            <div className="flex gap-2">
                                                {onEdit && (
                                                    <Button
                                                        className="border-dark"
                                                        variant="secondary"
                                                        fullWidth
                                                        onClick={() => onEdit(piece)}
                                                    >
                                                        Edit
                                                    </Button>
                                                )}
                                                {onRemove && (
                                                    <Button
                                                        variant="danger"
                                                        onClick={() => onRemove(piece.id)}
                                                    >
                                                        <CloseIcon />
                                                    </Button>
                                                )}
                                            </div>
                                        ) : (
                                            onEquip && (
                                                <Button
                                                    variant="primary"
                                                    fullWidth
                                                    onClick={() => onEquip(piece)}
                                                >
                                                    Equip
                                                </Button>
                                            )
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )
            }
        </div>
    );
};