// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    it('renders one round button per round, and no Outcome card, when uncontrolled', () => {
        render(<BattlePlayback result={battle(5)} />);
        const rounds = within(screen.getByRole('group', { name: 'Rounds' }));
        expect(rounds.getAllByRole('button').map((b) => b.textContent)).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
        ]);
        expect(rounds.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText('Outcome')).not.toBeInTheDocument();
        expect(screen.getByText('Your team wins in round 5')).toBeInTheDocument();
    });

    it('keeps the Outcome card when controlled, with no player toolbar', () => {
        render(<BattlePlayback result={battle(5)} round={2} />);
        expect(screen.getByText('Outcome')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Rounds' })).not.toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Playback speed' })).not.toBeInTheDocument();
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
        expect(screen.getByText('Round 1 · round end')).toBeInTheDocument();
        expect(screen.getByLabelText(/Hexa at T1, 80% HP/)).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Previous turn'));
        expect(screen.getByText('Round 1 · turn 1 of 2 · Nova')).toBeInTheDocument();
        expect(screen.getByLabelText(/Hexa at T1, 80% HP/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Nova at T1, 100% HP/)).toBeInTheDocument();
        expect(screen.getByText('200')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Next turn'));
        fireEvent.click(screen.getByLabelText('Next turn'));
        expect(screen.getByText('Round 2 · turn 1 of 2 · Nova')).toBeInTheDocument();
        expect(
            within(screen.getByRole('group', { name: 'Rounds' })).getByRole('button', { name: '2' })
        ).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText(/Hexa at T1, 60% HP/)).toBeInTheDocument();
    });

    it('Play runs the turns through the rounds and stops at the end', () => {
        vi.useFakeTimers();
        try {
            render(<BattlePlayback result={turnFight()} />);
            fireEvent.click(screen.getByLabelText('Play'));
            expect(screen.getByText('Round 1 · turn 1 of 2 · Nova')).toBeInTheDocument();
            act(() => void vi.advanceTimersByTime(1500));
            expect(screen.getByText('Round 1 · turn 2 of 2 · Hexa')).toBeInTheDocument();
            act(() => void vi.advanceTimersByTime(1500));
            expect(screen.getByText('Round 2 · turn 1 of 2 · Nova')).toBeInTheDocument();
            // Each turn arms the next one's timer once it has rendered.
            for (let i = 0; i < 5; i++) act(() => void vi.advanceTimersByTime(1500));
            expect(screen.getByText('Round 2 · turn 2 of 2 · Hexa')).toBeInTheDocument();
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

// ── The player ────────────────────────────────────────────────────────────────────────────────

const player = () => screen.getByRole('region', { name: 'Battle playback' });
const turnText = () => within(player()).getByText(/^Round \d+ · /).textContent;

describe('BattlePlayback speed', () => {
    it('Normal advances a turn after 1500 ms, Slow only after 2400 ms', () => {
        vi.useFakeTimers();
        try {
            const normal = render(<BattlePlayback result={turnFight()} />);
            fireEvent.click(screen.getByLabelText('Play'));
            act(() => void vi.advanceTimersByTime(1499));
            expect(turnText()).toBe('Round 1 · turn 1 of 2 · Nova');
            act(() => void vi.advanceTimersByTime(1));
            expect(turnText()).toBe('Round 1 · turn 2 of 2 · Hexa');
            normal.unmount();

            render(<BattlePlayback result={turnFight()} />);
            fireEvent.click(screen.getByRole('button', { name: 'Slow' }));
            fireEvent.click(screen.getByLabelText('Play'));
            act(() => void vi.advanceTimersByTime(1500));
            expect(turnText()).toBe('Round 1 · turn 1 of 2 · Nova');
            act(() => void vi.advanceTimersByTime(900));
            expect(turnText()).toBe('Round 1 · turn 2 of 2 · Hexa');
        } finally {
            vi.useRealTimers();
        }
    });

    it('Fast advances after 700 ms, and a speed change waits for the next turn', () => {
        vi.useFakeTimers();
        try {
            render(<BattlePlayback result={turnFight()} />);
            fireEvent.click(screen.getByRole('button', { name: 'Fast' }));
            fireEvent.click(screen.getByLabelText('Play'));
            act(() => void vi.advanceTimersByTime(700));
            expect(turnText()).toBe('Round 1 · turn 2 of 2 · Hexa');
            // The timer armed for the next turn already runs at Fast; switching now leaves it be.
            fireEvent.click(screen.getByRole('button', { name: 'Slow' }));
            act(() => void vi.advanceTimersByTime(700));
            expect(turnText()).toBe('Round 2 · turn 1 of 2 · Nova');
            act(() => void vi.advanceTimersByTime(2399));
            expect(turnText()).toBe('Round 2 · turn 1 of 2 · Nova');
            act(() => void vi.advanceTimersByTime(1));
            expect(turnText()).toBe('Round 2 · turn 2 of 2 · Hexa');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('BattlePlayback round buttons and keys', () => {
    it('a round button jumps to that round’s end and shows pressed', () => {
        render(<BattlePlayback result={turnFight()} />);
        fireEvent.click(screen.getByLabelText('Previous turn'));
        const rounds = within(screen.getByRole('group', { name: 'Rounds' }));
        fireEvent.click(rounds.getByRole('button', { name: '2' }));
        expect(turnText()).toBe('Round 2 · round end');
        expect(rounds.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'true');
        expect(rounds.getByRole('button', { name: '1' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByLabelText(/Hexa at T1, 60% HP/)).toBeInTheDocument();
    });

    it('ArrowRight and ArrowLeft step a turn from anywhere in the player', () => {
        render(<BattlePlayback result={turnFight()} />);
        const nova = screen.getByLabelText(/Nova at T1/);
        fireEvent.keyDown(nova, { key: 'ArrowRight' });
        expect(turnText()).toBe('Round 2 · turn 1 of 2 · Nova');
        fireEvent.keyDown(nova, { key: 'ArrowLeft' });
        expect(turnText()).toBe('Round 1 · turn 2 of 2 · Hexa');
    });

    it('leaves arrow keys to the speed control', () => {
        render(<BattlePlayback result={turnFight()} />);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Fast' }), { key: 'ArrowRight' });
        expect(turnText()).toBe('Round 1 · round end');
    });

    it('Space on the player toggles play, and is prevented so the page does not scroll', () => {
        render(<BattlePlayback result={turnFight()} />);
        const region = player();
        const notPrevented = fireEvent.keyDown(region, { key: ' ' });
        expect(notPrevented).toBe(false);
        expect(screen.getByLabelText('Pause')).toBeInTheDocument();
        fireEvent.keyDown(region, { key: ' ' });
        expect(screen.getByLabelText('Play')).toBeInTheDocument();
    });

    it('Space on a button is left to the button, so it acts once', () => {
        render(<BattlePlayback result={turnFight()} />);
        const play = screen.getByLabelText('Play');
        expect(fireEvent.keyDown(play, { key: ' ' })).toBe(true);
        expect(screen.getByLabelText('Play')).toBeInTheDocument();
        fireEvent.click(play);
        expect(screen.getByLabelText('Pause')).toBeInTheDocument();

        const round2 = within(screen.getByRole('group', { name: 'Rounds' })).getByRole('button', {
            name: '2',
        });
        expect(fireEvent.keyDown(round2, { key: ' ' })).toBe(true);
        expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    });

    it('ignores keys with no player to drive when controlled', () => {
        const { container } = render(<BattlePlayback result={turnFight()} round={1} />);
        expect(fireEvent.keyDown(container, { key: ' ' })).toBe(true);
    });
});

// ── Target lines, status floats and the hover card ─────────────────────────────────────────────

/** Nova hits both Hexa (main) and Brute (splash) on turn 1; Hexa buffs herself on turn 2. */
const richFight = (): BattleResult => {
    const base = turnFight();
    const hexa2 = shipState('e:enemy:1', 'enemy', 100);
    return {
        ...base,
        roster: [
            ...base.roster,
            { actorId: 'e:enemy:1', side: 'enemy', name: 'Brute', position: 'M2' },
        ],
        rounds: base.rounds.map((r, i) => ({
            ...r,
            ships: [
                ...r.ships.map((s) =>
                    s.actorId === 'attacker'
                        ? { ...s, activeBuffs: ['Attack Up II'], activeDebuffs: ['Corrosion'] }
                        : s
                ),
                hexa2,
            ],
            round: i + 1,
        })),
        combatLog: [
            {
                round: 1,
                startOfRound: [],
                endOfRound: [],
                turns: [
                    turn('attacker', [
                        {
                            kind: 'attack',
                            actorId: 'attacker',
                            targets: [
                                {
                                    targetId: 'e:enemy:0',
                                    amount: 200,
                                    resultingHpPct: 80,
                                    isPrimary: true,
                                },
                                { targetId: 'e:enemy:1', amount: 100, resultingHpPct: 90 },
                            ],
                            reactions: [],
                        },
                        {
                            kind: 'buff',
                            actorId: 'attacker',
                            targets: [{ targetId: 'attacker' }],
                            reactions: [],
                            note: 'Attack Up II',
                        },
                        {
                            kind: 'dot-applied',
                            actorId: 'e:enemy:0',
                            targets: [{ targetId: 'attacker' }],
                            reactions: [],
                            note: 'corrosion III ×1',
                        },
                    ]),
                    turn('e:enemy:0', [hit('e:enemy:0', 'attacker', 100, 90)]),
                ],
            },
            {
                round: 2,
                startOfRound: [],
                endOfRound: [],
                turns: [turn('attacker', [hit('attacker', 'e:enemy:0', 200, 60)])],
            },
        ],
    } as unknown as BattleResult;
};

describe('BattlePlayback target lines', () => {
    const turnOne = () => {
        render(<BattlePlayback result={richFight()} />);
        fireEvent.click(
            within(screen.getByRole('group', { name: 'Rounds' })).getByRole('button', { name: '1' })
        );
        fireEvent.click(screen.getByLabelText('Previous turn'));
        fireEvent.click(screen.getByLabelText('Previous turn'));
    };

    it('draws a main and a splash line from the acting ship while its turn plays', () => {
        turnOne();
        expect(turnText()).toBe('Round 1 · turn 1 of 2 · Nova');
        const paths = player().querySelectorAll('svg path[data-role]');
        expect([...paths].map((p) => p.getAttribute('data-role')).sort()).toEqual([
            'main',
            'splash',
        ]);
        const overlay = paths[0].closest('svg');
        expect(overlay).toHaveAttribute('aria-hidden', 'true');
        expect(overlay).toHaveClass('pointer-events-none');
    });

    it('draws none at a round’s end, and none when controlled', () => {
        const { container, unmount } = render(<BattlePlayback result={richFight()} />);
        expect(container.querySelector('svg path[data-role]')).toBeNull();
        unmount();
        const controlled = render(<BattlePlayback result={richFight()} round={1} />);
        expect(controlled.container.querySelector('svg path[data-role]')).toBeNull();
    });

    it('explains the two kinds of line under the boards', () => {
        render(<BattlePlayback result={richFight()} />);
        expect(screen.getByText('Main target')).toBeInTheDocument();
        expect(screen.getByText('Splash')).toBeInTheDocument();
    });
});

describe('BattlePlayback floating status text', () => {
    it('floats a buff and a damage-over-time debuff over the ship they reached', () => {
        render(<BattlePlayback result={richFight()} />);
        fireEvent.click(screen.getByLabelText('Previous turn'));
        fireEvent.click(screen.getByLabelText('Previous turn'));
        expect(screen.getByText('▲ Attack Up II')).toBeInTheDocument();
        expect(screen.getByText('▼ Corrosion')).toBeInTheDocument();
    });

    it('floats nothing under reduced motion', () => {
        motion.reduced = true;
        try {
            render(<BattlePlayback result={richFight()} />);
            fireEvent.click(screen.getByLabelText('Previous turn'));
            fireEvent.click(screen.getByLabelText('Previous turn'));
            expect(screen.queryByText('▲ Attack Up II')).not.toBeInTheDocument();
        } finally {
            motion.reduced = false;
        }
    });
});

describe('BattlePlayback hover card', () => {
    it('shows a ship’s statuses with who applied them, and hides on leave', () => {
        render(<BattlePlayback result={richFight()} />);
        const nova = screen.getByLabelText(/Nova at T1/);
        expect(screen.queryByText('Buffs · 1')).not.toBeInTheDocument();
        fireEvent.mouseEnter(nova);
        expect(screen.getByText('Buffs · 1')).toBeInTheDocument();
        expect(screen.getByText('Debuffs · 1')).toBeInTheDocument();
        const buff = screen.getByText('Attack Up II').closest('li') as HTMLElement;
        expect(within(buff).getByText('self')).toBeInTheDocument();
        const debuff = screen.getByText('Corrosion').closest('li') as HTMLElement;
        expect(within(debuff).getByText('Hexa')).toBeInTheDocument();
        expect(screen.getByText(/90% HP/)).toBeInTheDocument();
        expect(screen.queryByText('As of the last round end')).not.toBeInTheDocument();
        fireEvent.mouseLeave(nova);
        expect(screen.queryByText('Buffs · 1')).not.toBeInTheDocument();
    });

    it('opens on focus, and says its statuses are from the last round end while a turn plays', () => {
        render(<BattlePlayback result={richFight()} />);
        fireEvent.click(screen.getByLabelText('Previous turn'));
        fireEvent.click(screen.getByLabelText('Previous turn'));
        fireEvent.focus(screen.getByLabelText(/Nova at T1/));
        expect(screen.getByText('As of the last round end')).toBeInTheDocument();
    });

    it('lists a status with no known source without one, and an empty list as None', () => {
        render(<BattlePlayback result={richFight()} />);
        fireEvent.mouseEnter(screen.getByLabelText(/Hexa at T1/));
        expect(screen.getByText('Buffs · 0')).toBeInTheDocument();
        expect(screen.getAllByText('None')).toHaveLength(2);
    });
});
