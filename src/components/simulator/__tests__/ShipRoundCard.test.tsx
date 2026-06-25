import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShipRoundCard from '../ShipRoundCard';
import type {
    BattleRound,
    BattleResult,
    ShipRoundState,
} from '../../../utils/calculators/battleSimulator';

const roster: BattleResult['roster'] = [
    { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
];

const state: ShipRoundState = {
    actorId: 'attacker',
    side: 'player',
    damageDealt: 1500,
    damageTaken: 300,
    healingDone: 0,
    healingReceived: 200,
    shieldsAbsorbed: 0,
    shieldGranted: 0,
    currentShieldPool: 0,
    hpPct: 65,
    alive: true,
    activeBuffs: ['Attack Up'],
    activeDebuffs: ['Defense Shred'],
};

describe('ShipRoundCard', () => {
    const round: BattleRound = { round: 4, ships: [state], events: [], turnOrder: [] };

    it('shows the pinned ship name and current-round stats', () => {
        render(<ShipRoundCard actorId="attacker" round={round} roster={roster} />);
        expect(screen.getByText('Nova')).toBeInTheDocument();
        expect(screen.getByText('65%')).toBeInTheDocument();
        expect(screen.getByText('1,500')).toBeInTheDocument();
        expect(screen.getByText('300')).toBeInTheDocument();
    });

    it('lists active buffs and debuffs', () => {
        render(<ShipRoundCard actorId="attacker" round={round} roster={roster} />);
        expect(screen.getByText('Attack Up')).toBeInTheDocument();
        expect(screen.getByText('Defense Shred')).toBeInTheDocument();
    });

    it('renders nothing when the actor has no state this round', () => {
        const empty: BattleRound = { round: 4, ships: [], events: [], turnOrder: [] };
        const { container } = render(
            <ShipRoundCard actorId="attacker" round={empty} roster={roster} />
        );
        expect(container).toBeEmptyDOMElement();
    });
});
