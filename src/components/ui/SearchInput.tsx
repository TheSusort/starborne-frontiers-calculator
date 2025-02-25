import React from 'react';
import { SearchIcon } from './icons/SearchIcon';
import { Input } from './Input';

interface Props {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
}

export const SearchInput: React.FC<Props> = ({
    value,
    onChange,
    className = '',
    placeholder = 'Search...',
    ...props
}) => {
    return (
        <div className={`relative ${className}`}>
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <SearchIcon className="h-5 w-5 text-gray-400" />
            </div>
            <Input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="!pl-10"
                placeholder={placeholder}
                {...props}
            />
        </div>
    );
};
