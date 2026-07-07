import { describe, it, expect } from 'vitest';
import { createActor, type ActiveDoTStack } from '../state';
import { tickDoTs } from '../engine';

describe('generic DoT', () => {
    it('createActor seeds an empty genericDoTEntries array', () => {
        const a = createActor({
            id: 'v',
            side: 'player',
            kind: 'team',
            stats: {
                attack: 100, crit: 0, critDamage: 50, defensePenetration: 0,
                shieldPenetration: 0, defence: 100, hp: 10000, speed: 100,
            },
        });
        expect(a.genericDoTEntries).toEqual([]);
    });

    it('a generic DoT stack carries an absolute perTickAmount', () => {
        const stack = { stacks: 1, tier: 0, remainingRounds: 3, sourceId: 'v', perTickAmount: 300 };
        expect(stack.perTickAmount).toBe(300);
    });

    it('a generic DoT ticks perTickAmount and expires after remainingRounds', () => {
        // Isolated unit test of tickDoTs (exported for this purpose): a generic entry credits
        // an ABSOLUTE perTickAmount × stacks, independent of stats/HP (no ctxFor lookup needed —
        // ctxFor always returns undefined here, proving corrosion/inferno's applier-ctx gate does
        // not gate the generic branch), and decrements remainingRounds by 1 per tick.
        const gen: ActiveDoTStack[] = [
            { stacks: 1, tier: 0, remainingRounds: 3, sourceId: 'v', perTickAmount: 300 },
        ];
        let credited = 0;
        let tickedDamage: number | undefined;
        tickDoTs({
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: gen,
            enemyHp: 1_000_000,
            ctxFor: () => undefined,
            emitTicked: (dotType, damage) => {
                if (dotType === 'generic') tickedDamage = damage;
            },
            credit: (_sourceId, dotType, damage) => {
                if (dotType === 'generic') credited += damage;
            },
        });

        expect(credited).toBe(300);
        expect(tickedDamage).toBe(300);
        expect(gen[0].remainingRounds).toBe(2);

        // Two more ticks exhaust remainingRounds → the entry expires (array empties).
        tickDoTs({
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: gen,
            enemyHp: 1_000_000,
            ctxFor: () => undefined,
            emitTicked: () => {},
            credit: (_sourceId, dotType, damage) => {
                if (dotType === 'generic') credited += damage;
            },
        });
        tickDoTs({
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: gen,
            enemyHp: 1_000_000,
            ctxFor: () => undefined,
            emitTicked: () => {},
            credit: (_sourceId, dotType, damage) => {
                if (dotType === 'generic') credited += damage;
            },
        });

        expect(credited).toBe(900);
        expect(gen).toEqual([]);
    });

    it('a generic DoT tick respects incomingDotReductionPct', () => {
        const gen: ActiveDoTStack[] = [
            { stacks: 2, tier: 0, remainingRounds: 1, sourceId: 'v', perTickAmount: 100 },
        ];
        let credited = 0;
        tickDoTs({
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: gen,
            enemyHp: 1_000_000,
            ctxFor: () => undefined,
            emitTicked: () => {},
            credit: (_sourceId, dotType, damage) => {
                if (dotType === 'generic') credited += damage;
            },
            incomingDotReductionPct: (dotType) => (dotType === 'generic' ? 50 : 0),
        });

        // 100 * 2 stacks = 200 raw, halved by the 50% reduction → 100.
        expect(credited).toBe(100);
    });
});
