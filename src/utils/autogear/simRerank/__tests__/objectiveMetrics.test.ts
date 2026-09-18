import { describe, it, expect } from 'vitest';
import { objectiveSeries, survived } from '../objectiveMetrics';
import type { BattleResult } from '../../../calculators/battleSimulator';

const round = (
    ships: Array<
        Partial<{
            actorId: string;
            side: string;
            damageDealt: number;
            damageTaken: number;
            healingDone: number;
            shieldGranted: number;
            alive: boolean;
            activeDebuffs: string[];
        }>
    >
) => ({
    ships: ships.map((s) => ({
        actorId: 'attacker',
        side: 'player',
        damageDealt: 0,
        damageTaken: 0,
        healingDone: 0,
        shieldGranted: 0,
        alive: true,
        activeDebuffs: [],
        activeBuffs: [],
        ...s,
    })),
});

const result = (rounds: ReturnType<typeof round>[]) => ({ rounds }) as unknown as BattleResult;

describe('objectiveSeries', () => {
    it('sums focus damage across rounds, because round fields are rates not cumulatives', () => {
        const r = result([
            round([{ actorId: 'attacker', damageDealt: 100 }]),
            round([{ actorId: 'attacker', damageDealt: 150 }]),
        ]);
        expect(objectiveSeries(r, 'attacker', 'focusDamageDealt')).toBe(250);
    });

    it('reports damage taken as a SHARE of the player side, not a raw total', () => {
        const r = result([
            round([
                { actorId: 'attacker', damageTaken: 300 },
                { actorId: 'p:ally:1', damageTaken: 100 },
                { actorId: 'e:foe:0', side: 'enemy', damageTaken: 9999 },
            ]),
        ]);
        // 300 / (300 + 100). The enemy's 9999 must not enter the denominator, and the bare
        // 'attacker' id must count as a player — a `p:` prefix test drops index 0 entirely.
        expect(objectiveSeries(r, 'attacker', 'focusDamageTakenShare')).toBeCloseTo(0.75);
    });

    it('reports 0, not NaN, when the player side takes no damage at all', () => {
        const r = result([
            round([
                { actorId: 'attacker', damageTaken: 0 },
                { actorId: 'e:foe:0', side: 'enemy', damageTaken: 500 },
            ]),
        ]);
        expect(objectiveSeries(r, 'attacker', 'focusDamageTakenShare')).toBe(0);
    });

    it('adds shields granted to repairs, because shielding IS support output', () => {
        const r = result([round([{ actorId: 'attacker', healingDone: 500, shieldGranted: 200 }])]);
        expect(objectiveSeries(r, 'attacker', 'focusSupportOutput')).toBe(700);
    });

    it('measures enemy debuff uptime as a fraction of enemy-rounds, not all actor-rows', () => {
        const r = result([
            round([
                { actorId: 'e:a:0', side: 'enemy', activeDebuffs: ['Burn'] },
                { actorId: 'e:b:1', side: 'enemy', activeDebuffs: [] },
                { actorId: 'attacker', activeDebuffs: ['Slow'] },
            ]),
            round([
                { actorId: 'e:a:0', side: 'enemy', activeDebuffs: ['Burn'] },
                { actorId: 'e:b:1', side: 'enemy', activeDebuffs: ['Slow'] },
                { actorId: 'attacker', activeDebuffs: ['Slow'] },
            ]),
        ]);
        // 3 debuffed enemy-rounds out of 4 enemy-rounds. The player row carries a debuff in
        // both rounds, so a denominator or numerator that folds player rows in would report
        // 3/6 or 5/4 instead — this fails under either mistake.
        expect(objectiveSeries(r, 'attacker', 'enemyDebuffUptime')).toBeCloseTo(0.75);
    });

    it('does not count PLAYER debuffs as enemy uptime', () => {
        const r = result([
            round([
                { actorId: 'attacker', activeDebuffs: ['Burn', 'Slow'] },
                { actorId: 'e:a:0', side: 'enemy', activeDebuffs: [] },
            ]),
        ]);
        expect(objectiveSeries(r, 'attacker', 'enemyDebuffUptime')).toBe(0);
    });

    it('reports 0, not NaN, when the fight recorded no enemy-rounds', () => {
        const r = result([round([{ actorId: 'attacker', activeDebuffs: ['Burn'] }])]);
        expect(objectiveSeries(r, 'attacker', 'enemyDebuffUptime')).toBe(0);
    });
});

describe('survived', () => {
    it('reads the FINAL round, not any round', () => {
        const r = result([
            round([{ actorId: 'attacker', alive: true }]),
            round([{ actorId: 'attacker', alive: false }]),
        ]);
        expect(survived(r, 'attacker')).toBe(false);
    });

    it('returns false when the focus actor has no rounds recorded at all', () => {
        const r = result([]);
        expect(survived(r, 'attacker')).toBe(false);
    });
});
