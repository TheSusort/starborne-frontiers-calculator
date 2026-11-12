// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SimulatorVerdict from '../SimulatorVerdict';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { SeedSetAggregate } from '../../../utils/simulator/seededRuns';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const roster: BattleResult['roster'] = [
    { actorId: 'p0', side: 'player', name: 'Nova', position: 'T1' },
    { actorId: 'p1', side: 'player', name: 'Vex', position: 'T2' },
    { actorId: 'e0', side: 'enemy', name: 'Hexa', position: 'T4' },
];

const aggregate: SeedSetAggregate = {
    baseSeed: 1,
    count: 20,
    roster,
    runs: [],
    wins: { player: 15, enemy: 5 },
    meanRounds: 7.25,
    medianRounds: 7,
    perActorMean: {
        p0: { damageDealt: 12345.6, damageTaken: 0, healingDone: 0 },
        p1: { damageDealt: 900, damageTaken: 0, healingDone: 0 },
        e0: { damageDealt: 4321, damageTaken: 0, healingDone: 0 },
    },
};

const ship = (actorId: string, side: 'player' | 'enemy', damageDealt: number) => ({
    actorId,
    side,
    damageDealt,
    damageTaken: 0,
    healingDone: 0,
});

const singleRun = {
    rounds: [
        { round: 1, ships: [ship('p0', 'player', 1000), ship('e0', 'enemy', 300)] },
        { round: 2, ships: [ship('p0', 'player', 1500), ship('e0', 'enemy', 200)] },
    ],
    outcome: { winner: 'player', lastRound: 2 },
    roster,
} as unknown as BattleResult;

const tile = (title: string) => screen.getByText(title).parentElement as HTMLElement;

describe('SimulatorVerdict', () => {
    it('summarises an aggregate: win rate, fight length and each side top damage', () => {
        render(<SimulatorVerdict aggregate={aggregate} />);
        expect(tile('Your win rate')).toHaveTextContent('75%');
        expect(tile('Your win rate')).toHaveTextContent('15 of 20');
        expect(tile('Fight length')).toHaveTextContent('7.3');
        expect(tile('Fight length')).toHaveTextContent('median 7');
        expect(tile('Your top damage')).toHaveTextContent('12,346');
        expect(tile('Your top damage')).toHaveTextContent('Nova');
        expect(tile('Enemy top damage')).toHaveTextContent('4,321');
        expect(tile('Enemy top damage')).toHaveTextContent('Hexa');
    });

    it('summarises a single run from its own rounds and per-ship totals', () => {
        render(<SimulatorVerdict result={singleRun} />);
        expect(tile('Your win rate')).toHaveTextContent('100%');
        expect(tile('Your win rate')).toHaveTextContent('1 of 1');
        expect(tile('Fight length')).toHaveTextContent('2');
        expect(tile('Your top damage')).toHaveTextContent('2,500');
        expect(tile('Enemy top damage')).toHaveTextContent('500');
        expect(tile('Enemy top damage')).toHaveTextContent('Hexa');
    });

    it('shows a lost single run as 0%', () => {
        const lost = {
            ...singleRun,
            outcome: { winner: 'enemy', lastRound: 2 },
        } as unknown as BattleResult;
        render(<SimulatorVerdict result={lost} />);
        expect(tile('Your win rate')).toHaveTextContent('0%');
        expect(tile('Your win rate')).toHaveTextContent('0 of 1');
    });
});
