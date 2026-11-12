import { useState, useEffect } from 'react';

const hasMatchMedia = () => typeof window.matchMedia === 'function';

/** Whether `query` currently matches. Reads `false` where `matchMedia` does not exist. */
export const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState(
        () => hasMatchMedia() && window.matchMedia(query).matches
    );

    useEffect(() => {
        if (!hasMatchMedia()) return;
        const mql = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
        mql.addEventListener('change', handler);
        setMatches(mql.matches);
        return () => mql.removeEventListener('change', handler);
    }, [query]);

    return matches;
};
