import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkillTargetingBoard } from '../SkillTargetingBoard';
import { parseShipTargeting, SkillTargeting } from '../../../utils/targetingParser';

function active(target: string, pattern: string) {
    return parseShipTargeting({ activeTarget: target, activePattern: pattern }).active!;
}

describe('SkillTargetingBoard', () => {
    it('renders the rule label and plain-English description for the selection', () => {
        const { getByText } = render(
            <SkillTargetingBoard targeting={active('skip', 'Pattern-Cone-Range-1')} />
        );
        expect(getByText('Skip')).toBeInTheDocument();
        expect(getByText(/leaps the front line/i)).toBeInTheDocument();
    });

    it('renders one primary cell and splash cells for a cone', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(container.querySelectorAll('[data-role="primary"]').length).toBe(1);
        expect(container.querySelectorAll('[data-role="splash"]').length).toBeGreaterThan(0);
    });

    it('colors enemy cells red (primary) and lighter red (splash)', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(container.querySelector('[data-role="primary"]')!.getAttribute('stroke')).toBe(
            '#ff3b5c'
        );
        expect(container.querySelector('[data-role="splash"]')!.getAttribute('stroke')).toBe(
            '#ff8a9c'
        );
    });

    it('colors ally cells green (splash) and darker green (caster/primary)', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('allies', 'Pattern-Cone-Support-Range-1')} />
        );
        expect(container.querySelector('[data-role="primary"]')!.getAttribute('stroke')).toBe(
            '#16a34a'
        );
        expect(container.querySelector('[data-role="splash"]')!.getAttribute('stroke')).toBe(
            '#4ade80'
        );
    });

    it('mirrors the cluster for enemy (attacker) targets but not for ally targets', () => {
        const base = active('skip', 'Pattern-Cone-Range-1'); // enemy side
        const allyVariant = {
            ...base,
            target: { ...base.target, side: 'ally' as const },
        };
        // The primary sits at offset (0,0) (unaffected by a horizontal flip), so compare a
        // splash cell, which is off-origin and moves when mirrored.
        const firstSplashPoints = (t: SkillTargeting) => {
            const { container } = render(<SkillTargetingBoard targeting={t} />);
            return container.querySelector('[data-role="splash"]')!.getAttribute('points');
        };
        expect(firstSplashPoints(base)).not.toBe(firstSplashPoints(allyVariant));
    });

    it('shows Primary/Splash legend for enemy targets', () => {
        const { getByText } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(getByText('Primary')).toBeInTheDocument();
        expect(getByText('Splash')).toBeInTheDocument();
    });

    it('notSelf ally pattern: splash cells only, no caster, Allies legend only', () => {
        // 'line|2|support+notSelf' → only cov() cells, no origin/primary; ally side.
        const { container, getByText, queryByText } = render(
            <SkillTargetingBoard
                targeting={active('allies', 'Pattern-Line-Support-Not-Self-Range-2')}
            />
        );
        expect(container.querySelectorAll('[data-role="primary"]').length).toBe(0);
        expect(container.querySelectorAll('[data-role="splash"]').length).toBeGreaterThan(0);
        expect(queryByText('Caster')).toBeNull();
        expect(getByText('Allies')).toBeInTheDocument();
    });

    it('puts the full shape/range/side caption in the SVG aria-label', () => {
        const { container } = render(
            <SkillTargetingBoard targeting={active('front', 'Pattern-Cone-Range-1')} />
        );
        expect(container.querySelector('svg')!.getAttribute('aria-label')).toContain(
            'Cone · Range 1 · enemy front'
        );
    });

    it('renders nothing for an unknown pattern signature (try/catch → null)', () => {
        const broken = {
            target: { raw: 'front', side: 'enemy', selection: 'front' },
            pattern: { raw: 'Pattern-Cone-Range-99', shape: 'cone', range: 99, modifiers: {} },
        } as unknown as SkillTargeting;
        const { container } = render(<SkillTargetingBoard targeting={broken} />);
        expect(container.querySelector('svg')).toBeNull();
    });
});
