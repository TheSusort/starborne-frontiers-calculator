import { Position } from '../../types/encounters';
import type { PatternShape, TargetSelection } from '../../utils/targetingParser';

/** Fixed demo setup, pinned by a test.
 *
 *  The caster sits in the BOTTOM row and no enemy occupies the enemy bottom row, so "Front"
 *  has to wrap bottom -> top — the exact case the row-scan rule is taught with.
 *
 *  The occupied top row holds THREE ships (T4 front, T3, T1 rear) so Front, Skip and Back
 *  each resolve to a different ship. With only two, Back and Skip coincide and the board
 *  teaches nothing when the reader clicks between them.
 *
 *  Lives in this plain `.ts` module (rather than `TargetingBoard.tsx` itself) so these
 *  non-component values can be exported without tripping `react-refresh/only-export-components`
 *  — same reason `CHARGE_TARGET_OPTIONS` lives outside its component file in `simCoverage.ts`. */
export const DEMO_CASTER: Position = 'B2';
export const DEMO_ENEMIES: Position[] = ['T1', 'T3', 'T4', 'M2', 'M4'];

/** The rules this board demonstrates, in teaching order. Enemy-side only — the ally-side
 *  selections in TARGETING_RULES (team/others/self) have no row scan to show. */
export const DEMO_RULES: TargetSelection[] = ['front', 'back', 'skip', 'all'];

/** Pattern shapes this board demonstrates. Every signature below is present in OFFSET_TABLES;
 *  `base|0|` must stay first so it is the default and the rule buttons read cleanly. */
export const DEMO_PATTERNS: { shape: PatternShape; range: number }[] = [
    { shape: 'base', range: 0 },
    { shape: 'cone', range: 1 },
    { shape: 'line', range: 1 },
    { shape: 'circle', range: 1 },
];
