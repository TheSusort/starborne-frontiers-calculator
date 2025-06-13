import { memo, useMemo, useCallback, useState } from 'react';
import { GearPiece } from '../../types/gear';
import { Stat } from '../../types/stats';
import { GEAR_SETS, GEAR_SLOTS, IMPLANT_SLOTS, RARITIES } from '../../constants';
import { Button, CheckIcon, CloseIcon, EditIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { StatDisplay } from '../stats/StatDisplay';
import { ImplantName } from '../../constants/implants';
import IMPLANTS from '../../constants/implants';
import { Image } from '../ui/Image';
import { Tooltip } from '../ui/layout/Tooltip';

interface Props {
    gear: GearPiece;
    showDetails?: boolean;
    mode?: 'manage' | 'select' | 'full' | 'compact' | 'subcompact';
    onRemove?: (id: string) => void;
    onEdit?: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    className?: string;
    small?: boolean;
}

export const GearPieceDisplay = memo(
    ({
        gear,
        showDetails = true,
        mode = 'manage',
        onRemove,
        onEdit,
        onEquip,
        className = '',
        small = false,
    }: Props) => {
        const { getShipName, getShipFromGearId } = useShips();
        const shipName = gear?.shipId ? getShipName(gear.shipId) : getShipFromGearId(gear.id)?.name;
        const isImplant = gear.slot.startsWith('implant_');
        const [showSetTooltip, setShowSetTooltip] = useState(false);

        // Memoize computed values
        const slotInfo = useMemo(() => GEAR_SETS[gear.setBonus || '']?.iconUrl, [gear.setBonus]);
        const rarityInfo = useMemo(() => RARITIES[gear.rarity], [gear.rarity]);
        const implantInfo = useMemo(() => IMPLANTS[gear.setBonus as ImplantName], [gear.setBonus]);
        const gearSetInfo = useMemo(
            () => (gear.setBonus ? GEAR_SETS[gear.setBonus] : null),
            [gear.setBonus]
        );

        const handleRemove = useCallback(() => {
            onRemove?.(gear.id);
        }, [gear.id, onRemove]);

        const handleEdit = useCallback(() => {
            onEdit?.(gear);
        }, [gear, onEdit]);

        const handleEquip = useCallback(() => {
            onEquip?.(gear);
        }, [gear, onEquip]);

        if (!gear?.id) return null;
        return (
            <div
                className={`bg-dark shadow-md border ${rarityInfo.borderColor} overflow-hidden flex-grow flex flex-col ${className} ${small ? 'text-xs' : 'text-sm'}`}
            >
                {/* Header */}
                <div
                    className={`py-2 ${rarityInfo.textColor} ${mode === 'subcompact' && !showDetails ? '' : 'border-b ' + rarityInfo.borderColor} flex justify-between items-center ${small ? 'px-2' : 'px-4'}`}
                >
                    <div>
                        <div className="flex items-center gap-2">
                            {isImplant && implantInfo && implantInfo.imageKey && (
                                <Image
                                    src={implantInfo.imageKey}
                                    alt={IMPLANTS[gear.setBonus as ImplantName]?.name}
                                    className={`h-auto ${small ? 'min-w-4 w-4' : 'min-w-6 w-6 translate-y-1'}`}
                                />
                            )}
                            {!isImplant && slotInfo && (
                                <div className="relative">
                                    <img
                                        src={slotInfo}
                                        alt={GEAR_SETS[gear.setBonus || '']?.name}
                                        className={`h-auto ${small ? 'w-4' : 'w-6'} cursor-help`}
                                        onMouseEnter={() => setShowSetTooltip(true)}
                                        onMouseLeave={() => setShowSetTooltip(false)}
                                    />
                                    {gearSetInfo && (
                                        <Tooltip
                                            isVisible={showSetTooltip}
                                            className="bg-dark p-2 border border-dark-border min-w-[200px] text-gray-300"
                                        >
                                            <div className="space-y-2">
                                                <div className="font-semibold">
                                                    {gearSetInfo.name}
                                                </div>
                                                {typeof gearSetInfo.description === 'string' && (
                                                    <div className="text-sm bg-dark-lighter p-2">
                                                        {gearSetInfo.description}
                                                    </div>
                                                )}
                                                {gearSetInfo.stats &&
                                                    gearSetInfo.stats.length > 0 && (
                                                        <StatDisplay stats={gearSetInfo.stats} />
                                                    )}
                                                {gearSetInfo.minPieces && (
                                                    <div className="text-xs">
                                                        Requires {gearSetInfo.minPieces} pieces
                                                    </div>
                                                )}
                                            </div>
                                        </Tooltip>
                                    )}
                                </div>
                            )}
                            <span className={`font-secondary`}>
                                {isImplant
                                    ? IMPLANTS[gear.setBonus as ImplantName]?.name
                                    : GEAR_SLOTS[gear.slot]?.label}
                            </span>
                        </div>
                        <div className="flex items-center text-xs">
                            {!isImplant && (
                                <>
                                    <span className="text-yellow-400">★ {gear.stars}</span>
                                    <div className="ps-3">Lvl {gear.level}</div>
                                </>
                            )}
                            {isImplant && mode !== 'subcompact' && (
                                <span className="ps-8 text-xs">
                                    {IMPLANT_SLOTS[gear.slot as keyof typeof IMPLANT_SLOTS]?.label}
                                </span>
                            )}
                        </div>
                    </div>
                    {mode === 'manage' ? (
                        <div className="flex gap-2">
                            {!isImplant && onEdit && (
                                <Button
                                    aria-label="Edit gear piece"
                                    title="Edit gear piece"
                                    variant="secondary"
                                    size="sm"
                                    className="ms-auto"
                                    onClick={handleEdit}
                                >
                                    <EditIcon />
                                </Button>
                            )}
                            {onRemove && (
                                <Button
                                    aria-label="Remove gear piece"
                                    title="Remove gear piece"
                                    variant="danger"
                                    size="sm"
                                    onClick={handleRemove}
                                >
                                    <CloseIcon />
                                </Button>
                            )}
                        </div>
                    ) : (
                        onEquip && (
                            <Button
                                aria-label="Equip gear piece"
                                title="Equip gear piece"
                                variant="primary"
                                size="sm"
                                onClick={handleEquip}
                            >
                                <CheckIcon />
                            </Button>
                        )
                    )}
                </div>

                {showDetails && (
                    <div
                        className={`pb-2 flex-grow flex flex-col ${small ? 'p-2 space-y-2' : 'p-4 space-y-4'}`}
                    >
                        {/* Main Stat */}
                        {!isImplant && (
                            <div>
                                <div className={`text-gray-400 ${small ? 'text-xs' : 'mb-1'}`}>
                                    Main Stat
                                </div>
                                <StatDisplay stats={[gear.mainStat as Stat]} />
                            </div>
                        )}
                        {/* Implant Description */}
                        {isImplant &&
                            mode !== 'subcompact' &&
                            (gear.slot === 'implant_major' || gear.slot === 'implant_ultimate') && (
                                <div>
                                    <div className={`text-gray-400 ${small ? 'text-xs' : 'mb-1'}`}>
                                        Description
                                    </div>
                                    <div className="bg-dark-lighter py-1.5 px-3">
                                        {
                                            implantInfo?.variants.find(
                                                (variant) => variant.rarity === gear.rarity
                                            )?.description
                                        }
                                    </div>
                                </div>
                            )}

                        {/* Sub Stats */}
                        {gear.subStats.length > 0 && (
                            <div>
                                {mode !== 'subcompact' && (
                                    <div className="text-gray-400 mb-2">Sub Stats</div>
                                )}
                                <StatDisplay stats={gear.subStats} />
                            </div>
                        )}
                        {shipName && mode !== 'subcompact' && (
                            <span className="text-xs"> Equipped by: {shipName}</span>
                        )}
                    </div>
                )}
            </div>
        );
    },
    (prevProps, nextProps) => {
        // Compare IDs and display settings
        if (
            prevProps.gear.id !== nextProps.gear.id ||
            prevProps.mode !== nextProps.mode ||
            prevProps.showDetails !== nextProps.showDetails
        ) {
            return false;
        }

        // Compare gear properties
        const prevGear = prevProps.gear;
        const nextGear = nextProps.gear;

        if (
            prevGear.slot !== nextGear.slot ||
            prevGear.level !== nextGear.level ||
            prevGear.stars !== nextGear.stars ||
            prevGear.rarity !== nextGear.rarity ||
            prevGear.setBonus !== nextGear.setBonus ||
            prevGear.shipId !== nextGear.shipId
        ) {
            return false;
        }

        // Compare main stat
        if (
            prevGear.mainStat?.name !== nextGear.mainStat?.name ||
            prevGear.mainStat?.value !== nextGear.mainStat?.value ||
            prevGear.mainStat?.type !== nextGear.mainStat?.type
        ) {
            return false;
        }

        // Compare sub stats
        if (prevGear.subStats.length !== nextGear.subStats.length) {
            return false;
        }

        // If we've passed all the checks, the components are equal
        return true;
    }
);

GearPieceDisplay.displayName = 'GearPieceDisplay';
