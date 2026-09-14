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
import { Ability } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { getAffinityMatchup } from '../../calculators/affinityUtils';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ship } from '../../../types/ship';

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
    amount: number | 'all',
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
    },
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

// ─── Zenith: the unbounded "removes all charges" quantifier, end to end ──────────────
//
// Zenith is built from its VERBATIM docs/ship-skills.csv rows, so this exercises the whole
// pipeline — regex → parseChargeRemoval → buildShipAbilities → playerTurn's cast step →
// removeEnemyCharges — rather than a hand-constructed `{ amount: 'all' }` config.
//
//   active:  "...deals 230% damage and removes 1 charge from the enemy charged skill."
//   charged: "...deals 310% damage and removes all charges from the enemy charged skill."
//
// Both holders start at 3 charges, which makes the chemical enemy's reading a three-way
// discriminator rather than a pass/fail: 3 = nothing fired (or the gate wrongly skipped it),
// 2 = the ACTIVE slot fired and the charged did not, 0 = the charged slot fired AND 'all'
// actually emptied the pool. Only 0 proves the feature.
const ZENITH_ACTIVE =
    'This Unit deals <unit-damage>230% damage</unit-damage> and <unit-aid>removes 1 charge</unit-aid> from the enemy charged skill.';
const ZENITH_CHARGED =
    'This Unit deals <unit-damage>310% damage</unit-damage> and <unit-aid>removes all charges</unit-aid> from the enemy charged skill.';

/** Zenith's real skill rows through the real builder. `startCharged` picks WHICH slot the focus
 *  casts on its single turn: true → the charged skill ('all'), false → the active ('1'). */
const zenithInput = (startCharged: boolean, enemies: EnemyAttacker[]): CombatEngineInput => {
    const { slots } = buildShipAbilities({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: ZENITH_ACTIVE,
        chargeSkillText: ZENITH_CHARGED,
        chargeSkillCharge: 3,
    } as Ship);
    return {
        ...buildInput(chargeAbility(0, 'self', 'on-cast', 'unused'), enemies),
        shipSkills: { slots },
        chargeCount: 3,
        hasChargedSkill: true,
        startCharged,
    };
};

describe("Zenith — 'removes all charges' end to end", () => {
    it('the charged slot EMPTIES the chemical enemy (3 → 0) and the affinity gate still spares the electric one', () => {
        const actors = runAndTap(
            zenithInput(true, [
                chargeHolder('e-electric', 'electric'), // advantage over thermal Zenith → SKIPPED
                chargeHolder('e-chemical', 'chemical'), // thermal advantage → emptied
            ])
        );

        // The charge-manip affinity gate is NOT bypassed by the unbounded quantifier: a
        // disadvantaged Zenith removes NOTHING from the electric holder, 'all' or not.
        expect(chargesOf(actors, 'e-electric')).toBe(3);
        // 'all' reaches the engine and empties the pool outright — not 3 − 1 = 2.
        expect(chargesOf(actors, 'e-chemical')).toBe(0);
    });

    it("a REACTIVE 'all' removal goes through the same executor and the same affinity gate", () => {
        // Zenith's own 'all' rides on-cast (playerTurn), so this arm covers the OTHER route to
        // `removeEnemyCharges`: triggers.ts's reactive executor. Hand-built because no corpus text
        // emits a reactive 'all' today — this pins the path tsc forced open, not a shipped kit.
        const actors = runAndTap(
            buildInput(chargeAbility('all', 'all-enemies', 'start-of-round', 'p-remove-all-sor'), [
                chargeHolder('e-electric', 'electric'),
                chargeHolder('e-chemical', 'chemical'),
            ])
        );

        expect(chargesOf(actors, 'e-electric')).toBe(3);
        expect(chargesOf(actors, 'e-chemical')).toBe(0);
    });

    it("the ACTIVE slot's numeric quantifier still removes exactly 1 (3 → 2)", () => {
        // Same fixture, charged skill not ready → the active casts. This is what pins the reading
        // above to the CHARGED slot: the pipeline can produce 2 here, so 0 there is not an
        // artefact of the fixture removing everything no matter which slot fires.
        const actors = runAndTap(
            zenithInput(false, [
                chargeHolder('e-electric', 'electric'),
                chargeHolder('e-chemical', 'chemical'),
            ])
        );

        expect(chargesOf(actors, 'e-electric')).toBe(3);
        expect(chargesOf(actors, 'e-chemical')).toBe(2);
    });
});
