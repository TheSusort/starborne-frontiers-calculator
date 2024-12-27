import React, { useEffect, useState, useRef } from 'react';

interface Props {
    isVisible: boolean;
    children: React.ReactNode;
    className?: string;
}

export const Tooltip: React.FC<Props> = ({ isVisible, children, className }) => {
    const [position, setPosition] = useState<'top' | 'bottom'>('bottom');
    const [xOffset, setXOffset] = useState(0);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isVisible || !tooltipRef.current) return;

        const tooltip = tooltipRef.current;
        const rect = tooltip.getBoundingClientRect();
        const parentRect = tooltip.parentElement?.getBoundingClientRect();

        if (!parentRect) return;

        // Check vertical position
        const spaceBelow = window.innerHeight - parentRect.bottom;
        const spaceAbove = parentRect.top;
        setPosition(spaceBelow < rect.height && spaceAbove > rect.height ? 'top' : 'bottom');

        // Check horizontal position
        const leftOverflow = rect.left < 0;
        const rightOverflow = rect.right > window.innerWidth;

        if (leftOverflow) {
            setXOffset(Math.abs(rect.left));
        } else if (rightOverflow) {
            setXOffset(window.innerWidth - rect.right);
        } else {
            setXOffset(0);
        }
    }, [isVisible]);

    if (!isVisible) return null;

    return (
        <div
            ref={tooltipRef}
            className={`
                absolute z-50 w-64
                ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}
                left-1/2 -translate-x-1/2
                ${className}
            `}
            style={{
                transform: `translateX(calc(-50% + ${xOffset}px))`
            }}
        >
            {children}
        </div>
    );
};