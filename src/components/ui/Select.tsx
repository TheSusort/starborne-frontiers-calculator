import React from 'react';

interface Props extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    options: { value: string; label: string }[];
}

export const Select: React.FC<Props> = ({
    label,
    error,
    options,
    className = '',
    ...props
}) => {
    return (
        <div className="space-y-1 grow">
            {label && (
                <label className="block text-sm font-medium text-gray-200">
                    {label}
                </label>
            )}
            <select
                className={`
                    w-full px-4 py-2 bg-dark-lighter border border-dark-border
                     focus:outline-none focus:ring-2 focus:ring-primary
                    text-gray-200 h-10
                    ${error ? 'border-red-500' : 'focus:border-primary'}
                    ${className}
                `}
                {...props}
            >
                {options.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            {error && (
                <p className="text-sm text-red-500">{error}</p>
            )}
        </div>
    );
};