import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// Create a single portal root for all tooltips
const getOrCreateTooltipPortalRoot = () => {
    let portalRoot = document.getElementById('tooltip-root');
    if (!portalRoot) {
        portalRoot = document.createElement('div');
        portalRoot.setAttribute('id', 'tooltip-root');
        portalRoot.className = 'fixed inset-0 pointer-events-none z-[1000]';
        document.body.appendChild(portalRoot);
    }
    return portalRoot;
};

interface Props {
    isVisible: boolean;
    children: React.ReactNode;
    className?: string;
    targetElement?: HTMLElement | null; // Element to position relative to
}

export const Tooltip: React.FC<Props> = ({
    isVisible,
    children,
    className = '',
    targetElement,
}) => {
    const [coords, setCoords] = useState({ left: 0, top: 0 });
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isVisible || !tooltipRef.current) return;

        // targetElement is required when using portal (which we always do now)
        // If it's not available yet, the effect will re-run when it becomes available
        if (!targetElement) return;

        const updatePosition = () => {
            const tooltip = tooltipRef.current;
            if (!tooltip || !targetElement) return;

            const parentRect = targetElement.getBoundingClientRect();
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

        // Recalculate on window resize and scroll
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true); // Use capture to catch scroll in offcanvas

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isVisible, children, targetElement]);

    if (!isVisible) return null;

    return createPortal(
        <div
            ref={tooltipRef}
            className={`pointer-events-auto ${className}`}
            style={{
                position: 'fixed',
                left: `${coords.left}px`,
                top: `${coords.top}px`,
            }}
        >
            {children}
        </div>,
        getOrCreateTooltipPortalRoot()
    );
};
