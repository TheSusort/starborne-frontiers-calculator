import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// C2b-3 Task 3: an ENEMY "Nayra"-like caster's on-cast purge is GATED on whether
// its target was REPAIRED (HP-healed) this round (subject
// 'target-repaired-this-round'). The engine populates a per-round repaired set
// inside applyHealToTarget and threads it into the round context; the on-cast
// purge fire only triggers when conditionsMet([...], ctx) holds.
//
// Positional two-team battle-sim harness (mirrors purgeCastPath.test.ts — the
// player focus IS the healTargetId, positioned + parsed-targeted so the enemy
// resolves it as targetId). Turn order by speed desc within a round:
//   FastEnemy(300)  → hits the focus for real, non-lethal damage (creates the HP
//                     deficit so the focus's self-heal consumes > 0).
//   Focus(200)      → self-heals (deficit → consumed > 0 → focus flagged repaired)
//                     and applies a removable "Attack Up" self-buff.
//   Nayra(100)      → sees targetRepairedThisRound(focus) = true → its on-cast
//                     purge fires → strips the focus's "Attack Up".
//
// Two runs:
//   1. Repaired:     FastEnemy present + focus self-heal present → Attack Up GONE.
//   2. Not repaired: focus self-heal removed → focus never repaired → Nayra's
//                    gate is false → purge does NOT fire → Attack Up REMAINS.
//
// Observed off the focus's self-buff store via
// statusEngine.timedAbilityStatuses('self', focusId) read through the
// __testTapStatusEngine tap (= the same store purgeCastPath.test.ts reads).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `nr${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const FOCUS_ID = 'attacker';

describe('C2b-3 Task 3: Nayra purge gated on target-repaired-this-round', () => {
    // The focus's removable self-buff applied on its active each round.
    const attackUp = (): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    // A self-heal: 10% of the focus's own max HP. With an HP deficit from FastEnemy,
    // consumed > 0 → the focus is flagged repaired this round.
    const selfHeal = (): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            config: { type: 'heal', pct: 10, basis: 'target-hp' },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // The player focus skill: applies Attack Up to itself, optionally self-heals,
    // and fires a basic hit (so its turn resolves normally).
    const focusSkills = (heal: boolean): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: heal ? [attackUp(), selfHeal(), hit()] : [attackUp(), hit()],
            },
        ],
    });

    // FastEnemy (speed 300, acts FIRST): a plain attacker that hits the focus for real,
    // non-lethal damage to create the HP deficit. NO purge.
    const fastEnemy = () => ({
        id: 'fast-enemy',
        stats: { attack: 5000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 300 },
        chargeCount: 0,
        startCharged: false,
        position: 'M1' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active' as const, abilities: [hit()] }] },
    });

    // Nayra-like enemy (speed 100, acts LAST): an on-cast purge GATED on
    // target-repaired-this-round, plus a basic hit so targetId resolves to the focus.
    const nayra = () => ({
        id: 'nayra',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 100 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'purge',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [
                                { subject: 'target-repaired-this-round', derivable: true },
                            ],
                            config: { type: 'purge', count: 'all' },
                        }),
                        hit(),
                    ],
                },
            ],
        },
    });

    const BASE = (heal: boolean): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(heal),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 3,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        // Focus is the heal target. Large HP + non-lethal hits → survives all rounds with
        // a deficit each round for the self-heal to consume.
        hp: 1_000_000,
        healTargetId: FOCUS_ID,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        // heal run: FastEnemy creates the deficit. not-repaired run: omit it AND the heal so
        // there is definitively no repair (belt-and-suspenders: removing the heal already
        // guarantees no repair regardless of incoming damage).
        enemyAttackers: heal ? [fastEnemy(), nayra()] : [nayra()],
    });

    const finalFocusSelfBuffs = (heal: boolean): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(heal),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return engine!.timedAbilityStatuses('self', FOCUS_ID).map((b) => b.active.buffName);
    };

    it('REPAIRED (focus self-heals after taking damage): Nayra purge fires → Attack Up removed', () => {
        expect(finalFocusSelfBuffs(true)).toEqual([]);
    });

    it('NOT REPAIRED (focus never self-heals): Nayra gate false → purge inert → Attack Up remains', () => {
        expect(finalFocusSelfBuffs(false)).toEqual(['Attack Up']);
    });
});
