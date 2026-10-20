import React from 'react';
import { Link } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';

interface FeatureCardProps {
    to: string;
    icon: LucideIcon;
    title: string;
    description: string;
    className?: string;
    /** Rendered beside the title, e.g. a "New" chip. */
    badge?: React.ReactNode;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({
    to,
    icon: Icon,
    title,
    description,
    className = '',
    badge,
}) => {
    return (
        <Link to={to} className={`card hover:border-primary/50 transition-all group ${className}`}>
            <div className="flex items-center gap-3">
                <Icon
                    className="text-primary mb-3 group-hover:scale-110 transition-transform"
                    size={32}
                />
                <h3 className="text-lg font-semibold text-theme-text mb-2">{title}</h3>
                {badge && <span className="ml-auto mb-2 shrink-0">{badge}</span>}
            </div>
            <p className="text-sm text-theme-text-secondary">{description}</p>
        </Link>
    );
};
