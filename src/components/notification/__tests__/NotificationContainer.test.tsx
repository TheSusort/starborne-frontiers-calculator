import { render, screen } from '../../../test-utils/test-utils';
import { NotificationContainer } from '../NotificationContainer';
import { useNotification } from '../../../hooks/useNotification';
import { vi } from 'vitest';
import { Notification } from '../../../types/notification';
vi.mock('../../../hooks/useNotification', () => ({
    useNotification: vi.fn(),
}));

describe('NotificationContainer', () => {
    const mockNotifications: Notification[] = [
        { id: '1', type: 'success', message: 'Success message' },
        { id: '2', type: 'error', message: 'Error message' },
    ];

    const mockRemoveNotification = vi.fn();

    beforeEach(() => {
        vi.mocked(useNotification).mockReturnValue({
            notifications: mockNotifications,
            removeNotification: mockRemoveNotification,
            addNotification: vi.fn(),
        });
    });

    test('renders all notifications', () => {
        render(<NotificationContainer />);

        expect(screen.getByText('Success message')).toBeInTheDocument();
        expect(screen.getByText('Error message')).toBeInTheDocument();
    });

    test('renders container with correct styles', () => {
        render(<NotificationContainer />);

        const container = screen.getByRole('complementary');
        expect(container).toHaveClass('fixed', 'top-4', 'right-4', 'z-50', 'w-96', 'space-y-2');
    });
});
