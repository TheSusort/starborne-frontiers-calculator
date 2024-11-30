import React from 'react';
import { GearPiece } from '../types/gear';
import { GearPieceDisplay } from './GearPieceDisplay';

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
            <h3 className="text-2xl font-bold text-gray-800">Inventory</h3>
            
            {inventory.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed">
                    No gear pieces added yet
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inventory.map(piece => (
                        <div key={piece.id} className="relative">
                            <GearPieceDisplay gear={piece} />
                            <div className="p-4">
                                {mode === 'manage' ? (
                                    <div className="flex gap-2">
                                        {onEdit && (
                                            <button
                                                onClick={() => onEdit(piece)}
                                                className="text-blue-600 hover:text-blue-700"
                                            >
                                                Edit
                                            </button>
                                        )}
                                        {onRemove && (
                                            <button
                                                onClick={() => onRemove(piece.id)}
                                                className="text-red-600 hover:text-red-700"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    onEquip && (
                                        <button
                                            onClick={() => onEquip(piece)}
                                            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                        >
                                            Equip
                                        </button>
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