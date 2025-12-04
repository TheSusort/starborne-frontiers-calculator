import React, { useRef, useState } from 'react';
import { LucideIcon } from 'lucide-react';
import { IconBadge } from './IconBadge';

interface QuickStartCardProps {
    icon: LucideIcon;
    iconGradientFrom?: string;
    iconGradientTo?: string;
    title: string;
    videoSrc?: string;
    description: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}

export const QuickStartCard: React.FC<QuickStartCardProps> = ({
    icon,
    iconGradientFrom = 'from-blue-600',
    iconGradientTo = 'to-blue-800',
    title,
    videoSrc,
    description,
    action,
    className = '',
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    return (
        <div
            className={`card hover:border-primary/50 transition-colors group ${className}`}
            onMouseEnter={() => {
                videoRef.current?.play();
                setIsPlaying(true);
            }}
            onMouseLeave={() => {
                videoRef.current?.pause();
                setIsPlaying(false);
            }}
        >
            <div className="flex items-center gap-3 mb-4">
                <IconBadge
                    icon={icon}
                    gradientFrom={iconGradientFrom}
                    gradientTo={iconGradientTo}
                />
                <h3 className="text-xl font-semibold text-gray-100">{title}</h3>
            </div>
            {videoSrc && (
                <div className="mb-4 overflow-hidden border border-dark-border h-48 relative">
                    <video
                        ref={videoRef}
                        src={videoSrc}
                        loop
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                    />
                    {!isPlaying && (
                        <div className="absolute inset-0 bg-black/50 transition-opacity duration-300" />
                    )}
                </div>
            )}
            <p className="text-gray-300 mb-4">{description}</p>
            {action && <div>{action}</div>}
        </div>
    );
};
