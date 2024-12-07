import React from 'react';
import { Button } from '../ui';

interface PageLayoutProps {
    title: string;
    children: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
        variant?: 'primary' | 'secondary';
    };
}

export const PageLayout: React.FC<PageLayoutProps> = ({
    title,
    children,
    action
}) => {
    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-200">{title}</h1>
                {action && (
                    <Button
                        variant={action.variant || 'primary'}
                        onClick={action.onClick}
                    >
                        {action.label}
                    </Button>
                )}
            </div>
            {children}
        </div>
    );
};