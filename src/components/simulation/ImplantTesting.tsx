import React from 'react';
import { GearPiece } from '../../types/gear';
import { GearSlotName, IMPLANT_SLOT_ORDER, ImplantSlotName } from '../../constants';
import { GearSlot } from '../gear/GearSlot';
import { Button } from '../ui';

interface ImplantTestingProps {
    temporaryImplants: Partial<Record<GearSlotName, string>>;
    getGearPiece: (id: string) => GearPiece | undefined;
    hoveredGear: GearPiece | null;
    onGearHover: (gear: GearPiece | null) => void;
    onSelectSlot: (slot: ImplantSlotName) => void;
    onRemoveImplant: (slot: ImplantSlotName) => void;
    onSaveChanges: () => void;
    onResetChanges: () => void;
    hasChanges: boolean;
}

export const ImplantTesting: React.FC<ImplantTestingProps> = ({
    temporaryImplants,
    getGearPiece,
    hoveredGear,
    onGearHover,
    onSelectSlot,
    onRemoveImplant,
    onSaveChanges,
    onResetChanges,
    hasChanges,
}) => {
    return (
        <div className="space-y-4">
            <h4 className="font-semibold">Implants</h4>
            <div className="p-4 bg-dark">
                <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                    {IMPLANT_SLOT_ORDER.map((slotKey) => (
                        <GearSlot
                            key={slotKey}
                            slotKey={slotKey}
                            gear={
                                temporaryImplants[slotKey]
                                    ? getGearPiece(temporaryImplants[slotKey]!)
                                    : undefined
                            }
                            hoveredGear={hoveredGear}
                            onSelect={onSelectSlot}
                            onRemove={onRemoveImplant}
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
