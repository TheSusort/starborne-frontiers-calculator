import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// E5 Task 2: the SIDES-SWAPPED consequence of symmetric healing
// (nayraRepairedPurge.test.ts is the MIRROR — there the player focus is repaired
// and an enemy Nayra purges it). Here the PLAYER focus IS the Nayra: its on-cast
// purge is GATED on whether its struck target was REPAIRED (HP-healed) this round
// (subject 'target-repaired-this-round'). The repaired target is an ENEMY ally.
//
// Before E5, enemy heals never restored HP, so an enemy could never enter the
// engine's per-round repaired set → a player Nayra attacking an enemy never saw
// targetRepairedThisRound === true. Task 1 made enemy heals symmetric. This test
// proves the consequence: a player Nayra now purges a *repaired enemy*.
//
// Positional two-team battle-sim harness. Turn order by speed desc within a round:
//   EnemyAlly(200)   → self-heals (consumes any HP deficit → flagged repaired) and
//                      applies a removable "Attack Up" self-buff.
//   Nayra-focus(100) → hits the enemy ally (creating/refreshing the deficit) AND
//                      fires its on-cast purge gated on target-repaired-this-round.
//
// The deficit→heal→purge sequence completes across rounds:
//   Round 1: enemy ally self-heals at full HP (consumes 0 → NOT repaired this
//            round) → focus purge gate false. Then the focus hits the enemy ally,
//            opening a deficit.
//   Round 2: enemy ally self-heals consuming the round-1 deficit (> 0 → REPAIRED
//            this round). Then the focus acts → targetRepairedThisRound(enemyAlly)
//            = true → its on-cast purge fires → strips "Attack Up".
//
// Two runs (non-vacuous contrast):
//   1. Repaired:     enemy-ally self-heal present → it enters repairedThisRound →
//                    Attack Up GONE.
//   2. Not repaired: enemy-ally self-heal removed → never repaired → the player
//                    Nayra's gate is false → purge does NOT fire → Attack Up REMAINS.
//
// Observed off the ENEMY ALLY's self-buff store via
// statusEngine.timedAbilityStatuses('self', ENEMY_ALLY_ID) read through the
// __testTapStatusEngine tap (the same store nayraRepairedPurge.test.ts reads for
// the focus, keyed here by the enemy ally's id).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ner${++idc}`,
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
const ENEMY_ALLY_ID = 'enemy-ally';

describe('E5 Task 2: player-Nayra purge gated on target-repaired-this-round vs a repaired enemy', () => {
    // The enemy ally's removable self-buff, applied on its active each round.
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

    // A self-heal: 10% of the enemy ally's own max HP. With an HP deficit from the
    // focus's prior-round hit, consumed > 0 → the enemy ally is flagged repaired.
    const selfHeal = (): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            config: { type: 'heal', pct: 10, basis: 'target-hp' },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // The enemy ally (speed 200, acts FIRST): applies Attack Up to itself, optionally
    // self-heals, and fires a basic hit so its turn resolves normally. NO purge.
    const enemyAlly = (heal: boolean) => ({
        id: ENEMY_ALLY_ID,
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position: 'M1' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: heal ? [attackUp(), selfHeal(), hit()] : [attackUp(), hit()],
                },
            ],
        },
    });

    // The player focus IS the Nayra (speed 100, acts LAST): an on-cast purge GATED
    // on target-repaired-this-round, plus a basic hit so targetId resolves to the
    // enemy ally and (in the prior round) dents it to open the deficit.
    const nayraFocusSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'purge',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [{ subject: 'target-repaired-this-round', derivable: true }],
                        config: { type: 'purge', count: 'all' },
                    }),
                    hit(),
                ],
            },
        ],
    });

    const BASE = (heal: boolean): CombatEngineInput => ({
        // Modest attack: a non-lethal dent each round, leaving a deficit for the
        // enemy ally's self-heal to consume without out-healing it to full.
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: nayraFocusSkills(),
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
        // The player focus is the Nayra. It is also the (formal) heal target — required
        // because enemyAttackers demand a healTargetId — but it is never healed.
        hp: 1_000_000,
        // Focus acts LAST (speed 100 < enemy ally 200), so it sees the enemy ally's
        // same-round self-heal before its purge gate is evaluated.
        speed: 100,
        healTargetId: FOCUS_ID,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [enemyAlly(heal)],
    });

    const finalEnemyAllySelfBuffs = (heal: boolean): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(heal),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return engine!.timedAbilityStatuses('self', ENEMY_ALLY_ID).map((b) => b.active.buffName);
    };

    it('REPAIRED (enemy ally self-heals after taking damage): player-Nayra purge fires → Attack Up removed', () => {
        expect(finalEnemyAllySelfBuffs(true)).toEqual([]);
    });

    it('NOT REPAIRED (enemy ally never self-heals): player-Nayra gate false → purge inert → Attack Up remains', () => {
        expect(finalEnemyAllySelfBuffs(false)).toEqual(['Attack Up']);
    });
});
