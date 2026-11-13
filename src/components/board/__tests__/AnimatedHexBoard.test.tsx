// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';
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

describe('AnimatedHexBoard multi-hex units', () => {
    it('draws a covered cell as part of the unit and selects the anchor from it', () => {
        const picked: string[] = [];
        const { container } = render(
            <AnimatedHexBoard
                cells={ALL_POSITIONS}
                ships={{ M1: ship({ name: 'Boss' }) }}
                secondaryCells={{ M2: 'M1' }}
                tone="enemy"
                label="Board"
                onSelectCell={(cell) => picked.push(cell)}
            />
        );
        const m2 = container.querySelector('[data-cell="M2"]') as HTMLElement;
        // The unit's name is drawn once, on its anchor cell.
        expect(m2).not.toHaveTextContent('Boss');
        expect(container.querySelector('[data-cell="M1"]')).toHaveTextContent('Boss');
        within(m2)
            .getByRole('button', { name: /^Boss at M1/ })
            .click();
        expect(picked).toEqual(['M1']);
    });

    it('draws the unit’s portrait and hull on a covered cell, hidden from assistive tech', () => {
        const { container } = render(
            <AnimatedHexBoard
                cells={ALL_POSITIONS}
                ships={{ M1: ship({ name: 'Boss', imageUrl: 'boss.png', hpPct: 40 }) }}
                secondaryCells={{ M2: 'M1' }}
                tone="enemy"
                label="Board"
            />
        );
        const m2 = container.querySelector('[data-cell="M2"]') as HTMLElement;
        expect(m2.querySelector('img')).toHaveAttribute('src', 'boss.png');
        expect(
            within(m2).getByRole('progressbar', { name: 'Boss hull', hidden: true })
        ).toHaveAttribute('aria-valuenow', '40');
        expect(within(m2).queryByRole('progressbar', { name: 'Boss hull' })).toBeNull();
        expect(
            within(m2).queryByRole('progressbar', { name: 'Boss charge', hidden: true })
        ).toBeNull();
    });

    it('keeps a covered cell’s rim and dimmed look when the unit is destroyed', () => {
        const { container } = render(
            <AnimatedHexBoard
                cells={ALL_POSITIONS}
                ships={{ M1: ship({ name: 'Boss', alive: false }) }}
                secondaryCells={{ M2: 'M1' }}
                tone="enemy"
                label="Board"
                onSelectCell={() => {}}
            />
        );
        const m2 = container.querySelector('[data-cell="M2"]') as HTMLElement;
        expect(m2.querySelector('.opacity-40')).not.toBeNull();
        expect(within(m2).getByRole('button', { name: /^Boss at M1.*destroyed/ })).toBeTruthy();
    });
});

describe('AnimatedHexBoard hover', () => {
    const setup = () => {
        const calls: [string | null, HTMLElement | null][] = [];
        const { getByRole, container } = render(
            <AnimatedHexBoard
                cells={ALL_POSITIONS}
                ships={{ M1: ship({ name: 'Boss' }), T2: ship({ name: 'Nova' }) }}
                secondaryCells={{ M2: 'M1' }}
                tone="enemy"
                label="Board"
                onSelectCell={() => {}}
                onHoverCell={(cell, el) => calls.push([cell, el])}
            />
        );
        return { calls, getByRole, container };
    };

    it('reports the hovered cell with its button, and null on leave', () => {
        const { calls, getByRole } = setup();
        const nova = getByRole('button', { name: /^Nova at T2/ });
        fireEvent.mouseEnter(nova);
        fireEvent.mouseLeave(nova);
        expect(calls).toEqual([
            ['T2', nova],
            [null, null],
        ]);
    });

    it('reports focus and blur the same way', () => {
        const { calls, getByRole } = setup();
        const nova = getByRole('button', { name: /^Nova at T2/ });
        fireEvent.focus(nova);
        fireEvent.blur(nova);
        expect(calls).toEqual([
            ['T2', nova],
            [null, null],
        ]);
    });

    it('reports the anchor cell when a covered cell is hovered', () => {
        const { calls, container } = setup();
        const covered = within(
            container.querySelector('[data-cell="M2"]') as HTMLElement
        ).getByRole('button');
        fireEvent.mouseEnter(covered);
        expect(calls).toEqual([['M1', covered]]);
    });
});
