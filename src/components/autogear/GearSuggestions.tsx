import React from 'react';
import { GearSlot } from '../gear/GearSlot';
import { Button } from '../ui';
import { GEAR_SLOT_ORDER, GearSlotName } from '../../constants';
import { GearPiece } from '../../types/gear';
import { GearSuggestion } from '../../types/autogear';

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
  const getSuggestionForSlot = (slotName: GearSlotName) => {
    return suggestions.find((s) => s.slotName === slotName);
  };

  return (
    <div className="bg-dark-lighter py-4 md:pt-0 rounded">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold text-gray-200">Suggested Gear</h3>
      </div>
      <div className="grid grid-cols-3 gap-2 bg-dark p-4">
        {GEAR_SLOT_ORDER.map((slotName) => {
          const suggestion = getSuggestionForSlot(slotName);
          return (
            <div key={slotName} className="flex items-center justify-center">
              <GearSlot
                slotKey={slotName}
                gear={suggestion ? getGearPiece(suggestion.gearId) : undefined}
                hoveredGear={hoveredGear}
                onHover={onHover}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-4">
        <Button aria-label="Equip all suggestions" variant="primary" onClick={onEquip}>
          Equip All Suggestions
        </Button>
      </div>
    </div>
  );
};
