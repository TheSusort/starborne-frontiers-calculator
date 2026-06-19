import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RoundEventLog from '../RoundEventLog';
import type { BattleRound, BattleResult } from '../../../utils/calculators/battleSimulator';

const roster: BattleResult['roster'] = [
    { actorId: 'attacker', side: 'player', name: 'Graphite', position: 'T1' },
    { actorId: 'p:judge:1', side: 'player', name: 'Judge', position: 'T2' },
    { actorId: 'e:s3:0', side: 'enemy', name: 'Selenite', position: 'T4' },
    { actorId: 'e:s3:1', side: 'enemy', name: 'Curator', position: 'B4' },
];

const renderRound = (events: BattleRound['events']) => {
    const round: BattleRound = { round: 1, ships: [], events, turnOrder: [] };
    render(<RoundEventLog round={round} roster={roster} />);
};

describe('RoundEventLog', () => {
    it('renders attacker-centric damage "X → Y: N" with the enemy "Enemy " prefix on the target', () => {
        renderRound([
            { round: 1, kind: 'damage', actorId: 'p:judge:1', targetId: 'e:s3:0', amount: 435312 },
        ]);
        expect(screen.getByText('Judge → Enemy Selenite: 435,312')).toBeInTheDocument();
    });

    it('renders a damage line targeting the dummy "enemy" verbatim', () => {
        renderRound([
            { round: 1, kind: 'damage', actorId: 'attacker', targetId: 'enemy', amount: 900 },
        ]);
        expect(screen.getByText('Graphite → enemy: 900')).toBeInTheDocument();
    });

    it('renders a turn delimiter line', () => {
        renderRound([{ round: 1, kind: 'turn', actorId: 'e:s3:1' }]);
        expect(screen.getByText("— Enemy Curator's turn —")).toBeInTheDocument();
    });

    it('renders a heal line with caster + target', () => {
        renderRound([
            { round: 1, kind: 'heal', actorId: 'attacker', targetId: 'p:judge:1', amount: 1411 },
        ]);
        expect(screen.getByText('Graphite heals Judge for 1,411')).toBeInTheDocument();
    });

    it('renders a buff line', () => {
        renderRound([{ round: 1, kind: 'buff', actorId: 'p:judge:1', label: 'Attack Up' }]);
        expect(screen.getByText('Judge gains Attack Up')).toBeInTheDocument();
    });

    it('renders a debuff line with the enemy prefix', () => {
        renderRound([{ round: 1, kind: 'debuff', actorId: 'e:s3:1', label: 'Def Down' }]);
        expect(screen.getByText('Enemy Curator afflicted with Def Down')).toBeInTheDocument();
    });

    it('renders a dot line with a title-cased label', () => {
        renderRound([{ round: 1, kind: 'dot', actorId: 'e:s3:0', label: 'corrosion' }]);
        expect(screen.getByText('Enemy Selenite afflicted with Corrosion')).toBeInTheDocument();
    });

    it('renders a death line with the enemy prefix', () => {
        renderRound([{ round: 1, kind: 'death', actorId: 'e:s3:0' }]);
        expect(screen.getByText('Enemy Selenite destroyed')).toBeInTheDocument();
    });

    it('shows an empty message when there are no events', () => {
        const round: BattleRound = { round: 3, ships: [], events: [], turnOrder: [] };
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/no events this round/i)).toBeInTheDocument();
    });
});
