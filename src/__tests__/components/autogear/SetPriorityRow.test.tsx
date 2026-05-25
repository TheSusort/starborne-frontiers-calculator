import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SetPriorityRow } from '../../../components/autogear/SetPriorityRow';

// Sidebar imports /favicon.ico?url which is not available in test environment
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const noop = vi.fn();
const baseProps = {
    isEditing: false,
    canMoveUp: false,
    canMoveDown: false,
    onUpdate: noop,
    onEdit: noop,
    onMoveUp: noop,
    onMoveDown: noop,
    onRemove: noop,
};

describe('SetPriorityRow', () => {
    it('renders gear-set row with count editor', () => {
        render(<SetPriorityRow {...baseProps} priority={{ setName: 'SHIELD', count: 2 }} />);
        expect(screen.getByText(/shield/i)).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText(/pieces/i)).toBeInTheDocument();
    });

    it('does NOT crash for implant-type key and hides count editor', () => {
        const availableImplantTypes = [{ key: 'HASTE', name: 'Haste', label: 'Haste' }];
        render(
            <SetPriorityRow
                {...baseProps}
                priority={{ setName: 'HASTE', count: 1, kind: 'implant' }}
                availableImplantTypes={availableImplantTypes}
            />
        );
        expect(screen.getByText('Haste')).toBeInTheDocument();
        expect(screen.queryByText(/pieces/i)).not.toBeInTheDocument();
    });

    it('falls back to setName when implant type not in availableImplantTypes', () => {
        render(
            <SetPriorityRow
                {...baseProps}
                priority={{ setName: 'UNKNOWN_TYPE', count: 1, kind: 'implant' }}
            />
        );
        expect(screen.getByText('UNKNOWN_TYPE')).toBeInTheDocument();
    });
});
