import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundEventLog from '../RoundEventLog';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatLogRound, CombatLogTarget } from '../../../utils/combat/log/types';

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
            note: 'inferno ×2',
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
        expect(screen.getByText(/Enemy Selenite: inferno ×2 → 300/)).toBeInTheDocument();
    });

    it('renders DoT tick type, stack count, and amount', () => {
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
                            note: 'corrosion ×3',
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
        expect(screen.getByText(/Anemone: corrosion ×3 → 1,234/)).toBeInTheDocument();
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

    // Helper: a single-turn round carrying one entry, for the per-kind formatter tests below.
    const oneEntryRound = (
        entry: CombatLogRound['turns'][number]['entries'][number]
    ): CombatLogRound => ({
        round: 1,
        startOfRound: [],
        endOfRound: [],
        turns: [
            { actorId: entry.actorId ?? 'nova', chargeBefore: 0, chargeMax: 0, entries: [entry] },
        ],
    });

    // #362 R11. The row is booked to the debuff's APPLIER (the actor the burn's damage and kill are
    // credited to), with the burned ship as its target — so it must read source → victim, not as a
    // self-line on the victim.
    it('reversed-repair: names the applier, the burned ship and the amount', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'reversed-repair',
                    actorId: 'hexa',
                    targets: [{ targetId: 'nova', amount: 4321 }],
                    reactions: [],
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Enemy Hexa → Nova: repairs reversed 4,321/)).toBeInTheDocument();
    });

    // A hand-picked (scheduled) Reversed Repairs has no applier, so the entry books to the victim
    // itself. It must still render a real line rather than a source → target line naming the same
    // ship twice.
    //
    // #362 fix-wave-2 (I-2): the entry carries `healerId`, because PRODUCTION always does — the
    // repair's source is a required parameter at every `applyHealToTarget` call site and
    // `buildCombatLog` copies it independently of `applierId`, so "no applier" never implies "no
    // healer". This test previously omitted it and asserted `Nova: repairs reversed 900`, a string
    // production cannot emit: the self-line and the healer clause are on different axes and both
    // apply at once here.
    it('reversed-repair: collapses to a self-line when there is no applier', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'reversed-repair',
                    actorId: 'nova',
                    targets: [{ targetId: 'nova', amount: 900 }],
                    reactions: [],
                    healerId: 'graphite',
                })}
                roster={roster}
            />
        );
        // ONE ship named as the line's subject (no "Nova → Nova"), and the healer named inside
        // the label — the real applier-less shape.
        expect(screen.getByText(/Nova: Graphite's repair reversed 900/)).toBeInTheDocument();
        expect(screen.queryByText(/Nova → Nova/)).not.toBeInTheDocument();
    });

    // #362 fix-wave-1: `healerId` names the reversed repair's caster inside the label — DISPLAY
    // ONLY. `actorId` (the applier, Hexa) stays the source of the source → victim line; `healerId`
    // (Graphite) never becomes the entry's actor.
    it('reversed-repair, healer present: names the healer inside the label', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'reversed-repair',
                    actorId: 'hexa',
                    targets: [{ targetId: 'nova', amount: 4321 }],
                    reactions: [],
                    healerId: 'graphite',
                })}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Enemy Hexa → Nova: Graphite's repair reversed 4,321/)
        ).toBeInTheDocument();
    });

    // Absent `healerId` is a FORMATTER-LEVEL fallback that production no longer reaches (#362
    // fix-wave-2, I-2): `engine.ts` sets the field on every reversal row it emits, from a
    // parameter that is required at every call site. The branch is kept — the field is optional on
    // the shared `CombatLogEntry` and a stored/replayed pre-fix-wave-1 log would still hit it —
    // and this test pins what it renders. It is a DEFENSIVE-BRANCH test, not a claim that the
    // shape is reachable; do not cite it as evidence that production can omit the healer.
    it('reversed-repair, healer absent: falls back to the plain label', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'reversed-repair',
                    actorId: 'hexa',
                    targets: [{ targetId: 'nova', amount: 4321 }],
                    reactions: [],
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Enemy Hexa → Nova: repairs reversed 4,321/)).toBeInTheDocument();
        expect(screen.queryByText(/Graphite's repair/)).not.toBeInTheDocument();
    });

    it('death: resolves the killer id to a ship name', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'death',
                    actorId: 'graphite',
                    targets: [{ targetId: 'hexa' }],
                    reactions: [],
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Graphite: destroyed by Enemy Hexa/)).toBeInTheDocument();
    });

    it('death: renders plain "destroyed" when there is no killer', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'death',
                    actorId: 'graphite',
                    targets: [],
                    reactions: [],
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Graphite: destroyed$/)).toBeInTheDocument();
    });

    it('debuff: shows attacker → target when the debuff lands on another ship', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'debuff',
                    actorId: 'selenite',
                    targets: [{ targetId: 'nova' }],
                    reactions: [],
                    note: 'Concentrate Fire',
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Enemy Selenite → Nova: Concentrate Fire/)).toBeInTheDocument();
    });

    it('dot-applied: shows attacker → target with the tiered note', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'dot-applied',
                    actorId: 'nova',
                    targets: [{ targetId: 'hexa' }],
                    reactions: [],
                    note: 'corrosion III ×2',
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Nova → Enemy Hexa: corrosion III ×2/)).toBeInTheDocument();
    });

    it('debuff: collapses to just the actor when the target is itself (self-debuff)', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'debuff',
                    actorId: 'nova',
                    targets: [{ targetId: 'nova' }],
                    reactions: [],
                    note: 'Overload',
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/^Nova: Overload$/)).toBeInTheDocument();
    });

    it('buff: shows granter → recipient when the buff lands on an ally', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'buff',
                    actorId: 'nova',
                    targets: [{ targetId: 'graphite' }],
                    reactions: [],
                    note: 'Hacking Up II',
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/Nova → Graphite: Hacking Up II/)).toBeInTheDocument();
    });

    it('buff: collapses to just the actor when the target is itself (self-buff)', () => {
        render(
            <RoundEventLog
                round={oneEntryRound({
                    kind: 'buff',
                    actorId: 'nova',
                    targets: [{ targetId: 'nova' }],
                    reactions: [],
                    note: 'Attack Up',
                })}
                roster={roster}
            />
        );
        expect(screen.getByText(/^Nova: Attack Up$/)).toBeInTheDocument();
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
    // ─── Wasted-portion annotation (the #418 follow-up) ───────────────────────
    //
    // The row shows what LANDED and names what did not. A fully-saturated shield used to render as
    // a bare `0` with nothing to explain it, and an over-repair used to render as a full-size heal
    // with nothing to say the HP bar had not moved — opposite failures of the same missing clause.

    const wasteRound = (target: CombatLogTarget, kind: 'heal' | 'shield'): CombatLogRound => ({
        round: 1,
        startOfRound: [],
        turns: [
            {
                actorId: 'nova',
                chargeBefore: 0,
                chargeMax: 0,
                entries: [{ kind, actorId: 'nova', targets: [target], reactions: [] }],
            },
        ],
        endOfRound: [],
    });

    it('annotates a fully-clipped shield grant with the reason and the clipped amount', () => {
        render(
            <RoundEventLog
                round={wasteRound({ targetId: 'graphite', amount: 0, overshield: 8400 }, 'shield')}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova shields → Graphite: 0 \(pool full, 8,400 clipped\)/)
        ).toBeInTheDocument();
    });

    it('annotates a partly-clipped shield grant without the reason clause', () => {
        render(
            <RoundEventLog
                round={wasteRound(
                    { targetId: 'graphite', amount: 2100, overshield: 3900 },
                    'shield'
                )}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova shields → Graphite: 2,100 \(3,900 clipped\)/)
        ).toBeInTheDocument();
    });

    it('annotates a fully-wasted repair with the reason and the overhealed amount', () => {
        render(
            <RoundEventLog
                round={wasteRound({ targetId: 'graphite', amount: 0, overheal: 5200 }, 'heal')}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova heals → Graphite: 0 \(full HP, 5,200 overhealed\)/)
        ).toBeInTheDocument();
    });

    it('annotates a partly-wasted repair without the reason clause', () => {
        render(
            <RoundEventLog
                round={wasteRound({ targetId: 'graphite', amount: 1400, overheal: 800 }, 'heal')}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova heals → Graphite: 1,400 \(800 overhealed\)/)
        ).toBeInTheDocument();
    });

    // CodeRabbit on #456: `fmt` rounds, so the reason clause has to be gated on the DISPLAYED
    // number. A repair that lands a fractional 0.3 HP renders as "0" while `amount === 0` is
    // false — which reproduced the exact bare, unexplained `0` the clause exists to remove.
    // Reachable: heal and shield amounts are `basis × pct/100 × modifiers`, i.e. fractional.

    it('gates the repair reason clause on the DISPLAYED amount, not the raw one', () => {
        render(
            <RoundEventLog
                round={wasteRound({ targetId: 'graphite', amount: 0.3, overheal: 5200 }, 'heal')}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova heals → Graphite: 0 \(full HP, 5,200 overhealed\)/)
        ).toBeInTheDocument();
    });

    it('gates the shield reason clause on the DISPLAYED amount too', () => {
        render(
            <RoundEventLog
                round={wasteRound(
                    { targetId: 'graphite', amount: 0.4, overshield: 8400 },
                    'shield'
                )}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova shields → Graphite: 0 \(pool full, 8,400 clipped\)/)
        ).toBeInTheDocument();
    });

    it('keeps the reason clause OFF once the displayed amount rounds to something', () => {
        // 0.6 rounds to 1 — something landed, so the row is self-explanatory without a reason.
        render(
            <RoundEventLog
                round={wasteRound({ targetId: 'graphite', amount: 0.6, overheal: 5200 }, 'heal')}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova heals → Graphite: 1 \(5,200 overhealed\)/)
        ).toBeInTheDocument();
    });

    it('folds crit and waste into ONE parenthetical, in that order', () => {
        render(
            <RoundEventLog
                round={wasteRound(
                    { targetId: 'graphite', amount: 1400, overheal: 800, didCrit: true },
                    'heal'
                )}
                roster={roster}
            />
        );
        expect(
            screen.getByText(/Nova heals → Graphite: 1,400 \(crit, 800 overhealed\)/)
        ).toBeInTheDocument();
    });

    it('leaves a waste-free row exactly as it renders today (crit alone keeps its own parens)', () => {
        render(
            <RoundEventLog
                round={wasteRound({ targetId: 'graphite', amount: 1400, didCrit: true }, 'heal')}
                roster={roster}
            />
        );
        expect(screen.getByText(/Nova heals → Graphite: 1,400 \(crit\)/)).toBeInTheDocument();
    });
});
