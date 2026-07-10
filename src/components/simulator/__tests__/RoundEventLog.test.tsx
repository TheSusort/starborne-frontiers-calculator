import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundEventLog from '../RoundEventLog';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatLogRound } from '../../../utils/combat/log/types';

const roster: BattleResult['roster'] = [
    { actorId: 'nova', side: 'player', name: 'Nova', position: 'T1' },
    { actorId: 'graphite', side: 'player', name: 'Graphite', position: 'T2' },
    { actorId: 'hexa', side: 'enemy', name: 'Hexa', position: 'T3' },
    { actorId: 'selenite', side: 'enemy', name: 'Selenite', position: 'T4' },
];

// A representative round: a charged AoE attack (crit + resulting HP on one victim, a miss on
// another) that triggers a reaction, a buff entry with a note, and an end-of-round DoT tick.
const round: CombatLogRound = {
    round: 3,
    startOfRound: [],
    turns: [
        {
            actorId: 'nova',
            chargeBefore: 2,
            chargeMax: 3,
            entries: [
                {
                    kind: 'attack',
                    actorId: 'nova',
                    skillName: 'Nova Burst',
                    slot: 'charged',
                    targets: [
                        {
                            targetId: 'hexa',
                            amount: 4321,
                            didCrit: true,
                            didHit: true,
                            resultingHpPct: 55,
                        },
                        { targetId: 'selenite', didHit: false },
                    ],
                    reactions: [
                        {
                            kind: 'attack',
                            actorId: 'hexa',
                            targets: [
                                {
                                    targetId: 'nova',
                                    amount: 1200,
                                    didHit: true,
                                    resultingHpPct: 88,
                                },
                            ],
                            reactions: [],
                            note: undefined,
                        },
                    ],
                },
                {
                    kind: 'buff',
                    actorId: 'graphite',
                    targets: [],
                    reactions: [],
                    note: 'Attack Up',
                },
            ],
        },
    ],
    endOfRound: [
        {
            kind: 'dot-ticked',
            actorId: 'selenite',
            targets: [{ targetId: 'selenite', amount: 300 }],
            reactions: [],
            note: undefined,
        },
    ],
};

describe('RoundEventLog', () => {
    it('renders the turn header with a charge annotation', () => {
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/Nova's turn · charge 2\/3/)).toBeInTheDocument();
    });

    it('shows the attack header with the charged slot tag and skill name', () => {
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/Nova Burst/)).toBeInTheDocument();
        expect(screen.getByText(/\[charged\]/)).toBeInTheDocument();
    });

    it('breaks out every AoE victim with amounts, crit, HP%, and miss', () => {
        render(<RoundEventLog round={round} roster={roster} />);
        // Hit victim: amount + crit + resulting HP.
        expect(screen.getByText(/Enemy Hexa: 4,321 \(crit\) → 55%/)).toBeInTheDocument();
        // Missed victim.
        expect(screen.getByText(/Enemy Selenite: miss/)).toBeInTheDocument();
    });

    it('renders the nested reaction line with the reactor name (no duplicate name)', () => {
        render(<RoundEventLog round={round} roster={roster} />);
        // The `↳ reacts:` marker omits the actor name; the reactor's name comes from the
        // formatted reaction body only (so it appears exactly once on the line).
        expect(screen.getByText(/↳ reacts:/)).toBeInTheDocument();
        expect(screen.getByText(/Enemy Hexa → Nova: 1,200 → 88%/)).toBeInTheDocument();
    });

    it('renders an effect entry using its note', () => {
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/Graphite: Attack Up/)).toBeInTheDocument();
    });

    it('renders the end-of-round group with its drained entries', () => {
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/— end of round —/)).toBeInTheDocument();
        expect(screen.getByText(/Enemy Selenite: 300 \(DoT\)/)).toBeInTheDocument();
    });

    it('renders DoT tick damage with its amount', () => {
        const round = {
            round: 1,
            startOfRound: [],
            turns: [
                {
                    actorId: 'A',
                    chargeBefore: 0,
                    chargeMax: 0,
                    entries: [
                        {
                            kind: 'dot-ticked' as const,
                            actorId: 'A',
                            targets: [{ targetId: 'A', amount: 1234 }],
                            reactions: [],
                        },
                    ],
                },
            ],
            endOfRound: [],
        };
        const roster: BattleResult['roster'] = [
            { actorId: 'A', side: 'player', name: 'Anemone', position: 'T1' },
        ];
        render(<RoundEventLog round={round} roster={roster} />);
        expect(screen.getByText(/1,234/)).toBeInTheDocument();
    });

    it('renders the actor name for a target-less entry that still carries a nested reaction', () => {
        // Rare case: a resisted-debuff-only cast has no targets recorded on the entry itself,
        // but its reaction (e.g. Ravager's counter) still nests underneath it. The bullet must
        // show the acting ship, not render blank.
        const round: CombatLogRound = {
            round: 1,
            startOfRound: [],
            turns: [
                {
                    actorId: 'ravager',
                    chargeBefore: 0,
                    chargeMax: 0,
                    entries: [
                        {
                            kind: 'attack',
                            actorId: 'ravager',
                            skillName: 'Ravage',
                            targets: [],
                            reactions: [
                                {
                                    kind: 'attack',
                                    actorId: 'hexa',
                                    targets: [
                                        {
                                            targetId: 'ravager',
                                            amount: 500,
                                            didHit: true,
                                            resultingHpPct: 90,
                                        },
                                    ],
                                    reactions: [],
                                    note: undefined,
                                },
                            ],
                        },
                    ],
                },
            ],
            endOfRound: [],
        };
        const roster: BattleResult['roster'] = [
            { actorId: 'ravager', side: 'enemy', name: 'Ravager', position: 'T1' },
            { actorId: 'hexa', side: 'enemy', name: 'Hexa', position: 'T2' },
        ];
        render(<RoundEventLog round={round} roster={roster} />);
        // The target-less entry still shows the actor + skill name (not blank).
        expect(screen.getByText(/Enemy Ravager Ravage/)).toBeInTheDocument();
        // The nested reaction still renders underneath it.
        expect(screen.getByText(/↳ reacts:/)).toBeInTheDocument();
        expect(screen.getByText(/Enemy Hexa → Enemy Ravager: 500 → 90%/)).toBeInTheDocument();
    });

    it('shows a fallback message when the round has no content', () => {
        const empty: CombatLogRound = { round: 1, startOfRound: [], turns: [], endOfRound: [] };
        render(<RoundEventLog round={empty} roster={roster} />);
        expect(screen.getByText('No events this round.')).toBeInTheDocument();
    });

    it('shows a collapsed stats summary under a turn and expands to the full block', async () => {
        const round: CombatLogRound = {
            round: 1,
            startOfRound: [],
            endOfRound: [],
            turns: [
                {
                    actorId: 'A',
                    chargeBefore: 0,
                    chargeMax: 0,
                    entries: [],
                    statsSnapshot: {
                        attack: 5000,
                        defence: 3000,
                        crit: 70,
                        critDamage: 150,
                        defensePenetration: 0,
                        speed: 120,
                        hacking: 200,
                        security: 100,
                        currentHp: 40000,
                        maxHp: 50000,
                        shieldPool: 0,
                    },
                },
            ],
        };
        render(
            <RoundEventLog
                round={round}
                roster={[{ actorId: 'A', side: 'player', name: 'A', position: 'T1' }]}
            />
        );
        // Collapsed summary shows HP.
        expect(screen.getByText(/40,000\s*\/\s*50,000/)).toBeInTheDocument();
        // Expanding reveals a detail stat (attack) not shown in the collapsed line.
        await userEvent.click(screen.getByRole('button', { name: /stats/i }));
        expect(screen.getByText(/5,000/)).toBeInTheDocument();
    });
});
