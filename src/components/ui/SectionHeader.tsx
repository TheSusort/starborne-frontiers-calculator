import React from 'react';

interface SectionHeaderProps {
    title: string;
    subtitle?: string;
    className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
    title,
    subtitle,
    className = '',
}) => {
    return (
        <div className={`text-center ${className}`}>
            <h2 className="text-3xl font-bold text-gray-100 mb-2">{title}</h2>
            {subtitle && <p className="text-gray-400">{subtitle}</p>}
        </div>
    );
};
