import React, { useState, useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { GearSetName, GearSlotName, GEAR_SETS, GEAR_SLOTS } from '../../constants';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button, Select } from '../ui';
import { CloseIcon } from '../ui/CloseIcon';
import { Offcanvas } from '../ui/Offcanvas';

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
    const [selectedSet, setSelectedSet] = useState<GearSetName | ''>('');
    const [selectedType, setSelectedType] = useState<GearSlotName | ''>('');
    const [isFilterOpen, setIsFilterOpen] = useState(false);

    const filteredInventory = useMemo(() => {
        return inventory.filter(piece => {
            const matchesSet = !selectedSet || piece.setBonus === selectedSet;
            const matchesType = !selectedType || piece.slot === selectedType;
            return matchesSet && matchesType;
        });
    }, [inventory, selectedSet, selectedType]);

    const uniqueSets = useMemo(() => {
        const sets = new Set(inventory.map(piece => piece.setBonus));
        return Array.from(sets);
    }, [inventory]);

    const uniqueTypes = useMemo(() => {
        const types = new Set(inventory.map(piece => piece.slot));
        return Array.from(types);
    }, [inventory]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-semibold text-gray-200">
                        Inventory ({filteredInventory.length})
                    </h3>
                    <Button variant="secondary" onClick={() => setIsFilterOpen(!isFilterOpen)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-filter"><path d="M21 21H3" /><path d="M10 6H21" /><path d="M15 12H21" /><path d="M8 18H21" /></svg>
                    </Button>
                </div>
            </div>

            <Offcanvas
                isOpen={isFilterOpen}
                onClose={() => setIsFilterOpen(false)}
                title="Filters"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Set
                        </label>
                        <Select
                            value={selectedSet}
                            onChange={(e) => setSelectedSet(e.target.value as GearSetName)}
                            className="w-full"
                            options={uniqueSets.map(set => ({ value: set, label: GEAR_SETS[set].name }))}
                            noDefaultSelection
                            defaultOption="All Sets"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Type
                        </label>
                        <Select
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value as GearSlotName)}
                            className="w-full"
                            options={uniqueTypes.map(type => ({ value: type, label: GEAR_SLOTS[type].label }))}
                            noDefaultSelection
                            defaultOption="All Types"
                        />
                    </div>

                    <div className="pt-4">
                        <Button
                            variant="secondary"
                            fullWidth
                            onClick={() => {
                                setSelectedSet('');
                                setSelectedType('');
                            }}
                        >
                            Clear Filters
                        </Button>
                    </div>
                </div>
            </Offcanvas>

            {
                filteredInventory.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                        {inventory.length === 0 ? 'No gear pieces added yet' : 'No matching gear pieces found'}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
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
                )
            }
        </div>
    );
};