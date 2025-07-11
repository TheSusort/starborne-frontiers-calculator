import React from 'react';
import { Input } from '../ui';

interface RangeFilterProps {
    label: string;
    minValue: number;
    maxValue: number;
    onMinChange: (value: number) => void;
    onMaxChange: (value: number) => void;
    minPlaceholder?: string;
    maxPlaceholder?: string;
    className?: string;
}

export const RangeFilter: React.FC<RangeFilterProps> = ({
    label,
    minValue,
    maxValue,
    onMinChange,
    onMaxChange,
    minPlaceholder = 'Min',
    maxPlaceholder = 'Max',
    className = '',
}) => {
    const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value) || 0;
        onMinChange(value);
    };

    const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value) || 0;
        onMaxChange(value);
    };

    return (
        <div className={`space-y-2 ${className}`}>
            <label className="block text-sm font-medium text-gray-200">{label}</label>
            <div className="flex gap-2">
                <div className="flex-1">
                    <Input
                        type="number"
                        value={minValue || ''}
                        onChange={handleMinChange}
                        placeholder={minPlaceholder}
                        className="w-full"
                        min={0}
                    />
                </div>
                <div className="flex items-center text-gray-400">to</div>
                <div className="flex-1">
                    <Input
                        type="number"
                        value={maxValue || ''}
                        onChange={handleMaxChange}
                        placeholder={maxPlaceholder}
                        className="w-full"
                        min={0}
                    />
                </div>
            </div>
        </div>
    );
};
