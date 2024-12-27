import React from 'react';
import { CheckIcon } from './icons/CheckIcon';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  checked,
  onChange,
  className = '',
  disabled = false,
  id: providedId,
}) => {
  const id = providedId || `checkbox-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
      <label
        htmlFor={id}
        className={`
                    flex items-center space-x-2
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
      >
        <div
          role="presentation"
          className={`
                        w-4 h-4
                        flex items-center justify-center
                        rounded
                        border
                        transition-all duration-200
                        ${checked ? 'bg-primary border-primary' : 'border-gray-600 bg-dark'}
                        ${!disabled && 'hover:border-primary'}
                        focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-0
                    `}
        >
          <div
            className={`
                        transition-all duration-200
                        ${checked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
                    `}
          >
            {checked && <CheckIcon />}
          </div>
        </div>
        <span className="text-gray-200 select-none">{label}</span>
      </label>
    </div>
  );
};
