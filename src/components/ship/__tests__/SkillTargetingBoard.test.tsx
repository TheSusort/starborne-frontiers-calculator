import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillTargetingBoard } from '../SkillTargetingBoard';
import { parseShipTargeting, SkillTargeting } from '../../../utils/targetingParser';

function active(target: string, pattern: string) {
    return parseShipTargeting({ activeTarget: target, activePattern: pattern }).active!;
}

describe('SkillTargetingBoard', () => {
    it('renders a single board with origin + covered cells for an enemy pattern', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        // Single board for both sides — no second (empty) board, no arrow.
        expect(container.querySelectorAll('[data-board]').length).toBe(1);
        expect(container.querySelectorAll('[data-role="origin"]').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('[data-role="covered"]').length).toBeGreaterThan(0);
    });

    it('renders a single board for a support (ally) pattern', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('allies', 'Pattern-Circle-Support-Range-1')} />
        );
        expect(container.querySelectorAll('[data-board]').length).toBe(1);
    });

    it('does not render per-cell position labels (compact, label-free board)', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        // No <text> elements inside the board group (labels removed).
        expect(container.querySelectorAll('svg text').length).toBe(0);
    });

    it('shows the caption', () => {
        const { getByText } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(getByText('Cone · Range 1 · enemy front')).toBeInTheDocument();
    });

    it('notSelf support pattern: single board, covered cells only, no origin in legend', () => {
        // Pattern-Line-Support-Not-Self-Range-2 with allies target
        // Signature: 'line|2|support+notSelf' → [cov(1,0), cov(2,0)] — no origin cells.
        const { container, queryByText } = render(
            <SkillTargetingBoard
                targeting={active('allies', 'Pattern-Line-Support-Not-Self-Range-2')}
            />
        );
        // Support layout: single board
        expect(container.querySelectorAll('[data-board]').length).toBe(1);
        // There are covered cells
        expect(container.querySelectorAll('[data-role="covered"]').length).toBeGreaterThan(0);
        // No origin cells anywhere (notSelf pattern has no ORIGIN in the offset table)
        expect(container.querySelectorAll('[data-role="origin"]').length).toBe(0);
        // Legend must NOT render the "origin" swatch
        expect(queryByText('origin')).toBeNull();
        // Legend must render the "covered" swatch
        expect(queryByText('covered')).toBeInTheDocument();
    });

    it('all-pattern: single board with all 12 cells as origin', () => {
        // Pattern-All → shape 'all' → all 12 positions role 'origin'.
        const { container } = render(
            <SkillTargetingBoard targeting={active('all', 'Pattern-All')} />
        );
        expect(container.querySelectorAll('[data-board]').length).toBe(1);
        expect(container.querySelectorAll('[data-role="origin"]').length).toBe(12);
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
