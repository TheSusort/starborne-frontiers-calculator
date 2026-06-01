import React, { useState } from 'react';
import { Ability, AbilityType, Skill, SkillSlot } from '../../types/abilities';
import { Modal } from '../ui/layout/Modal';
import { Button } from '../ui/Button';
import { AbilityCard } from './AbilityCard';
import { AbilityTypePicker } from './AbilityTypePicker';
import { makeDefaultAbility } from './abilityDefaults';

interface Props {
    isOpen: boolean;
    slot: SkillSlot;
    skill: Skill | undefined;
    onChange: (skill: Skill) => void;
    onClose: () => void;
}

const SLOT_LABELS: Record<SkillSlot, string> = {
    active: 'Active Skill',
    charged: 'Charged Skill',
    passive: 'Passive Skill',
};

export const SkillEditorModal: React.FC<Props> = ({ isOpen, slot, skill, onChange, onClose }) => {
    const [pickerOpen, setPickerOpen] = useState(false);

    const currentSkill: Skill = skill ?? { slot, abilities: [] };

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
        <Modal isOpen={isOpen} onClose={onClose} title={SLOT_LABELS[slot]}>
            <div className="space-y-4">
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
