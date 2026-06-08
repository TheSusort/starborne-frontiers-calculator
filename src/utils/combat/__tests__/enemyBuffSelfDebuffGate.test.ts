/**
 * enemy-buff / self-debuff condition gate tests (Task 7).
 *
 * Verifies that a player ability gated on `enemy-buff` fires when the
 * `enemyBuffNames` arg carries the named buff (and not when empty), and that a
 * `self-debuff`-gated ability fires when `selfDebuffNames` carries the named
 * debuff. Uses runPlayerTurn directly with explicit name arrays so the plumbing
 * into every buildRoundContext gate site is verified independently of the engine's
 * live state sourcing (which the runCombat tests in leech.test.ts cover).
 *
 * NOTE on `derivable: true`: only a DERIVABLE enemy-buff/self-debuff condition reads
 * the context name arrays — a non-derivable one returns manualCount (the editor path).
 * Ship-data `enemy-buff` gates are currently emitted non-derivable (buildShipAbilities);
 * making them live-reading is a separate data-modeling change. Task 7 delivers the
 * PLUMBING (the arrays are now populated), which these derivable conditions exercise.
 */
import { describe, it, expect } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `eb${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

function makeRuntime(skills: ShipSkills, attackStat = 10000): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: attackStat,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });
    const never: PlayerActorRuntime['activeCritGate'] = () => false;
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: attackStat,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: never,
        chargedCritGate: never,
        activeHealCritGate: never,
        chargedHealCritGate: never,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    names: { enemyBuffNames?: string[]; selfDebuffNames?: string[] }
): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        enemyHpDecline: 0,
        ...names,
    };
}

/** A damage skill with a +100%-attack MODIFIER ability gated on `cond`. When the gate
 *  passes, effectiveAttack doubles → directDamage doubles. Mirrors the selfHpGate pattern
 *  (modifier abilities fold via modifierTotalsFromAbilities against the gate ctx). */
const gatedAttackBuffSkill = (cond: Ability['conditions']): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'modifier',
                    target: 'self',
                    conditions: cond,
                    config: {
                        type: 'modifier',
                        channel: 'attack',
                        value: 100,
                        isMultiplicative: false,
                    },
                }),
            ],
        },
    ],
});

describe('enemy-buff gate in runPlayerTurn (Task 7)', () => {
    it('fires when enemyBuffNames carries the named buff; not when empty', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
        ];

        const withBuff = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { enemyBuffNames: ['Attack Up'] })
        );
        const without = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { enemyBuffNames: [] })
        );

        // Gate passes → +100% attack → 10000 → 20000. Gate fails → 10000.
        expect(withBuff.directDamage).toBe(20000);
        expect(without.directDamage).toBe(10000);
    });

    it('name-filtered: a DIFFERENT enemy buff name does not satisfy the gate', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
        ];
        const turn = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { enemyBuffNames: ['Defense Up'] })
        );
        expect(turn.directDamage).toBe(10000);
    });
});

describe('self-debuff gate in runPlayerTurn (Task 7)', () => {
    it('fires when selfDebuffNames carries the named debuff; not when empty', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'self-debuff', derivable: true, buffName: 'Defense Down' },
        ];

        const withDebuff = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), {
                selfDebuffNames: ['Defense Down'],
            })
        );
        const without = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { selfDebuffNames: [] })
        );

        expect(withDebuff.directDamage).toBe(20000);
        expect(without.directDamage).toBe(10000);
    });

    it('default (omitted) name args behave as empty — gate does not fire', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'self-debuff', derivable: true, buffName: 'Defense Down' },
        ];
        const turn = runPlayerTurn(makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), {}));
        expect(turn.directDamage).toBe(10000);
    });
});
