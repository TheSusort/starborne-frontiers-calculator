import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillEditorModal } from '../SkillEditorModal';
import { Ability, Skill } from '../../../types/abilities';

const damageAbility: Ability = {
    id: 'a1',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 150 },
};

const skill: Skill = { slot: 'active', abilities: [damageAbility] };

describe('SkillEditorModal', () => {
    it('renders the slot title', () => {
        render(
            <SkillEditorModal
                isOpen
                slot="charged"
                skill={skill}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText('Charged Skill')).toBeInTheDocument();
    });

    it('renders an AbilityCard for each ability in the skill', () => {
        render(
            <SkillEditorModal
                isOpen
                slot="active"
                skill={skill}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />
        );
        // AbilityCard for a damage ability exposes a Multiplier input.
        expect(screen.getByLabelText('Multiplier')).toBeInTheDocument();
    });

    it('appends a default ability when adding via the picker', () => {
        const onChange = vi.fn();
        render(
            <SkillEditorModal
                isOpen
                slot="active"
                skill={skill}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add ability' }));
        fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));

        expect(onChange).toHaveBeenCalledTimes(1);
        const updated: Skill = onChange.mock.calls[0][0];
        expect(updated.abilities).toHaveLength(2);
        expect(updated.abilities[1].type).toBe('modifier');
    });

    it('updates an ability immutably on edit', () => {
        const onChange = vi.fn();
        render(
            <SkillEditorModal
                isOpen
                slot="active"
                skill={skill}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );
        fireEvent.change(screen.getByLabelText('Multiplier'), { target: { value: '200' } });
        const updated: Skill = onChange.mock.calls[0][0];
        expect(updated.abilities[0].config).toMatchObject({ type: 'damage', multiplier: 200 });
        // original skill untouched
        expect(skill.abilities[0].config).toMatchObject({ multiplier: 150 });
    });

    it('treats an undefined skill as an empty editable skill', () => {
        const onChange = vi.fn();
        render(
            <SkillEditorModal
                isOpen
                slot="passive"
                skill={undefined}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText(/No abilities yet/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Add ability' }));
        fireEvent.click(screen.getByRole('button', { name: 'Charge' }));
        const updated: Skill = onChange.mock.calls[0][0];
        expect(updated.slot).toBe('passive');
        expect(updated.abilities).toHaveLength(1);
        expect(updated.abilities[0].type).toBe('charge');
    });

    it('renders nothing when closed', () => {
        render(
            <SkillEditorModal
                isOpen={false}
                slot="active"
                skill={skill}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(screen.queryByText('Active Skill')).not.toBeInTheDocument();
    });
});
