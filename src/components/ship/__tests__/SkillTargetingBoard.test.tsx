import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillTargetingBoard } from '../SkillTargetingBoard';
import { parseShipTargeting, SkillTargeting } from '../../../utils/targetingParser';

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

    it('renders nothing when the pattern has an unknown signature (try/catch → null)', () => {
        // Construct a SkillTargeting whose pattern signature has no offset table entry.
        // shape='cone', range=99 produces signature "cone|99|" which is not in OFFSET_TABLES,
        // so resolveCells throws and the component returns null.
        const broken = {
            target: { raw: 'front', side: 'enemy', selection: 'front' },
            pattern: { raw: 'Pattern-Cone-Range-99', shape: 'cone', range: 99, modifiers: {} },
        } as unknown as SkillTargeting;
        const { container } = render(<SkillTargetingBoard targeting={broken} />);
        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('[data-board]')).toBeNull();
    });
});
