import { Ship } from '../../types/ship';
import { parseShipTargeting, type ShipTargeting } from '../targetingParser';

/**
 * A ship's parsed ACTIVE targeting.
 *
 * ⚠️ GUARDED, and not defensively-for-the-sake-of-it: BOTH axes of `parseShipTargeting` THROW on a
 * string they do not recognise — `parseTarget` on anything outside its 8-entry map
 * (targetingParser.ts:119) and `parsePattern`'s `detectShape` on an unknown shape token (:171).
 * This call sits on the RENDER path over whatever targeting strings a user's stored ship records
 * happen to carry, so one stale or hand-edited value would take the whole page down with a React
 * render crash instead of degrading. An unparseable kit tells us nothing about targeting, so it
 * falls back to no targeting at all — exactly as a manual (no-ship) actor does.
 *
 * Shared by `HealingCalculatorPage.tsx` and `DefenseCalculatorPage.tsx` — do not fork a second
 * private copy.
 */
export const targetingOf = (ship?: Ship): ShipTargeting | undefined => {
    if (!ship) return undefined;
    try {
        return parseShipTargeting(ship);
    } catch {
        return undefined;
    }
};
