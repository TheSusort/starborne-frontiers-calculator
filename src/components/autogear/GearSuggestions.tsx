import React, { useState } from 'react';
import { GearSlot } from '../gear/GearSlot';
import { Button, LockIcon, UnlockedLockIcon } from '../ui';
import { GEAR_SLOT_ORDER, GearSlotName } from '../../constants';
import { GearPiece } from '../../types/gear';
import { GearSuggestion } from '../../types/autogear';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';
import { Ship } from '../../types/ship';
import { useGearUpgrades } from '../../hooks/useGearUpgrades';

interface GearSuggestionsProps {
    suggestions: GearSuggestion[];
    getGearPiece: (id: string) => GearPiece | undefined;
    hoveredGear: GearPiece | null;
    onHover: (gear: GearPiece | null) => void;
    onEquip: () => void;
    onLockEquipment: (ship: Ship) => Promise<void>;
    ship?: Ship;
    useUpgradedStats: boolean;
    onLockShip?: (shipId: string) => void;
    isPrinting?: boolean;
    optimizeImplants?: boolean;
}

export const GearSuggestions: React.FC<GearSuggestionsProps> = ({
    suggestions,
    getGearPiece,
    hoveredGear,
    onHover,
    onEquip,
    onLockEquipment,
    ship,
    useUpgradedStats,
    onLockShip,
    isPrinting = false,
    optimizeImplants = false,
}) => {
    const { getUpgrade } = useGearUpgrades();
    const [expanded, setExpanded] = useState(false);
    const getSuggestionForSlot = (slotName: GearSlotName) => {
        return suggestions.find((s) => s.slotName === slotName);
    };

    const hasImplantSuggestions = () => {
        return suggestions.some((s) => s.slotName.startsWith('implant_'));
    };

    const getTotalUpgradeCost = () => {
        return suggestions.reduce((acc, suggestion) => {
            if (getUpgrade(suggestion.gearId)) {
                const { cost } = getUpgrade(suggestion.gearId);
                return acc + (cost ?? 0);
            }
            return acc;
        }, 0);
    };

    return (
        <div
            className={`pt-4 md:pt-0 ${expanded ? 'lg:min-w-[450px] xl:min-w-[650px]' : ''}`}
            data-tutorial="autogear-gear-suggestions"
        >
            <div className="">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold  w-full">{ship?.name}</h3>
                </div>
                <div className="card">
                    {!expanded && !isPrinting ? (
                        <div className="grid grid-cols-3 gap-2 bg-dark p-4 w-fit mx-auto">
                            {GEAR_SLOT_ORDER.map((slotName) => {
                                const suggestion = getSuggestionForSlot(slotName);
                                return (
                                    <div
                                        key={slotName}
                                        className="flex items-center justify-center"
                                    >
                                        <GearSlot
                                            slotKey={slotName}
                                            gear={
                                                suggestion
                                                    ? getGearPiece(suggestion.gearId)
                                                    : undefined
                                            }
                                            hoveredGear={hoveredGear}
                                            onHover={onHover}
                                            onLockShip={onLockShip}
                                            excludeLockShipId={ship?.id}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
                            {GEAR_SLOT_ORDER.map((slotName) => {
                                const suggestion = getSuggestionForSlot(slotName);
                                const gear = suggestion
                                    ? getGearPiece(suggestion.gearId)
                                    : undefined;
                                if (!gear) return null;
                                return (
                                    <div key={slotName} className="flex justify-center">
                                        <GearPieceDisplay
                                            gear={gear}
                                            small
                                            onLockShip={onLockShip}
                                            excludeLockShipId={ship?.id}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Implant Display Section */}
                    {optimizeImplants &&
                        ship &&
                        (hasImplantSuggestions() ||
                            (ship.implants && Object.keys(ship.implants).length > 0)) && (
                            <div className="border-t border-dark-lighter mt-4 p-4">
                                <h4 className="text-sm font-semibold mb-3 text-theme-text">
                                    Implants
                                </h4>
                                {!expanded && !isPrinting ? (
                                    <div className="grid grid-cols-2 gap-2 w-fit mx-auto">
                                        {/* Left column: 3 Minors */}
                                        <div className="space-y-2">
                                            {[
                                                'implant_minor_alpha',
                                                'implant_minor_gamma',
                                                'implant_minor_sigma',
                                            ].map((slot) => {
                                                const suggestion = getSuggestionForSlot(slot);
                                                const gearId =
                                                    suggestion?.gearId ?? ship.implants?.[slot];
                                                const gear = gearId
                                                    ? getGearPiece(gearId)
                                                    : undefined;
                                                return (
                                                    <div
                                                        key={slot}
                                                        className="flex items-center justify-center"
                                                    >
                                                        {gear ? (
                                                            <GearSlot
                                                                slotKey={slot}
                                                                gear={gear}
                                                                hoveredGear={hoveredGear}
                                                                onHover={onHover}
                                                                onLockShip={onLockShip}
                                                                excludeLockShipId={ship?.id}
                                                            />
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Right column: Major + Ultimate */}
                                        <div className="space-y-2">
                                            {['implant_major', 'implant_ultimate'].map((slot) => {
                                                // For ultimate: show equipped only (no suggestion)
                                                // For major: show suggestion if exists, otherwise show equipped
                                                const suggestion =
                                                    slot === 'implant_ultimate'
                                                        ? null
                                                        : getSuggestionForSlot(slot);
                                                const gearId =
                                                    suggestion?.gearId ?? ship.implants?.[slot];
                                                const gear = gearId
                                                    ? getGearPiece(gearId)
                                                    : undefined;
                                                return (
                                                    <div
                                                        key={slot}
                                                        className="flex items-center justify-center"
                                                    >
                                                        {gear ? (
                                                            <GearSlot
                                                                slotKey={slot}
                                                                gear={gear}
                                                                hoveredGear={hoveredGear}
                                                                onHover={onHover}
                                                                onLockShip={onLockShip}
                                                                excludeLockShipId={ship?.id}
                                                            />
                                                        ) : null}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Left column: 3 Minors */}
                                        <div className="space-y-2">
                                            <div className="text-xs text-theme-text-secondary mb-2">
                                                Minor Slots
                                            </div>
                                            {[
                                                'implant_minor_alpha',
                                                'implant_minor_gamma',
                                                'implant_minor_sigma',
                                            ].map((slot) => {
                                                const suggestion = getSuggestionForSlot(slot);
                                                const gearId =
                                                    suggestion?.gearId ?? ship.implants?.[slot];
                                                const gear = gearId
                                                    ? getGearPiece(gearId)
                                                    : undefined;
                                                if (!gear) return null;
                                                return (
                                                    <div key={slot} className="flex justify-center">
                                                        <GearPieceDisplay
                                                            gear={gear}
                                                            small
                                                            onLockShip={onLockShip}
                                                            excludeLockShipId={ship?.id}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Right column: Major + Ultimate */}
                                        <div className="space-y-2">
                                            <div className="text-xs text-theme-text-secondary mb-2">
                                                Major & Ultimate
                                            </div>
                                            {['implant_major', 'implant_ultimate'].map((slot) => {
                                                const suggestion =
                                                    slot === 'implant_ultimate'
                                                        ? null
                                                        : getSuggestionForSlot(slot);
                                                const gearId =
                                                    suggestion?.gearId ?? ship.implants?.[slot];
                                                const gear = gearId
                                                    ? getGearPiece(gearId)
                                                    : undefined;
                                                if (!gear) return null;
                                                return (
                                                    <div key={slot} className="flex justify-center">
                                                        <GearPieceDisplay
                                                            gear={gear}
                                                            small
                                                            onLockShip={onLockShip}
                                                            excludeLockShipId={ship?.id}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                </div>

                <div className="flex justify-end items-center pt-4 gap-2">
                    {useUpgradedStats && (
                        <div className="text-sm text-theme-text-secondary mr-auto">
                            Total upgrade cost:{' '}
                            {Intl.NumberFormat('en', { notation: 'compact' }).format(
                                getTotalUpgradeCost()
                            )}
                        </div>
                    )}
                    <Button aria-label="Equip all suggestions" variant="primary" onClick={onEquip}>
                        Equip All Suggestions
                    </Button>
                    {onLockEquipment && ship && (
                        <Button
                            variant="secondary"
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
                    )}
                    <Button
                        aria-label="Expand suggestions"
                        variant="secondary"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? 'Collapse' : 'Expand'}
                    </Button>
                </div>
            </div>
        </div>
    );
};
