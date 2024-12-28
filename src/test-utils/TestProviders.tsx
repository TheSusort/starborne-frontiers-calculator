import React from 'react';
import { NotificationProvider } from '../contexts/NotificationProvider';

export const TestProviders = ({ children }: { children: React.ReactNode }) => {
    return <NotificationProvider>{children}</NotificationProvider>;
};
