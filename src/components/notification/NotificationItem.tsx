import React from 'react';
import { Notification } from '../../types/notification';
import { CloseIcon } from '../ui';

interface NotificationItemProps {
    notification: Notification;
    onClose: (id: string) => void;
}

export const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onClose }) => {
    const baseClasses = 'flex items-center p-4  shadow-lg mb-2 text-white';
    const typeClasses = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-yellow-500',
    };

    return (
        <div className={`${baseClasses} ${typeClasses[notification.type]}`}>
            <span className="flex-grow">{notification.message}</span>
            <button
                onClick={() => onClose(notification.id)}
                aria-label="Close notification"
                className="ml-4 text-white hover:"
            >
                <CloseIcon />
            </button>
        </div>
    );
};
