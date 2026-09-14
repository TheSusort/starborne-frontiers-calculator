import { describe, it, expect, vi } from 'vitest';
import { stepInput, runStatSweepAsync } from '../statSweep';
import type { BattleSimulationInput, BattlePlacement } from '../../calculators/battleSimulator';
import type { Position } from '../../../types/encounters';
import type { Ship } from '../../../types/ship';

const placement = (id: string, position: Position): BattlePlacement => ({
    ship: { id, name: id } as unknown as Ship,
    position,
    statOverrides: { attack: 100, speed: 100, hp: 1000 },
});

const input = (): BattleSimulationInput => ({
    playerTeam: [placement('p1', 'T1'), placement('p2', 'M2')],
    enemyTeam: [placement('e1', 'T1')],
});

/** A placement the engine can actually fight with: a ship with no skill text resolves to zero
 *  abilities, so every fight is a 0-damage draw regardless of `statOverrides`. */
const combatant = (
    id: string,
    position: Position,
    stats: BattlePlacement['statOverrides']
): BattlePlacement => ({
    ship: {
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: {},
        equipment: {},
        refits: [],
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as unknown as Ship,
    position,
    statOverrides: stats,
});

const combatStats = (attack: number, speed: number) => ({
    attack,
    crit: 50,
    critDamage: 150,
    hacking: 200,
    security: 100,
    defence: 500,
    hp: 20000,
    speed,
});

/** A lopsided fight so outcomes are non-degenerate (someone dies) while staying cheap. */
const battleInput = (): BattleSimulationInput => ({
    playerTeam: [
        combatant('striker', 'T1', combatStats(4000, 120)),
        combatant('wing', 'M2', combatStats(3000, 110)),
    ],
    enemyTeam: [combatant('dummy', 'T1', combatStats(800, 100))],
});

describe('stepInput', () => {
    it('changes only the targeted stat on the targeted placement', () => {
        const base = input();
        const stepped = stepInput(base, { side: 'player', position: 'M2' }, 'speed', 175);
        const target = stepped.playerTeam.find((p) => p.position === 'M2')!;
        expect(target.statOverrides).toEqual({ attack: 100, speed: 175, hp: 1000 });
    });

    it('leaves every other placement as the same object', () => {
        // A mutation probe: if the implementation deep-clones everything, this assertion still
        // has to hold, because "untouched" here means object identity, not deep equality.
        const base = input();
        const stepped = stepInput(base, { side: 'player', position: 'M2' }, 'speed', 175);
        expect(stepped.playerTeam.find((p) => p.position === 'T1')).toBe(base.playerTeam[0]);
        expect(stepped.enemyTeam[0]).toBe(base.enemyTeam[0]);
    });

    it('does not mutate the input it was given', () => {
        const base = input();
        stepInput(base, { side: 'player', position: 'M2' }, 'speed', 175);
        expect(base.playerTeam[1].statOverrides?.speed).toBe(100);
    });

    it('sets a value equal to the resolved base rather than dropping it', () => {
        // normalizeOverride returns undefined when value === base; a sweep must not do that, or
        // the reference step disappears.
        const base = input();
        const stepped = stepInput(base, { side: 'player', position: 'T1' }, 'speed', 100);
        expect(stepped.playerTeam[0].statOverrides?.speed).toBe(100);
    });

    it('targets the enemy side when asked', () => {
        const base = input();
        const stepped = stepInput(base, { side: 'enemy', position: 'T1' }, 'attack', 500);
        expect(stepped.enemyTeam[0].statOverrides?.attack).toBe(500);
        expect(stepped.playerTeam[0]).toBe(base.playerTeam[0]);
    });

    it('throws when the target position holds no placement', () => {
        expect(() => stepInput(input(), { side: 'player', position: 'B4' }, 'speed', 1)).toThrow();
    });
});

describe('runStatSweepAsync', () => {
    const steps = [
        { value: 100, isReference: true },
        { value: 150, isReference: false },
    ];
    const target = { side: 'player', position: 'T1' } as const;

    it('runs every step on the same seed set', async () => {
        const result = await runStatSweepAsync(battleInput(), target, 'speed', steps, 999, 3);
        expect(result).not.toBeNull();
        expect(result!.steps).toHaveLength(2);
        for (const step of result!.steps) {
            expect(step.aggregate.baseSeed).toBe(999);
            expect(step.aggregate.count).toBe(3);
            expect(step.aggregate.runs.map((r) => r.seed)).toEqual([999, 1000, 1001]);
        }
    });

    it('reports progress in battles and reaches the total exactly once', async () => {
        const onProgress = vi.fn();
        await runStatSweepAsync(battleInput(), target, 'speed', steps, 1, 3, { onProgress });
        const totals = onProgress.mock.calls.filter(([done, total]) => done === total);
        expect(totals).toHaveLength(1);
        expect(onProgress.mock.calls.at(-1)).toEqual([6, 6]);
    });

    it('resolves null on abort and never a partial sweep', async () => {
        const controller = new AbortController();
        const promise = runStatSweepAsync(battleInput(), target, 'speed', steps, 1, 5, {
            signal: controller.signal,
            onProgress: () => controller.abort(),
        });
        await expect(promise).resolves.toBeNull();
    });

    it('never reports 100% on a cancelled sweep', async () => {
        const controller = new AbortController();
        const onProgress = vi.fn((done: number, total: number) => {
            if (done >= 1) controller.abort();
            void total;
        });
        await runStatSweepAsync(battleInput(), target, 'speed', steps, 1, 5, {
            signal: controller.signal,
            onProgress,
        });
        expect(onProgress.mock.calls.some(([done, total]) => done === total)).toBe(false);
    });
});
