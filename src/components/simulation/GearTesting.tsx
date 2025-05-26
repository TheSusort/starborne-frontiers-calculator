import React from 'react';
import { GearPiece } from '../../types/gear';
import { GearSlotName, GEAR_SLOT_ORDER } from '../../constants';
import { GearSlot } from '../gear/GearSlot';
import { Button } from '../ui';

interface GearTestingProps {
    temporaryGear: Partial<Record<GearSlotName, string>>;
    getGearPiece: (id: string) => GearPiece | undefined;
    hoveredGear: GearPiece | null;
    onGearHover: (gear: GearPiece | null) => void;
    onSelectSlot: (slot: GearSlotName) => void;
    onRemoveGear: (slot: GearSlotName) => void;
    onSaveChanges: () => void;
    onResetChanges: () => void;
    hasChanges: boolean;
}

export const GearTesting: React.FC<GearTestingProps> = ({
    temporaryGear,
    getGearPiece,
    hoveredGear,
    onGearHover,
    onSelectSlot,
    onRemoveGear,
    onSaveChanges,
    onResetChanges,
    hasChanges,
}) => {
    return (
        <div className="space-y-4">
            <h4 className="font-semibold">Gear</h4>
            <div className="p-4 bg-dark">
                <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                    {GEAR_SLOT_ORDER.map((slotKey) => (
                        <GearSlot
                            key={slotKey}
                            slotKey={slotKey}
                            gear={
                                temporaryGear[slotKey]
                                    ? getGearPiece(temporaryGear[slotKey]!)
                                    : undefined
                            }
                            hoveredGear={hoveredGear}
                            onSelect={onSelectSlot}
                            onRemove={onRemoveGear}
                            onHover={onGearHover}
                        />
                    ))}
                </div>

                {hasChanges && (
                    <div className="flex gap-2 mt-4 justify-end">
                        <Button variant="primary" onClick={onSaveChanges}>
                            Equip Ship
                        </Button>
                        <Button variant="secondary" onClick={onResetChanges}>
                            Reset
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
