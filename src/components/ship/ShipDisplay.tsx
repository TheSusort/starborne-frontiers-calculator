import React, { memo, useMemo } from 'react';
import { toBlob } from 'html-to-image';
import { RARITIES } from '../../constants';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useNotification } from '../../hooks/useNotification';
import {
    ShipDisplayProps,
    ShipHeader,
    ShipActionsDropdown,
    LockEquipmentButton,
    QuickAddButtons,
    ImplantsDisplay,
    ShipStatsDisplay,
    ShipCopiesBadge,
} from './shipDisplayComponents';

export const ShipDisplay: React.FC<ShipDisplayProps> = memo(
    ({
        ship,
        variant = 'full',
        onEdit,
        onRemove,
        selected,
        onClick,
        children,
        onLockEquipment,
        onQuickAdd,
        isAdded,
        contentClassName,
        onAddToComparison,
        isInComparison,
    }) => {
        const { getGearPiece } = useInventory();
        const { getEngineeringStatsForShipType } = useEngineeringStats();
        const { addNotification } = useNotification();

        const createAndCopyImage = async () => {
            const shipElement = document.getElementById(`ship-card-${ship.id}`);
            if (!shipElement) return;

            try {
                const blob = await toBlob(shipElement, {
                    cacheBust: true,
                    includeQueryParams: true,
                    skipFonts: true,
                    filter: (node: Node) => {
                        if (node instanceof HTMLElement && node.dataset.hideOnCapture === 'true') {
                            return false;
                        }
                        return true;
                    },
                });

                if (!blob) {
                    throw new Error('Failed to create image blob');
                }

                await navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': blob,
                    }),
                ]);
                addNotification('success', 'Copied to clipboard!');
            } catch (error) {
                console.error('Failed to copy image:', error);
                addNotification('error', 'Failed to copy image');
            }
        };

        const statsBreakdown = useMemo(
            () =>
                calculateTotalStats(
                    ship.baseStats,
                    ship.equipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type),
                    ship.id
                ),
            [
                ship.baseStats,
                ship.equipment,
                getGearPiece,
                ship.refits,
                getEngineeringStatsForShipType,
                ship.type,
                ship.implants,
                ship.id,
            ]
        );

        if (variant === 'compact') {
            return (
                <div
                    className={`flex justify-between flex-grow p-3 bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                        selected ? 'border-2' : ''
                    } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''} ${contentClassName}`}
                    onClick={onClick}
                >
                    <ShipHeader ship={ship} variant="compact" minWidth />
                    {children}
                </div>
            );
        }

        return (
            <div
                id={`ship-card-${ship.id}`}
                className={`flex flex-col flex-grow bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                    selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''} ${contentClassName}`}
                onClick={onClick}
            >
                <div
                    className={`px-4 py-2 border-b ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center`}
                >
                    <ShipHeader ship={ship} minWidth />
                    {(onEdit || onRemove || onLockEquipment || onQuickAdd) && (
                        <div className="flex gap-1" data-hide-on-capture="true">
                            {onLockEquipment && (
                                <LockEquipmentButton
                                    ship={ship}
                                    onLockEquipment={onLockEquipment}
                                />
                            )}
                            {!onQuickAdd && (
                                <ShipActionsDropdown
                                    ship={ship}
                                    onEdit={onEdit}
                                    onRemove={onRemove}
                                    onAddToComparison={onAddToComparison}
                                    isInComparison={isInComparison}
                                    onCopyAsImage={createAndCopyImage}
                                    showCalibrateGear
                                />
                            )}
                            {onQuickAdd && (
                                <QuickAddButtons
                                    ship={ship}
                                    onQuickAdd={onQuickAdd}
                                    isAdded={isAdded}
                                    onAddToComparison={onAddToComparison}
                                    isInComparison={isInComparison}
                                    showLeaderboard
                                />
                            )}
                        </div>
                    )}
                </div>

                {children}

                <div
                    className={`px-4 pb-4 relative flex-grow ${Object.keys(ship.implants).length > 0 ? '' : 'pt-2'}`}
                >
                    <div className="space-y-1 text-sm">
                        {variant === 'full' && (
                            <ImplantsDisplay ship={ship} getGearPiece={getGearPiece} />
                        )}
                        <ShipStatsDisplay variant={variant} statsBreakdown={statsBreakdown} />
                    </div>
                </div>
                <ShipCopiesBadge copies={ship.copies} />
            </div>
        );
    }
);
ShipDisplay.displayName = 'ShipDisplay';
