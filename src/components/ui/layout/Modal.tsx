import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../Button';
import { CloseIcon } from '../icons/CloseIcon';

// Create a single portal root for all modals
const getOrCreatePortalRoot = (highZIndex = false) => {
    const rootId = highZIndex ? 'modal-root-high' : 'modal-root';
    let portalRoot = document.getElementById(rootId);
    if (!portalRoot) {
        portalRoot = document.createElement('div');
        portalRoot.setAttribute('id', rootId);
        portalRoot.className = highZIndex ? 'z-[80] relative' : 'z-[60] relative';
        document.body.appendChild(portalRoot);
    }
    return portalRoot;
};

// Body-scroll lock is reference-counted so nested modals (e.g. a ConfirmModal
// opened while another Modal is already open) don't fight over `document.body`
// styles. Only the first acquire stashes the scroll position and applies the
// lock; only the last release clears it. Module-level scope matches this
// file's existing portal-root management, and is safe: this is a
// single-window app.
let scrollLockCount = 0;
let stashedScrollY = 0;

const acquireScrollLock = () => {
    if (scrollLockCount === 0) {
        stashedScrollY = window.scrollY;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${stashedScrollY}px`;
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
    }
    scrollLockCount++;
};

const releaseScrollLock = () => {
    // Guard against a release firing without a matching acquire (shouldn't
    // happen, but would otherwise drive the counter negative and make every
    // future modal think a lock is already held).
    if (scrollLockCount === 0) return;

    scrollLockCount--;
    if (scrollLockCount === 0) {
        // Matches the pre-existing single-modal cleanup exactly: clear the
        // lock styles and nothing else — there was no explicit scroll
        // restore call before this fix, so none is added now (out of scope:
        // see the reentrancy fix's report for the verified single-modal
        // scroll behaviour this preserves).
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
    }
};

/**
 * Locks body scroll while `active`; reference-counted, so nested locks compose.
 *
 * The effect is keyed on `[active]` only, so a parent re-render that hands down a fresh inline
 * callback closure can't re-run it. If it were combined with an effect
 * that also depends on a callback, React 18's
 * "all destroys before all creates" batching would let a commit that
 * re-runs every open Modal's effect (e.g. a confirm action that both
 * updates parent state and closes a nested modal) drop the reference
 * count to 0 mid-flush — clearing the lock and re-stashing `scrollY`
 * after the fixed-position paint already clamped it to 0.
 */
export function useBodyScrollLock(active: boolean): void {
    useEffect(() => {
        if (!active) return;
        acquireScrollLock();
        // Runs on deactivation and on unmount, so every acquire has exactly one matching release.
        return () => releaseScrollLock();
    }, [active]);
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    /** Optional controls rendered in the header, between the title and the close button. */
    headerActions?: React.ReactNode;
    children: React.ReactNode;
    fullHeight?: boolean;
    highZIndex?: boolean;
    maxWidth?: string;
}

export const Modal: React.FC<Props> = ({
    isOpen,
    onClose,
    title,
    subtitle,
    headerActions,
    children,
    fullHeight = false,
    highZIndex = false,
    maxWidth = 'max-w-4xl',
}) => {
    useBodyScrollLock(isOpen);

    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const portalRoot = getOrCreatePortalRoot(highZIndex);

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                role="presentation"
            />
            <div className={`fixed inset-0 ${highZIndex ? 'z-[70]' : 'z-50'}`}>
                <div
                    className={`flex h-full max-h-[calc(100vh-2rem)] ${fullHeight ? '' : 'items-center'} justify-center p-4`}
                    onClick={onClose}
                >
                    <div
                        className={`relative transform overflow-hidden bg-dark-lighter border border-dark-border shadow-xl transition-all w-full ${maxWidth} flex flex-col`}
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-labelledby="modal-title"
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-dark-border flex justify-between items-center gap-3">
                            <div className="min-w-0">
                                <h3 id="modal-title" className="text-xl font-semibold">
                                    {title}
                                </h3>
                                {subtitle && (
                                    <p className="text-xs text-theme-text-secondary mt-0.5">
                                        {subtitle}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {headerActions}
                                <Button aria-label="Close modal" variant="danger" onClick={onClose}>
                                    <CloseIcon />
                                </Button>
                            </div>
                        </div>

                        {/* Content - Now scrollable */}
                        <div className="px-6 py-4 overflow-y-auto flex-1 max-h-[80vh]">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </>,
        portalRoot
    );
};
