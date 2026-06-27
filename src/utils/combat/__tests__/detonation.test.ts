import { describe, it, expect } from 'vitest';
import {
    detonateContainers,
    type DetonationRecipe,
    type DetonationContainers,
} from '../detonation';
import type { ActiveDoTStack, PendingBomb } from '../state';

// Crit-free, exact-integer assertions. These pin the EXACT detonation math lifted from
// playerTurn.ts detonate(): bomb uses per-bomb snapshots only (NO dotMult/affinityMult/
// detonationMult); inferno scales on effectiveAttack; corrosion clamps baseHp at 500k.

const bomb = (over: Partial<PendingBomb> = {}): PendingBomb => ({
    countdown: 1,
    damagePerStack: 100,
    stacks: 1,
    tier: 100,
    sourceId: 's',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
    ...over,
});

const dot = (over: Partial<ActiveDoTStack> = {}): ActiveDoTStack => ({
    stacks: 1,
    tier: 100,
    remainingRounds: 1,
    sourceId: 's',
    ...over,
});

const emptyContainers = (over: Partial<DetonationContainers> = {}): DetonationContainers => ({
    corrosionEntries: [],
    infernoEntries: [],
    pendingBombs: [],
    victimHp: 1000,
    ...over,
});

const baseRecipe = (over: Partial<DetonationRecipe> = {}): DetonationRecipe => ({
    dets: [],
    effectiveAttack: 1000,
    dotMult: 1,
    affinityMult: 1,
    detonationMult: 1,
    ...over,
});

describe('detonateContainers', () => {
    it('returns all-zero when no dets', () => {
        const c = emptyContainers({ pendingBombs: [bomb()] });
        const res = detonateContainers(baseRecipe(), c);
        expect(res).toEqual({ bomb: 0, inferno: 0, corrosion: 0, bombStacks: 0, total: 0 });
        // Containers untouched when no dets requested.
        expect(c.pendingBombs.length).toBe(1);
    });

    it('returns zero for empty containers (bomb det, no bombs)', () => {
        const c = emptyContainers();
        const res = detonateContainers(
            baseRecipe({ dets: [{ dotType: 'bomb', powerPct: 100 }] }),
            c
        );
        expect(res).toEqual({ bomb: 0, inferno: 0, corrosion: 0, bombStacks: 0, total: 0 });
    });

    it('computes bomb payout from per-bomb snapshots only (no dotMult/affinity/detonationMult)', () => {
        // Two bombs: (2 stacks * 50 dps * 2 affinity * (1+50/100)) + (3 * 100 * 1 * 1) = 300 + 300 = 600
        // powerPct 100 → *1. Recipe dotMult/affinityMult/detonationMult are 5/7/9 — MUST be ignored.
        const c = emptyContainers({
            pendingBombs: [
                bomb({
                    stacks: 2,
                    damagePerStack: 50,
                    affinityMult: 2,
                    detonationDamageModifier: 50,
                }),
                bomb({
                    stacks: 3,
                    damagePerStack: 100,
                    affinityMult: 1,
                    detonationDamageModifier: 0,
                }),
            ],
        });
        const res = detonateContainers(
            baseRecipe({
                dets: [{ dotType: 'bomb', powerPct: 100 }],
                dotMult: 5,
                affinityMult: 7,
                detonationMult: 9,
            }),
            c
        );
        expect(res.bomb).toBe(600);
        expect(res.bombStacks).toBe(5);
        expect(res.total).toBe(600);
        expect(c.pendingBombs.length).toBe(0);
    });

    it('applies powerPct to bomb payout', () => {
        const c = emptyContainers({ pendingBombs: [bomb({ stacks: 4, damagePerStack: 100 })] });
        const res = detonateContainers(
            baseRecipe({ dets: [{ dotType: 'bomb', powerPct: 50 }] }),
            c
        );
        // 4 * 100 * 1 * 1 = 400, *0.5 = 200
        expect(res.bomb).toBe(200);
        expect(res.bombStacks).toBe(4);
    });

    it('computes inferno payout scaling on effectiveAttack (with dotMult/affinity/detonationMult)', () => {
        // sum: 2 stacks * (50/100) * 1000 attack * 3 rounds = 3000; *dotMult2 *affinity3 *pct1 *det2 = 36000
        const c = emptyContainers({
            infernoEntries: [dot({ stacks: 2, tier: 50, remainingRounds: 3 })],
        });
        const res = detonateContainers(
            baseRecipe({
                dets: [{ dotType: 'inferno', powerPct: 100 }],
                effectiveAttack: 1000,
                dotMult: 2,
                affinityMult: 3,
                detonationMult: 2,
            }),
            c
        );
        expect(res.inferno).toBe(36000);
        expect(res.total).toBe(36000);
        expect(c.infernoEntries.length).toBe(0);
    });

    it('computes corrosion payout clamped at 500k when victimHp below clamp', () => {
        // baseHp = min(400000, 500000) = 400000. 1 stack * (100/100) * 400000 * 1 round = 400000; mults 1 → 400000
        const c = emptyContainers({
            corrosionEntries: [dot({ stacks: 1, tier: 100, remainingRounds: 1 })],
            victimHp: 400_000,
        });
        const res = detonateContainers(
            baseRecipe({ dets: [{ dotType: 'corrosion', powerPct: 100 }] }),
            c
        );
        expect(res.corrosion).toBe(400_000);
        expect(c.corrosionEntries.length).toBe(0);
    });

    it('clamps corrosion baseHp at 500k when victimHp above clamp', () => {
        // baseHp = min(900000, 500000) = 500000.
        const c = emptyContainers({
            corrosionEntries: [dot({ stacks: 1, tier: 100, remainingRounds: 1 })],
            victimHp: 900_000,
        });
        const res = detonateContainers(
            baseRecipe({ dets: [{ dotType: 'corrosion', powerPct: 100 }] }),
            c
        );
        expect(res.corrosion).toBe(500_000);
    });

    it('processes dets in order, consuming containers (2nd bomb det sees empty)', () => {
        const c = emptyContainers({ pendingBombs: [bomb({ stacks: 3, damagePerStack: 100 })] });
        const res = detonateContainers(
            baseRecipe({
                dets: [
                    { dotType: 'bomb', powerPct: 100 },
                    { dotType: 'bomb', powerPct: 100 },
                ],
            }),
            c
        );
        // first det pays 300, second sees emptied bombs → 0
        expect(res.bomb).toBe(300);
        expect(res.bombStacks).toBe(3);
        expect(c.pendingBombs.length).toBe(0);
    });

    it('sums total across all three types (bomb + inferno + corrosion)', () => {
        const c = emptyContainers({
            pendingBombs: [bomb({ stacks: 1, damagePerStack: 100 })], // 100
            infernoEntries: [dot({ stacks: 1, tier: 100, remainingRounds: 1 })], // 1*1*1000*1 = 1000
            corrosionEntries: [dot({ stacks: 1, tier: 100, remainingRounds: 1 })], // 1*1*1000*1 = 1000
            victimHp: 1000,
        });
        const res = detonateContainers(
            baseRecipe({
                dets: [
                    { dotType: 'bomb', powerPct: 100 },
                    { dotType: 'inferno', powerPct: 100 },
                    { dotType: 'corrosion', powerPct: 100 },
                ],
                effectiveAttack: 1000,
            }),
            c
        );
        expect(res.bomb).toBe(100);
        expect(res.inferno).toBe(1000);
        expect(res.corrosion).toBe(1000);
        expect(res.total).toBe(2100);
    });
});
