import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConditionRow } from '../ConditionRow';
import { Condition } from '../../../types/abilities';

const baseCondition: Condition = { subject: 'always', derivable: true };

describe('ConditionRow', () => {
    it('renders the subject select', () => {
        render(<ConditionRow condition={baseCondition} onChange={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByLabelText('Condition')).toBeInTheDocument();
    });

    it('fires onChange with the new subject when the subject select changes', () => {
        const onChange = vi.fn();
        render(<ConditionRow condition={baseCondition} onChange={onChange} onRemove={vi.fn()} />);
        // Open the subject select then choose 'enemy-type' option.
        fireEvent.click(screen.getByLabelText('Condition'));
        fireEvent.click(screen.getByText('when enemy matches type'));
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ subject: 'enemy-type' }));
    });

    it('reveals the manualCount input when "Set manually" is checked', () => {
        const onChange = vi.fn();
        // derivable true → checkbox unchecked → no manual input
        const { rerender } = render(
            <ConditionRow condition={baseCondition} onChange={onChange} onRemove={vi.fn()} />
        );
        expect(screen.queryByLabelText('Assume active / trigger count')).not.toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Set manually (assume active)'));
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ derivable: false }));

        // Re-render with derivable false to show the manual input.
        rerender(
            <ConditionRow
                condition={{ ...baseCondition, derivable: false, manualCount: 1 }}
                onChange={onChange}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByLabelText('Assume active / trigger count')).toBeInTheDocument();
    });

    it('reveals the requiredEnemyType select when subject is enemy-type', () => {
        render(
            <ConditionRow
                condition={{ subject: 'enemy-type', derivable: true }}
                onChange={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByLabelText('Enemy type')).toBeInTheDocument();
    });

    it('calls onRemove when the remove button is clicked', () => {
        const onRemove = vi.fn();
        render(<ConditionRow condition={baseCondition} onChange={vi.fn()} onRemove={onRemove} />);
        fireEvent.click(screen.getByLabelText('Remove condition'));
        expect(onRemove).toHaveBeenCalled();
    });
});
