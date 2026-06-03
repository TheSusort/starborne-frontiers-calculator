import React, { useState } from 'react';
import { ShipSkills, Skill, SkillSlot } from '../../types/abilities';
import { Ship } from '../../types/ship';
import { Button } from '../ui/Button';
import { SkillEditorModal } from './SkillEditorModal';

interface Props {
    shipSkills: ShipSkills;
    hasPassive: boolean;
    /** Selected ship, used to show per-slot skill-text reference in the editor modal. */
    ship?: Ship;
    onChange: (shipSkills: ShipSkills) => void;
}

const SLOT_LABELS: Record<SkillSlot, string> = {
    active: 'Active',
    charged: 'Charged',
    passive: 'Passive',
};

export const SkillSlotList: React.FC<Props> = ({ shipSkills, hasPassive, ship, onChange }) => {
    const [openSlot, setOpenSlot] = useState<SkillSlot | null>(null);

    const slots: SkillSlot[] = hasPassive
        ? ['active', 'charged', 'passive']
        : ['active', 'charged'];

    const findSkill = (slot: SkillSlot): Skill | undefined =>
        shipSkills.slots.find((s) => s.slot === slot);

    const handleSkillChange = (updated: Skill) => {
        const exists = shipSkills.slots.some((s) => s.slot === updated.slot);
        const nextSlots = exists
            ? shipSkills.slots.map((s) => (s.slot === updated.slot ? updated : s))
            : [...shipSkills.slots, updated];
        onChange({ ...shipSkills, slots: nextSlots });
    };

    return (
        <div className="space-y-2 mb-4">
            {slots.map((slot) => {
                const skill = findSkill(slot);
                const count = skill?.abilities.length ?? 0;
                return (
                    <div key={slot} className="card flex items-center justify-between">
                        <div>
                            <span className="text-sm font-semibold">{SLOT_LABELS[slot]}</span>
                            <span className="ml-2 text-xs text-theme-text-secondary">
                                {count} {count === 1 ? 'ability' : 'abilities'}
                            </span>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => setOpenSlot(slot)}>
                            Edit
                        </Button>
                    </div>
                );
            })}

            {openSlot && (
                <SkillEditorModal
                    isOpen
                    slot={openSlot}
                    skill={findSkill(openSlot)}
                    ship={ship}
                    availableSlots={slots}
                    onNavigate={setOpenSlot}
                    onChange={handleSkillChange}
                    onClose={() => setOpenSlot(null)}
                />
            )}
        </div>
    );
};
