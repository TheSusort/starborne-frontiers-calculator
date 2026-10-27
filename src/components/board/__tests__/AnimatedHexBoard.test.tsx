import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedHexBoard, type HexBoardShip } from '../AnimatedHexBoard';
import { hexBoardLayout } from '../hexBoardLayout';
import { ALL_POSITIONS, SMALL_GRID_POSITIONS } from '../../../utils/targeting/board';

const ship = (s: Partial<HexBoardShip> = {}): HexBoardShip => ({
    name: 'Nova',
    imageUrl: null,
    hpPct: 100,
    shieldPct: 0,
    chargePct: null,
    buffs: [],
    debuffs: [],
    alive: true,
    ...s,
});

describe('hexBoardLayout', () => {
    for (const [name, cells] of [
        ['full board', ALL_POSITIONS],
        ['small grid', SMALL_GRID_POSITIONS],
    ] as const) {
        it(`${name}: every cell inside the board, none overlapping a row neighbour`, () => {
            for (const mirrored of [false, true]) {
                const { box } = hexBoardLayout(cells);
                const boxes = cells.map((c) => ({ c, ...box(c, mirrored) }));
                for (const b of boxes) {
                    expect(b.left).toBeGreaterThanOrEqual(-1e-9);
                    expect(b.top).toBeGreaterThanOrEqual(-1e-9);
                    expect(b.left + b.width).toBeLessThanOrEqual(100 + 1e-9);
                    expect(b.top + b.height).toBeLessThanOrEqual(100 + 1e-9);
                }
                for (const a of boxes) {
                    for (const b of boxes) {
                        if (a.c === b.c || a.c[0] !== b.c[0]) continue;
                        expect(Math.abs(a.left - b.left)).toBeGreaterThanOrEqual(a.width - 1e-9);
                    }
                }
            }
        });
    }

    it('the middle row sits half a hex toward the back, and mirroring flips the front', () => {
        const { box } = hexBoardLayout(ALL_POSITIONS);
        expect(box('M1', false).left).toBeLessThan(box('T1', false).left);
        expect(box('T4', false).left).toBeGreaterThan(box('T1', false).left);
        expect(box('T4', true).left).toBeLessThan(box('T1', true).left);
        expect(box('M1', true).left).toBeGreaterThan(box('T1', true).left);
    });
});

describe('AnimatedHexBoard', () => {
    it('draws every cell, a ship where given, and its numbers and counts', () => {
        const { getByRole, container } = render(
            <AnimatedHexBoard
                cells={SMALL_GRID_POSITIONS}
                ships={{
                    M3: ship({
                        hpPct: 40,
                        debuffs: ['Burn', 'Stasis'],
                        floats: [{ turn: 1, hits: [{ kind: 'damage', amount: 1234, crit: true }] }],
                        flash: 1,
                    }),
                }}
                tone="player"
                label="Your board"
            />
        );
        expect(container.querySelectorAll('[data-cell]')).toHaveLength(7);
        const m3 = container.querySelector<HTMLElement>('[data-cell="M3"]')!;
        expect(within(m3).getByRole('progressbar', { name: 'Nova hull' })).toHaveAttribute(
            'aria-valuenow',
            '40'
        );
        expect(within(m3).getByText('1,234!')).toBeTruthy();
        expect(within(m3).getByRole('list', { name: 'Nova debuffs' })).toHaveTextContent('+2');
        expect(m3.querySelector('.board-hit-flash')).not.toBeNull();
        expect(getByRole('group', { name: 'Your board' })).toBeTruthy();
    });
});
