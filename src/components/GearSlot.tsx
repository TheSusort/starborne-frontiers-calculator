import { GearPiece } from '../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName, RARITIES } from '../constants';
import { memo } from 'react';
import { Button } from './ui/Button';
import { Tooltip } from './Tooltip';
import { CloseIcon } from './ui/CloseIcon';

interface GearSlotProps {
    slotKey: GearSlotName;
    slotData: typeof GEAR_SLOTS[GearSlotName];
    gear?: GearPiece;
    hoveredGear: GearPiece | null;
    onSelect?: (slot: GearSlotName) => void;
    onRemove?: (slot: GearSlotName) => void;
    onHover: (gear: GearPiece | null) => void;
}

export const GearSlot: React.FC<GearSlotProps> = memo(({
    slotKey,
    slotData,
    gear,
    hoveredGear,
    onSelect,
    onRemove,
    onHover
}) => {
    if (gear) {
        return (
            <div className="relative">
                <div
                    className={`w-16 h-16 bg-dark-lighter border ${RARITIES[gear.rarity].borderColor} relative group ${onSelect ? 'cursor-pointer' : ''} flex items-end justify-center`}
                    onClick={() => onSelect && onSelect(slotKey)}
                    onMouseEnter={() => onHover(gear)}
                    onMouseLeave={() => onHover(null)}
                >
                    {/* Gear display logic */}
                    <div className="absolute top-1 left-1">
                        <img
                            src={GEAR_SETS[gear.setBonus]?.iconUrl}
                            alt={gear.setBonus}
                            className="w-5"
                        />
                    </div>
                    {/* main stat and stars */}
                    <div className="text-xs text-white font-bold">
                        {gear.mainStat.name}
                        {gear.mainStat.type === 'percentage' ? "%" : ""}
                    </div>
                    <div className="absolute top-1 right-1 text-xs text-gray-400 capitalize text-center text-xs">
                        <span className="text-xs text-yellow-400">★ {gear.stars}</span>
                    </div>

                    {/* Remove Button */}
                    {onRemove && (
                        <Button
                            variant="danger"
                            onClick={() => onRemove && onRemove(slotKey)}
                            className="absolute -top-2 -right-2 rounded-full px-1 py-1 hidden group-hover:block"
                        >
                            <CloseIcon />
                        </Button>
                    )}
                </div>

                <Tooltip
                    gear={gear}
                    isVisible={hoveredGear === gear}
                />
            </div>
        );
    }

    return (
        <button
            onClick={() => onSelect && onSelect(slotKey)}
            className="w-16 h-16 bg-dark-lighter border border-dark-border flex items-center justify-center hover:bg-dark-border transition-colors"
        >
            <span className="text-xs text-gray-400 capitalize">equip</span>
        </button>
    );
});