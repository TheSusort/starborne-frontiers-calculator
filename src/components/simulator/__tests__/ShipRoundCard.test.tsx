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
    incomingDamage: 0,
    incomingShieldAbsorbed: 0,
    incomingBarrierAbsorbed: 0,
    hpPct: 65,
    shieldPct: 0,
    alive: true,
    activeBuffs: ['Attack Up'],
    activeDebuffs: ['Defense Shred'],
};

describe('ShipRoundCard', () => {
    const round: BattleRound = { round: 4, ships: [state], turnOrder: [] };

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
        const empty: BattleRound = { round: 4, ships: [], turnOrder: [] };
        const { container } = render(
            <ShipRoundCard actorId="attacker" round={empty} roster={roster} />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders "Shield granted" and "Current shield" StatCards with formatted values', () => {
        const stateWithShield: ShipRoundState = {
            ...state,
            shieldGranted: 4500,
            currentShieldPool: 3200,
        };
        const roundWithShield: BattleRound = {
            round: 5,
            ships: [stateWithShield],
            turnOrder: [],
        };
        render(<ShipRoundCard actorId="attacker" round={roundWithShield} roster={roster} />);
        expect(screen.getByText('Shield granted')).toBeInTheDocument();
        expect(screen.getByText('4,500')).toBeInTheDocument();
        expect(screen.getByText('Current shield')).toBeInTheDocument();
        expect(screen.getByText('3,200')).toBeInTheDocument();
    });

    it('renders per-victim incoming damage-taken StatCards with formatted values', () => {
        const stateWithIncoming: ShipRoundState = {
            ...state,
            // Net HP landed (incomingDamage) is what the card renders; the absorbed
            // fields are the portions soaked off the same arriving hit (900 + 1200 + 700 = 2800 total).
            incomingDamage: 900,
            incomingShieldAbsorbed: 1200,
            incomingBarrierAbsorbed: 700,
        };
        const roundWithIncoming: BattleRound = {
            round: 6,
            ships: [stateWithIncoming],
            turnOrder: [],
        };
        render(<ShipRoundCard actorId="attacker" round={roundWithIncoming} roster={roster} />);
        expect(screen.getByText('Incoming (HP)')).toBeInTheDocument();
        expect(screen.getByText('900')).toBeInTheDocument();
        expect(screen.getByText('Incoming shield absorbed')).toBeInTheDocument();
        expect(screen.getByText('1,200')).toBeInTheDocument();
        expect(screen.getByText('Incoming barrier absorbed')).toBeInTheDocument();
        expect(screen.getByText('700')).toBeInTheDocument();
    });
});
