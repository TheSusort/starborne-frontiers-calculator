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

export const PageLayout: React.FC<PageLayoutProps> = ({ title, description, children, action }) => {
    return (
        <div className="space-y-8">
            <div>
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold ">{title}</h1>
                    {action && (
                        <Button
                            aria-label={action.label}
                            variant={action.variant || 'primary'}
                            onClick={action.onClick}
                        >
                            {action.label}
                        </Button>
                    )}
                </div>
                {description && (
                    <p className="text-sm text-gray-400 order-2 w-full">{description}</p>
                )}
            </div>
            {children}
        </div>
    );
};
