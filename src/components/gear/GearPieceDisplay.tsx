import React, { memo, useMemo, useCallback, useState } from 'react';
import { GearPiece } from '../../types/gear';
import { Stat } from '../../types/stats';
import { GEAR_SETS, GEAR_SLOTS, IMPLANT_SLOTS, RARITIES } from '../../constants';
import { Button, CalibrationIcon, CheckIcon, CloseIcon, EditIcon, UnlockedLockIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { StatDisplay } from '../stats/StatDisplay';
import IMPLANTS, { ImplantName } from '../../constants/implants';
import { Image } from '../ui/Image';
import { Tooltip } from '../ui/layout/Tooltip';
import { useGearUpgrades } from '../../hooks/useGearUpgrades';
import {
    isCalibrationEligible,
    getCalibratedMainStat,
} from '../../utils/gear/calibrationCalculator';
import { calculateUpgradeCost } from '../../utils/gear/potentialCalculator';

interface Props {
    gear: GearPiece;
    showDetails?: boolean;
    mode?: 'manage' | 'select' | 'full' | 'compact' | 'subcompact';
    onRemove?: (id: string) => void;
    onEdit?: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    onCalibrate?: (piece: GearPiece) => void;
    onLockShip?: (shipId: string) => void;
    /** Hide lock button for this ship (the ship being optimized) */
    excludeLockShipId?: string;
    className?: string;
    small?: boolean;
    /** Show calibrated main stat value even if not actively calibrated */
    showCalibratedPreview?: boolean;
    /** When set, determines calibration-active status based on this ship
     *  instead of the currently-equipped ship. Used in autogear suggestions
     *  so that calibrated gear shows base stats when suggested for a
     *  different ship. */
    suggestedForShipId?: string;
    showSetName?: boolean;
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
        onLockShip,
        excludeLockShipId,
        className = '',
        small = false,
        showCalibratedPreview = false,
        suggestedForShipId,
        showSetName = false,
    }: Props) => {
        const { getShipFromGearId, getShipById, gearToShipMap } = useShips();
        const { getUpgrade } = useGearUpgrades();

        // Use memoized map for O(1) lookup instead of searching through all ships
        const { equippedShipId: equippedOnShipId, shipName } = useMemo(() => {
            const id = gearToShipMap.get(gear.id);
            if (id) {
                const ship = getShipFromGearId(gear.id);
                return { equippedShipId: id, shipName: ship?.name };
            }
            return { equippedShipId: undefined, shipName: undefined };
        }, [gear.id, gearToShipMap, getShipFromGearId]);
        const isImplant = gear.slot.startsWith('implant_');
        const [showSetTooltip, setShowSetTooltip] = useState(false);
        const setTooltipRef = React.useRef<HTMLImageElement>(null);
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
        // When displayed as a suggestion for a specific ship, check
        // calibration against that ship instead of the currently-equipped one.
        const calibrationTargetShipId = suggestedForShipId ?? equippedOnShipId;
        const isCalibrationActive =
            isCalibrated &&
            !!calibrationTargetShipId &&
            gear.calibration?.shipId === calibrationTargetShipId;
        const calibratedShipName = useMemo(() => {
            if (gear.calibration?.shipId) {
                const ship = getShipById(gear.calibration.shipId);
                return ship?.name;
            }
            return undefined;
        }, [gear.calibration?.shipId, getShipById]);
        const canCalibrate = isCalibrationEligible(gear);

        // Get the main stat to display - use calibrated if calibration is active or preview requested
        const displayMainStat = useMemo(() => {
            if (!gear.mainStat) return null;
            if ((isCalibrationActive || showCalibratedPreview) && isCalibrationEligible(gear)) {
                return getCalibratedMainStat(gear);
            }
            return gear.mainStat;
        }, [gear, isCalibrationActive, showCalibratedPreview]);

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
                className={`card-hover bg-dark shadow-md border ${rarityInfo.borderColor} overflow-hidden flex-grow flex flex-col ${className} ${small ? 'text-xs' : 'text-sm'}`}
            >
                {/* Header */}
                <div
                    className={`relative overflow-hidden py-2 ${rarityInfo.textColor} ${mode === 'subcompact' && !showDetails ? '' : 'border-b ' + rarityInfo.borderColor} flex justify-between items-center ${small ? 'px-2' : 'px-4'}`}
                    style={{
                        background: gearSetInfo?.color || 'transparent',
                    }}
                >
                    {!isImplant && slotInfo && (
                        <>
                            <img
                                src={slotInfo}
                                alt=""
                                aria-hidden="true"
                                className={`absolute ${small ? 'right-0' : ''} top-1/2 -translate-y-1/2 h-[150%] w-auto pointer-events-none select-none`}
                            />
                            <div
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                    background: `linear-gradient(to right, rgb(var(--color-bg)) ${small ? '55%' : '70%'}, transparent)`,
                                }}
                            />
                        </>
                    )}
                    <div className="z-0">
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
                                        ref={setTooltipRef}
                                        src={slotInfo}
                                        alt={GEAR_SETS[gear.setBonus || '']?.name}
                                        className={`h-auto ${small ? 'w-5' : 'w-6'} cursor-help`}
                                        onMouseEnter={() => setShowSetTooltip(true)}
                                        onMouseLeave={() => setShowSetTooltip(false)}
                                    />
                                    {gearSetInfo && (
                                        <Tooltip
                                            isVisible={showSetTooltip}
                                            className="bg-dark p-2 border border-dark-border min-w-[200px] text-theme-text text-sm"
                                            targetElement={setTooltipRef.current}
                                        >
                                            <div className="space-y-2">
                                                <div className="font-semibold">
                                                    {gearSetInfo.name}
                                                </div>
                                                {typeof gearSetInfo.description === 'string' && (
                                                    <div className="bg-dark-lighter p-2">
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
                                    : showSetName
                                      ? GEAR_SETS[gear.setBonus || '']?.name +
                                        ' ' +
                                        GEAR_SLOTS[gear.slot]?.label
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
                                    {IMPLANT_SLOTS[gear.slot]?.label}
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
                                <div
                                    className={`text-theme-text-secondary ${small ? 'text-xs' : 'mb-1'}`}
                                >
                                    Main Stat
                                </div>
                                <div className="space-y-1">
                                    <StatDisplay
                                        stats={[displayMainStat as Stat]}
                                        upgradedStats={
                                            isCalibrationActive &&
                                            !showCalibratedPreview &&
                                            displayMainStat
                                                ? [displayMainStat]
                                                : upgrade?.mainStat &&
                                                    !isMaxLevel &&
                                                    !showCalibratedPreview
                                                  ? [upgrade.mainStat as Stat]
                                                  : undefined
                                        }
                                    />
                                </div>
                            </div>
                        )}
                        {/* Implant Description */}
                        {isImplant &&
                            (gear.slot === 'implant_major' || gear.slot === 'implant_ultimate') && (
                                <div>
                                    <div
                                        className={`text-theme-text-secondary ${small ? 'text-xs' : 'mb-1'}`}
                                    >
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
                                    <div className="text-theme-text-secondary mb-2">Sub Stats</div>
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

                        {!isMaxLevel &&
                            !isImplant &&
                            (() => {
                                const cost = calculateUpgradeCost(gear, 16);
                                return cost > 0 ? (
                                    <div className="text-xs text-theme-text-secondary">
                                        Upgrade cost:{' '}
                                        {Intl.NumberFormat('en', { notation: 'compact' }).format(
                                            cost
                                        )}
                                    </div>
                                ) : null;
                            })()}

                        {shipName && mode !== 'subcompact' && (
                            <div className="text-xs !mt-auto pt-2 flex items-center gap-1">
                                <span>Equipped by: {shipName}</span>
                                {onLockShip &&
                                    equippedOnShipId &&
                                    equippedOnShipId !== excludeLockShipId && (
                                        <button
                                            className="text-yellow-400 hover:text-yellow-300 p-0.5"
                                            title={`Lock ${shipName}'s equipment and re-run autogear`}
                                            aria-label={`Lock ${shipName}'s equipment and re-run autogear`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onLockShip(equippedOnShipId);
                                            }}
                                        >
                                            <UnlockedLockIcon className="w-3 h-3" />
                                        </button>
                                    )}
                            </div>
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

        // Compare calibration and suggestion target
        if (
            prevGear.calibration?.shipId !== nextGear.calibration?.shipId ||
            prevProps.suggestedForShipId !== nextProps.suggestedForShipId
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
