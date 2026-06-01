import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AbilityCard } from '../AbilityCard';
import { Ability } from '../../../types/abilities';

const damageAbility: Ability = {
    id: 'a1',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 1.5 },
};

const buffAbility: Ability = {
    id: 'a2',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: '',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
    },
};

describe('AbilityCard', () => {
    it('renders a multiplier input for a damage ability and fires onChange on edit', () => {
        const onChange = vi.fn();
        render(<AbilityCard ability={damageAbility} onChange={onChange} onRemove={vi.fn()} />);
        const input = screen.getByLabelText('Skill multiplier');
        fireEvent.change(input, { target: { value: '2' } });
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ type: 'damage', multiplier: 2 }),
            })
        );
    });

    it('appends a default condition when "Add condition" is clicked', () => {
        const onChange = vi.fn();
        render(<AbilityCard ability={damageAbility} onChange={onChange} onRemove={vi.fn()} />);
        fireEvent.click(screen.getByText('Add condition'));
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                conditions: [{ subject: 'always', derivable: true }],
            })
        );
    });

    it('renders the GameBuffPicker for a buff ability', () => {
        render(<AbilityCard ability={buffAbility} onChange={vi.fn()} onRemove={vi.fn()} />);
        // GameBuffPicker trigger shows "Select <label>…" when nothing selected.
        expect(screen.getByText(/Select .*Buff/i)).toBeInTheDocument();
    });

    it('calls onRemove when the remove button is clicked', () => {
        const onRemove = vi.fn();
        render(<AbilityCard ability={damageAbility} onChange={vi.fn()} onRemove={onRemove} />);
        fireEvent.click(screen.getByLabelText('Remove ability'));
        expect(onRemove).toHaveBeenCalled();
    });

    it('reconstructs picker value from config.buffName and shows selected buff', () => {
        const buffAbilityWithName: Ability = {
            ...buffAbility,
            config: {
                ...buffAbility.config,
                type: 'buff',
                buffName: 'test-buff',
                parsedEffects: { attack: 10 },
                stacks: 1,
                isStackable: false,
            },
        };

        render(<AbilityCard ability={buffAbilityWithName} onChange={vi.fn()} onRemove={vi.fn()} />);

        // When a buff ability has config.buffName set, the GameBuffPicker
        // reconstructs its value and displays the selected buff.
        // Verify: the selected buff name appears in the rendered output
        // (GameBuffPicker displays selected buffs with their name and effects)
        expect(screen.getByText(/test-buff/i)).toBeInTheDocument();
        expect(screen.getByText(/\+10% Atk/i)).toBeInTheDocument();
    });
});
