import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { attachPageTrackingListeners, getPageTracker } from '../../services/pageTracking';
import { useLastVisitedPath } from '../../hooks/useLastVisitedPath';
import { resolveRoutePattern } from '../../services/pageTracking/resolveRoutePattern';

/** Opens a tracked visit per pathname and remembers the last page. Renders nothing; must sit inside the router. */
export const PageTracking: React.FC = () => {
    const { pathname } = useLocation();
    const tracker = useMemo(getPageTracker, []);

    useLastVisitedPath();

    useEffect(() => attachPageTrackingListeners(tracker), [tracker]);

    useEffect(() => {
        tracker.startVisit(
            pathname,
            resolveRoutePattern(pathname),
            document.visibilityState === 'visible'
        );
        tracker.flush();
    }, [tracker, pathname]);

    return null;
};
