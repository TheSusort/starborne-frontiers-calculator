/**
 * Sub-attack boundary hooks (multi-hit full-walk epic, PR8 Task 2).
 *
 * These two seams are what lets PR8 apply a debuff landing INSIDE the hit loop, so sub-attack k's
 * stack is in the store when sub-attack k+1 reads `defenseProfileOf`. This file pins the contract
 * only — no debuff logic reaches here.
 */
import { describe, it, expect } from 'vitest';
import { applyPositionalDamage } from '../positionalApply';
import type { CombatActor } from '../state';
import type { ParsedPattern, ParsedTarget } from '../../targetingParser';

const actor = (id: string, position: string, hp = 1_000_000): CombatActor =>
    ({
        id,
        position,
        currentHp: hp,
        shieldPool: 0,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        affinity: 'antimatter',
    }) as unknown as CombatActor;

const pattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const target = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });

const run = (args: {
    hits: number;
    opposing: CombatActor[];
    onSubAttackStart?: Parameters<typeof applyPositionalDamage>[0]['onSubAttackStart'];
    onSubAttackEnd?: Parameters<typeof applyPositionalDamage>[0]['onSubAttackEnd'];
    applyToVictim?: Parameters<typeof applyPositionalDamage>[0]['applyToVictim'];
}) =>
    applyPositionalDamage({
        hitCrits: Array.from({ length: args.hits }, () => false),
        scalars: { hits: args.hits } as unknown as Parameters<
            typeof applyPositionalDamage
        >[0]['scalars'],
        pattern: pattern(),
        actorPosition: 'M1',
        target: target(),
        opposingLiving: args.opposing,
        statusOf: () => ({}) as never,
        acting: {},
        defenseProfileOf: (v) => ({
            defence: 0,
            defenceModifierPct: 0,
            incomingDamageModifierPct: 0,
            affinity: v.affinity ?? 'antimatter',
        }),
        applyToVictim:
            args.applyToVictim ??
            (() => ({ hpDamage: 0, shieldBefore: 0, incomingBooked: 0 }) as never),
        onSubAttackStart: args.onSubAttackStart,
        onSubAttackEnd: args.onSubAttackEnd,
    });

describe('applyPositionalDamage sub-attack boundary hooks', () => {
    it('calls start then end once per sub-attack, in ascending index order', () => {
        const calls: string[] = [];
        run({
            hits: 3,
            opposing: [actor('v1', 'M4')],
            onSubAttackStart: (s) => calls.push(`start:${s.index}`),
            onSubAttackEnd: (s) => calls.push(`end:${s.index}`),
        });
        expect(calls).toEqual(['start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2']);
    });

    it('reports the sub-attack’s own anchor and footprint', () => {
        const seen: { index: number; anchorId: string; victimIds: string[] }[] = [];
        run({
            hits: 2,
            opposing: [actor('v1', 'M4'), actor('v2', 'M3')],
            onSubAttackEnd: (s) => seen.push({ ...s, victimIds: [...s.victimIds] }),
        });
        expect(seen).toHaveLength(2);
        for (const s of seen) {
            expect(s.anchorId).toBe('v1');
            expect(s.victimIds).toContain('v1');
        }
    });

    it('start fires BEFORE that sub-attack’s damage and end AFTER all of it', () => {
        const calls: string[] = [];
        run({
            hits: 2,
            opposing: [actor('v1', 'M4')],
            onSubAttackStart: (s) => calls.push(`start:${s.index}`),
            onSubAttackEnd: (s) => calls.push(`end:${s.index}`),
            applyToVictim: ((v: CombatActor) => {
                calls.push(`hit:${v.id}`);
                return { hpDamage: 0, shieldBefore: 0, incomingBooked: 0 };
            }) as never,
        });
        expect(calls).toEqual(['start:0', 'hit:v1', 'end:0', 'start:1', 'hit:v1', 'end:1']);
    });

    it('a WHIFF calls neither hook but still consumes its index', () => {
        const calls: string[] = [];
        const out = run({
            hits: 2,
            opposing: [],
            onSubAttackStart: (s) => calls.push(`start:${s.index}`),
            onSubAttackEnd: (s) => calls.push(`end:${s.index}`),
        });
        expect(calls).toEqual([]);
        expect(out.subAttacks.map((s) => s.whiffed)).toEqual([true, true]);
    });

    it('omitting both hooks changes nothing (they are optional)', () => {
        const out = run({ hits: 2, opposing: [actor('v1', 'M4')] });
        expect(out.subAttacks).toHaveLength(2);
    });
});
