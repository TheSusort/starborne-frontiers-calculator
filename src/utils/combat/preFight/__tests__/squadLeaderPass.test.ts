/**
 * Sub-project F, PR F1: squad-leader pre-fight pass — unit tests on hand-built
 * PreFightUnits (no engine involved).
 *
 * Real SQUAD_LEADERS data drives the stage-additivity / gating / math / symmetry cases.
 * The skip rules the shipped data never exercises ('other', per-round, 'self', unknown
 * stat, unmapped channel) are covered via a SYNTHETIC leader appended to the MARAUDERS
 * roster through vi.mock — the full-data sweep pulls the UNMOCKED data via
 * vi.importActual so it stays a pure real-data audit.
 */
import { describe, it, expect, vi } from 'vitest';
import { squadLeaderPass, emptyPreFightModifiers, runPreFight } from '../index';
import type { PreFightUnit } from '../index';
import type { FactionName } from '../../../../constants/factions';
import { SQUAD_LEADERS } from '../../../../constants/squadLeaders';

// Synthetic leader exercising every skip rule the real data never hits. Appended to
// MARAUDERS via vi.mock below (the factory is hoisted, so the const must be too).
const { SYNTHETIC_LEADER } = vi.hoisted(() => {
    // Type annotation only (erased at runtime, so safe inside the hoisted callback).
    const SYNTHETIC_LEADER: import('../../../../constants/squadLeaders').SquadLeader = {
        name: 'Test Synthetic',
        rarity: 'rare',
        stages: [
            [
                // condition set → unsimulated, stat untouched.
                {
                    kind: 'stat',
                    target: 'all-allies',
                    stat: 'attack',
                    value: 10,
                    valueType: 'percentage',
                    condition: { text: 'while below 50% HP' },
                    text: '+10% Attack while below 50% HP',
                },
                // kind 'other' escape hatch → unsimulated.
                { kind: 'other', target: 'all-allies', text: 'un-modelled weirdness' },
                // per-round recurrence → unsimulated, modifier NOT accumulated.
                {
                    kind: 'modifier',
                    target: 'all-allies',
                    channel: 'shieldGeneration',
                    value: 5,
                    recurrence: 'per-round',
                    text: 'Generate a shield of 5% max HP each round',
                },
                // 'self' target (squad leaders are not deployed) → unsimulated.
                {
                    kind: 'stat',
                    target: 'self',
                    stat: 'attack',
                    value: 5,
                    valueType: 'percentage',
                    text: 'Self +5% Attack',
                },
                // stat name outside PreFightStatBlock → unsimulated (defensive).
                {
                    kind: 'stat',
                    target: 'all-allies',
                    stat: 'healModifier',
                    value: 10,
                    valueType: 'percentage',
                    text: '+10% Heal Modifier',
                },
                // channel with no PreFightCombatModifiers field → unsimulated (defensive).
                {
                    kind: 'modifier',
                    target: 'all-allies',
                    channel: 'damageReduction',
                    value: 5,
                    text: '+5% Damage Reduction',
                },
                // unconditional mapped modifier → accumulates silently (simulated since F3).
                {
                    kind: 'modifier',
                    target: 'all-allies',
                    channel: 'outgoingDamage',
                    value: 7,
                    text: '+7% Outgoing direct damage',
                },
            ],
            [],
            [],
        ],
    };
    return { SYNTHETIC_LEADER };
});

vi.mock('../../../../constants/squadLeaders', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../constants/squadLeaders')>();
    return {
        ...actual,
        SQUAD_LEADERS: {
            ...actual.SQUAD_LEADERS,
            MARAUDERS: [...actual.SQUAD_LEADERS.MARAUDERS, SYNTHETIC_LEADER],
        },
    };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_STATS = {
    attack: 1000,
    crit: 50,
    critDamage: 100,
    defensePenetration: 10,
    shieldPenetration: 0,
    hacking: 200,
    security: 100,
    defence: 500,
    hp: 10000,
    speed: 120,
} as const;

const makeUnit = (
    id: string,
    side: 'player' | 'enemy',
    faction: FactionName,
    stats: Partial<PreFightUnit['stats']> = {}
): PreFightUnit => ({
    id,
    side,
    faction,
    stats: { ...BASE_STATS, ...stats },
    modifiers: emptyPreFightModifiers(),
    unsimulated: [],
});

const runPass = (
    player: PreFightUnit[],
    enemy: PreFightUnit[],
    selections: Parameters<typeof squadLeaderPass>[0]
): void => {
    runPreFight({ player, enemy }, [squadLeaderPass(selections)]);
};

describe('squadLeaderPass — lookup (trust boundary)', () => {
    it('throws on an unknown leader name', () => {
        const player = [makeUnit('p1', 'player', 'MPL')];
        const enemy = [makeUnit('e1', 'enemy', 'MPL')];
        expect(() =>
            runPass(player, enemy, { player: { faction: 'MPL', name: 'Nobody', stage: 1 } })
        ).toThrow('squadLeaderPass: unknown squad leader "Nobody" for faction "MPL"');
    });

    it('throws on an unknown faction (runtime input)', () => {
        const player = [makeUnit('p1', 'player', 'MPL')];
        const enemy = [makeUnit('e1', 'enemy', 'MPL')];
        expect(() =>
            runPass(player, enemy, {
                player: { faction: 'NOT_A_FACTION' as FactionName, name: 'Midas', stage: 1 },
            })
        ).toThrow('unknown squad leader');
    });

    it('with no selections the pass touches nothing (golden safety)', () => {
        const player = [makeUnit('p1', 'player', 'MARAUDERS')];
        const enemy = [makeUnit('e1', 'enemy', 'MPL')];
        const before = JSON.parse(JSON.stringify({ player, enemy }));
        runPass(player, enemy, {});
        expect(JSON.parse(JSON.stringify({ player, enemy }))).toEqual(before);
    });
});

describe('squadLeaderPass — stage additivity (ATLAS_SYNDICATE "Intern")', () => {
    // Intern: I = +3% attack; II = +2% attack & +2% critDamage; III = +3% critDamage.
    it('stage 1 applies only stages[0]', () => {
        const player = [makeUnit('p1', 'player', 'ATLAS_SYNDICATE')];
        runPass(player, [], {
            player: { faction: 'ATLAS_SYNDICATE', name: 'Intern', stage: 1 },
        });
        expect(player[0].stats.attack).toBeCloseTo(1000 * 1.03);
        expect(player[0].stats.critDamage).toBe(100);
    });

    it('stage 3 = stages[0] + [1] + [2], same-stat pcts summed BEFORE the single multiply', () => {
        const player = [makeUnit('p1', 'player', 'ATLAS_SYNDICATE')];
        runPass(player, [], {
            player: { faction: 'ATLAS_SYNDICATE', name: 'Intern', stage: 3 },
        });
        // attack: 3% + 2% sum to one ×1.05 (NOT sequential ×1.03×1.02 = ×1.0506).
        expect(player[0].stats.attack).toBeCloseTo(1050);
        expect(player[0].stats.attack).not.toBeCloseTo(1000 * 1.03 * 1.02, 10);
        // critDamage: 2% + 3% → ×1.05.
        expect(player[0].stats.critDamage).toBeCloseTo(105);
    });
});

describe('squadLeaderPass — faction gating & targeting', () => {
    it('all-allies lands ONLY on own-side units of the leader faction', () => {
        const player = [
            makeUnit('p1', 'player', 'ATLAS_SYNDICATE'),
            makeUnit('p2', 'player', 'MARAUDERS'),
        ];
        const enemy = [makeUnit('e1', 'enemy', 'ATLAS_SYNDICATE')];
        runPass(player, enemy, {
            player: { faction: 'ATLAS_SYNDICATE', name: 'Intern', stage: 1 },
        });
        expect(player[0].stats.attack).toBeCloseTo(1030);
        // Off-faction teammate and SAME-faction opponents untouched.
        expect(player[1].stats.attack).toBe(1000);
        expect(enemy[0].stats.attack).toBe(1000);
    });

    it('all-enemies lands on ALL opposing units when a leader-faction ship is on the own team', () => {
        // Brandisher (MARAUDERS legendary) stage III: enemies lose 15 Security (flat)
        // and 10% Defence.
        const player = [makeUnit('p1', 'player', 'MARAUDERS'), makeUnit('p2', 'player', 'MPL')];
        const enemy = [makeUnit('e1', 'enemy', 'MPL'), makeUnit('e2', 'enemy', 'XAOC')];
        runPass(player, enemy, {
            player: { faction: 'MARAUDERS', name: 'Brandisher', stage: 3 },
        });
        for (const e of enemy) {
            expect(e.stats.security).toBeCloseTo(100 - 15);
            expect(e.stats.defence).toBeCloseTo(500 * 0.9);
        }
        // Ally effects (stage I: +10% attack & +10% critDamage) hit only the Marauder.
        expect(player[0].stats.attack).toBeCloseTo(1100);
        expect(player[1].stats.attack).toBe(1000);
    });

    it('all-enemies gate: no leader-faction ship on the own team → zero enemy deltas, nothing recorded', () => {
        const player = [makeUnit('p1', 'player', 'MPL'), makeUnit('p2', 'player', 'XAOC')];
        const enemy = [makeUnit('e1', 'enemy', 'MARAUDERS')];
        const enemyBefore = JSON.parse(JSON.stringify(enemy));
        runPass(player, enemy, {
            player: { faction: 'MARAUDERS', name: 'Brandisher', stage: 3 },
        });
        expect(JSON.parse(JSON.stringify(enemy))).toEqual(enemyBefore);
        // Ally effects have no Marauder recipient either — everything is inert.
        expect(player[0].stats.attack).toBe(1000);
        expect(player.flatMap((u) => u.unsimulated)).toEqual([]);
    });
});

describe('squadLeaderPass — stat math', () => {
    it('applies base×(1+Σpct/100)+Σflat (Malachi stage 1: +10% HP and +25 flat security)', () => {
        const player = [makeUnit('p1', 'player', 'EVERLIVING')];
        runPass(player, [], {
            player: { faction: 'EVERLIVING', name: 'Malachi', stage: 1 },
        });
        expect(player[0].stats.hp).toBeCloseTo(10000 * 1.1);
        expect(player[0].stats.security).toBeCloseTo(100 + 25);
    });

    it('clamps a negative result at 0 (Swarmcaller stage 3: enemies lose 30 flat hacking)', () => {
        const player = [makeUnit('p1', 'player', 'BINDERBURG')];
        const enemy = [makeUnit('e1', 'enemy', 'MPL', { hacking: 10 })];
        runPass(player, enemy, {
            player: { faction: 'BINDERBURG', name: 'Swarmcaller', stage: 3 },
        });
        // 10 - 30 = -20 → floored at 0.
        expect(enemy[0].stats.hacking).toBe(0);
    });
});

describe('squadLeaderPass — side symmetry', () => {
    it('mirroring the selection (player ↔ enemy) yields mirrored results', () => {
        const build = () => ({
            marauder: makeUnit('m', 'player', 'MARAUDERS'),
            other: makeUnit('o', 'player', 'MPL'),
            foe: makeUnit('f', 'enemy', 'XAOC'),
        });
        const sel = { faction: 'MARAUDERS', name: 'Brandisher', stage: 3 } as const;

        // Selection on the PLAYER side.
        const a = build();
        runPass([a.marauder, a.other], [a.foe], { player: sel });

        // Same squads swapped across the board, selection on the ENEMY side.
        const b = build();
        runPass([b.foe], [b.marauder, b.other], { enemy: sel });

        expect(b.marauder.stats).toEqual(a.marauder.stats);
        expect(b.other.stats).toEqual(a.other.stats);
        expect(b.foe.stats).toEqual(a.foe.stats);
        expect(b.marauder.unsimulated).toEqual(a.marauder.unsimulated);
    });
});

describe('squadLeaderPass — dual leaders (both sides selected)', () => {
    it('a unit hit by BOTH leaders folds one Σpct (base×(1+(a+b)/100)), not sequential per-side multiplies', () => {
        // Player leader: Midas stage 1 → MPL allies +10% attack & +10% HP.
        // Enemy leader: Colonel stage 3 → all enemies (= player units) lose 15% attack
        // (its gate is met: the enemy team fields a FRONTIER_LEGION ship).
        const player = [makeUnit('p1', 'player', 'MPL')];
        const enemy = [makeUnit('e1', 'enemy', 'FRONTIER_LEGION')];
        runPass(player, enemy, {
            player: { faction: 'MPL', name: 'Midas', stage: 1 },
            enemy: { faction: 'FRONTIER_LEGION', name: 'Colonel', stage: 3 },
        });

        // attack: +10 (own leader) − 15 (opposing leader) = Σ −5 → ×0.95 exactly …
        expect(player[0].stats.attack).toBeCloseTo(1000 * 0.95);
        // … NOT ×1.10×0.85 = ×0.935 (sequential per-side application).
        expect(player[0].stats.attack).not.toBeCloseTo(1000 * 1.1 * 0.85, 5);
        // hp only sees the own leader's +10%.
        expect(player[0].stats.hp).toBeCloseTo(10000 * 1.1);
        // The Legion foe gets its own leader's ally boosts (stage I +10% + stage II
        // +7.5% attack, summed before the single multiply); Midas stage 1 has no
        // enemy-facing effects.
        expect(enemy[0].stats.attack).toBeCloseTo(1000 * 1.175);
    });
});

describe('squadLeaderPass — skip rules (synthetic leader)', () => {
    it('condition / other / per-round / self / unknown-stat / unmapped-channel → unsimulated, stats untouched', () => {
        const player = [makeUnit('p1', 'player', 'MARAUDERS'), makeUnit('p2', 'player', 'MPL')];
        runPass(player, [], {
            player: { faction: 'MARAUDERS', name: 'Test Synthetic', stage: 1 },
        });

        const [marauder, offFaction] = player;
        // No stat effect survives the skip rules → stats byte-identical to the base.
        expect(marauder.stats).toEqual({ ...BASE_STATS });
        expect(offFaction.stats).toEqual({ ...BASE_STATS });

        // Every skipped effect surfaced verbatim on the faction recipient. The unconditional
        // MAPPED modifier ('+7% Outgoing direct damage') is SIMULATED since F3 — it
        // accumulates silently and must NOT appear here.
        expect(marauder.unsimulated).toEqual([
            '+10% Attack while below 50% HP',
            'un-modelled weirdness',
            'Generate a shield of 5% max HP each round',
            'Self +5% Attack',
            '+10% Heal Modifier',
            '+5% Damage Reduction',
        ]);
        expect(offFaction.unsimulated).toEqual([]);

        // The unconditional mapped modifier accumulated (consumed by the engine since F3);
        // the per-round shieldGeneration did NOT.
        expect(marauder.modifiers.outgoingDamage).toBe(7);
        expect(marauder.modifiers.startingShieldPctOfHp).toBe(0);
        expect(offFaction.modifiers).toEqual(emptyPreFightModifiers());
    });

    it('a real conditional effect (Reaper stage 3 secondary-target damage) goes to unsimulated', () => {
        const player = [makeUnit('p1', 'player', 'MARAUDERS')];
        runPass(player, [], {
            player: { faction: 'MARAUDERS', name: 'Reaper', stage: 3 },
        });
        expect(player[0].unsimulated).toContain('+20% direct damage to secondary targets');
        // The conditional modifier must NOT have been folded into the channel.
        expect(player[0].modifiers.outgoingDamage).toBe(0);
    });

    it('an unconditional modifier (Malachi stage 2 outgoing repair) accumulates WITHOUT reporting unsimulated (simulated since F3)', () => {
        const player = [makeUnit('p1', 'player', 'EVERLIVING')];
        runPass(player, [], {
            player: { faction: 'EVERLIVING', name: 'Malachi', stage: 2 },
        });
        expect(player[0].modifiers.outgoingHeal).toBe(15);
        expect(player[0].unsimulated).not.toContain('+15% Outgoing repair');
    });
});

describe('squadLeaderPass — full-data sweep (real, unmocked SQUAD_LEADERS)', () => {
    it('every leader × stage 3 applies without throwing and every effect classifies', async () => {
        // Pull the REAL data (the module-level mock appended a synthetic leader).
        const { SQUAD_LEADERS: REAL } = await vi.importActual<
            typeof import('../../../../constants/squadLeaders')
        >('../../../../constants/squadLeaders');

        for (const [faction, leaders] of Object.entries(REAL)) {
            for (const leader of leaders) {
                // One leader-faction ship + one off-faction ship on the own team, two foes.
                const offFaction: FactionName = faction === 'MPL' ? 'XAOC' : 'MPL';
                const player = [
                    makeUnit('p1', 'player', faction),
                    makeUnit('p2', 'player', offFaction),
                ];
                const enemy = [
                    makeUnit('e1', 'enemy', offFaction),
                    makeUnit('e2', 'enemy', offFaction),
                ];
                runPass(player, enemy, {
                    player: { faction, name: leader.name, stage: 3 },
                });

                const surfaced = new Set([...player, ...enemy].flatMap((u) => u.unsimulated));
                for (const effect of leader.stages.flat()) {
                    const skipped =
                        effect.condition !== undefined ||
                        effect.kind === 'other' ||
                        effect.recurrence === 'per-round' ||
                        effect.target === 'self';
                    if (skipped) {
                        // Skipped effects must surface verbatim.
                        expect(surfaced, `${faction}/${leader.name}: "${effect.text}"`).toContain(
                            effect.text
                        );
                    } else {
                        // Everything else is SIMULATED (F3): stat effects fold into the
                        // pre-fight block, unconditional modifier effects accumulate into
                        // consumed channels — proving every real data stat name AND every
                        // real modifier channel is mapped (the defensive unknown-stat /
                        // unmapped-channel paths are covered by the synthetic leader above).
                        expect(
                            surfaced,
                            `${faction}/${leader.name}: "${effect.text}" should be simulated`
                        ).not.toContain(effect.text);
                    }
                }

                // All resulting stats stay finite and non-negative.
                for (const unit of [...player, ...enemy]) {
                    for (const value of Object.values(unit.stats)) {
                        expect(Number.isFinite(value)).toBe(true);
                        expect(value).toBeGreaterThanOrEqual(0);
                    }
                }
            }
        }
    });
});

describe('SQUAD_LEADERS data invariant — enemy-facing effects', () => {
    it('every all-enemies effect belongs to a LEGENDARY leader and sits in stage III', async () => {
        // Game rule (user-confirmed 2026-07-02): only legendary STAGE-3 effects may
        // target the opposing team. Pins the data against future entry drift. Uses the
        // REAL data (the module-level mock appended a synthetic leader).
        const { SQUAD_LEADERS: REAL } = await vi.importActual<
            typeof import('../../../../constants/squadLeaders')
        >('../../../../constants/squadLeaders');

        for (const [faction, leaders] of Object.entries(REAL)) {
            for (const leader of leaders) {
                leader.stages.forEach((stage, stageIdx) => {
                    for (const effect of stage) {
                        if (effect.target !== 'all-enemies') continue;
                        const label = `${faction}/${leader.name} stage ${stageIdx + 1}: "${effect.text}"`;
                        expect(leader.rarity, label).toBe('legendary');
                        expect(stageIdx, label).toBe(2);
                    }
                });
            }
        }
    });
});

// Sanity: the mock actually appended the synthetic leader (guards the skip-rule suite
// against a silently broken mock path).
describe('test harness', () => {
    it('mocked MARAUDERS roster contains the synthetic leader', () => {
        expect(SQUAD_LEADERS.MARAUDERS.some((l) => l.name === 'Test Synthetic')).toBe(true);
    });
});
