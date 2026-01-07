import React, { useState, useRef } from 'react';
import { Button, InfoIcon, Tooltip } from '../';
import { Link } from 'react-router-dom';

interface PageLayoutProps {
    title: string;
    description?: string;
    children: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
        variant?: 'primary' | 'secondary';
    };
    helpLink?: string;
}

export const PageLayout: React.FC<PageLayoutProps> = ({
    title,
    description,
    children,
    action,
    helpLink,
}) => {
    const [pathname, hash] = helpLink?.split('#') || [''];
    const [isTooltipVisible, setIsTooltipVisible] = useState(false);
    const tooltipRef = useRef<HTMLDivElement>(null);

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
                {helpLink && (
                    <div
                        ref={tooltipRef}
                        onMouseEnter={() => setIsTooltipVisible(true)}
                        onMouseLeave={() => setIsTooltipVisible(false)}
                        className="relative w-fit"
                    >
                        <Button variant="secondary" size="sm" className="mt-2">
                            <Link
                                to={{
                                    pathname,
                                    hash,
                                }}
                                className="flex items-center gap-2"
                            >
                                <InfoIcon /> Feeling lost?
                            </Link>
                        </Button>
                        <Tooltip
                            isVisible={isTooltipVisible}
                            className="bg-dark border border-dark-lighter p-2 w-48"
                            targetElement={tooltipRef.current}
                        >
                            <p className="text-sm text-gray-300">
                                Click to view the relevant help section
                            </p>
                        </Tooltip>
                    </div>
                )}
            </div>
            {children}
        </div>
    );
};
