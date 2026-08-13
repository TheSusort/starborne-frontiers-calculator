/**
 * Integration: charge MANIPULATION (removal) affinity gate.
 *
 * Charge Manipulation rule (buffs.ts): "Increases or Decreases charge skill charges by noted
 * amount. Does not need hacking. Does not affect enemies with affinity advantage over the
 * applying unit." → enemy-targeted charge REMOVAL must SKIP a target that has affinity ADVANTAGE
 * over the applier — i.e. when the applier is at a DISADVANTAGE vs the target:
 *   skip when getAffinityMatchup(applierAffinity, targetAffinity) === 'disadvantage'.
 *
 * Affinity ring (affinityUtils.ts): thermal > chemical > electric > thermal.
 *   - applier THERMAL vs ELECTRIC target → getAffinityMatchup(thermal, electric) === 'disadvantage'
 *     (electric beats thermal) → the electric enemy is SKIPPED (keeps its charges).
 *   - applier THERMAL vs CHEMICAL target → getAffinityMatchup(thermal, chemical) === 'advantage'
 *     → the chemical enemy's charges ARE removed.
 *
 * The two enemies are charge HOLDERS (chargeCount set, NO charged-damage slot → hasChargedSkill
 * false → cadence never re-banks), seeded `seeded === chargeCount` so each starts with exactly
 * `seeded` charges and the seeded value minus the removal is directly observable via the actor tap.
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { getAffinityMatchup } from '../../calculators/affinityUtils';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const runAndTap = (input: CombatEngineInput): CombatActor[] => {
    let captured: CombatActor[] = [];
    runCombat({ ...input, __testTapActors: (actors) => (captured = actors) });
    return captured;
};
const chargesOf = (actors: CombatActor[], id: string): number => {
    const a = actors.find((x) => x.id === id);
    if (!a) throw new Error(`no actor '${id}' in tapped roster`);
    return a.charges;
};

const enemyDamage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const chargeAbility = (
    amount: number,
    target: Ability['target'],
    trigger: Ability['trigger'],
    id: string
): Ability => ({
    id,
    type: 'charge',
    target,
    trigger,
    conditions: [],
    config: { type: 'charge', amount },
});

/** A charge HOLDER with a fixed id + affinity. chargeCount === seeded via startCharged; no
 *  charged-damage slot → hasChargedSkill false → never re-banks. */
const chargeHolder = (id: string, affinity: EnemyAttacker['affinity']): EnemyAttacker => ({
    id,
    affinity,
    stats: { attack: 1, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: 3,
    startCharged: true,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [enemyDamage(1, `${id}-a`)] }],
    } as ShipSkills,
});

/** Player focus (the applier) holding the under-test charge-removal ability. Speed 100 → acts
 *  before the enemies. `affinity: 'thermal'` is the applier affinity under test. */
const buildInput = (
    chargeAbilityUnderTest: Ability,
    enemies: EnemyAttacker[]
): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    affinity: 'thermal',
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(50, 'p-a')] },
            { slot: 'passive', abilities: [chargeAbilityUnderTest] },
        ],
    },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
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
    hp: 1_000_000_000,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: enemies,
});

describe('charge removal — affinity gate (applier thermal)', () => {
    // Empirical guard: verify the affinity directions this test relies on against affinityUtils.
    it('affinity directions hold: thermal is disadvantaged vs electric, advantaged vs chemical', () => {
        expect(getAffinityMatchup('thermal', 'electric')).toBe('disadvantage');
        expect(getAffinityMatchup('thermal', 'chemical')).toBe('advantage');
    });

    it('on-cast all-enemies: skips the affinity-advantaged (electric) enemy, removes from the chemical enemy', () => {
        const actors = runAndTap(
            buildInput(chargeAbility(2, 'all-enemies', 'on-cast', 'p-remove-cast'), [
                chargeHolder('e-electric', 'electric'), // advantage over thermal → SKIPPED
                chargeHolder('e-chemical', 'chemical'), // thermal advantage → removed
            ])
        );

        // Electric enemy has affinity advantage over the thermal applier → keeps all 3 charges.
        expect(chargesOf(actors, 'e-electric')).toBe(3);
        // Chemical enemy: thermal applier advantaged → 3 − 2 === 1.
        expect(chargesOf(actors, 'e-chemical')).toBe(1);
    });

    it('start-of-round all-enemies (reactive path): same affinity gate', () => {
        const actors = runAndTap(
            buildInput(chargeAbility(2, 'all-enemies', 'start-of-round', 'p-remove-sor'), [
                chargeHolder('e-electric', 'electric'),
                chargeHolder('e-chemical', 'chemical'),
            ])
        );

        expect(chargesOf(actors, 'e-electric')).toBe(3);
        expect(chargesOf(actors, 'e-chemical')).toBe(1);
    });
});
