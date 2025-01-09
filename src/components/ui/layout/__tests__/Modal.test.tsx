import { render, screen, fireEvent } from '../../../../test-utils/test-utils';
import { Modal } from '../Modal';
import { vi } from 'vitest';

describe('Modal Component', () => {
    const defaultProps = {
        isOpen: true,
        onClose: () => {},
        title: 'Test Modal',
    };

    test('renders modal when open', () => {
        render(
            <Modal {...defaultProps}>
                <div>Modal content</div>
            </Modal>
        );

        expect(screen.getByText('Test Modal')).toBeInTheDocument();
        expect(screen.getByText('Modal content')).toBeInTheDocument();
    });

    test('does not render when closed', () => {
        render(
            <Modal {...defaultProps} isOpen={false}>
                <div>Modal content</div>
            </Modal>
        );

        expect(screen.queryByText('Modal content')).not.toBeInTheDocument();
        expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
    });

    test('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <Modal {...defaultProps} onClose={onClose}>
                <div>Modal content</div>
            </Modal>
        );

        const closeButton = screen.getByRole('button', { name: /close modal/i });
        fireEvent.click(closeButton);

        expect(onClose).toHaveBeenCalled();
    });

    test('calls onClose when clicking overlay', () => {
        const onClose = vi.fn();
        render(
            <Modal {...defaultProps} onClose={onClose}>
                <div>Modal content</div>
            </Modal>
        );

        // Find and click the flex container that acts as the overlay
        const overlay = screen
            .getByRole('presentation', { hidden: true })
            .nextElementSibling?.querySelector('.flex.min-h-full');
        expect(overlay).toBeInTheDocument();
        if (overlay) fireEvent.click(overlay);

        expect(onClose).toHaveBeenCalled();
    });

    test('does not close when clicking modal content', () => {
        const onClose = vi.fn();
        render(
            <Modal {...defaultProps} onClose={onClose}>
                <div>Modal content</div>
            </Modal>
        );

        const modalContent = screen.getByText('Modal content');
        fireEvent.click(modalContent);

        expect(onClose).not.toHaveBeenCalled();
    });

    test('renders with correct structure', () => {
        render(
            <Modal {...defaultProps}>
                <div>Modal content</div>
            </Modal>
        );

        // Check for the main structural elements
        expect(screen.getByRole('presentation', { hidden: true })).toHaveClass(
            'bg-black',
            'bg-opacity-50'
        ); // Overlay

        // Header section
        const header = screen.getByRole('heading', { level: 3 });
        expect(header).toHaveTextContent('Test Modal');
        expect(header).toHaveClass('text-xl', 'font-semibold', '');

        // Content section
        const content = screen.getByText('Modal content');
        expect(content.parentElement).toHaveClass('px-6', 'py-4');
    });

    test('renders close button with correct styling', () => {
        render(
            <Modal {...defaultProps}>
                <div>Modal content</div>
            </Modal>
        );

        const closeButton = screen.getByRole('button', { name: /close modal/i });
        expect(closeButton).toHaveClass('bg-dark'); // assuming secondary variant has this class
    });
});
