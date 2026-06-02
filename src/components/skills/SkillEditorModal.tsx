import React, { useEffect, useState } from 'react';
import { Ability, AbilityType, Skill, SkillSlot } from '../../types/abilities';
import { Ship } from '../../types/ship';
import { Modal } from '../ui/layout/Modal';
import { Button } from '../ui/Button';
import { getSkillRowForSlot } from '../../utils/ship/skillRows';
import { SkillTooltip } from '../ship/SkillTooltip';
import { AbilityCard } from './AbilityCard';
import { AbilityTypePicker } from './AbilityTypePicker';
import { makeDefaultAbility } from './abilityDefaults';

interface Props {
    isOpen: boolean;
    slot: SkillSlot;
    skill: Skill | undefined;
    /** When provided, shows this slot's in-game skill text as reference. */
    ship?: Ship;
    /** All slots the user can edit; renders header shortcuts to the other slots. */
    availableSlots?: SkillSlot[];
    /** Switch the modal to another slot in place (no close/reopen). */
    onNavigate?: (slot: SkillSlot) => void;
    onChange: (skill: Skill) => void;
    onClose: () => void;
}

const SLOT_LABELS: Record<SkillSlot, string> = {
    active: 'Active Skill',
    charged: 'Charged Skill',
    passive: 'Passive Skill',
};

const SLOT_SHORT_LABELS: Record<SkillSlot, string> = {
    active: 'Active',
    charged: 'Charged',
    passive: 'Passive',
};

export const SkillEditorModal: React.FC<Props> = ({
    isOpen,
    slot,
    skill,
    ship,
    availableSlots,
    onNavigate,
    onChange,
    onClose,
}) => {
    const [pickerOpen, setPickerOpen] = useState(false);

    // Switching to another slot reuses this component instance — collapse the picker so the
    // newly-shown slot doesn't open mid-add.
    useEffect(() => setPickerOpen(false), [slot]);

    const currentSkill: Skill = skill ?? { slot, abilities: [] };
    const referenceRow = ship ? getSkillRowForSlot(ship, slot) : undefined;

    // Header shortcuts to the OTHER editable slots (e.g. from Active → Charged / Passive).
    const otherSlots = (availableSlots ?? []).filter((s) => s !== slot);
    const headerActions =
        onNavigate && otherSlots.length > 0 ? (
            <div className="flex items-center gap-1">
                {otherSlots.map((s) => (
                    <Button
                        key={s}
                        variant="secondary"
                        size="xs"
                        onClick={() => onNavigate(s)}
                        aria-label={`Edit ${SLOT_LABELS[s]}`}
                    >
                        {SLOT_SHORT_LABELS[s]}
                    </Button>
                ))}
            </div>
        ) : undefined;

    const handleAbilityChange = (index: number, updated: Ability) => {
        onChange({
            ...currentSkill,
            abilities: currentSkill.abilities.map((a, i) => (i === index ? updated : a)),
        });
    };

    const handleAbilityRemove = (index: number) => {
        onChange({
            ...currentSkill,
            abilities: currentSkill.abilities.filter((_, i) => i !== index),
        });
    };

    const handlePick = (type: AbilityType) => {
        onChange({
            ...currentSkill,
            abilities: [...currentSkill.abilities, makeDefaultAbility(type)],
        });
        setPickerOpen(false);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={SLOT_LABELS[slot]}
            headerActions={headerActions}
        >
            <div className="space-y-4">
                {referenceRow && (
                    <div className="pb-2 border-b border-dark-border">
                        <p className="text-xs uppercase tracking-wide text-theme-text-secondary mb-2">
                            Skill Reference
                        </p>
                        <SkillTooltip
                            inline
                            skillText={referenceRow.text}
                            skillType={referenceRow.label}
                            charge={referenceRow.charge}
                        />
                    </div>
                )}

                {currentSkill.abilities.length === 0 && (
                    <p className="text-sm text-theme-text-secondary">
                        No abilities yet. Add one below.
                    </p>
                )}

                {currentSkill.abilities.map((ability, index) => (
                    <AbilityCard
                        key={ability.id}
                        ability={ability}
                        onChange={(updated) => handleAbilityChange(index, updated)}
                        onRemove={() => handleAbilityRemove(index)}
                    />
                ))}

                {pickerOpen ? (
                    <AbilityTypePicker onPick={handlePick} />
                ) : (
                    <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                        Add ability
                    </Button>
                )}
            </div>
        </Modal>
    );
};
