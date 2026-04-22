import React, { useState, useCallback } from 'react';
import { Notification, NotificationType } from '../types/notification';
import { NotificationContext } from './NotificationContext';

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const removeNotification = useCallback((id: string) => {
        setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    }, []);

    const addNotification = useCallback(
        (type: NotificationType, message: string, duration?: number) => {
            const resolvedDuration = duration ?? (type === 'error' ? 15000 : 5000);
            const id = Date.now().toString() + Math.random().toString(36).substring(2, 15);
            const notification: Notification = { id, type, message, duration: resolvedDuration };

            setNotifications((prev) => [...prev, notification]);

            if (resolvedDuration > 0) {
                setTimeout(() => {
                    removeNotification(id);
                }, resolvedDuration);
            }
        },
        [removeNotification]
    );

    return (
        <NotificationContext.Provider
            value={{ notifications, addNotification, removeNotification }}
        >
            {children}
        </NotificationContext.Provider>
    );
};
