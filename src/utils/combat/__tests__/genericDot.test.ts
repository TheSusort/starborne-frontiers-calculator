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
                attack: 100,
                crit: 0,
                critDamage: 50,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 100,
                hp: 10000,
                speed: 100,
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
        let tickedStacks: number | undefined;
        tickDoTs({
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: gen,
            enemyHp: 1_000_000,
            ctxFor: () => undefined,
            emitTicked: (dotType, damage, stacks) => {
                if (dotType === 'generic') {
                    tickedDamage = damage;
                    tickedStacks = stacks;
                }
            },
            credit: (_sourceId, dotType, damage) => {
                if (dotType === 'generic') credited += damage;
            },
        });

        expect(credited).toBe(300);
        expect(tickedDamage).toBe(300);
        // The emitted stacks is the summed TICKING stacks for this DoT type (here: one entry, 1 stack).
        expect(tickedStacks).toBe(1);
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

    // SP-E, Task E2: `family`/`unremovable` are consumed by the Cheat-Death wipe filter
    // (engine.ts) and the `dotFamilyCounts` family-count derivation (roundContext.ts) — see
    // enemyDotFamilyCounts.test.ts / enemyDotFamilyCounts.integration.test.ts for those. This
    // locks the plain field shape on a generic entry itself, matching the parallel corrosion/
    // inferno coverage.
    it('a generic DoT stack can carry family + unremovable (Acidic Decay shape)', () => {
        const stack: ActiveDoTStack = {
            stacks: 1,
            tier: 0,
            remainingRounds: 3,
            sourceId: 'v',
            perTickAmount: 300,
            family: 'Acidic Decay',
            unremovable: true,
        };
        expect(stack.family).toBe('Acidic Decay');
        expect(stack.unremovable).toBe(true);
    });

    // Combat-log fidelity: `emitTicked`'s 3rd arg is the per-dotType SUMMED TICKING stacks
    // (only entries that actually tick — i.e. have a resolvable applier ctx — are counted).
    it('emitTicked receives the summed ticking stacks for corrosion, excluding entries with no ctx', () => {
        const corrosion: ActiveDoTStack[] = [
            { stacks: 2, tier: 10, remainingRounds: 2, sourceId: 'applier-a' },
            { stacks: 1, tier: 10, remainingRounds: 2, sourceId: 'applier-b' },
            // No ctx for this applier (faster-enemy round 1) — its 5 stacks must NOT be counted.
            { stacks: 5, tier: 10, remainingRounds: 2, sourceId: 'no-ctx-applier' },
        ];
        const ctx = {
            effectiveAttack: 100,
            dotMult: 1,
            affinityMult: 1,
            effectiveDefence: 0,
            effectiveMaxHp: 0,
            outgoingHealPct: 0,
            incomingHealPct: 0,
        };
        let tickedStacks: number | undefined;
        tickDoTs({
            corrosionEntries: corrosion,
            infernoEntries: [],
            genericDoTEntries: [],
            enemyHp: 100_000,
            ctxFor: (sourceId) => (sourceId === 'no-ctx-applier' ? undefined : ctx),
            emitTicked: (dotType, _damage, stacks) => {
                if (dotType === 'corrosion') tickedStacks = stacks;
            },
            credit: () => {},
        });

        // 2 (applier-a) + 1 (applier-b) = 3; the no-ctx entry's 5 stacks are excluded.
        expect(tickedStacks).toBe(3);
    });

    // Combat-log fidelity: distinct tiers of the SAME dotType must NOT be summed into one tick
    // line — tickDoTs emits one `emitTicked(dotType, damage, stacks, tier)` per (dotType, tier)
    // group so the log can show "corrosion I ×n" and "corrosion III ×m" separately. Same-tier
    // entries still coalesce, and the total credited damage is unchanged.
    it('emits one tick per (dotType, tier) group; same-tier entries coalesce', () => {
        const ctx = {
            effectiveAttack: 100,
            dotMult: 1,
            affinityMult: 1,
            effectiveDefence: 0,
            effectiveMaxHp: 0,
            outgoingHealPct: 0,
            incomingHealPct: 0,
        };
        const corrosion: ActiveDoTStack[] = [
            { stacks: 1, tier: 3, remainingRounds: 2, sourceId: 'a' }, // Corrosion I
            { stacks: 2, tier: 9, remainingRounds: 2, sourceId: 'a' }, // Corrosion III
            { stacks: 1, tier: 3, remainingRounds: 2, sourceId: 'b' }, // another Corrosion I → coalesces
        ];
        const ticks: Array<{ dotType: string; damage: number; stacks: number; tier: number }> = [];
        let credited = 0;
        tickDoTs({
            corrosionEntries: corrosion,
            infernoEntries: [],
            genericDoTEntries: [],
            enemyHp: 1_000, // corrosionBaseHp = 1000 → tier/100 * 1000 = 10 * tier% per stack
            ctxFor: () => ctx,
            emitTicked: (dotType, damage, stacks, tier) => {
                ticks.push({ dotType, damage, stacks, tier });
            },
            credit: (_s, dotType, damage) => {
                if (dotType === 'corrosion') credited += damage;
            },
        });

        const corrosionTicks = ticks.filter((t) => t.dotType === 'corrosion');
        // Two groups: tier 3 (I) and tier 9 (III) — NOT one summed line.
        expect(corrosionTicks).toHaveLength(2);
        const t1 = corrosionTicks.find((t) => t.tier === 3);
        const t3 = corrosionTicks.find((t) => t.tier === 9);
        // tier 3: two stacks total (a:1 + b:1), damage = 2 * 0.03 * 1000 = 60.
        expect(t1).toMatchObject({ stacks: 2, damage: 60 });
        // tier 9: two stacks (a:2), damage = 2 * 0.09 * 1000 = 180.
        expect(t3).toMatchObject({ stacks: 2, damage: 180 });
        // Total credited is unchanged by the split.
        expect(credited).toBe(240);
    });
});
