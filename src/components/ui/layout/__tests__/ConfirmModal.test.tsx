import { render, screen, fireEvent } from '../../../../test-utils/test-utils';
import { ConfirmModal } from '../ConfirmModal';
import { vi } from 'vitest';

describe('ConfirmModal Component', () => {
    const defaultProps = {
        isOpen: true,
        onClose: () => {},
        onConfirm: () => {},
        title: 'Confirm Action',
        message: 'Are you sure you want to proceed?',
    };

    test('renders modal with default labels', () => {
        render(<ConfirmModal {...defaultProps} />);

        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
        expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    test('renders with custom labels', () => {
        render(
            <ConfirmModal {...defaultProps} confirmLabel="Yes, delete" cancelLabel="No, keep it" />
        );

        expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'No, keep it' })).toBeInTheDocument();
    });

    test('calls onConfirm and onClose when confirm button is clicked', () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        render(<ConfirmModal {...defaultProps} onConfirm={onConfirm} onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('calls onClose when cancel button is clicked', () => {
        const onClose = vi.fn();
        render(<ConfirmModal {...defaultProps} onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('does not render when isOpen is false', () => {
        render(<ConfirmModal {...defaultProps} isOpen={false} />);

        expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
        expect(screen.queryByText('Are you sure you want to proceed?')).not.toBeInTheDocument();
    });

    test('renders with correct button variants', () => {
        render(<ConfirmModal {...defaultProps} />);

        const confirmButton = screen.getByRole('button', { name: 'Confirm' });
        const cancelButton = screen.getByRole('button', { name: 'Cancel' });

        expect(confirmButton).toHaveClass('bg-gradient-to-r', 'from-red-600', 'to-red-500'); // danger variant
        expect(cancelButton).toHaveClass('bg-dark'); // secondary variant
    });

    test('renders with correct layout structure', () => {
        render(<ConfirmModal {...defaultProps} />);

        const message = screen.getByText('Are you sure you want to proceed?');
        expect(message).toHaveClass('');

        const buttonContainer = screen.getByRole('button', { name: 'Confirm' }).parentElement;
        expect(buttonContainer).toHaveClass('flex', 'justify-end', 'gap-3');
    });
});
