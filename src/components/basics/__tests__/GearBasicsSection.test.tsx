import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GearBasicsSection from '../GearBasicsSection';
import { SLOT_MAIN_STATS, STATS } from '../../../constants/stats';
import { GEAR_SETS } from '../../../constants/gearSets';
import { GEAR_SLOTS } from '../../../constants/gearTypes';

describe('GearBasicsSection', () => {
    it('lists every gear slot, labelled from GEAR_SLOTS', () => {
        render(<GearBasicsSection />);
        for (const slot of Object.keys(SLOT_MAIN_STATS)) {
            expect(screen.getByTestId(`slot-row-${slot}`)).toHaveTextContent(
                GEAR_SLOTS[slot].label
            );
        }
    });

    it("shows a slot's primary stats from SLOT_MAIN_STATS, not a hardcoded list", () => {
        render(<GearBasicsSection />);
        // Weapon rolls exactly one primary stat.
        expect(screen.getByTestId('slot-row-weapon')).toHaveTextContent(STATS.attack.label);
        // Software is one of the flexible slots and is the only place hacking/security roll.
        const software = screen.getByTestId('slot-row-software');
        expect(software).toHaveTextContent(STATS.hacking.label);
        expect(software).toHaveTextContent(STATS.security.label);
        // Weapon must NOT claim stats it cannot roll.
        expect(screen.getByTestId('slot-row-weapon')).not.toHaveTextContent(STATS.speed.label);
    });

    it('lists every gear set', () => {
        render(<GearBasicsSection />);
        for (const set of Object.values(GEAR_SETS)) {
            expect(screen.getByTestId(`set-row-${set.name}`)).toBeInTheDocument();
        }
    });

    it('shows the piece count each set needs, defaulting to 2', () => {
        render(<GearBasicsSection />);
        // Boost is a 4-piece set.
        expect(screen.getByTestId('set-row-Boost')).toHaveTextContent('4');
        // Attack is a 2-piece set (no minPieces field).
        expect(screen.getByTestId('set-row-Attack')).toHaveTextContent('2');
    });

    it('opens the set table when the page was opened on a set deep link', () => {
        // The panel renders at max-h-0 when closed, so /basics#set-piercer would otherwise scroll
        // to a clipped row and show the reader nothing.
        window.location.hash = '#set-piercer';
        try {
            render(<GearBasicsSection />);
            expect(screen.getByRole('button', { name: /set bonuses/i })).toHaveAttribute(
                'aria-expanded',
                'true'
            );
        } finally {
            window.location.hash = '';
        }
    });

    it('leaves the set table closed when the page was opened without a set deep link', () => {
        render(<GearBasicsSection />);
        expect(screen.getByRole('button', { name: /set bonuses/i })).toHaveAttribute(
            'aria-expanded',
            'false'
        );
    });
});
