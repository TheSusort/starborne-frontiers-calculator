/**
 * #396 — cross-store family shadowing on the two channels `victimIncomingModifiers` combines:
 * `defense` (`toSelfDefenseModifier` vs `toEnemyModifiers`) and `incomingDamage`
 * (`toSelfIncomingDamageModifier` vs `toEnemyModifiers`).
 *
 * LOCKED RULE: highest tier wins for ALL buffs/debuffs, regardless of which side applied it. Two
 * instances of one named family never add. DoTs and bombs are the only exceptions.
 *
 * HOW THE FIXTURE REACHES A STRADDLE, and why it looks like this. A probe over all 149 corpus
 * ships found ZERO families granted from both a self-targeted and an enemy-targeted ability — the
 * ship kits alone cannot produce a straddle, so a kit-driven fixture here would be VACUOUSLY green.
 * The reachable path is the manual pickers: `GameBuffPicker` excludes only `type: 'effect'`, so the
 * same named family can be ticked in the self-side picker AND an enemy-side one. `selfBuffs` and
 * `enemyDebuffs` on `CombatEngineInput` are exactly those two picker channels, which is why the
 * fixture builds the straddle from buff LISTS.
 *
 * THREE FIGURES, MUTUALLY DISTINGUISHABLE, in every arm below: the weaker instance, the stronger
 * instance, and their sum are three DIFFERENT numbers, so an assertion on one of them cannot pass
 * under either of the other two rules. #389's first cross-family arm was vacuous for want of
 * exactly this.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { ShipSkills } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

type Modifiers = {
    enemyDefenseModifier: number;
    incomingDamageModifier: number;
    victimSideIncomingModifier: number;
};

let idc = 0;
const scheduled = (
    buffName: string,
    parsedEffects: SelectedGameBuff['parsedEffects'],
    stacks = 1
): SelectedGameBuff => ({
    id: `xs-${++idc}`,
    buffName,
    stacks,
    parsedEffects,
    isStackable: false,
    skillSource: 'active',
    skillDuration: 3,
});

const damageSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'xs-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [damageSlot()] },
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
    hp: 10_000_000,
    ...overrides,
});

const modifiersFor = (overrides: Partial<CombatEngineInput>): ((id: string) => Modifiers) => {
    idc = 0;
    let captured: ((victimId: string) => Modifiers) | undefined;
    runCombat(
        BASE({
            ...overrides,
            __testTapVictimEnemyModifiers: (fn) => {
                captured = fn;
            },
        })
    );
    expect(captured).toBeDefined();
    return captured!;
};

describe('#396 — defense channel shadows across the self/enemy store boundary', () => {
    // The three candidate figures. Deliberately not a doubling of each other, so no arm can be
    // satisfied by two different rules at once.
    const OWN = -30; // self-side `Defense Down II`
    const APPLIED = -45; // enemy-side `Defense Down III`
    const SUM = OWN + APPLIED; // -75, the pre-#396 answer

    it('the three candidate figures are mutually distinguishable', () => {
        expect(new Set([OWN, APPLIED, SUM]).size).toBe(3);
    });

    it('the STRONGER applied instance wins — never the sum, never the weaker own instance', () => {
        const m = modifiersFor({
            selfBuffs: [scheduled('Defense Down II', { defense: OWN })],
            enemyDebuffs: [scheduled('Defense Down III', { defense: APPLIED })],
        });
        expect(m('attacker').enemyDefenseModifier).toBe(APPLIED);
        expect(m('attacker').enemyDefenseModifier).not.toBe(SUM);
        expect(m('attacker').enemyDefenseModifier).not.toBe(OWN);
    });

    it('the STRONGER own instance wins when the applied one is weaker', () => {
        const m = modifiersFor({
            selfBuffs: [scheduled('Defense Down III', { defense: APPLIED })],
            enemyDebuffs: [scheduled('Defense Down II', { defense: OWN })],
        });
        expect(m('attacker').enemyDefenseModifier).toBe(APPLIED);
        expect(m('attacker').enemyDefenseModifier).not.toBe(SUM);
    });

    it('DIFFERENT families on one channel still ADD — the over-collapse guard', () => {
        // `deriveFamilyKey` gives `Defense Down` and `Defense Shred` different keys, so nothing
        // shadows and the additive answer is the RIGHT one here. This is the arm that turns red if
        // the family key is ever replaced by a constant.
        const m = modifiersFor({
            selfBuffs: [scheduled('Defense Down II', { defense: OWN })],
            enemyDebuffs: [scheduled('Defense Shred', { defense: APPLIED })],
        });
        expect(m('attacker').enemyDefenseModifier).toBe(SUM);
    });

    it('an enemy-only family passes through whole (nothing on the self side to compare)', () => {
        const m = modifiersFor({
            enemyDebuffs: [scheduled('Defense Down III', { defense: APPLIED })],
        });
        expect(m('attacker').enemyDefenseModifier).toBe(APPLIED);
    });

    it('a self-only family passes through whole (no enemy instance visits it)', () => {
        const m = modifiersFor({
            selfBuffs: [scheduled('Defense Down II', { defense: OWN })],
        });
        expect(m('attacker').enemyDefenseModifier).toBe(OWN);
    });

    it('two instances of ONE family in the enemy list collapse to the strongest', () => {
        // CHARACTERIZATION, not a #396 arm — MEASURED: this stays GREEN under a revert of the
        // #396 arithmetic, because the picker-sourced enemy list is written through `upsertBuff`,
        // whose within-store `familyApplicationWins` upsert already dropped the weaker instance
        // before this read. Kept because it pins that the boundary fix did not disturb the
        // within-store rule, and because the enemy list reaching `familiesOf` un-collapsed (a
        // future per-victim scheduled store, say) must land on the same answer. Sum would be -75.
        const m = modifiersFor({
            enemyDebuffs: [
                scheduled('Defense Down II', { defense: OWN }),
                scheduled('Defense Down III', { defense: APPLIED }),
            ],
        });
        expect(m('attacker').enemyDefenseModifier).toBe(APPLIED);
    });
});

describe('#396 — incomingDamage channel, and the victim-side split that moves with it', () => {
    const OWN = 20; // self-side `Inc. Damage Up I` (ticked on the actor's own picker)
    const APPLIED = 35; // enemy-side `Inc. Damage Up III`
    const SUM = OWN + APPLIED; // 55

    it('the three candidate figures are mutually distinguishable', () => {
        expect(new Set([OWN, APPLIED, SUM]).size).toBe(3);
    });

    it('the applied instance wins the mixed channel', () => {
        const m = modifiersFor({
            selfBuffs: [scheduled('Inc. Damage Up I', { incomingDamage: OWN })],
            enemyDebuffs: [scheduled('Inc. Damage Up III', { incomingDamage: APPLIED })],
        });
        expect(m('attacker').incomingDamageModifier).toBe(APPLIED);
        expect(m('attacker').incomingDamageModifier).not.toBe(SUM);
    });

    it('a SHADOWED self instance leaves the victim-side split too', () => {
        // #358 addendum 3: `victimSideIncomingModifier` is the half `victimHitDamageParts`
        // subtracts back off the "damage absorbed" axis. A self-sourced term the enemy side
        // shadowed away is no longer in the mixed total, so reporting it as a victim-side
        // reduction would strip damage the total never held.
        const m = modifiersFor({
            selfBuffs: [scheduled('Inc. Damage Up I', { incomingDamage: OWN })],
            enemyDebuffs: [scheduled('Inc. Damage Up III', { incomingDamage: APPLIED })],
        });
        expect(m('attacker').victimSideIncomingModifier).toBe(0);
    });

    it('an UNSHADOWED self instance stays in the victim-side split', () => {
        // Different family on the enemy side → nothing shadows → the self term is still there,
        // and the mixed total is the sum. The contrast with the arm above is what proves the
        // split MOVES rather than being hardcoded either way.
        const m = modifiersFor({
            selfBuffs: [scheduled('Inc. Damage Down I', { incomingDamage: -OWN })],
            enemyDebuffs: [scheduled('Inc. Damage Up III', { incomingDamage: APPLIED })],
        });
        expect(m('attacker').incomingDamageModifier).toBe(APPLIED - OWN);
        expect(m('attacker').victimSideIncomingModifier).toBe(-OWN);
    });
});
