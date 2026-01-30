import React, { memo, useState } from 'react';
import { AffinityName, Ship } from '../../types/ship';
import {
    SHIP_TYPES,
    FACTIONS,
    RARITIES,
    IMPLANT_SLOT_ORDER,
    ImplantSlotName,
} from '../../constants';
import {
    Button,
    CloseIcon,
    EditIcon,
    LockIcon,
    UnlockedLockIcon,
    InfoIcon,
    Tooltip,
    CalibrationIcon,
} from '../ui';
import { Link, useNavigate } from 'react-router-dom';
import { MenuIcon } from '../ui/icons/MenuIcon';
import { Dropdown } from '../ui/Dropdown';
import { GearIcon } from '../ui/icons/GearIcon';
import { ChartIcon } from '../ui/icons/ChartIcon';
import { CompareIcon } from '../ui/icons/CompareIcon';
import { CheckIcon } from '../ui/icons/CheckIcon';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';
import { GearPiece } from '../../types/gear';
import { TrophyIcon } from '../ui/icons/TrophyIcon';
import { Image } from '../ui/Image';
import IMPLANTS, { ImplantName } from '../../constants/implants';
import { ImageIcon } from '../ui/icons/ImageIcon';
import { StatBreakdown as StatsBreakdownType } from '../../utils/ship/statsCalculator';
import { StatList } from '../stats/StatList';
import { StatBreakdown } from '../stats/StatBreakdown';
import { CopyIcon } from '../ui';

export interface ShipDisplayProps {
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
    contentClassName?: string;
    onAddToComparison?: (shipId: string) => void;
    isInComparison?: boolean;
}

export const ShipIcon = memo(
    ({ iconUrl, name, className }: { iconUrl: string; name: string; className?: string }) => (
        <img src={iconUrl} alt={name} className={`w-4 ${className}`} />
    )
);
ShipIcon.displayName = 'ShipIcon';

export const getAffinityClass = (affinity: AffinityName): string => {
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

export const ShipHeader = memo(
    ({
        ship,
        variant = 'full',
        minWidth = false,
    }: {
        ship: Ship;
        variant?: 'full' | 'compact' | 'extended';
        minWidth?: boolean;
    }) => (
        <div>
            <div
                className={`flex items-center gap-1 min-h-[28px] ${minWidth ? 'min-w-[100px]' : ''}`}
            >
                {ship.type && SHIP_TYPES[ship.type] && (
                    <ShipIcon
                        iconUrl={SHIP_TYPES[ship.type].iconUrl}
                        name={SHIP_TYPES[ship.type].name}
                        className={`${ship.affinity ? getAffinityClass(ship.affinity) : ''}`}
                    />
                )}
                {ship.faction && FACTIONS[ship.faction] && (
                    <ShipIcon
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
ShipHeader.displayName = 'ShipHeader';

interface ShipActionsDropdownProps {
    ship: Ship;
    onEdit?: (ship: Ship) => void;
    onRemove?: (id: string) => void;
    onAddToComparison?: (shipId: string) => void;
    isInComparison?: boolean;
    onCopyAsImage?: () => void;
    showCalibrateGear?: boolean;
}

export const ShipActionsDropdown: React.FC<ShipActionsDropdownProps> = ({
    ship,
    onEdit,
    onRemove,
    onAddToComparison,
    isInComparison,
    onCopyAsImage,
    showCalibrateGear = false,
}) => {
    const navigate = useNavigate();

    return (
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
                <Link to={`/ships/${ship.id}`} className="flex items-center gap-2">
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

            {showCalibrateGear && (
                <Dropdown.Item
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/gear?tab=calibration&subTab=ship&shipId=${ship.id}`);
                    }}
                >
                    <div className="flex items-center gap-2">
                        <CalibrationIcon />
                        <span>Calibrate gear</span>
                    </div>
                </Dropdown.Item>
            )}

            {onCopyAsImage && (
                <Dropdown.Item
                    onClick={(e) => {
                        e.stopPropagation();
                        onCopyAsImage();
                    }}
                >
                    <div className="flex items-center gap-2">
                        <ImageIcon />
                        <span>Copy as image</span>
                    </div>
                </Dropdown.Item>
            )}

            {onAddToComparison && !isInComparison && (
                <Dropdown.Item
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddToComparison(ship.id);
                    }}
                >
                    <div className="flex items-center gap-2">
                        <CompareIcon />
                        <span>Add to comparison</span>
                    </div>
                </Dropdown.Item>
            )}

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
    );
};

interface LockEquipmentButtonProps {
    ship: Ship;
    onLockEquipment: (ship: Ship) => Promise<void>;
}

export const LockEquipmentButton: React.FC<LockEquipmentButtonProps> = ({
    ship,
    onLockEquipment,
}) => (
    <Button
        variant="secondary"
        size="sm"
        title={ship.equipmentLocked ? 'Unlock equipment' : 'Lock equipment'}
        onClick={async (e) => {
            e.stopPropagation();
            try {
                await onLockEquipment(ship);
            } catch (error) {
                console.error('Failed to update lock state:', error);
            }
        }}
    >
        {ship.equipmentLocked ? <LockIcon /> : <UnlockedLockIcon />}
    </Button>
);

interface QuickAddButtonsProps {
    ship: Ship;
    onQuickAdd: (ship: Ship) => Promise<void>;
    isAdded?: boolean;
    onAddToComparison?: (shipId: string) => void;
    isInComparison?: boolean;
    showLeaderboard?: boolean;
}

export const QuickAddButtons: React.FC<QuickAddButtonsProps> = ({
    ship,
    onQuickAdd,
    isAdded,
    onAddToComparison,
    isInComparison,
    showLeaderboard = false,
}) => {
    const navigate = useNavigate();

    const handleLeaderboardClick = (shipName: string) => {
        navigate(`/ships/leaderboard/${encodeURIComponent(shipName)}`);
    };

    return (
        <>
            {onAddToComparison && !isInComparison && (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddToComparison(ship.id);
                    }}
                    title="Add to comparison"
                >
                    <CompareIcon />
                </Button>
            )}
            {showLeaderboard && (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleLeaderboardClick(ship.name)}
                    title="View leaderboard"
                >
                    <TrophyIcon />
                </Button>
            )}
            <Button
                onClick={() => !isAdded && onQuickAdd(ship)}
                disabled={isAdded}
                variant="secondary"
                size="sm"
                title={isAdded ? 'Already in fleet' : 'Add to fleet'}
            >
                {isAdded ? <CheckIcon /> : <div className="w-4 h-4">+</div>}
            </Button>
        </>
    );
};

interface ImplantsDisplayProps {
    ship: Ship;
    getGearPiece: (id: string) => GearPiece | undefined;
}

export const ImplantsDisplay: React.FC<ImplantsDisplayProps> = ({ ship, getGearPiece }) => {
    const [hoveredImplantSlot, setHoveredImplantSlot] = useState<ImplantSlotName | null>(null);
    const implantTooltipRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

    if (!ship.implants || Object.keys(ship.implants).length === 0) {
        return null;
    }

    return (
        <div className="relative">
            <div className="flex items-center gap-2 text-gray-300 border-b py-1 border-dark-lighter">
                <span>Implants:</span>
                <div className="flex items-center gap-1 ms-auto">
                    {IMPLANT_SLOT_ORDER.map((slot) => {
                        const implantId = ship.implants?.[slot];
                        if (!implantId) return null;
                        const gear = getGearPiece(implantId);
                        if (!gear?.setBonus) return null;
                        const implant = IMPLANTS[gear.setBonus as ImplantName];
                        if (!implant?.imageKey) return null;
                        const rarity = gear.rarity || 'common';
                        return (
                            <div
                                key={slot}
                                ref={(el) => {
                                    implantTooltipRefs.current[slot] = el;
                                }}
                                className={`border ${RARITIES[rarity].borderColor} cursor-help`}
                                onMouseEnter={() => setHoveredImplantSlot(slot)}
                                onMouseLeave={() => setHoveredImplantSlot(null)}
                            >
                                <Image
                                    src={implant.imageKey}
                                    alt={implant.name}
                                    className="w-5 h-5"
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
            {hoveredImplantSlot && ship.implants?.[hoveredImplantSlot] && (
                <Tooltip
                    isVisible={true}
                    className="flex flex-col gap-2 bg-dark border border-dark-lighter p-2 w-[256px]"
                    targetElement={implantTooltipRefs.current[hoveredImplantSlot]}
                >
                    <GearPieceDisplay
                        gear={
                            getGearPiece(ship.implants[hoveredImplantSlot] as string) as GearPiece
                        }
                        mode="subcompact"
                        small
                    />
                </Tooltip>
            )}
        </div>
    );
};

interface ShipStatsDisplayProps {
    variant: 'full' | 'compact' | 'extended';
    statsBreakdown: StatsBreakdownType;
}

export const ShipStatsDisplay: React.FC<ShipStatsDisplayProps> = ({ variant, statsBreakdown }) => (
    <div className="flex items-center justify-between">
        <div className="flex-grow">
            {variant === 'full' && <StatList stats={statsBreakdown.final} />}
            {variant === 'extended' && <StatBreakdown breakdown={statsBreakdown} />}
        </div>
    </div>
);

interface ShipCopiesBadgeProps {
    copies?: number;
}

export const ShipCopiesBadge: React.FC<ShipCopiesBadgeProps> = ({ copies }) => {
    if (!copies || copies <= 1) {
        return null;
    }

    return (
        <div className="flex items-center gap-1 justify-end px-4 pb-2">
            <span className="text-gray-300 text-sm">x{copies}</span>
            <CopyIcon />
        </div>
    );
};
