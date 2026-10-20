import { matchRoutes } from 'react-router-dom';
import { ROUTE_PATTERNS } from '../../constants/routes';

const ROUTES = ROUTE_PATTERNS.map((path) => ({ path }));

/** Maps a pathname to the route pattern react-router would render, using its own ranking. */
export function resolveRoutePattern(pathname: string): string {
    const matches = matchRoutes(ROUTES, pathname);
    return matches?.[0]?.route.path ?? '*';
}
