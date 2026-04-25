import React, { useEffect, useRef, useState } from 'react';

interface InlineNumberEditProps {
    value: number | undefined;
    onSave: (value: number | undefined) => void;
    allowEmpty?: boolean;
    min?: number;
    max?: number;
    disabled?: boolean;
    className?: string;
    children: React.ReactNode;
}

export const InlineNumberEdit: React.FC<InlineNumberEditProps> = ({
    value,
    onSave,
    allowEmpty = false,
    min,
    max,
    disabled = false,
    className = '',
    children,
}) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const startEdit = () => {
        if (disabled) return;
        setDraft(value === undefined ? '' : String(value));
        setEditing(true);
    };

    const commit = () => {
        const trimmed = draft.trim();
        if (trimmed === '') {
            if (allowEmpty) onSave(undefined);
            setEditing(false);
            return;
        }
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed)) {
            setEditing(false);
            return;
        }
        if (min !== undefined && parsed < min) {
            setEditing(false);
            return;
        }
        if (max !== undefined && parsed > max) {
            setEditing(false);
            return;
        }
        onSave(parsed);
        setEditing(false);
    };

    const cancel = () => setEditing(false);

    if (!editing) {
        return (
            <span
                className={`cursor-pointer border-b border-dotted border-theme-text-secondary hover:text-theme-text ${disabled ? 'pointer-events-none opacity-60' : ''} ${className}`}
                onClick={startEdit}
            >
                {children}
            </span>
        );
    }

    return (
        <input
            ref={inputRef}
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                }
            }}
            min={min}
            max={max}
            className={`w-16 px-1 py-0 bg-dark border border-dark-border text-sm ${className}`}
        />
    );
};
