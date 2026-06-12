/**
 * Phase 4c (enemy-team PR2) — cross-enemy CAST buff routing.
 *
 * PR1 wired enemy attackers' REACTIVE self-buffs. PR2 fixes the CAST path so an enemy
 * SUPPORTER's `ally`/`all-allies` buffs land on the ENEMY TEAM (raising other enemies'
 * damage to the tank) instead of leaking onto the player team.
 *
 * registerActorAbilityStatuses routes `ally`/`all-allies` recipients to the passed
 * recipient-id order. For enemy actors that order was previously `playerIds` (the player
 * team) — so an enemy supporter's all-allies buff registered onto PLAYER stores and never
 * reached the other enemy. The fix passes the ENEMY attacker ids as the recipient order, so
 * aura+timed statuses fan out onto enemy stores and fold into each enemy's own turn (via
 * playerTurn's `timedAbilityStatuses('self', id)` + `activeAbilityStatuses('self', ctx, id)`).
 *
 * Each test isolates the SINGLE variable (the buff's target / presence) against a control,
 * so the delta proves the buff reached the OTHER enemy and not the player team.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `etr${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A basic-attack active slot (100% / 1 hit). Folds the enemy's CURRENT effective attack —
// so a live Attack Up buff couples straight into this hit's incoming damage.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// A SUPPORTER whose active slot casts an all-allies Attack Up (timed, 99 turns) AND a basic
// hit. The buff is on-cast → folds at this enemy's turn onto every enemy recipient.
const supporterEnemy = (id: string, speed: number, buffTarget: Ability['target']): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: buffTarget,
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 100 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// A PURE supporter: only an all-allies Attack Up on its active slot, NO damage ability.
const pureSupporterEnemy = (id: string, speed: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 100 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// An aura supporter: all-allies Attack Up with NO duration (aura → folds each round via
// activeAbilityStatuses), plus a basic hit.
const auraSupporterEnemy = (id: string, speed: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'all-allies',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 100 },
                                stacks: 1,
                                isStackable: false,
                                // No duration → aura (recurring fold).
                            },
                        }),
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// A plain enemy with NO buff at all, at a given speed/id.
const plainEnemy = (id: string, speed: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: { slots: [basicAttack()] } as ShipSkills,
    }) as EnemyAttacker;

const BASE_MULTI = (enemyAttackers: EnemyAttacker[]): CombatEngineInput => ({
    ...BASE(enemyAttackers[0]),
    enemyAttackers,
});

const BASE = (enemyAttacker: EnemyAttacker): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000, // huge tank HP so it survives both rounds and incoming damage is observable
    healTargetId: 'attacker',
    enemyAttackers: [enemyAttacker],
});

const total = (r: ReturnType<typeof runCombat>) =>
    r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

describe('enemy-team cross-enemy cast buff routing (PR2)', () => {
    // ── Task 1: all-allies timed cast buff reaches the OTHER enemy ─────────────
    it('an enemy supporter all-allies Attack Up raises the OTHER enemy hit vs a self-target control', () => {
        // Supporter acts FIRST (speed 80) so its buff lands before the attacker's turn.
        // ALL-ALLIES routing → the buff reaches the second (slower) attacker, raising its hit.
        idc = 0;
        const allAllies = runCombat(
            BASE_MULTI([supporterEnemy('support', 80, 'all-allies'), plainEnemy('attacker2', 40)])
        );
        // CONTROL: identical, but the supporter's buff is SELF-target — only the routing target
        // differs, so the second enemy stays unbuffed.
        idc = 0;
        const selfControl = runCombat(
            BASE_MULTI([supporterEnemy('support', 80, 'self'), plainEnemy('attacker2', 40)])
        );

        // RED (before routing fix): the all-allies buff routes to playerIds, so the second enemy
        // is unbuffed → incoming EQUALS the self-control (the supporter's own hit folds the buff
        // identically in both runs). Observed RED: 20000 vs 20000 → toBeGreaterThan FAILS.
        // After the fix the second enemy folds the all-allies buff → strictly more incoming.
        expect(total(allAllies)).toBeGreaterThan(total(selfControl));
    });

    // ── Task 2: aura routing + pure-supporter coverage ─────────────────────────
    it('an enemy all-allies AURA buff reaches the OTHER enemy and folds each round', () => {
        idc = 0;
        const aura = runCombat(
            BASE_MULTI([auraSupporterEnemy('support', 80), plainEnemy('attacker2', 40)])
        );
        // CONTROL: replace the aura supporter with a plain attacker (no buff at all), keeping the
        // second attacker identical. The delta is the second enemy folding the routed aura.
        idc = 0;
        const noBuff = runCombat(
            BASE_MULTI([plainEnemy('support', 80), plainEnemy('attacker2', 40)])
        );

        expect(total(aura)).toBeGreaterThan(total(noBuff));
    });

    it('a PURE supporter (no damage slot) buffs a plain attacker and produces no NaN', () => {
        idc = 0;
        const withSupporter = runCombat(
            BASE_MULTI([pureSupporterEnemy('support', 80), plainEnemy('attacker2', 40)])
        );
        // BASELINE: drop the supporter entirely — just the lone plain attacker.
        idc = 0;
        const baseline = runCombat(BASE_MULTI([plainEnemy('attacker2', 40)]));

        const supTotal = total(withSupporter);
        const baseTotal = total(baseline);

        // (b) no NaN anywhere in the incoming-damage series.
        for (const round of withSupporter.healing!.rounds) {
            expect(Number.isNaN(round.incomingDamage)).toBe(false);
        }
        // (a) the supporter's all-allies buff reached the plain attacker → more incoming than the
        // lone-attacker baseline.
        expect(supTotal).toBeGreaterThan(baseTotal);
    });
});
