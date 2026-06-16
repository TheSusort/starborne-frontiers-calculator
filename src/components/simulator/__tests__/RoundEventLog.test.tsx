import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RoundEventLog from '../RoundEventLog';
import type { BattleRound, BattleResult } from '../../../utils/calculators/battleSimulator';

const roster: BattleResult['roster'] = [
    { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
    { actorId: 'e:s3:0', side: 'enemy', name: 'Hexa', position: 'T4' },
];

describe('RoundEventLog', () => {
    it('renders a damage line mapping actorIds to names', () => {
        const round: BattleRound = {
            round: 1,
            ships: [],
            events: [
                { round: 1, kind: 'damage', actorId: 'attacker', targetId: 'e:s3:0', amount: 2140 },
            ],
            turnOrder: [],
        };
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText('Nova -> Hexa: 2,140')).toBeInTheDocument();
    });

    it('renders heal and death lines', () => {
        const round: BattleRound = {
            round: 2,
            ships: [],
            events: [
                { round: 2, kind: 'heal', actorId: 'attacker', targetId: 'attacker', amount: 800 },
                { round: 2, kind: 'death', actorId: 'e:s3:0' },
            ],
            turnOrder: [],
        };
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText('Nova heals Nova: 800')).toBeInTheDocument();
        expect(screen.getByText('Hexa destroyed')).toBeInTheDocument();
    });

    it('shows an empty message when there are no events', () => {
        const round: BattleRound = { round: 3, ships: [], events: [], turnOrder: [] };
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/no events this round/i)).toBeInTheDocument();
    });
});
