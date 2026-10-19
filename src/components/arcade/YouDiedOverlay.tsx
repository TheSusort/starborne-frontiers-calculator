import React from 'react';

/**
 * The souls-like death screen shown after the ship explodes: "YOU DIED" across a dark band over
 * the frozen run (styles in `index.css`, `.arcade-you-died-*`). It is decorative; the game-over
 * panel that follows reports the result. Clicks pass through to the canvas underneath.
 */
export const YouDiedOverlay: React.FC = () => (
    <div
        aria-hidden="true"
        className="absolute inset-0 z-[56] flex items-center pointer-events-none"
    >
        <div className="arcade-you-died-band w-full py-10 sm:py-14 flex justify-center">
            <span className="arcade-you-died-text whitespace-nowrap">YOU DIED</span>
        </div>
    </div>
);
