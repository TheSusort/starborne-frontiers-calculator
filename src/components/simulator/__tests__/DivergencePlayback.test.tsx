import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DivergencePlayback from '../DivergencePlayback';
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

const battle = (rounds: number, winner: 'player' | 'enemy' | 'draw'): BattleResult =>
    ({
        rounds: Array.from({ length: rounds }, (_, i) => ({
            round: i + 1,
            ships: [
                shipState('attacker', 'player', 100 - i * 10),
                shipState('e:enemy:0', 'enemy', 100),
            ],
            turnOrder: ['attacker', 'e:enemy:0'],
        })),
        outcome: { winner, lastRound: rounds },
        roster: [
            { actorId: 'attacker', side: 'player', name: 'Nova', position: 'T1' },
            { actorId: 'e:enemy:0', side: 'enemy', name: 'Hexa', position: 'T1' },
        ],
        combatLog: [],
    }) as unknown as BattleResult;

describe('DivergencePlayback', () => {
    const props = {
        seed: 507,
        baseline: battle(4, 'enemy'),
        current: battle(7, 'player'),
        onClose: vi.fn(),
    };

    it('names the seed and reads correctly for every outcome, including a draw', () => {
        render(<DivergencePlayback {...props} />);
        expect(screen.getByText(/Seed 507/)).toBeInTheDocument();
        // props: baseline is a 4-round enemy win, current a 7-round player win.
        expect(
            screen.getByText(
                'Baseline: Enemy wins in 4 rounds. Current: Your team wins in 7 rounds.'
            )
        ).toBeInTheDocument();
    });

    it('reads correctly when one side is a draw', () => {
        render(
            <DivergencePlayback
                seed={507}
                baseline={battle(4, 'draw')}
                current={battle(7, 'player')}
                onClose={vi.fn()}
            />
        );
        expect(
            screen.getByText('Baseline: Draw in 4 rounds. Current: Your team wins in 7 rounds.')
        ).toBeInTheDocument();
    });

    it('drives both fights from one stepper, over the longer fight’s round count', () => {
        render(<DivergencePlayback {...props} />);
        // One stepper, not one per fight — the whole point is that both sides show the same round.
        expect(screen.getAllByLabelText('Next round')).toHaveLength(1);
        expect(screen.getByText('Round 1 / 7')).toBeInTheDocument();
    });

    it('advances both fights together, and the shorter one holds at its last round', () => {
        render(<DivergencePlayback {...props} />);
        // Step to round 6: past the 4-round baseline, inside the 7-round current run.
        for (let i = 0; i < 5; i++) {
            fireEvent.click(screen.getByLabelText('Next round'));
        }
        expect(screen.getByText('Round 6 / 7')).toBeInTheDocument();
        // Baseline holds at its own last round, 4 (index 3, 70%); the current run shows its
        // round 6 (index 5, 50%).
        expect(screen.getByLabelText(/Nova at T1, 70% HP/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Nova at T1, 50% HP/)).toBeInTheDocument();
    });

    // The other fixtures all make `current` the longer fight, so "the longer fight" and
    // "current's own length" read the same in their assertions. This one flips it: baseline is
    // longer, current is shorter, pinning that the stepper spans the longer fight whichever side
    // it's on.
    const mirroredProps = {
        seed: 507,
        baseline: battle(7, 'enemy'),
        current: battle(4, 'player'),
        onClose: vi.fn(),
    };

    it('spans the longer fight even when that fight is the baseline', () => {
        render(<DivergencePlayback {...mirroredProps} />);
        expect(screen.getByText('Round 1 / 7')).toBeInTheDocument();
    });

    it('holds the shorter fight at its last round when current is the shorter one', () => {
        render(<DivergencePlayback {...mirroredProps} />);
        // Step to round 6: past the 4-round current run, inside the 7-round baseline.
        for (let i = 0; i < 5; i++) {
            fireEvent.click(screen.getByLabelText('Next round'));
        }
        expect(screen.getByText('Round 6 / 7')).toBeInTheDocument();
        // Current holds at its own last round, 4 (index 3, 70%); baseline shows its round 6
        // (index 5, 50%).
        expect(screen.getByLabelText(/Nova at T1, 70% HP/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Nova at T1, 50% HP/)).toBeInTheDocument();
    });

    it('closes', () => {
        const onClose = vi.fn();
        render(<DivergencePlayback {...props} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalled();
    });
});
