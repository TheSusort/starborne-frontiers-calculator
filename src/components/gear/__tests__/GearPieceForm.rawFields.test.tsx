import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { GearPieceForm } from '../GearPieceForm';
import type { GearPiece } from '../../../types/gear';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const editingPiece = (overrides: Partial<GearPiece>): GearPiece => ({
    id: 'gear-1',
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 100, type: 'flat' },
    subStats: [],
    setBonus: 'ATTACK',
    ...overrides,
});

const submitWith = (piece: GearPiece): GearPiece => {
    const onSubmit = vi.fn();
    const { container } = render(<GearPieceForm onSubmit={onSubmit} editingPiece={piece} />);
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][0] as GearPiece;
};

// Editing an unrelated field must not rewrite a stored slot or set the form cannot offer (#569).
describe('GearPieceForm keeps stored values it does not recognise', () => {
    it('saves an unrecognised set unchanged', () => {
        expect(submitWith(editingPiece({ setBonus: 'RETIRED_SET' })).setBonus).toBe('RETIRED_SET');
    });

    it('saves an unrecognised slot unchanged', () => {
        expect(submitWith(editingPiece({ slot: 'antenna' })).slot).toBe('antenna');
    });

    it('saves a recognised slot and set as they were', () => {
        const saved = submitWith(editingPiece({ slot: 'hull', setBonus: 'FORTITUDE' }));
        expect(saved.slot).toBe('hull');
        expect(saved.setBonus).toBe('FORTITUDE');
    });
});
