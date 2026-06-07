import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TurnOrderStrip, TurnOrderActor } from '../TurnOrderStrip';

const actor = (
    name: string,
    speed: number,
    side: 'player' | 'enemy' = 'player'
): TurnOrderActor => ({ name, speed, side });

describe('TurnOrderStrip', () => {
    it('renders the actors ordered by speed DESC with 1-based positions', () => {
        render(
            <TurnOrderStrip
                actors={[actor('Buffer', 80), actor('Healer', 120), actor('Enemy', 50, 'enemy')]}
            />
        );
        const region = screen.getByTestId('turn-order-strip');
        // Each chip shows position, name, speed; chips are in DOM order = sorted order.
        const chips = within(region).getAllByTestId('turn-order-chip');
        expect(chips.map((c) => c.textContent)).toEqual(['1Healer120', '2Buffer80', '3Enemy50']);
    });

    it('places a faster enemy before a slower player (speed dominates side)', () => {
        render(<TurnOrderStrip actors={[actor('Healer', 50), actor('Enemy', 90, 'enemy')]} />);
        const chips = within(screen.getByTestId('turn-order-strip')).getAllByTestId(
            'turn-order-chip'
        );
        expect(chips[0].textContent).toBe('1Enemy90');
        expect(chips[1].textContent).toBe('2Healer50');
    });

    it('breaks equal-speed ties player-first, then input order', () => {
        render(
            <TurnOrderStrip
                actors={[actor('Enemy', 100, 'enemy'), actor('Team 1', 100), actor('Healer', 100)]}
            />
        );
        const chips = within(screen.getByTestId('turn-order-strip')).getAllByTestId(
            'turn-order-chip'
        );
        // Player side before enemy; within player side, input order (Team 1 before Healer).
        expect(chips.map((c) => c.textContent)).toEqual(['1Team 1100', '2Healer100', '3Enemy100']);
    });
});
