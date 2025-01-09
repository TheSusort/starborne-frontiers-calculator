import React, { useEffect, useState, useRef } from 'react';

interface Props {
    isVisible: boolean;
    children: React.ReactNode;
    className?: string;
}

export const Tooltip: React.FC<Props> = ({ isVisible, children, className = '' }) => {
    const [coords, setCoords] = useState({ left: 0, top: 0 });
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isVisible || !tooltipRef.current) return;

        const updatePosition = () => {
            const tooltip = tooltipRef.current;
            if (!tooltip) return;

            const parentRect = tooltip.parentElement?.getBoundingClientRect();
            if (!parentRect) return;

            const tooltipRect = tooltip.getBoundingClientRect();

            // Calculate vertical position
            const spaceBelow = window.innerHeight - parentRect.bottom;
            const spaceAbove = parentRect.top;
            const newPosition =
                spaceBelow < tooltipRect.height && spaceAbove > tooltipRect.height
                    ? 'top'
                    : 'bottom';

            // Calculate center position
            const left = parentRect.left + parentRect.width / 2 - tooltipRect.width / 2;

            // Adjust if tooltip would overflow window
            const adjustedLeft = Math.min(
                Math.max(0, left), // Don't go beyond left edge
                window.innerWidth - tooltipRect.width // Don't go beyond right edge
            );

            // Calculate vertical offset based on position
            const top =
                newPosition === 'top'
                    ? parentRect.top - tooltipRect.height - 8 // 8px margin
                    : parentRect.bottom + 8;

            setCoords({ left: adjustedLeft, top });
        };

        // Initial position calculation
        updatePosition();

        // Recalculate on window resize
        window.addEventListener('resize', updatePosition);

        return () => {
            window.removeEventListener('resize', updatePosition);
        };
    }, [isVisible, children]);

    if (!isVisible) return null;

    return (
        <div
            ref={tooltipRef}
            className={`fixed z-50 ${className}`}
            style={{
                left: `${coords.left}px`,
                top: `${coords.top}px`,
            }}
        >
            {children}
        </div>
    );
};
