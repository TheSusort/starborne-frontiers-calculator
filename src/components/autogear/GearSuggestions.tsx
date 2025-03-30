import React, { useState } from 'react';
import { GearSlot } from '../gear/GearSlot';
import { Button } from '../ui';
import { GEAR_SLOT_ORDER, GearSlotName } from '../../constants';
import { GearPiece } from '../../types/gear';
import { GearSuggestion } from '../../types/autogear';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';

interface GearSuggestionsProps {
    suggestions: GearSuggestion[];
    getGearPiece: (id: string) => GearPiece | undefined;
    hoveredGear: GearPiece | null;
    onHover: (gear: GearPiece | null) => void;
    onEquip: () => void;
}

export const GearSuggestions: React.FC<GearSuggestionsProps> = ({
    suggestions,
    getGearPiece,
    hoveredGear,
    onHover,
    onEquip,
}) => {
    const [expanded, setExpanded] = useState(false);

    const getSuggestionForSlot = (slotName: GearSlotName) => {
        return suggestions.find((s) => s.slotName === slotName);
    };

    return (
        <div className="py-4 md:pt-0">
            <div className="sticky top-16 lg:top-0">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold">Suggested Gear</h3>
                </div>
                <div className="bg-dark">
                    {!expanded ? (
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
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 gap-4 p-4">
                            {GEAR_SLOT_ORDER.map((slotName) => {
                                const suggestion = getSuggestionForSlot(slotName);
                                const gear = suggestion
                                    ? getGearPiece(suggestion.gearId)
                                    : undefined;
                                if (!gear) return null;
                                return (
                                    <div key={slotName} className="flex justify-center">
                                        <GearPieceDisplay gear={gear} />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-4 gap-2">
                    <Button aria-label="Equip all suggestions" variant="primary" onClick={onEquip}>
                        Equip All Suggestions
                    </Button>
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
