import React from 'react';
import { useNotification } from '../../hooks/useNotification';
import { NotificationItem } from './NotificationItem';

export const NotificationContainer: React.FC = () => {
    const { notifications, removeNotification } = useNotification();

    return (
        <div className="fixed top-4 right-4 z-[110] w-96 space-y-2" role="complementary">
            {notifications.map((notification) => (
                <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onClose={removeNotification}
                />
            ))}
        </div>
    );
};
