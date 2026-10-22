import React from 'react';

interface BuffTooltipProps {
    title: string;
    description: string;
}

export const BuffTooltip: React.FC<BuffTooltipProps> = ({ title, description }) => (
    <div className="bg-dark-lighter p-2 shadow-lg max-w-xs mt-1 border border-dark-border">
        <div className="font-semibold text-sm text-primary capitalize">{title}</div>
        <div className="text-sm text-theme-text">{description}</div>
    </div>
);
