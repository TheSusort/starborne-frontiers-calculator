/**
 * Phase 4c (enemy-team PR1) — enemy attacker REACTIVE self-buffs.
 *
 * An enemy attacker walks the full runPlayerTurn pipeline bound to the heal target.
 * Its CAST abilities fire, but before this PR its REACTIVE abilities (e.g. a
 * `start-of-round` self Attack Up — Chakara-shaped) never fired:
 * buildEnemyPlayerActorRuntime partitions the enemy's reactive abilities onto the
 * runtime, but they were never registered as listeners (only the player-side
 * registerReactiveListeners ran), and even an enqueued enemy intent would throw in
 * the executor because enemy ids are absent from the player runtimes map.
 *
 * This is the RED characterization test: an enemy whose shipSkills carry a
 * `start-of-round` self Attack Up buff should hit HARDER than a control enemy with
 * no such buff, because the buff folds into its outgoing damage at its turn. The
 * assertion is on the per-round incoming damage to the tank (healing.rounds[].incomingDamage),
 * NOT internal state.
 *
 * RED baseline (before Task 2): the enemy's reactive `start-of-round` buff is never
 * registered/executed, so the buffed enemy deals the SAME incoming damage as the
 * control → `toBeGreaterThan` FAILS (equal values). (No throw is observed because
 * nothing enqueues an enemy intent in the first place — the listener was never
 * registered, so the executor's "no runtime for intent ownerId" path is never reached.)
 * After Task 2 the buff folds in and the buffed enemy hits harder → PASS.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `era${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A basic-attack active slot (100% / 1 hit). Folds the enemy's CURRENT effective attack —
// so a live self Attack Up buff couples straight into this hit's incoming damage.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// Chakara-shaped enemy: basic attack + a `start-of-round` self Attack Up (+100% attack,
// 99 turns). The reactive buff fires at the round head and folds into this same round's hit.
const buffedEnemy = (): EnemyAttacker =>
    ({
        id: 'chakara',
        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                basicAttack(),
                {
                    slot: 'passive',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            trigger: 'start-of-round',
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

// Control: identical basic attack, NO reactive self-buff.
const controlEnemy = (): EnemyAttacker =>
    ({
        id: 'control',
        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: { slots: [basicAttack()] } as ShipSkills,
    }) as EnemyAttacker;

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

describe('enemy attacker reactive self-buffs (Chakara-as-enemy)', () => {
    it('a start-of-round self Attack Up makes the enemy hit the tank HARDER than a control', () => {
        idc = 0;
        const buffed = runCombat(BASE(buffedEnemy()));
        idc = 0;
        const control = runCombat(BASE(controlEnemy()));

        const buffedR2 = buffed.healing!.rounds[1].incomingDamage;
        const controlR2 = control.healing!.rounds[1].incomingDamage;

        // The reactive buff folds +100% attack into the enemy's round-2 hit, so the buffed
        // enemy deals strictly more incoming damage to the tank than the un-buffed control.
        expect(buffedR2).toBeGreaterThan(controlR2);
    });
});
