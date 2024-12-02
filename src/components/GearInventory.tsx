import React from 'react';
import { GearPiece } from '../types/gear';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button } from './ui/Button';

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
    return (
        <div className="space-y-6">
            <h3 className="text-2xl font-bold text-gray-200">Inventory</h3>
            
            {inventory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter rounded-lg border-2 border-dashed border-gray-700">
                    No gear pieces added yet
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inventory.map(piece => (
                        <div key={piece.id} className="relative flex flex-col">
                            <GearPieceDisplay gear={piece} />
                            <div className="p-4">
                                {mode === 'manage' ? (
                                    <div className="flex gap-2">
                                        {onEdit && (
                                            <Button 
                                                variant="primary" 
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
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                </svg>
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
            )}
        </div>
    );
}; 