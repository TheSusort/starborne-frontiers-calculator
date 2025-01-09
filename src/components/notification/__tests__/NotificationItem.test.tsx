import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { NotificationItem } from '../NotificationItem';
import { Notification } from '../../../types/notification';
import { vi } from 'vitest';

describe('NotificationItem', () => {
    const mockNotification: Notification = {
        id: '1',
        type: 'success',
        message: 'Test notification',
        duration: 5000,
    };

    const defaultProps = {
        notification: mockNotification,
        onClose: vi.fn(),
    };

    test.each([
        ['success', 'bg-green-500'],
        ['error', 'bg-red-500'],
        ['info', 'bg-blue-500'],
        ['warning', 'bg-yellow-500'],
    ])('applies correct background color for %s type', (type, expectedClass) => {
        render(
            <NotificationItem
                {...defaultProps}
                notification={{ ...mockNotification, type: type as Notification['type'] }}
            />
        );

        const notification = screen.getByText('Test notification').parentElement;
        expect(notification).toHaveClass(expectedClass);
    });

    test('displays notification message', () => {
        render(<NotificationItem {...defaultProps} />);
        expect(screen.getByText('Test notification')).toBeInTheDocument();
    });

    test('calls onClose when close button is clicked', () => {
        render(<NotificationItem {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /close notification/i }));
        expect(defaultProps.onClose).toHaveBeenCalledWith('1');
    });

    test('renders with base styles', () => {
        render(<NotificationItem {...defaultProps} />);

        const notification = screen.getByText('Test notification').parentElement;
        expect(notification).toHaveClass(
            'flex',
            'items-center',
            'p-4',
            '',
            'shadow-lg',
            'mb-2',
            'text-white'
        );
    });

    test('close button has correct styles', () => {
        render(<NotificationItem {...defaultProps} />);

        const closeButton = screen.getByRole('button', { name: /close notification/i });
        expect(closeButton).toHaveClass('ml-4', 'text-white', 'hover:');
    });
});
