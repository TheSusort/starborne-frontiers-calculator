import { memo, useMemo, useCallback, useState } from 'react';
import { GearPiece } from '../../types/gear';
import { Stat } from '../../types/stats';
import { GEAR_SETS, GEAR_SLOTS, IMPLANT_SLOTS, RARITIES } from '../../constants';
import { Button, CalibrationIcon, CheckIcon, CloseIcon, EditIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { StatDisplay } from '../stats/StatDisplay';
import { ImplantName } from '../../constants/implants';
import IMPLANTS from '../../constants/implants';
import { Image } from '../ui/Image';
import { Tooltip } from '../ui/layout/Tooltip';
import { useGearUpgrades } from '../../hooks/useGearUpgrades';
import {
    isCalibrationEligible,
    getCalibratedMainStat,
} from '../../utils/gear/calibrationCalculator';

interface Props {
    gear: GearPiece;
    showDetails?: boolean;
    mode?: 'manage' | 'select' | 'full' | 'compact' | 'subcompact';
    onRemove?: (id: string) => void;
    onEdit?: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    onCalibrate?: (piece: GearPiece) => void;
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
        onCalibrate,
        className = '',
        small = false,
    }: Props) => {
        const { getShipFromGearId, getShipById, gearToShipMap } = useShips();
        const { getUpgrade } = useGearUpgrades();

        // Use memoized map for O(1) lookup instead of searching through all ships
        const shipName = useMemo(() => {
            const shipId = gearToShipMap.get(gear.id);
            if (shipId) {
                const ship = getShipFromGearId(gear.id);
                return ship?.name;
            }
            return undefined;
        }, [gear.id, gearToShipMap, getShipFromGearId]);
        const isImplant = gear.slot.startsWith('implant_');
        const [showSetTooltip, setShowSetTooltip] = useState(false);
        const upgrade = getUpgrade(gear.id);
        const isMaxLevel = gear.level >= 16;

        // Memoize computed values
        const slotInfo = useMemo(() => GEAR_SETS[gear.setBonus || '']?.iconUrl, [gear.setBonus]);
        const rarityInfo = useMemo(() => RARITIES[gear.rarity], [gear.rarity]);
        const implantInfo = useMemo(() => IMPLANTS[gear.setBonus as ImplantName], [gear.setBonus]);
        const gearSetInfo = useMemo(
            () => (gear.setBonus ? GEAR_SETS[gear.setBonus] : null),
            [gear.setBonus]
        );

        // Calibration-related computed values
        const isCalibrated = !!gear.calibration?.shipId;
        const equippedShipId = gearToShipMap.get(gear.id);
        const isCalibrationActive =
            isCalibrated && equippedShipId && gear.calibration?.shipId === equippedShipId;
        const calibratedShipName = useMemo(() => {
            if (gear.calibration?.shipId) {
                const ship = getShipById(gear.calibration.shipId);
                return ship?.name;
            }
            return undefined;
        }, [gear.calibration?.shipId, getShipById]);
        const canCalibrate = isCalibrationEligible(gear);

        // Get the main stat to display - use calibrated if calibration is active
        const displayMainStat = useMemo(() => {
            if (!gear.mainStat) return null;
            if (isCalibrationActive && isCalibrationEligible(gear)) {
                return getCalibratedMainStat(gear);
            }
            return gear.mainStat;
        }, [gear, isCalibrationActive]);

        const handleRemove = useCallback(() => {
            onRemove?.(gear.id);
        }, [gear.id, onRemove]);

        const handleEdit = useCallback(() => {
            onEdit?.(gear);
        }, [gear, onEdit]);

        const handleEquip = useCallback(() => {
            onEquip?.(gear);
        }, [gear, onEquip]);

        const handleCalibrate = useCallback(() => {
            onCalibrate?.(gear);
        }, [gear, onCalibrate]);

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
                                    className={`h-auto translate-y-1 ${small ? 'min-w-4 w-4' : 'min-w-6 w-6'}`}
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
                                    {isCalibrated && (
                                        <div
                                            className="ps-2 text-cyan-400 flex items-center gap-1"
                                            title={`Calibrated to ${calibratedShipName}`}
                                        >
                                            <CalibrationIcon className="w-3 h-3" />
                                        </div>
                                    )}
                                </>
                            )}
                            {isImplant && mode !== 'subcompact' && (
                                <span className={`${small ? 'ps-6' : 'ps-8'} text-xs`}>
                                    {IMPLANT_SLOTS[gear.slot as keyof typeof IMPLANT_SLOTS]?.label}
                                </span>
                            )}
                        </div>
                    </div>
                    {mode === 'manage' ? (
                        <div className="flex gap-2">
                            {!isImplant && canCalibrate && onCalibrate && (
                                <Button
                                    aria-label={
                                        isCalibrated ? 'Recalibrate gear' : 'Calibrate gear'
                                    }
                                    title={isCalibrated ? 'Recalibrate gear' : 'Calibrate gear'}
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleCalibrate}
                                    className={isCalibrated ? 'text-cyan-400' : ''}
                                >
                                    <CalibrationIcon />
                                </Button>
                            )}
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
                                <div className="space-y-1">
                                    <StatDisplay
                                        stats={[gear.mainStat as Stat]}
                                        upgradedStats={
                                            isCalibrationActive && displayMainStat
                                                ? [displayMainStat as Stat]
                                                : upgrade?.mainStat && !isMaxLevel
                                                  ? [upgrade.mainStat as Stat]
                                                  : undefined
                                        }
                                    />
                                </div>
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
                                <div className="space-y-1">
                                    <StatDisplay
                                        stats={gear.subStats}
                                        upgradedStats={
                                            upgrade?.subStats && !isMaxLevel
                                                ? (upgrade.subStats as Stat[])
                                                : undefined
                                        }
                                    />
                                </div>
                            </div>
                        )}

                        {upgrade?.cost > 0 && !isMaxLevel && (
                            <div className="text-xs text-gray-400">
                                Upgrade cost:{' '}
                                {Intl.NumberFormat('en', { notation: 'compact' }).format(
                                    upgrade.cost
                                )}
                            </div>
                        )}

                        {shipName && mode !== 'subcompact' && (
                            <span className="text-xs !mt-auto pt-2"> Equipped by: {shipName}</span>
                        )}

                        {/* Calibration info */}
                        {isCalibrated && calibratedShipName && mode !== 'subcompact' && (
                            <div className="text-xs text-cyan-400 flex items-center gap-1 pt-1">
                                <CalibrationIcon className="w-3 h-3" />
                                <span>Calibrated to: {calibratedShipName}</span>
                            </div>
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

        // Compare calibration
        if (prevGear.calibration?.shipId !== nextGear.calibration?.shipId) {
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
