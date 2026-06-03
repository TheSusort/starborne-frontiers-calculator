import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillSlotList } from '../SkillSlotList';
import { Ability, ShipSkills } from '../../../types/abilities';

const damageAbility: Ability = {
    id: 'a1',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 150 },
};

const shipSkills: ShipSkills = {
    slots: [{ slot: 'active', abilities: [damageAbility] }],
};

describe('SkillSlotList', () => {
    it('renders Active and Charged rows when hasPassive is false', () => {
        render(<SkillSlotList shipSkills={shipSkills} hasPassive={false} onChange={vi.fn()} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Charged')).toBeInTheDocument();
        expect(screen.queryByText('Passive')).not.toBeInTheDocument();
    });

    it('renders a Passive row when hasPassive is true', () => {
        render(<SkillSlotList shipSkills={shipSkills} hasPassive={true} onChange={vi.fn()} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Charged')).toBeInTheDocument();
        expect(screen.getByText('Passive')).toBeInTheDocument();
    });

    it('shows the ability count for a populated slot', () => {
        render(<SkillSlotList shipSkills={shipSkills} hasPassive={false} onChange={vi.fn()} />);
        expect(screen.getByText('1 ability')).toBeInTheDocument();
        // empty charged slot
        expect(screen.getByText('0 abilities')).toBeInTheDocument();
    });

    it('opens the editor modal for the clicked slot', () => {
        render(<SkillSlotList shipSkills={shipSkills} hasPassive={false} onChange={vi.fn()} />);
        const editButtons = screen.getAllByRole('button', { name: 'Edit' });
        fireEvent.click(editButtons[0]);
        expect(screen.getByText('Active Skill')).toBeInTheDocument();
    });

    it('merges an edited skill back into shipSkills and calls onChange', () => {
        const onChange = vi.fn();
        render(<SkillSlotList shipSkills={shipSkills} hasPassive={false} onChange={onChange} />);
        const editButtons = screen.getAllByRole('button', { name: 'Edit' });
        fireEvent.click(editButtons[0]);

        // edit the multiplier inside the modal's AbilityCard
        fireEvent.change(screen.getByLabelText('Skill multiplier'), { target: { value: '250' } });

        expect(onChange).toHaveBeenCalledTimes(1);
        const updated: ShipSkills = onChange.mock.calls[0][0];
        const active = updated.slots.find((s) => s.slot === 'active');
        expect(active?.abilities[0].config).toMatchObject({ multiplier: 250 });
        // original untouched
        expect(shipSkills.slots[0].abilities[0].config).toMatchObject({ multiplier: 150 });
    });

    it('adds a new slot entry when editing a previously-empty slot', () => {
        const onChange = vi.fn();
        render(<SkillSlotList shipSkills={shipSkills} hasPassive={false} onChange={onChange} />);
        const editButtons = screen.getAllByRole('button', { name: 'Edit' });
        // second row is Charged, which has no slot entry yet
        fireEvent.click(editButtons[1]);

        fireEvent.click(screen.getByRole('button', { name: 'Add ability' }));
        fireEvent.click(screen.getByRole('button', { name: 'Charge' }));

        const updated: ShipSkills = onChange.mock.calls[0][0];
        const charged = updated.slots.find((s) => s.slot === 'charged');
        expect(charged).toBeDefined();
        expect(charged?.abilities[0].type).toBe('charge');
        // active slot preserved
        expect(updated.slots.find((s) => s.slot === 'active')).toBeDefined();
    });
});
