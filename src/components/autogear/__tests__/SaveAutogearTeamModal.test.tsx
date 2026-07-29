import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { SaveAutogearTeamModal } from '../SaveAutogearTeamModal';
import { Ship } from '../../../types/ship';

// Modal → ui/index → Sidebar → /favicon.ico?url which Vitest cannot resolve
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const makeShip = (id: string, name: string): Ship => ({ id, name }) as Ship;

const ships = [makeShip('1', 'Lodolite'), makeShip('2', 'Zeolite')];

const renderModal = (overrides: Partial<Parameters<typeof SaveAutogearTeamModal>[0]> = {}) => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
        <SaveAutogearTeamModal
            isOpen
            onClose={onClose}
            ships={ships}
            existingNames={['Arena A']}
            onSave={onSave}
            {...overrides}
        />
    );

    return { onSave, onClose };
};

describe('SaveAutogearTeamModal', () => {
    it('lists the ships in selection order', () => {
        renderModal();

        expect(screen.getByText('1. Lodolite')).toBeInTheDocument();
        expect(screen.getByText('2. Zeolite')).toBeInTheDocument();
    });

    it('pre-fills the name when one is suggested', () => {
        renderModal({ initialName: 'Wave 3 Farm' });

        expect(screen.getByLabelText('Team name')).toHaveValue('Wave 3 Farm');
    });

    it('saves the trimmed name', () => {
        const { onSave } = renderModal();

        fireEvent.change(screen.getByLabelText('Team name'), { target: { value: '  Arena B  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

        expect(onSave).toHaveBeenCalledWith('Arena B');
    });

    it('rejects a duplicate name without saving', () => {
        const { onSave } = renderModal();

        fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'arena a' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

        expect(screen.getByText('A team with this name already exists')).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('rejects an empty name without saving', () => {
        const { onSave } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

        expect(screen.getByText('Give the team a name')).toBeInTheDocument();
        expect(onSave).not.toHaveBeenCalled();
    });
});
