import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BattlePlayback from '../BattlePlayback';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatLogEntry, CombatLogTurn } from '../../../utils/combat/log/types';
import { SMALL_GRID_POSITIONS } from '../../../utils/targeting/board';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../../../hooks/useMediaQuery', () => ({ useMediaQuery: () => motion.reduced }));
vi.mock('../RoundEventLog', () => ({ default: () => null }));

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

    it('pins the ship clicked on the board, and a second click unpins it', () => {
        render(<BattlePlayback result={battle(3)} />);
        const nova = screen.getByLabelText(/Nova at T1/);
        fireEvent.click(nova);
        expect(nova).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Your team - round 1')).toBeInTheDocument();
        fireEvent.click(nova);
        expect(screen.queryByText('Your team - round 1')).not.toBeInTheDocument();
    });

    it('draws only the cells it is given', () => {
        const { container } = render(
            <BattlePlayback result={battle(2)} round={1} cells={SMALL_GRID_POSITIONS} />
        );
        const player = container.querySelector('[aria-label="Your team battle board"]')!;
        expect(player.querySelectorAll('[data-cell]')).toHaveLength(7);
        expect(player.querySelector('[data-cell="T1"]')).toBeNull();
    });
});

// ── Turn by turn ──────────────────────────────────────────────────────────────────────────────

const hit = (actorId: string, targetId: string, amount: number, hpAfter: number): CombatLogEntry =>
    ({
        kind: 'attack',
        actorId,
        targets: [{ targetId, amount, resultingHpPct: hpAfter }],
        reactions: [],
    }) as unknown as CombatLogEntry;

const turn = (actorId: string, entries: CombatLogEntry[]): CombatLogTurn => ({
    actorId,
    chargeBefore: 0,
    chargeMax: 0,
    entries,
});

/** Two rounds of two turns each: Nova hits Hexa, then Hexa hits Nova. */
const turnFight = (): BattleResult => {
    const base = battle(2);
    return {
        ...base,
        rounds: [
            {
                ...base.rounds[0],
                ships: [shipState('attacker', 'player', 90), shipState('e:enemy:0', 'enemy', 80)],
            },
            {
                ...base.rounds[1],
                ships: [shipState('attacker', 'player', 80), shipState('e:enemy:0', 'enemy', 60)],
            },
        ],
        combatLog: [1, 2].map((round) => ({
            round,
            startOfRound: [],
            endOfRound: [],
            turns: [
                turn('attacker', [hit('attacker', 'e:enemy:0', 200, round === 1 ? 80 : 60)]),
                turn('e:enemy:0', [hit('e:enemy:0', 'attacker', 100, round === 1 ? 90 : 80)]),
            ],
        })),
    } as unknown as BattleResult;
};

describe('BattlePlayback turn by turn', () => {
    it('steps turns within a round and across into the next', () => {
        render(<BattlePlayback result={turnFight()} />);
        // A round opens at its end.
        expect(screen.getByText('Round 1: Round end')).toBeInTheDocument();
        expect(screen.getByLabelText(/Hexa at T1, 80% HP/)).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Previous turn'));
        expect(screen.getByText('Round 1: Turn 1 / 2: Nova')).toBeInTheDocument();
        expect(screen.getByLabelText(/Hexa at T1, 80% HP/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Nova at T1, 100% HP/)).toBeInTheDocument();
        expect(screen.getByText('200')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Next turn'));
        fireEvent.click(screen.getByLabelText('Next turn'));
        expect(screen.getByText('Round 2: Turn 1 / 2: Nova')).toBeInTheDocument();
        expect(screen.getByText('Round 2 / 2')).toBeInTheDocument();
        expect(screen.getByLabelText(/Hexa at T1, 60% HP/)).toBeInTheDocument();
    });

    it('Play runs the turns through the rounds and stops at the end', () => {
        vi.useFakeTimers();
        try {
            render(<BattlePlayback result={turnFight()} />);
            fireEvent.click(screen.getByLabelText('Play'));
            expect(screen.getByText('Round 1: Turn 1 / 2: Nova')).toBeInTheDocument();
            act(() => void vi.advanceTimersByTime(900));
            expect(screen.getByText('Round 1: Turn 2 / 2: Hexa')).toBeInTheDocument();
            act(() => void vi.advanceTimersByTime(900));
            expect(screen.getByText('Round 2: Turn 1 / 2: Nova')).toBeInTheDocument();
            // Each turn arms the next one's timer once it has rendered.
            for (let i = 0; i < 5; i++) act(() => void vi.advanceTimersByTime(900));
            expect(screen.getByText('Round 2: Turn 2 / 2: Hexa')).toBeInTheDocument();
            expect(screen.getByLabelText('Play')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('under reduced motion the board shows no floating numbers', () => {
        motion.reduced = true;
        try {
            render(<BattlePlayback result={turnFight()} />);
            fireEvent.click(screen.getByLabelText('Previous turn'));
            expect(screen.getByLabelText(/Hexa at T1, 80% HP/)).toBeInTheDocument();
            expect(screen.queryByText('200')).not.toBeInTheDocument();
        } finally {
            motion.reduced = false;
        }
    });

    it('a controlled playback shows round ends and has no turn controls', () => {
        render(<BattlePlayback result={turnFight()} round={1} />);
        expect(screen.queryByLabelText('Next turn')).not.toBeInTheDocument();
        expect(screen.getByLabelText(/Hexa at T1, 80% HP/)).toBeInTheDocument();
        expect(screen.queryByText('200')).not.toBeInTheDocument();
    });
});
