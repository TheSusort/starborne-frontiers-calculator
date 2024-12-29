import { renderHook } from '../../test-utils/test-utils';
import { useNotification } from '../useNotification';
import { NotificationContext } from '../../contexts/NotificationContext';
import { Notification } from '../../types/notification';
import { vi } from 'vitest';
import React from 'react';

describe('useNotification Hook', () => {
    const mockNotificationContext = {
        notifications: [],
        addNotification: vi.fn(),
        removeNotification: vi.fn(),
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <NotificationContext.Provider value={mockNotificationContext}>
            {children}
        </NotificationContext.Provider>
    );

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('returns notification context when used within provider', () => {
        const { result } = renderHook(() => useNotification(), { wrapper });

        expect(result.current).toEqual(mockNotificationContext);
        expect(result.current.addNotification).toBeDefined();
        expect(result.current.removeNotification).toBeDefined();
        expect(result.current.notifications).toEqual([]);
    });

    test('throws error when used outside provider', () => {
        expect(() => {
            renderHook(() => {
                // This will throw when accessing the hook's result
                const { notifications } = useNotification();
                return notifications;
            });
        }).toThrow('useNotification must be used within a NotificationProvider');
    });

    test('addNotification function is callable', () => {
        const { result } = renderHook(() => useNotification(), { wrapper });

        result.current.addNotification('success', 'Test notification');
        expect(mockNotificationContext.addNotification).toHaveBeenCalledWith(
            'success',
            'Test notification'
        );
    });

    test('addNotification accepts custom duration', () => {
        const { result } = renderHook(() => useNotification(), { wrapper });

        result.current.addNotification('success', 'Test notification', 5000);
        expect(mockNotificationContext.addNotification).toHaveBeenCalledWith(
            'success',
            'Test notification',
            5000
        );
    });

    test('removeNotification function is callable', () => {
        const { result } = renderHook(() => useNotification(), { wrapper });

        result.current.removeNotification('test-id');
        expect(mockNotificationContext.removeNotification).toHaveBeenCalledWith('test-id');
    });

    test('notifications array is accessible', () => {
        const contextWithNotifications = {
            ...mockNotificationContext,
            notifications: [
                { id: '1', type: 'success', message: 'Test 1' },
                { id: '2', type: 'error', message: 'Test 2' },
            ] as Notification[],
        };

        const customWrapper = ({ children }: { children: React.ReactNode }) => (
            <NotificationContext.Provider value={contextWithNotifications}>
                {children}
            </NotificationContext.Provider>
        );

        const { result } = renderHook(() => useNotification(), { wrapper: customWrapper });

        expect(result.current.notifications).toHaveLength(2);
        expect(result.current.notifications[0]).toEqual({
            id: '1',
            type: 'success',
            message: 'Test 1',
        });
        expect(result.current.notifications[1]).toEqual({
            id: '2',
            type: 'error',
            message: 'Test 2',
        });
    });
});
