import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import StatSweepPanel from '../StatSweepPanel';
import type { BoardState } from '../PlacementBoard';
import type { Ship } from '../../../types/ship';
import type { CombatStatsDeps } from '../../../utils/ship/combatStats';
import { OVERRIDABLE_STATS } from '../../../utils/simulator/statOverrides';
import { STATS } from '../../../constants/stats';
import type { StatName } from '../../../types/stats';

// recharts' ResponsiveContainer needs a ResizeObserver and real layout, neither of which jsdom
// provides. What the chart draws is StatSweepChart.test's subject; here it only has to mount.
vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    const Empty = () => null;
    return {
        LineChart: Pass,
        ResponsiveContainer: Pass,
        Line: Empty,
        ReferenceLine: Empty,
        XAxis: Empty,
        YAxis: Empty,
        CartesianGrid: Empty,
        Tooltip: Empty,
    };
});

const ship = (id: string, name: string, speed: number, attack = 1000): Ship =>
    ({
        id,
        name,
        type: 'ATTACKER',
        baseStats: { attack, crit: 10, critDamage: 50, defence: 500, hp: 10000, speed },
        equipment: {},
        refits: [],
    }) as unknown as Ship;

const statsDeps: CombatStatsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const playerBoard: BoardState = {
    T1: { ship: ship('p1', 'Ranger', 120) },
    M2: { ship: ship('p2', 'Warden', 105) },
};
const enemyBoard: BoardState = { T1: { ship: ship('e1', 'Raider', 98) } };

const renderPanel = (props: Partial<React.ComponentProps<typeof StatSweepPanel>> = {}) => {
    const onRunSweep = vi.fn();
    const onCancelSweep = vi.fn();
    const result = render(
        <StatSweepPanel
            playerBoard={playerBoard}
            enemyBoard={enemyBoard}
            statsDeps={statsDeps}
            seed={4242}
            points={null}
            provenance={null}
            isSweeping={false}
            progress={null}
            error={null}
            onRunSweep={onRunSweep}
            onCancelSweep={onCancelSweep}
            {...props}
        />
    );
    fireEvent.click(screen.getByTestId('sweep-toggle'));
    return { ...result, onRunSweep, onCancelSweep };
};

const pickTarget = (optionName: RegExp) => {
    fireEvent.click(screen.getByTestId('sweep-target'));
    fireEvent.click(screen.getByRole('option', { name: optionName }));
};

const pickStat = (label: string) => {
    fireEvent.click(screen.getByTestId('sweep-stat'));
    fireEvent.click(screen.getByRole('option', { name: label }));
};

const field = (label: RegExp) => screen.getByLabelText<HTMLInputElement>(label);

describe('StatSweepPanel', () => {
    it('lists every placed ship on both boards, labelled with side and position', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('sweep-target'));
        expect(screen.getByRole('option', { name: 'Your team T1 — Ranger' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Your team M2 — Warden' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Enemy T1 — Raider' })).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('offers every overridable stat', () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('sweep-stat'));
        for (const stat of OVERRIDABLE_STATS) {
            expect(
                screen.getByRole('option', { name: STATS[stat as StatName].label })
            ).toBeInTheDocument();
        }
        expect(screen.getAllByRole('option')).toHaveLength(OVERRIDABLE_STATS.length);
    });

    it('prefills the range from the selected target resolved value', () => {
        renderPanel();
        pickTarget(/Your team T1 — Ranger/);
        expect(field(/^From$/i).value).toBe('120');
        expect(field(/^To$/i).value).toBe('180');
        expect(field(/^Step$/i).value).toBe('10');
    });

    it('re-prefills when the target changes', () => {
        renderPanel();
        pickTarget(/Your team T1 — Ranger/);
        pickTarget(/Enemy T1 — Raider/);
        expect(field(/^From$/i).value).toBe('98');
    });

    it('re-prefills when the stat changes', () => {
        renderPanel();
        pickTarget(/Your team T1 — Ranger/);
        pickStat(STATS.attack.label);
        expect(field(/^From$/i).value).toBe('1000');
    });

    it('prefills from the value the ship actually fights at, override included', () => {
        // A placement already carrying an override sits at the override, not at its gear figure:
        // the reference step has to be where the ship is, or the sweep compares against a
        // configuration the user never runs.
        renderPanel({
            playerBoard: { T1: { ship: ship('p1', 'Ranger', 120), overrides: { speed: 150 } } },
        });
        pickTarget(/Your team T1 — Ranger/);
        expect(field(/^From$/i).value).toBe('150');
    });

    it('previews the cost and updates it with the inputs', () => {
        renderPanel();
        pickTarget(/Your team T1 — Ranger/);
        // 120..180 step 10 is 7 steps, and the sweep's own run count defaults to 20.
        expect(screen.getByText('7 steps x 20 seeds = 140 battles')).toBeInTheDocument();
        fireEvent.change(field(/^To$/i), { target: { value: '150' } });
        expect(screen.getByText('4 steps x 20 seeds = 80 battles')).toBeInTheDocument();
        fireEvent.change(field(/^Seeds per step$/i), { target: { value: '5' } });
        expect(screen.getByText('4 steps x 5 seeds = 20 battles')).toBeInTheDocument();
    });

    it('disables Run until a target is selected', () => {
        renderPanel();
        expect(screen.getByRole('button', { name: /Run sweep/i })).toBeDisabled();
        pickTarget(/Your team T1 — Ranger/);
        expect(screen.getByRole('button', { name: /Run sweep/i })).not.toBeDisabled();
    });

    it('hands the run its target, stat, range, seed and resolved value', () => {
        const { onRunSweep } = renderPanel();
        pickTarget(/Your team M2 — Warden/);
        fireEvent.click(screen.getByRole('button', { name: /Run sweep/i }));
        expect(onRunSweep).toHaveBeenCalledWith({
            target: { side: 'player', position: 'M2' },
            stat: 'speed',
            from: 105,
            to: 158,
            step: 10,
            resolved: 105,
            baseSeed: 4242,
            count: 20,
        });
    });

    it('replaces Run with Cancel while sweeping and announces progress', () => {
        renderPanel({ isSweeping: true, progress: { completed: 40, total: 140 } });
        expect(screen.queryByRole('button', { name: /Run sweep/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
        const live = screen.getByTestId('sweep-progress');
        expect(live).toHaveAttribute('aria-live', 'polite');
        expect(live).toHaveTextContent('40 / 140');
    });

    it('mounts the progress region before there is progress to put in it', () => {
        // A screen reader announces a live region inconsistently when the region and its first
        // text arrive in the same mutation.
        renderPanel();
        expect(screen.getByTestId('sweep-progress')).toBeEmptyDOMElement();
    });

    it('shows the error it is given', () => {
        renderPanel({ error: 'sweep step must be positive' });
        expect(screen.getByText(/sweep step must be positive/i)).toBeInTheDocument();
    });

    it('cannot start a sweep while an ordinary run is in flight', () => {
        renderPanel({ disabled: true });
        pickTarget(/Your team T1 — Ranger/);
        expect(screen.getByRole('button', { name: /Run sweep/i })).toBeDisabled();
    });

    it('says a sweep moves one stat while real gear moves several', () => {
        renderPanel();
        expect(screen.getByText(/holds every other stat fixed/i)).toBeInTheDocument();
    });

    it('refuses a sweep while one side of the board is empty', () => {
        // simulateBattle throws on an empty side, so a sweep that could start here could only
        // fail — the same guard `canRun` puts on an ordinary run.
        const { onRunSweep } = renderPanel({ enemyBoard: {} });
        pickTarget(/Ranger/);
        const run = screen.getByRole('button', { name: /run sweep/i });
        expect(run).toBeDisabled();
        fireEvent.click(run);
        expect(onRunSweep).not.toHaveBeenCalled();
    });

    it('captions the chart from the run that produced it, not the live selections', () => {
        // A result outlives the controls that made it. Captioning from live state would relabel
        // an existing chart with a stat and ship that never ran.
        renderPanel({
            points: [
                { value: 100, isReference: true, winRate: 0.5, meanRounds: 9, playerDamage: 900 },
            ],
            provenance: {
                stat: 'attack',
                target: { side: 'enemy', position: 'T1' },
                baseSeed: 900,
                count: 20,
            },
        });
        pickStat('Speed');
        const caption = screen.getByTestId('sweep-provenance');
        expect(caption).toHaveTextContent(/Attack/i);
        expect(caption).not.toHaveTextContent(/Speed/i);
        expect(caption).toHaveTextContent(/T1/);
        expect(caption).toHaveTextContent(/900-919/);
    });

    it('switches the charted series', () => {
        renderPanel({
            provenance: {
                stat: 'speed',
                target: { side: 'player', position: 'T1' },
                baseSeed: 7,
                count: 20,
            },
            points: [
                { value: 120, isReference: true, winRate: 0.5, meanRounds: 10, playerDamage: 900 },
            ],
        });
        const toggle = screen.getByTestId('sweep-series-toggle');
        expect(within(toggle).getByRole('button', { name: /Win rate/i })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        fireEvent.click(within(toggle).getByRole('button', { name: /Mean rounds/i }));
        expect(within(toggle).getByRole('button', { name: /Mean rounds/i })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        expect(within(toggle).getByRole('button', { name: /Win rate/i })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });
});
