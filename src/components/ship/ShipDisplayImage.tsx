import React, { memo, useMemo, useState } from 'react';
import { AffinityName, Ship } from '../../types/ship';
import { SHIP_TYPES, FACTIONS, RARITIES, IMPLANT_SLOT_ORDER } from '../../constants';
import {
    Button,
    CloseIcon,
    EditIcon,
    LockIcon,
    UnlockedLockIcon,
    InfoIcon,
    CopyIcon,
    Tooltip,
} from '../ui';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { StatList } from '../stats/StatList';
import { StatBreakdown } from '../stats/StatBreakdown';
import { Link, useNavigate } from 'react-router-dom';
import { MenuIcon } from '../ui/icons/MenuIcon';
import { Dropdown } from '../ui/Dropdown';
import { GearIcon } from '../ui/icons/GearIcon';
import { ChartIcon } from '../ui/icons/ChartIcon';
import { CheckIcon } from '../ui/icons/CheckIcon';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';
import { GearPiece } from '../../types/gear';
import { Image } from '../ui/Image';

interface Props {
    ship: Ship;
    variant?: 'full' | 'compact' | 'extended';
    onEdit?: (ship: Ship) => void;
    onRemove?: (id: string) => void;
    selected?: boolean;
    onClick?: () => void;
    children?: React.ReactNode;
    onLockEquipment?: (ship: Ship) => Promise<void>;
    onQuickAdd?: (ship: Ship) => Promise<void>;
    isAdded?: boolean;
}

const ShipImage = memo(
    ({ iconUrl, name, className }: { iconUrl: string; name: string; className?: string }) => (
        <img src={iconUrl} alt={name} className={`w-4 ${className}`} />
    )
);
ShipImage.displayName = 'ShipImage';

const AffinityClass = ({ affinity }: { affinity: AffinityName }) => {
    switch (affinity) {
        case 'chemical':
            return 'filter-chemical';
        case 'electric':
            return 'filter-electric';
        case 'thermal':
            return 'filter-thermal';
        case 'antimatter':
            return 'filter-antimatter';
        default:
            return '';
    }
};

const Header = memo(
    ({ ship, variant = 'full' }: { ship: Ship; variant?: 'full' | 'compact' | 'extended' }) => (
        <div>
            <div className="flex items-center gap-1 min-h-[28px]">
                {ship.type && SHIP_TYPES[ship.type] && (
                    <ShipImage
                        iconUrl={SHIP_TYPES[ship.type].iconUrl}
                        name={SHIP_TYPES[ship.type].name}
                        className={`${ship.affinity ? AffinityClass({ affinity: ship.affinity }) : ''}`}
                    />
                )}
                {ship.faction && FACTIONS[ship.faction] && (
                    <ShipImage
                        iconUrl={FACTIONS[ship.faction].iconUrl}
                        name={FACTIONS[ship.faction].name}
                    />
                )}
                <span
                    className={`${variant === 'compact' ? 'text-sm' : 'lg:text-sm'} font-secondary ${RARITIES[ship.rarity || 'common'].textColor}`}
                >
                    {ship.name}
                </span>
            </div>

            <div className="flex items-center gap-1">
                {Array.from({ length: 6 }, (_, index) => (
                    <span
                        key={index}
                        className={`text-xs tracking-tightest ${index < ship.refits?.length ? 'text-yellow-400' : ship.rank && index < ship.rank ? 'text-gray-300' : 'text-gray-500'}`}
                    >
                        ★
                    </span>
                ))}
            </div>
        </div>
    )
);
Header.displayName = 'Header';

export const ShipDisplayImage: React.FC<Props> = memo(
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
    }) => {
        const { getGearPiece } = useInventory();
        const { getEngineeringStatsForShipType } = useEngineeringStats();
        const navigate = useNavigate();
        const [isTooltipVisible, setIsTooltipVisible] = useState(false);
        const statsBreakdown = useMemo(
            () =>
                calculateTotalStats(
                    ship.baseStats,
                    ship.equipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type)
                ),
            [
                ship.baseStats,
                ship.equipment,
                getGearPiece,
                ship.refits,
                getEngineeringStatsForShipType,
                ship.type,
                ship.implants,
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
                    <Header ship={ship} variant="compact" />
                    {children}
                </div>
            );
        }

        return (
            <div
                className={`flex flex-col bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                    selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}
                    ship-display-height
                    relative
                    group
                `}
                onClick={onClick}
            >
                {ship.imageKey && (
                    <Image
                        src={`${ship.imageKey}_BigPortrait.jpg`}
                        alt={ship.name}
                        className="mx-auto w-full"
                        imageClassName="mb-[10rem]"
                    />
                )}
                <div
                    className={`bg-dark absolute top-[calc(100%-259px)] left-[-1px] w-[calc(100%+2px)] max-h-[260px] group-hover:max-h-[700px] overflow-hidden z-10 group-hover:z-20 transition-all duration-300 ease-in-out border-x border-b ${RARITIES[ship.rarity || 'common'].borderColor}`}
                >
                    <div
                        className={`px-4 py-2 ${ship.imageKey ? 'border-y' : 'border-b'} ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center relative`}
                    >
                        <Header ship={ship} />
                        {(onEdit || onRemove || onLockEquipment || onQuickAdd) && (
                            <div className="flex gap-1">
                                {onLockEquipment && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        title={
                                            ship.equipmentLocked
                                                ? 'Unlock equipment'
                                                : 'Lock equipment'
                                        }
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                                await onLockEquipment(ship);
                                            } catch (error) {
                                                console.error(
                                                    'Failed to update lock state:',
                                                    error
                                                );
                                            }
                                        }}
                                    >
                                        {ship.equipmentLocked ? <LockIcon /> : <UnlockedLockIcon />}
                                    </Button>
                                )}
                                {!onQuickAdd && (
                                    <Dropdown
                                        trigger={
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                aria-label="Ship actions"
                                                title="Ship actions"
                                            >
                                                <MenuIcon />
                                            </Button>
                                        }
                                    >
                                        <Dropdown.Item onClick={() => {}}>
                                            <Link
                                                to={`/ships/${ship.id}`}
                                                className="flex items-center gap-2"
                                            >
                                                <InfoIcon />
                                                <span>Ship info</span>
                                            </Link>
                                        </Dropdown.Item>

                                        <Dropdown.Item
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/autogear?shipId=${ship.id}`);
                                            }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <GearIcon />
                                                <span>Optimize gear</span>
                                            </div>
                                        </Dropdown.Item>

                                        <Dropdown.Item
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                navigate(`/simulation?shipId=${ship.id}`);
                                            }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <ChartIcon />
                                                <span>Simulate ship</span>
                                            </div>
                                        </Dropdown.Item>

                                        {onEdit && (
                                            <Dropdown.Item
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEdit(ship);
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <EditIcon />
                                                    <span>Edit ship</span>
                                                </div>
                                            </Dropdown.Item>
                                        )}
                                        {onRemove && (
                                            <Dropdown.Item
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemove(ship.id);
                                                }}
                                                className="text-red-500"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <CloseIcon />
                                                    <span>Remove ship</span>
                                                </div>
                                            </Dropdown.Item>
                                        )}
                                    </Dropdown>
                                )}
                                {onQuickAdd && (
                                    <Button
                                        onClick={() => !isAdded && onQuickAdd(ship)}
                                        disabled={isAdded}
                                        variant="secondary"
                                        size="sm"
                                        title={isAdded ? 'Remove from fleet' : 'Add to fleet'}
                                    >
                                        {isAdded ? <CheckIcon /> : <div className="w-4 h-4">+</div>}
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    {children}

                    <div className="px-4 pb-4 relative flex-grow">
                        <div className="space-y-1 text-sm">
                            {ship.implants &&
                                Object.keys(ship.implants).length > 0 &&
                                variant === 'full' && (
                                    <div className="relative">
                                        <div
                                            className="flex justify-between text-gray-300 border-b py-1 border-dark-lighter"
                                            onMouseEnter={() => setIsTooltipVisible(true)}
                                            onMouseLeave={() => setIsTooltipVisible(false)}
                                        >
                                            <span>Implants:</span>
                                            <span>{Object.keys(ship.implants || {}).length}</span>
                                        </div>
                                        <Tooltip
                                            isVisible={isTooltipVisible}
                                            className="flex flex-col gap-2 bg-dark border border-dark-lighter p-2 w-48"
                                        >
                                            {IMPLANT_SLOT_ORDER.map((slot) => (
                                                <React.Fragment key={slot}>
                                                    {ship.implants?.[slot] && (
                                                        <GearPieceDisplay
                                                            gear={
                                                                getGearPiece(
                                                                    ship.implants[slot] as string
                                                                ) as GearPiece
                                                            }
                                                            showDetails={
                                                                getGearPiece(ship.implants[slot])
                                                                    ?.subStats?.length !== 0
                                                            }
                                                            mode="subcompact"
                                                            small
                                                        />
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </Tooltip>
                                    </div>
                                )}
                            <div className="flex items-center justify-between">
                                <div className="flex-grow">
                                    {variant === 'full' && (
                                        <StatList stats={statsBreakdown.final} />
                                    )}
                                    {variant === 'extended' && (
                                        <StatBreakdown breakdown={statsBreakdown} />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    {ship.copies && ship.copies > 1 && (
                        <div className="flex items-center gap-1 justify-end px-4 pb-2">
                            <span className="text-gray-300 text-sm">x{ship.copies}</span>
                            <CopyIcon />
                        </div>
                    )}
                </div>
            </div>
        );
    }
);
ShipDisplayImage.displayName = 'ShipDisplayImage';
