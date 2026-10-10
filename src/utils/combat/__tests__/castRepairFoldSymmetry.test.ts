/**
 * A CAST REPAIR FOLDS THE SAME FACTORS ON EITHER SIDE OF THE BOARD.
 *
 * `healing.test.ts`'s "fold order: healModifier × outgoingHeal × incomingHeal" pins the composition
 * for the PLAYER focus only. An enemy caster's repair runs through the same `runPlayerTurn` heal
 * block but books nothing to the player healing buckets, so that test's instrument cannot see it.
 * This file builds one healer, stands it on each side in turn, and reads both runs through the same
 * instrument — the `heal-performed` event's per-recipient amount — so a factor dropped on either
 * side shows up as the two sides disagreeing.
 *
 * The healer: max HP 10,000, `healModifier` 20, and an active that first grants itself a status
 * carrying `Out. Repair` +15 and `Inc. Repair` +20, then repairs itself for 10% of its max HP.
 * Clause order puts the status on the board before the repair, so the repair reads it:
 *   1,000 × 1.20 × 1.15 × 1.20 = 1,656.
 * Its opponent is an inert, unkillable dummy that never attacks.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

const HEALER_HP = 10_000;
const DUMMY_HP = 1_000_000_000;
const HEAL_PCT = 10;
const HEAL_MODIFIER = 20;
const OUT_REPAIR = 15;
const INC_REPAIR = 20;

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const healerSkills = (statusEffects: ParsedBuffEffects): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'repair-boost',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Repair Boost',
                        parsedEffects: statusEffects,
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                } satisfies Ability,
                {
                    id: 'self-repair',
                    type: 'heal',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: HEAL_PCT, basis: 'target-hp' },
                } satisfies Ability,
            ],
        },
    ],
});

const common = {
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    chargeCount: 0,
    defensePenetration: 0,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    crit: 0,
    critDamage: 0,
    defence: 0,
    position: 'M1' as const,
    target: front(),
    pattern: basePattern(),
    healTargetId: 'attacker',
    mode: 'healing' as const,
};

const enemyBase = {
    chargeCount: 0,
    startCharged: false,
    position: 'M1' as const,
    target: front(),
    pattern: basePattern(),
};

/** The healer's own repair amounts, read off `heal-performed` (both sides emit it). */
function healerRepairs(
    side: 'player' | 'enemy',
    healModifier: number,
    statusEffects: ParsedBuffEffects
): number[] {
    const bus = createEventBus();
    const events: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
    bus.on('heal-performed', (e) => events.push(e));
    const healerId = side === 'player' ? 'attacker' : 'enemy-healer';
    const input: CombatEngineInput =
        side === 'player'
            ? {
                  ...common,
                  bus,
                  attack: 0,
                  hp: HEALER_HP,
                  speed: 300,
                  healModifier,
                  shipSkills: healerSkills(statusEffects),
                  enemyAttackers: [
                      {
                          ...enemyBase,
                          id: 'dummy',
                          stats: {
                              attack: 0,
                              crit: 0,
                              critDamage: 0,
                              defence: 0,
                              hp: DUMMY_HP,
                              speed: 100,
                          },
                          shipSkills: { slots: [] },
                      },
                  ],
              }
            : {
                  ...common,
                  bus,
                  attack: 0,
                  hp: DUMMY_HP,
                  speed: 300,
                  shipSkills: { slots: [] },
                  enemyAttackers: [
                      {
                          ...enemyBase,
                          id: healerId,
                          stats: {
                              attack: 0,
                              crit: 0,
                              critDamage: 0,
                              defence: 0,
                              hp: HEALER_HP,
                              speed: 100,
                              healModifier,
                          },
                          shipSkills: healerSkills(statusEffects),
                      },
                  ],
              };
    runCombat(input);
    return events
        .filter((e) => e.casterId === healerId)
        .flatMap((e) => (e.perTarget ?? []).filter((t) => t.targetId === healerId))
        .map((t) => t.amount);
}

const BOOST: ParsedBuffEffects = { outgoingHeal: OUT_REPAIR, incomingHeal: INC_REPAIR };
const FULL =
    HEALER_HP *
    (HEAL_PCT / 100) *
    (1 + HEAL_MODIFIER / 100) *
    (1 + OUT_REPAIR / 100) *
    (1 + INC_REPAIR / 100);

describe('a cast repair composes healModifier × Out. Repair × Inc. Repair on both sides', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side caster: 1,000 × 1.20 × 1.15 × 1.20`, () => {
            const amounts = healerRepairs(side, HEAL_MODIFIER, BOOST);
            expect(amounts).toHaveLength(1);
            expect(amounts[0]).toBeCloseTo(FULL, 6);
        });

        it(`${side}-side caster: each factor is read (strip one, the amount drops by it)`, () => {
            const noModifier = healerRepairs(side, 0, BOOST);
            const noStatus = healerRepairs(side, HEAL_MODIFIER, {});
            expect(noModifier[0]).toBeCloseTo(FULL / (1 + HEAL_MODIFIER / 100), 6);
            expect(noStatus[0]).toBeCloseTo(
                HEALER_HP * (HEAL_PCT / 100) * (1 + HEAL_MODIFIER / 100),
                6
            );
        });
    }

    it('the two sides give the same number for the mirrored healer', () => {
        expect(healerRepairs('enemy', HEAL_MODIFIER, BOOST)).toEqual(
            healerRepairs('player', HEAL_MODIFIER, BOOST)
        );
    });
});
