import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillTargetingBoard } from '../SkillTargetingBoard';
import { parseShipTargeting } from '../../../utils/targetingParser';

function active(target: string, pattern: string) {
    return parseShipTargeting({ activeTarget: target, activePattern: pattern }).active!;
}

describe('SkillTargetingBoard', () => {
    it('renders two boards + arrow for an enemy (attacker) pattern', () => {
        const { container, getByText } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(container.querySelectorAll('[data-board]').length).toBe(2);
        expect(getByText('▶')).toBeInTheDocument();
        expect(container.querySelectorAll('[data-role="origin"]').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('[data-role="covered"]').length).toBeGreaterThan(0);
    });

    it('renders a single board for a support (ally) pattern', () => {
        const { container, queryByText } = render(
            <SkillTargetingBoard targeting={active('allies', 'Pattern-Circle-Support-Range-1')} />
        );
        expect(container.querySelectorAll('[data-board]').length).toBe(1);
        expect(queryByText('▶')).toBeNull();
    });

    it('shows the caption', () => {
        const { getByText } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(getByText('Cone · Range 1 · enemy front')).toBeInTheDocument();
    });
});
