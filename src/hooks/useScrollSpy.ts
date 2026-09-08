import { useEffect, useState } from 'react';

/** Which of `ids` is the section the reader is currently looking at.
 *
 *  Returns the first id whose element is inside the observed band, so a long section that
 *  spans the whole viewport keeps the highlight instead of handing it to the next one. The
 *  band starts below the sticky header and ends 70% up the viewport, which is what makes the
 *  highlight change as a heading reaches the upper third rather than only when it leaves.
 *
 *  Falls back to the first id where `IntersectionObserver` is absent (jsdom), so a caller can
 *  render a sensible highlight in tests and in a prerender without branching. */
export const useScrollSpy = (ids: string[]): string | undefined => {
    const [activeId, setActiveId] = useState<string | undefined>(ids[0]);

    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;

        const visible = new Set<string>();
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) visible.add(entry.target.id);
                    else visible.delete(entry.target.id);
                }
                const first = ids.find((id) => visible.has(id));
                if (first) setActiveId(first);
            },
            { rootMargin: '-88px 0px -70% 0px' }
        );

        for (const id of ids) {
            const element = document.getElementById(id);
            if (element) observer.observe(element);
        }
        return () => observer.disconnect();
    }, [ids]);

    return activeId;
};
