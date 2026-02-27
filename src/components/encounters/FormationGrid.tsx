import React, { useMemo } from 'react';
import { Position, ShipPosition, SharedShipPosition } from '../../types/encounters';
import { useShips } from '../../contexts/ShipsContext';
import { HexButton } from '../ui/HexButton';
import { Ship } from '../../types/ship';
import { SHIPS } from '../../constants/ships';
import { SHIP_TYPES } from '../../constants/shipTypes';

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

    // Lookup map: ship name -> template data (for imageKey/affinity when not on imported ship)
    const templateByName = useMemo(() => {
        const map = new Map<string, (typeof SHIPS)[string]>();
        for (const template of Object.values(SHIPS)) {
            map.set(template.name.toLowerCase(), template);
        }
        return map;
    }, []);

    const getTemplateData = (shipName: string) => {
        return templateByName.get(shipName.toLowerCase());
    };

    const getShipForPosition = (pos: Position): Ship | { name: string } | null => {
        const shipPosition = formation.find((ship) => ship.position === pos);
        if (!shipPosition) return null;

        // Try to find the full ship in the user's local inventory
        const fullShip = ships.find((ship) => ship.id === shipPosition.shipId);
        if (fullShip) return fullShip;

        // For shared encounters, fall back to the ship name from the database
        const shared = shipPosition as SharedShipPosition;
        if (shared.shipName) {
            return { name: shared.shipName };
        }

        return null;
    };

    const isFullShip = (ship: Ship | { name: string }): ship is Ship => {
        return 'type' in ship;
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
                        const fullShip = ship && isFullShip(ship) ? ship : null;
                        const template = ship ? getTemplateData(ship.name) : null;
                        const rawImageKey = fullShip?.imageKey || template?.imageKey;
                        const imageKey = rawImageKey ? `${rawImageKey}_BigPortrait.jpg` : undefined;
                        const affinity =
                            fullShip?.affinity ||
                            (template?.affinity?.toLowerCase() as Ship['affinity']);
                        const rarity = fullShip?.rarity || template?.rarity?.toLowerCase();
                        const shipType = fullShip?.type || template?.role;
                        const roleIconUrl = shipType && SHIP_TYPES[shipType]?.iconUrl;
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
                                imageKey={imageKey}
                                affinity={affinity}
                                rarity={rarity}
                                roleIconUrl={roleIconUrl}
                            >
                                {ship ? (
                                    <div
                                        className="flex flex-col items-center justify-end w-full h-full
                    scale-[0.9151]"
                                    >
                                        {imageKey ? (
                                            <div
                                                className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-6 px-1 ${affinity ? 'pb-6' : 'pb-1 mb-1'}`}
                                            >
                                                <div className="flex flex-col items-center">
                                                    <span className="text-white text-xs font-bold leading-tight text-center max-w-full px-1">
                                                        {ship.name}
                                                    </span>
                                                    {fullShip && (
                                                        <span className="flex items-center">
                                                            {Array.from(
                                                                { length: 6 },
                                                                (_, index) => (
                                                                    <span
                                                                        key={index}
                                                                        className={`text-[0.55rem] ${index < (fullShip.refits?.length ?? 0) ? 'text-yellow-400' : fullShip.rank && index < fullShip.rank ? 'text-gray-300' : 'text-gray-500'}`}
                                                                    >
                                                                        ★
                                                                    </span>
                                                                )
                                                            )}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center">
                                                <span className="text-white text-xs mt-1 px-1 text-center max-w-full">
                                                    {ship.name}
                                                </span>
                                                {'refits' in ship && (
                                                    <span className="flex items-center gap-1">
                                                        {Array.from({ length: 6 }, (_, index) => (
                                                            <span
                                                                key={index}
                                                                className={`text-xs tracking-tightest ${index < (ship.refits?.length ?? 0) ? 'text-yellow-400' : 'rank' in ship && ship.rank && index < ship.rank ? 'text-gray-300' : 'text-gray-500'}`}
                                                            >
                                                                ★
                                                            </span>
                                                        ))}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-xs">{pos}</span>
                                )}
                            </HexButton>
                        );
                    })}
                </div>
            ))}
            {onRemoveShip && (
                <div className="text-xs text-gray-400 mt-10">
                    Click to select a ship, Ctrl+Click to remove a ship
                </div>
            )}
        </div>
    );
};

export default FormationGrid;
