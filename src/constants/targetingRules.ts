import { PatternShape, TargetSelection } from '../utils/targetingParser';

/**
 * A targeting rule = how the game picks the target for a skill. Cards reference a rule by
 * id (the parsed `TargetSelection`) and pull label/description from here, so copy is never
 * hardcoded in components. Add a new rule by adding a row keyed on its selection id.
 *
 * `description` copy is intentionally short and editable.
 */
export interface TargetingRule {
    id: TargetSelection;
    label: string;
    description: string;
}

export const TARGETING_RULES: Record<TargetSelection, TargetingRule> = {
    front: {
        id: 'front',
        label: 'Front',
        description: 'Strikes the front-most enemy in the row.',
    },
    back: {
        id: 'back',
        label: 'Back',
        description: 'Targets the rear-most unit, behind the front line.',
    },
    skip: {
        id: 'skip',
        label: 'Skip',
        description: 'Leaps the front line to strike the unit behind it.',
    },
    all: {
        id: 'all',
        label: 'All',
        description: 'Hits every valid target at once.',
    },
    'row-most': {
        id: 'row-most',
        label: 'Fullest Row',
        description: 'Strikes the enemy row holding the most units.',
    },
    'row-least': {
        id: 'row-least',
        label: 'Emptiest Row',
        description: 'Strikes the enemy row holding the fewest units.',
    },
    team: {
        id: 'team',
        label: 'Allies',
        description: 'Affects your allies.',
    },
    others: {
        id: 'others',
        label: 'Other Allies',
        description: 'Affects allies other than the caster.',
    },
    self: {
        id: 'self',
        label: 'Self',
        description: 'Affects the caster only.',
    },
};

/**
 * Human-readable labels for parsed AoE pattern shapes. Mirrors TARGETING_RULES:
 * keep display copy here, never hardcoded in components. Add a new shape by
 * adding a row keyed on its PatternShape id.
 */
export interface PatternShapeInfo {
    id: PatternShape;
    label: string;
}

export const PATTERN_SHAPES: Record<PatternShape, PatternShapeInfo> = {
    base: { id: 'base', label: 'Single Target' },
    cone: { id: 'cone', label: 'Cone' },
    line: { id: 'line', label: 'Line' },
    cross: { id: 'cross', label: 'Cross' },
    curve: { id: 'curve', label: 'Curve' },
    circle: { id: 'circle', label: 'Circle' },
    backline: { id: 'backline', label: 'Backline' },
    root: { id: 'root', label: 'Root' },
    split: { id: 'split', label: 'Split' },
    burst: { id: 'burst', label: 'Burst' },
    scattershot: { id: 'scattershot', label: 'Scattershot' },
    wings: { id: 'wings', label: 'Wings' },
    range: { id: 'range', label: 'Range' },
    pickaxe: { id: 'pickaxe', label: 'Pickaxe' },
    all: { id: 'all', label: 'All' },
    row: { id: 'row', label: 'Whole Row' },
};

/** Selections only bounty bosses use; no player ship has them, so ship filters omit them. */
const BOSS_ONLY_SELECTIONS: readonly TargetSelection[] = ['row-most', 'row-least'];

/** The rules a ship's own target can be filtered by. */
export const SHIP_FILTER_TARGETING_RULES: TargetingRule[] = Object.values(TARGETING_RULES).filter(
    (rule) => !BOSS_ONLY_SELECTIONS.includes(rule.id)
);
