import { describe, it, expect, vi } from 'vitest';
import { duelOutcome, runDuel } from '../runDuel';
import type { Ship } from '../../../../types/ship';
import type { BattleResult } from '../../../../utils/calculators/battleSimulator';
import type { CombatStatsDeps } from '../../../../utils/ship/combatStats';

const deps: CombatStatsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const fighter = (id: string, attack: number, hp: number, skill = true): Ship =>
    ({
        id,
        name: id,
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        type: 'ATTACKER',
        baseStats: {
            hp,
            attack,
            defence: 1000,
            hacking: 0,
            security: 0,
            crit: 0,
            critDamage: 0,
            speed: 100,
            healModifier: 0,
            hpRegen: 0,
            shield: 0,
            damageReduction: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: skill
            ? 'This Unit deals <unit-damage>100% damage</unit-damage>.'
            : undefined,
        activeTarget: skill ? 'front' : undefined,
        activePattern: skill ? 'Pattern-Base' : undefined,
    }) as unknown as Ship;

/** Hand-built result: only the fields `duelOutcome` reads. */
const result = (
    winner: 'player' | 'enemy',
    rounds: { player: [number, boolean]; enemy: [number, boolean] }[]
): BattleResult =>
    ({
        outcome: { winner, lastRound: rounds.length },
        rounds: rounds.map((r, i) => ({
            round: i + 1,
            ships: [
                { actorId: 'p', side: 'player', hpPct: r.player[0], alive: r.player[1] },
                { actorId: 'e', side: 'enemy', hpPct: r.enemy[0], alive: r.enemy[1] },
            ],
        })),
    }) as unknown as BattleResult;

describe('duelOutcome', () => {
    it('follows the simulator winner when a side was wiped', () => {
        const r = result('player', [
            { player: [80, true], enemy: [40, true] },
            { player: [60, true], enemy: [0, false] },
        ]);
        expect(duelOutcome(r)).toEqual({
            outcome: 'win',
            timeline: [
                { round: 0, playerHpPct: 100, enemyHpPct: 100 },
                { round: 1, playerHpPct: 80, enemyHpPct: 40 },
                { round: 2, playerHpPct: 60, enemyHpPct: 0 },
            ],
        });
        expect(
            duelOutcome(result('enemy', [{ player: [0, false], enemy: [5, true] }])).outcome
        ).toBe('lose');
    });

    it('at the round cap, the side with more HP wins even though the simulator says enemy', () => {
        expect(
            duelOutcome(result('enemy', [{ player: [70, true], enemy: [30, true] }])).outcome
        ).toBe('win');
        expect(
            duelOutcome(result('enemy', [{ player: [30, true], enemy: [70, true] }])).outcome
        ).toBe('lose');
    });

    it('at the round cap, the player wins a tie', () => {
        expect(
            duelOutcome(result('enemy', [{ player: [50, true], enemy: [50, true] }])).outcome
        ).toBe('win');
    });
});

describe('runDuel', () => {
    it('runs a real 1v1 and produces a winner and a timeline', () => {
        const strong = fighter('strong', 6000, 20000);
        const weak = fighter('weak', 500, 8000);
        const r = runDuel(strong, weak, deps, 123);
        expect(r.outcome).toBe('win');
        expect(r.timeline.length).toBeGreaterThan(1);
        expect(r.timeline.at(-1)!.enemyHpPct).toBe(0);
        expect(r.timeline.at(-1)!.playerHpPct).toBeGreaterThan(0);
        const back = runDuel(weak, strong, deps, 123);
        expect(back.outcome).toBe('lose');
        expect(back.timeline.at(-1)!.playerHpPct).toBe(0);
    });

    it('a fight nobody can win reaches the cap and the tie goes to the player', () => {
        const r = runDuel(fighter('a', 0, 1000, false), fighter('b', 0, 1000, false), deps, 1);
        expect(r.outcome).toBe('win');
    });

    it('a thrown error skips the duel and leaves a warning in development', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let called = false;
        const broken: CombatStatsDeps = {
            getGearPiece: () => {
                called = true;
                throw new Error('boom');
            },
            getEngineeringStatsForShipType: () => undefined,
        };
        const geared = { ...fighter('g', 1000, 1000), equipment: { weapon: 'x' } } as Ship;
        expect(runDuel(geared, fighter('b', 1000, 1000), broken, 1)).toEqual({
            outcome: 'skipped',
            timeline: [],
        });
        expect(called).toBe(true);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('duel skipped'),
            expect.objectContaining({ message: 'boom' })
        );
        warn.mockRestore();
    });
});
