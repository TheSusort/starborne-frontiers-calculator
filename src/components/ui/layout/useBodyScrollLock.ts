import { useEffect } from 'react';

// Body-scroll lock is reference-counted so nested modals (e.g. a ConfirmModal
// opened while another Modal is already open) don't fight over `document.body`
// styles. Only the first acquire stashes the scroll position and applies the
// lock; only the last release clears it. Module-level scope is safe: this is a
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
