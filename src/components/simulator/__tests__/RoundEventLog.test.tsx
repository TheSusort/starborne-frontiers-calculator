import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
            targets: [],
            reactions: [],
            note: 'corrosion ×3',
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
        expect(screen.getByText(/Enemy Selenite: corrosion ×3/)).toBeInTheDocument();
    });

    it('shows a fallback message when the round has no content', () => {
        const empty: CombatLogRound = { round: 1, startOfRound: [], turns: [], endOfRound: [] };
        render(<RoundEventLog round={empty} roster={roster} />);
        expect(screen.getByText('No events this round.')).toBeInTheDocument();
    });
});
