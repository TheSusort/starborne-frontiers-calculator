import React from 'react';

interface Props {
    label: string;
    values: string[];
    onChange: (values: string[]) => void;
    options: { value: string; label: string }[];
    className?: string;
}

export const RadioGroup: React.FC<Props> = ({
    label,
    values,
    onChange,
    options,
    className = ''
}) => {
    const handleChange = (value: string) => {
        const newValues = values.includes(value)
            ? values.filter(v => v !== value)
            : [...values, value];
        onChange(newValues);
    };

    return (
        <div className={className}>
            <label className="block text-sm font-medium text-gray-300 mb-2">
                {label}
            </label>
            <div className="space-y-2">
                {options.map(option => (
                    <div
                        key={option.value}
                        className="flex items-center"
                    >
                        <input
                            type="checkbox"
                            id={`${label}-${option.value}`}
                            checked={values.includes(option.value)}
                            onChange={() => handleChange(option.value)}
                            className="h-4 w-4 text-primary border-gray-600 bg-dark focus:ring-primary"
                        />
                        <label
                            htmlFor={`${label}-${option.value}`}
                            className="ml-2 text-sm text-gray-300 cursor-pointer"
                        >
                            {option.label}
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
};
