import React from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GearSlotName } from '../../constants';
import { GearSlot } from '../gear/GearSlot';
import { Button } from '../ui';

interface GearTestingProps {
    ship: Ship;
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
    ship,
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
            <h3 className="text-xl font-bold">Test Gear</h3>
            <div className="p-4 bg-dark">
                <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                    {Object.entries(temporaryGear).map(([slot, gearId]) => (
                        <GearSlot
                            key={slot}
                            slotKey={slot as GearSlotName}
                            gear={gearId ? getGearPiece(gearId) : undefined}
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
