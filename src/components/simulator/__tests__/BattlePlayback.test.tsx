import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BattlePlayback from '../BattlePlayback';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';

const shipState = (actorId: string, side: 'player' | 'enemy', hpPct: number) => ({
    actorId,
    side,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    healingReceived: 0,
    shieldsAbsorbed: 0,
    shieldGranted: 0,
    currentShieldPool: 0,
    incomingDamage: 0,
    incomingShieldAbsorbed: 0,
    incomingBarrierAbsorbed: 0,
    hpPct,
    shieldPct: 0,
    alive: true,
    activeBuffs: [],
    activeDebuffs: [],
});

/** A fight of `rounds` rounds where the player's HP drops by 10 points per round, so the
 *  displayed round is readable off the board rather than off the stepper's own label. */
const battle = (rounds: number): BattleResult =>
    ({
        rounds: Array.from({ length: rounds }, (_, i) => ({
            round: i + 1,
            ships: [
                shipState('attacker', 'player', 100 - i * 10),
                shipState('e:enemy:0', 'enemy', 100),
            ],
            turnOrder: ['attacker', 'e:enemy:0'],
        })),
        outcome: { winner: 'player', lastRound: rounds },
        roster: [
            { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
            { actorId: 'e:enemy:0', side: 'enemy', name: 'Hexa', position: 'T1' },
        ],
        combatLog: [],
    }) as unknown as BattleResult;

describe('BattlePlayback', () => {
    it('renders its own stepper when uncontrolled', () => {
        render(<BattlePlayback result={battle(5)} />);
        expect(screen.getByLabelText('Next round')).toBeInTheDocument();
        expect(screen.getByText('Round 1 / 5')).toBeInTheDocument();
    });

    it('shows the round it is given and renders no stepper when controlled', () => {
        render(<BattlePlayback result={battle(5)} round={3} />);
        // The parent owns the position, so a second stepper here would be a second source of
        // truth for it.
        expect(screen.queryByLabelText('Next round')).not.toBeInTheDocument();
        // Round 3 is index 2, so hpPct is 100 - 2 * 10.
        expect(screen.getByLabelText(/Nova at T1, 80% HP/)).toBeInTheDocument();
    });

    it('clamps a controlled round past the end to this fight’s last round', () => {
        // The two sides of a divergence can end on different rounds; the shorter fight holds at
        // its own last round rather than blanking out.
        render(<BattlePlayback result={battle(2)} round={9} />);
        expect(screen.getByLabelText(/Nova at T1, 90% HP/)).toBeInTheDocument();
    });
});
