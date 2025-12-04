import React from 'react';
import { Link } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';

interface FeatureCardProps {
    to: string;
    icon: LucideIcon;
    title: string;
    description: string;
    className?: string;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
    to,
    icon: Icon,
    title,
    description,
    className = '',
}) => {
    return (
        <Link to={to} className={`card hover:border-primary/50 transition-all group ${className}`}>
            <div className="flex items-center gap-3">
                <Icon
                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                    size={32}
                />
                <h3 className="text-lg font-semibold text-gray-100 mb-2">{title}</h3>
            </div>
            <p className="text-sm text-gray-400">{description}</p>
        </Link>
    );
};
