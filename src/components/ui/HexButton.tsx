import React from 'react';
import { AffinityName } from '../../types/ship';
import { Image } from './Image';

const AFFINITY_COLORS: Record<AffinityName, string> = {
    chemical: 'bg-green-600',
    electric: 'bg-blue-500',
    thermal: 'bg-orange-500',
    antimatter: 'bg-purple-500',
};

const RARITY_BORDER_COLORS: Record<string, string> = {
    common: 'bg-rarity-common',
    uncommon: 'bg-rarity-uncommon',
    rare: 'bg-rarity-rare',
    epic: 'bg-rarity-epic',
    legendary: 'bg-rarity-legendary',
};

interface HexButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isActive?: boolean;
    isSelected?: boolean;
    imageKey?: string;
    affinity?: AffinityName;
    rarity?: string;
    roleIconUrl?: string;
    children: React.ReactNode;
}

export const HexButton: React.FC<HexButtonProps> = ({
    isActive,
    isSelected,
    imageKey,
    affinity,
    rarity,
    roleIconUrl,
    children,
    className = '',
    ...props
}) => {
    const borderColor = isSelected
        ? 'bg-yellow-500'
        : rarity
          ? RARITY_BORDER_COLORS[rarity] || 'bg-primary'
          : isActive
            ? 'bg-primary'
            : 'bg-dark-lighter';

    return (
        <button
            className={`
                w-full aspect-[1.15/1] relative
                transform scale-[1.15]
                ${className}
            `}
            {...props}
        >
            <div
                className={`
                    absolute inset-0
                    clip-hex transition-colors duration-200
                    flex items-center justify-center
                    transform rotate-[30deg]
                    ${borderColor}
                    hover:bg-white
                `}
            >
                <div className="clip-hex transform scale-95 bg-dark w-full h-full relative overflow-hidden">
                    {imageKey && (
                        <div className="absolute inset-0 transform rotate-[-30deg] scale-[1.15]">
                            <Image
                                src={imageKey}
                                className="w-full h-full"
                                imageClassName="w-full h-full object-cover object-top"
                            />
                        </div>
                    )}
                    <div className="transform rotate-[-30deg] w-full h-full flex items-center justify-center relative z-10">
                        {children}
                        {affinity && (
                            <div
                                className={`absolute bottom-0 left-0 right-0 h-5 ${AFFINITY_COLORS[affinity]} flex items-center justify-center`}
                            >
                                {roleIconUrl && (
                                    <img
                                        src={roleIconUrl}
                                        alt=""
                                        className="h-3.5 w-3.5 brightness-0 invert"
                                    />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
};
