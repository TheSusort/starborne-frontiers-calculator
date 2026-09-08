import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AffinityWheel from '../AffinityWheel';
import { getAffinityMatchup } from '../../../utils/calculators/affinityUtils';

describe('AffinityWheel', () => {
    it('names all four affinities', () => {
        render(<AffinityWheel />);
        for (const name of ['Electric', 'Thermal', 'Chemical', 'Antimatter']) {
            expect(screen.getByText(name)).toBeInTheDocument();
        }
    });

    it('states the disadvantage clause that deletes non-hacking effects', () => {
        render(<AffinityWheel />);
        expect(
            screen.getByText(/Effects that do not require hacking will not be applied/i)
        ).toBeInTheDocument();
    });

    it('states the 75% crit hard cap', () => {
        render(<AffinityWheel />);
        expect(screen.getByText(/Hard cap at 75%/i)).toBeInTheDocument();
    });

    it('draws the cycle the engine actually implements', () => {
        // Tripwire: if ADVANTAGE_OVER ever changes, this fails rather than leaving the page lying.
        render(<AffinityWheel />);
        const arrows = screen
            .getAllByTestId(/^affinity-beats-/)
            .map((el) => el.getAttribute('data-testid')!.replace('affinity-beats-', ''));
        expect(arrows.sort()).toEqual(
            ['chemical-electric', 'electric-thermal', 'thermal-chemical'].sort()
        );
        for (const arrow of arrows) {
            const [winner, loser] = arrow.split('-');
            expect(getAffinityMatchup(winner as never, loser as never)).toBe('advantage');
        }
    });
});
