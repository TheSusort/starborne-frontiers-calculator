import React, { useEffect, useRef, useState } from 'react';

interface InlineNumberEditProps {
    value: number | undefined;
    onSave: (value: number | undefined) => void;
    allowEmpty?: boolean;
    min?: number;
    max?: number;
    disabled?: boolean;
    className?: string;
    /**
     * Accessible name for the display trigger. Without it the name falls back to the rendered
     * children, which is the bare number and says nothing about what it belongs to.
     */
    label?: string;
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
    label,
    children,
}) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLSpanElement>(null);
    const committedRef = useRef(false);
    // Set only when the editor is left by a key, so focus returns to the trigger for a keyboard
    // user. A blur-driven exit must NOT refocus: that would pull focus back out of whatever the
    // user tabbed to.
    const refocusTriggerRef = useRef(false);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
        if (!editing && refocusTriggerRef.current) {
            refocusTriggerRef.current = false;
            triggerRef.current?.focus();
        }
    }, [editing]);

    const startEdit = () => {
        if (disabled) return;
        committedRef.current = false;
        setDraft(value === undefined ? '' : String(value));
        setEditing(true);
    };

    const commit = () => {
        if (committedRef.current) return;
        committedRef.current = true;
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
                ref={triggerRef}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label={label}
                aria-disabled={disabled || undefined}
                className={`cursor-pointer border-b border-dotted border-theme-text-secondary hover:text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${disabled ? 'pointer-events-none opacity-60' : ''} ${className}`}
                onClick={startEdit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        startEdit();
                    }
                }}
            >
                {children}
            </span>
        );
    }

    return (
        <input
            ref={inputRef}
            type="number"
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    refocusTriggerRef.current = true;
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    refocusTriggerRef.current = true;
                    cancel();
                }
            }}
            min={min}
            max={max}
            className={`w-16 px-1 py-0 bg-dark border border-dark-border text-sm ${className}`}
        />
    );
};
