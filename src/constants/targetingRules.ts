import { TargetSelection } from '../utils/targetingParser';

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
        description: 'Strikes the front-most enemy in the lane.',
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
    team: {
        id: 'team',
        label: 'Team',
        description: 'Affects your whole team.',
    },
    others: {
        id: 'others',
        label: 'Others',
        description: 'Affects allies other than the caster.',
    },
    self: {
        id: 'self',
        label: 'Self',
        description: 'Affects the caster only.',
    },
};
