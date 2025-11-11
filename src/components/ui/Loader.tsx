import React from 'react';

export const Loader = React.memo(({ size = 'lg' }: { size?: 'sm' | 'lg' }) => {
    const hexSize = size === 'sm' ? 40 : 80;

    return (
        <div className={`flex justify-center items-center ${size === 'sm' ? '' : 'min-h-[50vh]'}`}>
            <div className="relative" style={{ width: hexSize, height: hexSize }}>
                <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-0"
                    style={{ width: hexSize, height: hexSize }}
                >
                    {/* Define the hexagon path */}
                    <defs>
                        <path
                            id="hexPath"
                            d="M 50 5 L 95 27.5 L 95 72.5 L 50 95 L 5 72.5 L 5 27.5 Z"
                        />
                    </defs>

                    {/* Background hexagon (dim) */}
                    <use href="#hexPath" fill="none" stroke="#fff" strokeWidth="6" />

                    {/* Animated hexagon (bright, follows outline) */}
                    <use
                        href="#hexPath"
                        fill="none"
                        stroke="#ec8c37"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray="270"
                        strokeDashoffset="0"
                        className="opacity-100 hex-loader-animated"
                    />
                </svg>
            </div>

            <style>{`
                @keyframes hexLoader {
                    0% {
                        stroke-dashoffset: 270;
                    }
                    100% {
                        stroke-dashoffset: 0;
                    }
                }

                .hex-loader-animated {
                    animation: hexLoader 2s linear infinite;
                    will-change: stroke-dashoffset;
                }
            `}</style>
        </div>
    );
});

Loader.displayName = 'Loader';
