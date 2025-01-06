import React from 'react';

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label: string;
    id?: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    required?: boolean;
    className?: string;
}

export const Textarea: React.FC<Props> = ({
    label,
    id,
    value,
    onChange,
    required,
    className,
    ...props
}) => {
    const textareaId = id || `textarea-${Math.random().toString(36).substring(2, 15)}`;
    return (
        <div className="flex flex-col">
            <label htmlFor={textareaId} className="text-white text-sm mb-2">
                {label}
            </label>
            <textarea
                id={textareaId}
                value={value}
                onChange={onChange}
                required={required}
                className={`bg-dark-lighter text-white p-2 ${className}`}
                {...props}
            />
        </div>
    );
};
