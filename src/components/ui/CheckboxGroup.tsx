import React from 'react';
import { Checkbox } from './Checkbox';

interface Props {
    label: string;
    values: string[];
    onChange: (values: string[]) => void;
    options: { value: string; label: string }[];
    className?: string;
    disabled?: boolean;
}

export const CheckboxGroup: React.FC<Props> = ({
    label,
    values,
    onChange,
    options,
    className = '',
    disabled = false,
}) => {
    const handleChange = (value: string) => {
        const newValues = values.includes(value)
            ? values.filter((v) => v !== value)
            : [...values, value];
        onChange(newValues);
    };

    return (
        <div className={className}>
            <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
            <div className="space-y-2">
                {options.map((option) => (
                    <Checkbox
                        key={option.value}
                        label={option.label}
                        checked={values.includes(option.value)}
                        onChange={() => handleChange(option.value)}
                        disabled={disabled}
                    />
                ))}
            </div>
        </div>
    );
};
