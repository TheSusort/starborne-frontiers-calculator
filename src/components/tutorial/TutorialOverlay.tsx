import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTutorial } from '../../contexts/TutorialContext';
import { Button } from '../ui';

interface SpotlightRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface TooltipPosition {
    top: number;
    left: number;
    placement: 'top' | 'bottom';
}

const PADDING = 12;
const TOOLTIP_MARGIN = 12;
const BORDER_RADIUS = 8;

/** Check if an element is effectively visible (not hidden by collapsed parents, opacity, etc.) */
function isEffectivelyVisible(el: Element): boolean {
    let current: Element | null = el;
    while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        if (
            (style.overflow === 'hidden' || style.overflowY === 'hidden') &&
            current.clientHeight === 0
        )
            return false;
        current = current.parentElement;
    }
    return true;
}

export const TutorialOverlay: React.FC = () => {
    const { activeStep, activeStepIndex, activeGroup, nextStep, skipTutorial } = useTutorial();
    const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
    const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null);
    const [tooltipRef, setTooltipRef] = useState<HTMLDivElement | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    /** Position spotlight and tooltip around the target element (no scrolling). */
    const updatePositions = useCallback(() => {
        if (!activeStep) return;

        const target = document.querySelector(`[data-tutorial="${activeStep.targetId}"]`);
        if (!target) return;

        const rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || !isEffectivelyVisible(target)) return;

        const spotlightRect: SpotlightRect = {
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
        };
        setSpotlight(spotlightRect);

        // Calculate tooltip position after it renders
        if (tooltipRef) {
            const tooltipRect = tooltipRef.getBoundingClientRect();
            const spaceBelow = window.innerHeight - (spotlightRect.top + spotlightRect.height);
            const spaceAbove = spotlightRect.top;
            const placement =
                spaceBelow >= tooltipRect.height + TOOLTIP_MARGIN ||
                spaceAbove < tooltipRect.height + TOOLTIP_MARGIN
                    ? 'bottom'
                    : 'top';

            const top =
                placement === 'bottom'
                    ? spotlightRect.top + spotlightRect.height + TOOLTIP_MARGIN
                    : spotlightRect.top - tooltipRect.height - TOOLTIP_MARGIN;

            // Center horizontally on the spotlight, clamped to viewport
            const centerLeft = spotlightRect.left + spotlightRect.width / 2 - tooltipRect.width / 2;
            const left = Math.min(
                Math.max(16, centerLeft),
                window.innerWidth - tooltipRect.width - 16
            );

            setTooltipPos({ top, left, placement });
        }
    }, [activeStep, tooltipRef]);

    /** Called on step change: scroll target into view if needed, then position. */
    useEffect(() => {
        if (!activeStep) {
            setIsVisible(false);
            setSpotlight(null);
            setTooltipPos(null);
            return;
        }

        const target = document.querySelector(`[data-tutorial="${activeStep.targetId}"]`);
        if (!target) {
            // Target not found, skip to next step
            nextStep();
            return;
        }

        // Skip elements that are effectively invisible (e.g., inside collapsed containers)
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || !isEffectivelyVisible(target)) {
            nextStep();
            return;
        }

        const isInView =
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth;

        if (!isInView) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Recalculate after scroll completes
            const timer = setTimeout(() => {
                updatePositions();
                setIsVisible(true);
            }, 400);
            return () => clearTimeout(timer);
        }

        // Already in view — position after a small render delay
        const timer = setTimeout(() => {
            updatePositions();
            setIsVisible(true);
        }, 100);

        return () => clearTimeout(timer);
    }, [activeStep, activeStepIndex, nextStep, updatePositions]);

    // Recalculate on resize/scroll
    useEffect(() => {
        if (!activeStep) return;

        window.addEventListener('resize', updatePositions);
        window.addEventListener('scroll', updatePositions, true);

        return () => {
            window.removeEventListener('resize', updatePositions);
            window.removeEventListener('scroll', updatePositions, true);
        };
    }, [activeStep, updatePositions]);

    if (!activeStep || !activeGroup) return null;

    const isLastStep = activeStepIndex === activeGroup.steps.length - 1;
    const totalSteps = activeGroup.steps.length;

    // Build the box-shadow spotlight mask
    const shadowStyle = spotlight
        ? {
              boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.75)`,
              position: 'fixed' as const,
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
              borderRadius: BORDER_RADIUS,
              zIndex: 101,
              pointerEvents: 'none' as const,
              transition: 'all 0.3s ease-in-out',
          }
        : undefined;

    return createPortal(
        <div
            className={`fixed inset-0 z-[100] pointer-events-none transition-opacity duration-300 ${
                isVisible ? 'opacity-100' : 'opacity-0'
            }`}
        >
            {/* Scroll-through overlay - allows scrolling but blocks clicks via spotlight shadow */}
            <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 100 }} />

            {/* Spotlight cutout */}
            {shadowStyle && <div style={shadowStyle} />}

            {/* Tooltip card */}
            <div
                ref={setTooltipRef}
                className={`fixed z-[102] max-w-sm w-80 bg-dark border border-dark-border rounded-lg shadow-xl pointer-events-auto transition-all duration-300 ${
                    isVisible && tooltipPos ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                }`}
                style={
                    tooltipPos
                        ? { top: tooltipPos.top, left: tooltipPos.left }
                        : { top: -9999, left: -9999 }
                }
            >
                {/* Arrow */}
                {tooltipPos && spotlight && (
                    <div
                        className="absolute w-3 h-3 bg-dark border-dark-border rotate-45"
                        style={{
                            [tooltipPos.placement === 'bottom' ? 'top' : 'bottom']: -6,
                            left: Math.min(
                                Math.max(
                                    24,
                                    spotlight.left + spotlight.width / 2 - (tooltipPos.left || 0)
                                ),
                                288 // max-w-sm (320) - 32px padding
                            ),
                            borderTop: tooltipPos.placement === 'bottom' ? '1px solid' : 'none',
                            borderLeft: tooltipPos.placement === 'bottom' ? '1px solid' : 'none',
                            borderBottom: tooltipPos.placement === 'top' ? '1px solid' : 'none',
                            borderRight: tooltipPos.placement === 'top' ? '1px solid' : 'none',
                            borderColor: 'inherit',
                        }}
                    />
                )}

                <div className="p-4 space-y-3">
                    <h3 className="font-bold text-white">{activeStep.title}</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        {activeStep.description}
                    </p>

                    <div className="flex justify-between items-center pt-1">
                        <span className="text-xs text-gray-500">
                            {activeStepIndex + 1} of {totalSteps}
                        </span>
                        <div className="flex gap-2">
                            {totalSteps > 1 && (
                                <Button variant="link" size="sm" onClick={skipTutorial}>
                                    Skip
                                </Button>
                            )}
                            <Button variant="primary" size="sm" onClick={nextStep}>
                                {isLastStep ? 'OK' : 'Next'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
