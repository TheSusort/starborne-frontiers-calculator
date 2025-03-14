import React from 'react';
import { GearSlot } from '../gear/GearSlot';
import { Button } from '../ui';
import { GEAR_SLOT_ORDER, GearSlotName } from '../../constants';
import { GearPiece } from '../../types/gear';
import { GearSuggestion } from '../../types/autogear';
import { LockIcon } from '../ui/icons/LockIcon';
import { UnlockedLockIcon } from '../ui/icons/UnlockedLockIcon';
import { Loader } from '../ui/Loader';

interface GearSuggestionsProps {
    suggestions: GearSuggestion[];
    getGearPiece: (id: string) => GearPiece | undefined;
    hoveredGear: GearPiece | null;
    onHover: (gear: GearPiece | null) => void;
    onEquip: () => void;
    lockOnEquip: boolean;
    onLockToggle: () => void;
    isLoading?: boolean;
}

export const GearSuggestions: React.FC<GearSuggestionsProps> = ({
    suggestions,
    getGearPiece,
    hoveredGear,
    onHover,
    onEquip,
    lockOnEquip,
    onLockToggle,
    isLoading = false,
}) => {
    const getSuggestionForSlot = (slotName: GearSlotName) => {
        return suggestions.find((s) => s.slotName === slotName);
    };

    return (
        <div className="py-4 md:pt-0 ">
            <div className="sticky top-16 lg:top-0">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold ">Suggested Gear</h3>
                </div>
                <div className="bg-dark">
                    <div className="grid grid-cols-3 gap-2 bg-dark p-4 w-fit mx-auto">
                        {GEAR_SLOT_ORDER.map((slotName) => {
                            const suggestion = getSuggestionForSlot(slotName);
                            return (
                                <div key={slotName} className="flex items-center justify-center">
                                    <GearSlot
                                        slotKey={slotName}
                                        gear={
                                            suggestion ? getGearPiece(suggestion.gearId) : undefined
                                        }
                                        hoveredGear={hoveredGear}
                                        onHover={onHover}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="flex gap-2 justify-end">
                    <Button onClick={onEquip} variant="primary" disabled={isLoading}>
                        {isLoading ? (
                            <div className="flex items-center gap-2">
                                <Loader size="sm" />
                                <span>Equipping...</span>
                            </div>
                        ) : (
                            'Equip Suggestions'
                        )}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={onLockToggle}
                        title={
                            lockOnEquip
                                ? 'Ship will be locked after equipping'
                                : 'Ship will remain unlocked after equipping'
                        }
                        disabled={isLoading}
                    >
                        {lockOnEquip ? (
                            <LockIcon className="w-5 h-5" />
                        ) : (
                            <UnlockedLockIcon className="w-5 h-5" />
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
};
