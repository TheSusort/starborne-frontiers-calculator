import React from 'react';
import { Notification } from '../../types/notification';
import { CloseIcon } from '../ui';

interface NotificationItemProps {
    notification: Notification;
    onClose: (id: string) => void;
}

export const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onClose }) => {
    const baseClasses = 'flex items-center p-4 shadow-lg mb-2 text-white';
    const typeClasses = {
        success: 'bg-green-500 notification-success',
        error: 'bg-red-500 notification-error',
        info: 'bg-blue-500 notification-info',
        warning: 'bg-yellow-500 notification-warning',
    };

    return (
        <div className={`${baseClasses} ${typeClasses[notification.type]}`}>
            <span className="flex-grow">{notification.message}</span>
            <span
                role="button"
                tabIndex={0}
                onClick={() => onClose(notification.id)}
                onKeyDown={(e) => e.key === 'Enter' && onClose(notification.id)}
                aria-label="Close notification"
                className="ml-4 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            >
                <CloseIcon />
            </span>
        </div>
    );
};
