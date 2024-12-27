import React from 'react';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  labelClassName?: string;
}

export const Input: React.FC<Props> = ({
  label,
  error,
  labelClassName = '',
  className = '',
  ...props
}) => {
  const id = props.id || props.name || `input-${Math.random().toString(36).substring(2, 15)}`;
  return (
    <div className="space-y-1">
      {label && (
        <label className={`block text-sm font-medium text-gray-200 ${labelClassName}`} htmlFor={id}>
          {label}
        </label>
      )}
      <input
        className={`
                    w-full px-1 md:px-4 py-2 bg-dark-lighter border border-dark-border
                     focus:outline-none focus:ring-2 focus:ring-primary
                    text-gray-200 placeholder-gray-500 h-10
                    ${error ? 'border-red-500' : 'focus:border-primary'}
                    ${className}
                `}
        id={id}
        {...props}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
};
