// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ShipBreakdownTable from '../ShipBreakdownTable';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { ActorTotals } from '../../../utils/simulator/seededRuns';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

type Roster = BattleResult['roster'];

const roster: Roster = [
    { actorId: 'p0', side: 'player', name: 'Nova', position: 'T1' },
    { actorId: 'p1', side: 'player', name: 'Nova', position: 'T2' },
    { actorId: 'p2', side: 'player', name: 'Vex', position: 'T3' },
    { actorId: 'e0', side: 'enemy', name: 'Hexa', position: 'T4' },
];

const totals = (damageDealt: number, damageTaken = 0, healingDone = 0): ActorTotals => ({
    damageDealt,
    damageTaken,
    healingDone,
});

const perActorMean: Record<string, ActorTotals> = {
    p0: totals(12345, 400, 0),
    p1: totals(6000, 800, 0),
    p2: totals(0, 0, 0),
    e0: totals(3000, 1600, 0),
};

const rowFor = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const barValue = (row: HTMLElement, label: RegExp) =>
    Number(within(row).getByRole('progressbar', { name: label }).getAttribute('aria-valuenow'));

describe('ShipBreakdownTable', () => {
    it('groups ships under a header per side', () => {
        render(<ShipBreakdownTable roster={roster} perActorMean={perActorMean} />);
        expect(screen.getByText('Your team')).toBeInTheDocument();
        expect(screen.getByText('Enemy')).toBeInTheDocument();
        // Player rows come before the enemy header, enemy rows after it.
        const rows = screen.getAllByRole('row').map((row) => row.textContent ?? '');
        const enemyHeader = rows.findIndex((text) => text === 'Enemy');
        const hexa = rows.findIndex((text) => text.startsWith('Hexa'));
        const vex = rows.findIndex((text) => text.startsWith('Vex'));
        expect(vex).toBeLessThan(enemyHeader);
        expect(hexa).toBeGreaterThan(enemyHeader);
    });

    it('formats numbers with thousands separators', () => {
        render(<ShipBreakdownTable roster={roster} perActorMean={perActorMean} />);
        expect(screen.getByText('12,345')).toBeInTheDocument();
        expect(screen.queryByText('12345')).not.toBeInTheDocument();
    });

    it('suffixes duplicate names on one side in roster order and leaves unique names alone', () => {
        render(<ShipBreakdownTable roster={roster} perActorMean={perActorMean} />);
        expect(screen.getByText('Nova #1')).toBeInTheDocument();
        expect(screen.getByText('Nova #2')).toBeInTheDocument();
        expect(screen.getByText('Vex')).toBeInTheDocument();
        expect(screen.queryByText('Nova')).not.toBeInTheDocument();
    });

    it('does not suffix a name that repeats only across sides', () => {
        const mirrored: Roster = [
            { actorId: 'p0', side: 'player', name: 'Nova', position: 'T1' },
            { actorId: 'e0', side: 'enemy', name: 'Nova', position: 'T4' },
        ];
        render(<ShipBreakdownTable roster={mirrored} perActorMean={perActorMean} />);
        expect(screen.getAllByText('Nova')).toHaveLength(2);
    });

    it('scales each column bar to that column max across every row', () => {
        render(<ShipBreakdownTable roster={roster} perActorMean={perActorMean} />);
        const nova1 = rowFor('Nova #1');
        const nova2 = rowFor('Nova #2');
        // Dealt max is 12,345 (Nova #1); taken max is 1,600 (Hexa).
        expect(barValue(nova1, /dealt/i)).toBe(100);
        expect(barValue(nova2, /dealt/i)).toBe(Math.round((6000 / 12345) * 100));
        expect(barValue(rowFor('Hexa'), /taken/i)).toBe(100);
        expect(barValue(nova1, /taken/i)).toBe(25);
    });

    it('draws empty bars for a column where every row is zero', () => {
        render(<ShipBreakdownTable roster={roster} perActorMean={perActorMean} />);
        expect(barValue(rowFor('Nova #1'), /healing/i)).toBe(0);
        expect(barValue(rowFor('Hexa'), /healing/i)).toBe(0);
    });

    it('treats a rostered ship with no recorded totals as zero', () => {
        render(<ShipBreakdownTable roster={roster} perActorMean={{ p0: totals(100) }} />);
        expect(barValue(rowFor('Hexa'), /dealt/i)).toBe(0);
    });
});
