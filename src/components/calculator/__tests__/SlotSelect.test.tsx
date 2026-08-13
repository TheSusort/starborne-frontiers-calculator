import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotSelect } from '../SlotSelect';

describe('SlotSelect', () => {
    it('reflects the current slot', () => {
        render(<SlotSelect value="M4" onChange={() => {}} label="Slot" />);
        expect(screen.getByText('M4 (front)')).toBeInTheDocument();
    });

    it('reports the chosen slot', () => {
        const onChange = vi.fn();
        render(<SlotSelect value="M4" onChange={onChange} label="Slot" />);
        fireEvent.click(screen.getByLabelText('Slot'));
        fireEvent.click(screen.getByText('T1'));
        expect(onChange).toHaveBeenCalledWith('T1');
    });

    it('marks an already-taken slot so a collision is visible before it happens', () => {
        render(<SlotSelect value="M4" onChange={() => {}} label="Slot" taken={['T1']} />);
        fireEvent.click(screen.getByLabelText('Slot'));
        expect(screen.getByText('T1 (taken)')).toBeInTheDocument();
    });

    it("never marks the actor's OWN slot as taken", () => {
        render(<SlotSelect value="M4" onChange={() => {}} label="Slot" taken={['M4']} />);
        // Select is portal-based — options render only once the menu is open. Without opening it,
        // queryByText('M4 (taken)') is absent no matter what the own-slot logic does, so this
        // assertion needs the click first or it discriminates nothing.
        fireEvent.click(screen.getByLabelText('Slot'));
        expect(screen.queryByText('M4 (taken)')).not.toBeInTheDocument();
    });
});
