import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

interface ArtBackdropProps {
    /** Image URL; only applied once the section is near the viewport. */
    src: string;
    children: React.ReactNode;
    className?: string;
}

const PRELOAD_MARGIN = '200px';

/**
 * Wraps a page section with faint, edge-masked art behind its content. The image is set only
 * after the wrapper nears the viewport, and no art is rendered in the synthwave theme.
 */
export const ArtBackdrop: React.FC<ArtBackdropProps> = ({ src, children, className = '' }) => {
    const { theme } = useTheme();
    const isSynthwave = theme === 'synthwave';
    const ref = useRef<HTMLDivElement>(null);
    const [isNear, setIsNear] = useState(false);

    useEffect(() => {
        if (isSynthwave || isNear) return;
        const node = ref.current;
        if (!node) return;
        if (typeof IntersectionObserver === 'undefined') {
            setIsNear(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setIsNear(true);
                    observer.disconnect();
                }
            },
            { rootMargin: PRELOAD_MARGIN }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [isSynthwave, isNear]);

    return (
        <div ref={ref} className={`relative isolate ${className}`}>
            {!isSynthwave && (
                <div
                    aria-hidden="true"
                    data-testid="art-backdrop-image"
                    className="art-backdrop-image pointer-events-none absolute inset-0 -z-10 bg-cover bg-center opacity-10"
                    style={isNear ? { backgroundImage: `url(${src})` } : undefined}
                />
            )}
            {children}
        </div>
    );
};
