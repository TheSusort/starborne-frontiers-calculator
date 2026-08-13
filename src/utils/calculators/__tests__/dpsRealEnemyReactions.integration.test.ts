import { describe, it, expect, beforeEach } from 'vitest';
import { dealtBy } from '../../combat/__testutils__/perTargetDealt';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';
import type { CombatEvent } from '../../combat/events';

const plainDamageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

const input = (): DPSSimulationInput => ({
    attack: 20000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 10000,
    enemyHp: 500000,
    rounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 300000,
    position: DEFAULT_ATTACKER_SLOT,
    shipSkills: plainDamageKit(),
});

const enemy = (overrides: Partial<{ attack: number; speed: number; hp: number }> = {}) => [
    {
        id: 'enemy-1',
        stats: {
            attack: overrides.attack ?? 8000,
            crit: 0,
            critDamage: 150,
            speed: overrides.speed ?? 40,
            defence: 1000,
            hp: overrides.hp ?? 400000,
        },
        chargeCount: 0,
        startCharged: false,
        position: DEFAULT_ENEMY_SLOT,
    },
];

const collect = (events: CombatEvent[]) => ({
    on: () => {},
    emit: (e: CombatEvent) => void events.push(e),
});

describe('a real DPS enemy acts', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('attacks the focus, emitting `attacked` events against it', () => {
        const events: CombatEvent[] = [];
        simulateDPS({ ...input(), enemyAttackers: enemy(), bus: collect(events) });

        const hitsOnFocus = events.filter(
            (e) => e.type === 'attacked' && e.targetId === 'attacker'
        );
        expect(hitsOnFocus.length).toBeGreaterThan(0);
    });

    it('fires an on-attacked rider that could never fire against a dummy', () => {
        // THE payoff assertion for this sub-project. Nothing ever hits the focus in the scalar
        // DPS path, so an on-attacked rider is structurally dead there — its damage contribution
        // was silently understated for every reaction-built kit.
        const events: CombatEvent[] = [];
        simulateDPS({
            ...input(),
            shipSkills: {
                slots: [
                    ...plainDamageKit().slots,
                    {
                        slot: 'passive',
                        abilities: [
                            {
                                id: 'p1',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-attacked',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up III',
                                    parsedEffects: { attack: 30 },
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 2,
                                },
                            },
                        ],
                    },
                ],
            },
            enemyAttackers: enemy(),
            bus: collect(events),
        });

        const granted = events.filter((e) => e.type === 'buff-applied' && e.actorId === 'attacker');
        expect(granted.length).toBeGreaterThan(0);
    });

    it('kills a low-HP enemy and reports roundsToKill', () => {
        const result = simulateDPS({
            ...input(),
            rounds: 10,
            enemyAttackers: enemy({ attack: 1, speed: 1, hp: 1000 }),
        });

        expect(result.summary.roundsToKill).toBeGreaterThan(0);
        expect(result.summary.survived).toBe(false);
        // The run terminates on the kill round rather than padding out the window.
        expect(result.rounds.length).toBeLessThan(10);
    });

    it('reports the SURVIVING real enemy HP%, not the dummy', () => {
        const result = simulateDPS({
            ...input(),
            rounds: 2,
            enemyAttackers: enemy({ hp: 5_000_000 }),
        });

        // The dummy has billions of HP and would read ~100%. A real enemy taking real damage must
        // read below 100 while still alive.
        expect(result.summary.survived).toBe(true);
        expect(result.summary.finalHpPct).toBeLessThan(100);
        expect(result.summary.finalHpPct).toBeGreaterThan(0);
    });

    it('ends the run when the focus attacker dies', () => {
        const result = simulateDPS({
            ...input(),
            hp: 100,
            rounds: 10,
            enemyAttackers: enemy({ attack: 500000, speed: 9999, hp: 10_000_000 }),
        });

        expect(result.rounds.length).toBeLessThan(10);
    });

    it('still reports the round the focus died in, so team damage is not dropped', () => {
        // CodeRabbit #317: breaking BEFORE row assembly discarded that round's per-round maps, so a
        // team actor that acted earlier in the same round (faster than the enemy, which was faster
        // than the dying attacker) lost its damage from the totals — even though it had already
        // reduced the enemy's real HP. The row is now pushed via a synthesized skip turn.
        const teamStats = {
            attack: 30000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            hacking: 200,
            security: 100,
            defence: 0,
            hp: 100000,
            healModifier: 0,
            speed: 20000, // acts before the enemy, which outspeeds the doomed focus
        };

        const result = simulateDPS({
            ...input(),
            hp: 1,
            rounds: 10,
            teamActors: [
                {
                    id: 'team-1',
                    speed: teamStats.speed,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    shipSkills: plainDamageKit(),
                    stats: teamStats,
                    position: 'M3',
                },
            ],
            enemyAttackers: enemy({ attack: 500000, speed: 9999, hp: 10_000_000 }),
        });

        // The death round is reported rather than discarded...
        expect(result.rounds.length).toBeGreaterThan(0);
        // ...and the team's damage from it is credited.
        //
        // SP-4b-1: the credit moved channel. The boundary places every actor and synthesizes the
        // missing `target`/`pattern`, so the team actor's cast resolves positionally onto the real,
        // placed enemy and books through `applyVictimDamage` → `creditDealt`
        // (`RoundData.perTargetDealt`). `RoundData.teamDamage` sums the `roundDamage` scalar map,
        // which only the legacy dummy-sink route wrote — exactly the asymmetry engine.ts already
        // documents for the positional sim ("reactives route through applyVictimDamage + the
        // per-victim maps ... NOT roundDamage"). So the non-focus channel to read here is the
        // per-victim one, and the scalar is pinned empty because the two are mutually exclusive per
        // cast: `dealt > 0` alone would still pass if a later change credited both.
        expect(dealtBy(result.rounds, 'team-1')).toBeGreaterThan(0);
        const teamTotal = result.rounds.reduce((sum, r) => sum + (r.teamDamage ?? 0), 0);
        expect(teamTotal).toBe(0);
    });
});
