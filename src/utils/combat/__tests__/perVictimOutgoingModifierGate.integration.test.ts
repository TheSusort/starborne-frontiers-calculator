/**
 * Sub-project I, PR I2 — per-victim evaluation of enemy-status-gated OUTGOING-DAMAGE
 * modifiers (Layer 3), combat-engine integration.
 *
 * I1 (PR c5d52d07) made `enemy-debuff` gating NAME-specific but still evaluated ONCE per
 * turn against the primary (bound) target — `positionalScalars.outgoingDamageBuffPct` is a
 * single fixed value applied uniformly to every AoE footprint victim. This is wrong for a
 * Tygr/Incinerator/Lodolite-shape aura ("+N% to enemies with <named status>"): in an AoE only
 * the victims that CURRENTLY carry the named status should get the bonus (spec §2 locked rule).
 *
 * This suite locks the fix: `engine.ts`'s `perVictimOutgoingDeltaPct` re-folds the SAME
 * `modifierAbilities` against a per-victim ctx (that victim's OWN enemy-debuff names) and
 * subtracts the primary-ctx fold, producing a DELTA that `victimHitDamage` (victimDamage.ts)
 * applies additively alongside the fixed per-turn `outgoingDamageBuffPct`.
 *
 * Fixture shape (mirrors enemyDebuffNameSpecificGate.integration.test.ts's Tygr-shape,
 * extended to TWO footprint victims via a whole-team ('all' shape) damage pattern):
 *   - The damage ability is AoE ('all' pattern) → hits BOTH enemy attackers every round.
 *   - The debuff-inflict ability targets 'enemy' (single-target, NOT AoE) → lands ONLY on the
 *     resolved anchor ('front', bound via the parsed `target`).
 *   - The modifier is gated on `enemy-debuff` (buffName: 'Stasis').
 *
 * Round 1: neither victim carries Stasis pre-turn → gate false for both → both take BASE
 *          damage. The round's own inflict lands on 'front' (anti-causality — I1 invariant).
 * Round 2: 'front' now carries the round-1 infliction (pre-existing) → gate TRUE for 'front'
 *          only → 'front' takes base × 1.30; 'covered' (never debuffed) stays at base damage.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvog${++idc}`,
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
// AoE whole-team pattern (shape:'all' ignores geometry — every occupied cell is 'origin',
// so BOTH footprint victims take FULL (roleScale 1.0) damage; only the per-victim outgoing
// delta under test can make their damage diverge).
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A single positioned, passive (attack:0) enemy — security:0 so any inflict-type debuff
// always lands (mirrors enemyDebuffNameSpecificGate.integration.test.ts).
const passiveEnemyAt = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const engineBase = (
    shipSkills: ShipSkills,
    enemyAttackers: EnemyAttacker[]
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    numRounds: 2,
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
    // hacking 200 vs enemy security 0 → inflict landing chance clamp((200-0)/100) = 1.0.
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    // The single-target debuff ability resolves against THIS parsed target ('front') —
    // whichever enemy attacker occupies the front-most position becomes the anchor.
    target: parsedTarget('front'),
    // The top-level pattern drives the DAMAGE ability's footprint expansion (AoE, both victims).
    pattern: allPattern(),
    enemyAttackers,
});

/** Shared skill set: AoE damage + single-target Stasis inflict + a self modifier gated on
 *  the named 'enemy-debuff' Stasis, folded into the outgoingDamage channel. */
const skillsWithGate = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'debuff',
                    config: {
                        type: 'debuff',
                        buffName: 'Stasis',
                        application: 'inflict',
                        duration: 5,
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: {},
                    },
                }),
                ab({
                    target: 'self',
                    type: 'modifier',
                    conditions: [{ subject: 'enemy-debuff', derivable: true, buffName: 'Stasis' }],
                    config: {
                        type: 'modifier',
                        channel: 'outgoingDamage',
                        value: 30,
                        isMultiplicative: true,
                    },
                }),
            ],
        },
    ],
});

describe('per-victim outgoing-modifier gate (sub-project I, PR I2) — AoE mixed-victim', () => {
    it('only the victim carrying the named debuff gets the bonus; the other AoE victim stays at base damage', () => {
        idc = 0;
        const result = runCombat(
            engineBase(skillsWithGate(), [
                passiveEnemyAt('front', 'M4'),
                passiveEnemyAt('covered', 'M3'),
            ])
        );

        expect(result.rounds).toHaveLength(2);

        // Round 1: nothing pre-exists on EITHER victim before this turn → gate false for both →
        // both take BASE damage (100% of 10000 attack = 10000). The round's own Stasis
        // infliction lands on 'front' but does not retroactively satisfy this turn's gate.
        expect(result.rounds[0].perTargetDamage?.['front']).toBe(10_000);
        expect(result.rounds[0].perTargetDamage?.['covered']).toBe(10_000);

        // Round 2: 'front' now carries the round-1 infliction (pre-existing) → its OWN gate
        // reads true → +30% (13000). 'covered' never received Stasis → its OWN gate reads
        // false → stays at BASE damage (10000), even though the primary-target ctx (front)
        // satisfies the condition. This is the core per-victim assertion: the bonus does NOT
        // bleed from the primary target onto an untouched AoE victim.
        expect(result.rounds[1].perTargetDamage?.['front']).toBe(13_000);
        expect(result.rounds[1].perTargetDamage?.['covered']).toBe(10_000);
    });

    it('single-victim regression: delta is 0 through the positional/AoE plumbing — identical to I1', () => {
        idc = 0;
        // Only ONE enemy attacker present: the victim IS the primary target, so the per-victim
        // ctx is IDENTICAL to the primary ctx by construction (delta = 0 always). Proves the
        // new perVictimOutgoing plumbing does not perturb the single-victim case.
        const result = runCombat(engineBase(skillsWithGate(), [passiveEnemyAt('front', 'M4')]));

        expect(result.rounds).toHaveLength(2);
        expect(result.rounds[0].perTargetDamage?.['front']).toBe(10_000); // no pre-existing Stasis
        expect(result.rounds[1].perTargetDamage?.['front']).toBe(13_000); // pre-existing → +30%
    });

    it('no enemy-status-gated modifier present → delta is 0 for every AoE victim (byte-identical fast path)', () => {
        idc = 0;
        // Same AoE damage ability, but NO modifier ability at all — perVictimOutgoing carries
        // an empty modifierAbilities list, so perVictimOutgoingDeltaPct short-circuits to 0.
        const plainSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ],
                },
            ],
        };
        const result = runCombat(
            engineBase(plainSkills, [
                passiveEnemyAt('front', 'M4'),
                passiveEnemyAt('covered', 'M3'),
            ])
        );

        expect(result.rounds).toHaveLength(2);
        for (const round of result.rounds) {
            expect(round.perTargetDamage?.['front']).toBe(10_000);
            expect(round.perTargetDamage?.['covered']).toBe(10_000);
        }
    });
});
