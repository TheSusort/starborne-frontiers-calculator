import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationProvider } from '../contexts/NotificationProvider';

export const TestProviders = ({ children }: { children: React.ReactNode }) => {
    return (
        <MemoryRouter>
            <NotificationProvider>{children}</NotificationProvider>
        </MemoryRouter>
    );
};
