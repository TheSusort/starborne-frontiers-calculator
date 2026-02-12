import React, { memo, useMemo, useRef } from 'react';
import { toBlob } from 'html-to-image';
import { RARITIES } from '../../constants';
import { Image } from '../ui/Image';
import { Video, VideoHandle } from '../ui/Video';
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
    PanelVariant,
} from './shipDisplayComponents';

const PANEL_VARIANTS: Record<
    PanelVariant,
    { maxHeight: string; top: string; imageMargin: string }
> = {
    default: {
        maxHeight: 'max-h-[260px]',
        top: 'top-[calc(100%-259px)]',
        imageMargin: 'mb-[10rem]',
    },
    compact: {
        maxHeight: 'max-h-[120px]',
        top: 'top-[calc(100%-119px)]',
        imageMargin: 'mb-[4rem]',
    },
};

export const ShipDisplayImage: React.FC<ShipDisplayProps> = memo(
    ({
        ship,
        variant = 'full',
        panelVariant = 'default',
        onEdit,
        onRemove,
        selected,
        onClick,
        children,
        onLockEquipment,
        onQuickAdd,
        isAdded,
        onAddToComparison,
        isInComparison,
    }) => {
        const panelStyles = PANEL_VARIANTS[panelVariant];
        const { getGearPiece } = useInventory();
        const { getEngineeringStatsForShipType } = useEngineeringStats();
        const { addNotification } = useNotification();
        const videoRef = useRef<VideoHandle>(null);

        const handleMouseEnter = () => {
            videoRef.current?.play();
        };

        const handleMouseLeave = () => {
            videoRef.current?.pause();
        };

        const createAndCopyImage = async () => {
            const shipElement = document.getElementById(`ship-card-${ship.id}`);
            if (!shipElement) return;

            // Find the expandable stats panel
            const statsPanel = shipElement.querySelector(
                '[data-stats-panel]'
            ) as HTMLElement | null;

            try {
                // Expand parent to fit content
                shipElement.style.height = 'auto';
                shipElement.style.maxHeight = 'none';
                shipElement.style.overflow = 'visible';

                // Expand stats panel and make it flow naturally
                if (statsPanel) {
                    statsPanel.style.maxHeight = 'none';
                    statsPanel.style.overflow = 'visible';
                    statsPanel.style.position = 'relative';
                    statsPanel.style.marginTop = '-260px';
                    statsPanel.style.top = 'unset';
                    statsPanel.style.transitionDuration = '0s';
                }

                // Wait for reflow
                await new Promise((resolve) => requestAnimationFrame(resolve));

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
            } finally {
                // Restore original styles
                shipElement.removeAttribute('style');
                statsPanel?.removeAttribute('style');
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
                    className={`flex-grow p-3 bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                        selected ? 'border-2' : ''
                    } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
                    onClick={onClick}
                >
                    <ShipHeader ship={ship} variant="compact" />
                    {children}
                </div>
            );
        }

        return (
            <div
                id={`ship-card-${ship.id}`}
                className={`flex flex-col bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                    selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}
                    ship-display-height
                    relative
                    group
                `}
                onClick={onClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {ship.imageKey && (
                    <div className={`relative mx-auto w-full ${panelStyles.imageMargin}`}>
                        <Image
                            src={`${ship.imageKey}_BigPortrait.jpg`}
                            alt={ship.name}
                            className="w-full"
                            imageClassName="w-full"
                            aspectRatio="1/1"
                        />
                        <Video
                            ref={videoRef}
                            src={`${ship.imageKey}_Video`}
                            className="absolute inset-0 w-full pointer-events-none"
                            videoClassName="w-full object-cover"
                            aspectRatio="1/1"
                        />
                    </div>
                )}
                <div
                    data-stats-panel
                    className={`bg-dark absolute ${panelStyles.top} left-[-1px] w-[calc(100%+2px)] ${panelStyles.maxHeight} group-hover:max-h-[700px] overflow-hidden z-10 group-hover:z-20 transition-all duration-300 ease-in-out border-x border-b ${RARITIES[ship.rarity || 'common'].borderColor}`}
                >
                    <div
                        className={`px-4 py-2 ${ship.imageKey ? 'border-y' : 'border-b'} ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center relative`}
                    >
                        <ShipHeader ship={ship} />
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
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {children}

                    <div className="px-4 pb-4 relative flex-grow">
                        <div className="space-y-1 text-sm">
                            {variant === 'full' && (
                                <ImplantsDisplay ship={ship} getGearPiece={getGearPiece} />
                            )}
                            <ShipStatsDisplay variant={variant} statsBreakdown={statsBreakdown} />
                        </div>
                    </div>
                    <ShipCopiesBadge copies={ship.copies} />
                </div>
            </div>
        );
    }
);
ShipDisplayImage.displayName = 'ShipDisplayImage';
