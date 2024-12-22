import React from 'react';
import { Button } from '../';

interface PageLayoutProps {
    title: string;
    description?: string;
    children: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
        variant?: 'primary' | 'secondary';
    };
}

export const PageLayout: React.FC<PageLayoutProps> = ({
    title,
    description,
    children,
    action
}) => {
    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div className="">
                    <h1 className="text-2xl font-bold text-gray-200">{title}</h1>
                    {description && <p className="text-sm text-gray-400">{description}</p>}
                </div>
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