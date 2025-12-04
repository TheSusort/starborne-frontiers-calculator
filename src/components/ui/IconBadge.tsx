import React from 'react';
import { LucideIcon } from 'lucide-react';

interface IconBadgeProps {
    icon: LucideIcon;
    size?: number;
    gradientFrom?: string;
    gradientTo?: string;
    className?: string;
}

export const IconBadge: React.FC<IconBadgeProps> = ({
    icon: Icon,
    size = 24,
    gradientFrom = 'from-gray-600',
    gradientTo = 'to-gray-800',
    className = '',
}) => {
    return (
        <div
            className={`w-12 h-12 bg-gradient-to-br ${gradientFrom} ${gradientTo} flex items-center justify-center ${className}`}
        >
            <Icon className="text-white" size={size} />
        </div>
    );
};
