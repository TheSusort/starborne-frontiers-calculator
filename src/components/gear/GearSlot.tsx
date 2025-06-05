import { memo } from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GearSetName, GearSlotName, RARITIES, STATS } from '../../constants';
import { Button, Tooltip, CloseIcon } from '../ui';
import { GearPieceDisplay } from './GearPieceDisplay';
import { ImplantName, IMPLANTS } from '../../constants/implants';
import { Image } from '../ui/Image';
interface GearSlotProps {
    slotKey: GearSlotName;
    gear?: GearPiece;
    hoveredGear: GearPiece | null;
    onSelect?: (slot: GearSlotName) => void;
    onRemove?: (slot: GearSlotName) => void;
    onHover: (gear: GearPiece | null) => void;
}

export const GearSlot: React.FC<GearSlotProps> = memo(
    ({ slotKey, gear, hoveredGear, onSelect, onRemove, onHover }) => {
        const isImplant = gear?.slot.startsWith('implant_');
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
                            {isImplant && (
                                <Image
                                    src={IMPLANTS[gear.setBonus as ImplantName].imageKey as string}
                                    alt={IMPLANTS[gear.setBonus as ImplantName].name}
                                    className="w-5"
                                />
                            )}
                            {!isImplant && (
                                <img
                                    src={GEAR_SETS[gear.setBonus as GearSetName]?.iconUrl as string}
                                    alt={gear.setBonus as string}
                                    className="w-5"
                                />
                            )}
                        </div>
                        {/* main stat and stars */}

                        {!isImplant && (
                            <>
                                <div className="text-xs  font-bold">
                                    {gear.mainStat && STATS[gear.mainStat.name].shortLabel}
                                    {gear.mainStat && gear.mainStat.type === 'percentage'
                                        ? '%'
                                        : ''}
                                </div>
                                <span className="text-xs text-yellow-400 absolute top-1 right-1 text-center">
                                    ★ {gear.stars}
                                </span>
                            </>
                        )}

                        {/* Remove Button */}
                        {onRemove && (
                            <Button
                                aria-label="Remove gear piece"
                                variant="danger"
                                size="sm"
                                onClick={() => onRemove(slotKey)}
                                className="!absolute -top-2 -right-2 rounded-full hidden group-hover:block"
                            >
                                <CloseIcon />
                            </Button>
                        )}
                    </div>

                    <Tooltip isVisible={hoveredGear === gear}>
                        <GearPieceDisplay gear={gear} className="min-w-[230px]" />
                    </Tooltip>
                </div>
            );
        }

        return (
            <Button
                variant="secondary"
                aria-label="Equip gear piece"
                onClick={() => onSelect && onSelect(slotKey)}
                className="w-16 h-16 bg-dark-lighter border border-dark-border flex items-center justify-center hover:bg-dark-border transition-colors"
            >
                <span className="text-xs text-gray-400 capitalize">equip</span>
            </Button>
        );
    }
);

GearSlot.displayName = 'GearSlot';
