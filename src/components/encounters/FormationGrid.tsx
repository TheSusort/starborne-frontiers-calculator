import React from 'react';
import { Position, ShipPosition, SharedShipPosition } from '../../types/encounters';
import { useShips } from '../../contexts/ShipsContext';
import { HexButton } from '../ui/HexButton';

interface FormationGridProps {
    formation: ShipPosition[] | SharedShipPosition[];
    onPositionSelect?: (position: Position) => void;
    selectedPosition?: Position;
    onRemoveShip?: (position: Position) => void;
}

const FormationGrid: React.FC<FormationGridProps> = ({
    formation,
    onPositionSelect,
    selectedPosition,
    onRemoveShip,
}) => {
    const { ships } = useShips();
    const rows: Position[][] = [
        ['T1', 'T2', 'T3', 'T4'],
        ['M1', 'M2', 'M3', 'M4'],
        ['B1', 'B2', 'B3', 'B4'],
    ];

    const getShipForPosition = (pos: Position) => {
        const shipPosition = formation.find((ship) => ship.position === pos);
        if (!shipPosition) return null;
        if ('shipId' in shipPosition) {
            return ships.find((ship) => ship.id === shipPosition.shipId);
        }
        return { name: (shipPosition as SharedShipPosition).shipName };
    };

    return (
        <div className="grid p-4 py-6 ml-[9.5%] !mt-auto" role="grid">
            {rows.map((row, rowIndex) => (
                <div
                    key={rowIndex}
                    className={`grid grid-cols-4 ${rowIndex === 1 ? 'ml-[-12.5%] mr-[12.5%]' : ''}`}
                >
                    {row.map((pos) => {
                        const ship = getShipForPosition(pos as Position);
                        return (
                            <HexButton
                                key={pos}
                                onClick={(e) => {
                                    if (e.ctrlKey || e.metaKey) {
                                        onRemoveShip?.(pos as Position);
                                    } else {
                                        onPositionSelect?.(pos as Position);
                                    }
                                }}
                                isActive={!!ship}
                                isSelected={selectedPosition === pos}
                            >
                                <div className="flex flex-col items-center">
                                    <span className="text-xs ">{pos}</span>
                                    {ship && (
                                        <>
                                            <span className="text-white text-xs mt-1 px-1 truncate max-w-full">
                                                {ship.name}
                                            </span>
                                            {'refits' in ship && ship.refits && (
                                                <span className="flex items-center gap-1">
                                                    {Array.from({ length: 6 }, (_, index) => (
                                                        <span
                                                            key={index}
                                                            className={`text-xs tracking-tightest ${index < ship.refits.length ? 'text-yellow-400' : 'text-gray-300'}`}
                                                        >
                                                            ★
                                                        </span>
                                                    ))}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            </HexButton>
                        );
                    })}
                </div>
            ))}
            {onRemoveShip && (
                <div className="text-xs text-gray-400 mt-6">Tip: Ctrl+Click to remove a ship</div>
            )}
        </div>
    );
};

export default FormationGrid;
