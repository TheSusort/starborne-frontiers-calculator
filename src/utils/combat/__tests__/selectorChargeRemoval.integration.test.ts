/**
 * #399 Task 3 — a charge-removal ability whose target is one of the three SELECTOR targets removes
 * charges from THAT ONE resolved enemy, not from the whole opposing board and not from nobody.
 *
 * Before this, `triggers.ts`'s charge branch matched only 'enemy' | 'all-enemies', so a selector
 * target fell through to the owner-only GAIN arm at the bottom: the caster gained a charge and no
 * enemy lost one. HAND-AUTHORED shape — `parseChargeRemoval` hardcodes target:'enemy', so no
 * corpus skill text can produce this and no fixture here can be a real kit.
 *
 * FIXTURE-DESIGN NOTE (found while getting the CONTROL arm to pass): every actor with a USABLE
 * charged skill (`hasUsableChargedSkill` — a non-empty 'charged' slot) gets `advanceChargeCadence`
 * run on its OWN turn (state.ts): +1 charge if still below `chargeCount`, or a reset to 0 if it
 * just fired at cap. All four enemies here act within the SAME round (numRounds:1 still runs every
 * living actor once — speed only orders turns, it does not skip them), so a fixture carrying a
 * 'charged' slot ability would re-gain exactly the 1 charge this test removes on that same turn,
 * making a POST-round direct `.charges` tap unable to observe the removal AT ALL — independent of
 * whether the fix under test is even present. `enemyWithCharges` below therefore gives every enemy
 * ONLY an 'active' slot (no 'charged' ability), so `hasUsableChargedSkill` is false and
 * `advanceChargeCadence` no-ops on every turn — this fixture is a pure charge COUNTER, not a real
 * charged-burster kit, which is fine: nothing here asserts anything about which skill fires.
 */

import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability } from '../../../types/abilities';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ─── Direct-charge harness ────────────────────────────────────────────────────────
// Copied verbatim from enemyChargeRemoval.integration.test.ts:32-110 — the smallest working
// `runCombat` charge harness in the repo. Deliberately duplicated (not extracted into a shared
// module) so the two integration files can drift independently, matching wave8Targets.test.ts's
// precedent for copying its own harness rather than sharing one.
const runAndTap = (input: CombatEngineInput): CombatActor[] => {
    let captured: CombatActor[] = [];
    runCombat({ ...input, __testTapActors: (actors) => (captured = actors) });
    return captured;
};
/** runAndTap with a forced round count — the on-cast cases read after a SINGLE player cast
 *  (numRounds 1), otherwise the player would re-cast the removal every round and stack drops. */
const runAndTapRounds = (input: CombatEngineInput, numRounds: number): CombatActor[] =>
    runAndTap({ ...input, numRounds });
const chargesOf = (actors: CombatActor[], id: string): number => {
    const a = actors.find((x) => x.id === id);
    if (!a) throw new Error(`no actor '${id}' in tapped roster`);
    return a.charges;
};

// ─── Ability fixtures ───────────────────────────────────────────────────────────

const enemyDamage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A player charge ability with a configurable target + trigger (positive amount; the engine
 *  subtracts for enemy targets). */
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

// ─── Task 3 fixtures ────────────────────────────────────────────────────────────

const HIGH_ATTACK_ID = 'e-doomsayer';
const FILLER_IDS = ['e-f1', 'e-f2', 'e-f3'] as const;

/** An enemy seeded with charges and nothing else interesting. Speed 40 → acts AFTER the player
 *  (speed 100), so the start-of-round removal lands before any enemy turn. `startCharged: true`
 *  seeds `charges === chargeCount`, so the pre-removal value is exactly `chargeCount`. ONLY an
 *  'active' slot ability (no 'charged' slot) — see the file-level FIXTURE-DESIGN NOTE: a usable
 *  charged skill would re-generate the removed charge on the enemy's own turn this same round,
 *  masking the removal from a post-round tap regardless of correctness. */
const enemyWithCharges = (opts: {
    id: string;
    attack: number;
    chargeCount: number;
    startCharged: boolean;
}): EnemyAttacker => ({
    id: opts.id,
    stats: { attack: opts.attack, crit: 0, critDamage: 0, speed: 40 },
    chargeCount: opts.chargeCount,
    startCharged: opts.startCharged,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [enemyDamage(50, `${opts.id}-a`)] }],
    },
});

/** The Doomsayer board: one 9000-attack enemy at 2 charges, three at 1 charge each. */
const board = () => [
    enemyWithCharges({ id: HIGH_ATTACK_ID, attack: 9000, chargeCount: 2, startCharged: true }),
    ...FILLER_IDS.map((id) =>
        enemyWithCharges({ id, attack: 100, chargeCount: 1, startCharged: true })
    ),
];

/** The focus carries the charge ability under test on its PASSIVE slot (a `start-of-round`
 *  trigger is partitioned to the reactive drain regardless of slot). Field-for-field the input
 *  from `enemyChargeRemoval.integration.test.ts:118-145`; `enemyAttackers` is supplied by each
 *  arm via spread. */
const playerInput = (chargeAbilityUnderTest: Ability): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    // chargeCount: 1 (not 0) — INSTRUMENT VALIDATION for the NO-OP arm below: the pre-fix
    // fall-through lands on "Owner-only charge gain, capped as on the cast path; no-op when
    // chargeCount 0" (triggers.ts). A chargeCount of 0 would make that owner-gain branch a no-op
    // FOR AN UNRELATED REASON, silently passing the NO-OP test whether or not the selector
    // fall-through bug is actually reached. `hasChargedSkill: false` below keeps the caster's own
    // per-turn charge cadence (advanceChargeCadence) from touching this at all, so the ONLY way
    // 'attacker' can end this test with a nonzero charge is the exact pre-fix fall-through path.
    chargeCount: 1,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(50, 'p-a')] },
            { slot: 'passive', abilities: [chargeAbilityUnderTest] },
        ],
    },
    numRounds: 6,
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
    enemyAttackers: [],
});

describe('#399: selector-targeted charge removal', () => {
    it('enemy-highest-attack removes from the 9000-attack enemy ONLY', () => {
        const actors = runAndTapRounds(
            {
                ...playerInput(chargeAbility(1, 'enemy-highest-attack', 'start-of-round', 'p-c')),
                enemyAttackers: board(),
            },
            1
        );

        expect(chargesOf(actors, HIGH_ATTACK_ID)).toBe(1); // 2 → 1
        for (const id of FILLER_IDS) expect(chargesOf(actors, id)).toBe(1); // untouched
    });

    it('CONTROL: target:all-enemies still removes from every enemy (the bulk arm is unchanged)', () => {
        const actors = runAndTapRounds(
            {
                ...playerInput(chargeAbility(1, 'all-enemies', 'start-of-round', 'p-c')),
                enemyAttackers: board(),
            },
            1
        );

        // INSTRUMENT VALIDATION: proves the fixture's removal really fires. Without this arm, a
        // green "filler untouched" above could just mean nothing happened at all.
        expect(chargesOf(actors, HIGH_ATTACK_ID)).toBe(1);
        for (const id of FILLER_IDS) expect(chargesOf(actors, id)).toBe(0);
    });

    it('NO-OP when the selector resolves to nobody — never a fall-through to the owner gain', () => {
        // NO-OP VARIANT USED: an empty `enemyAttackers` roster ends the fight before the
        // start-of-round drain ever runs (a fight ends at the end of the turn that wipes a side —
        // an empty enemy side means the fight is already over on round 1), so this arm cannot use
        // that shape. Instead we seed ONE living, `chargeLossImmune` enemy: the
        // `enemy-highest-attack` selector resolves to it (it is the only living candidate), but
        // `removeChargesFrom` skips chargeLossImmune actors, so its charge count is unchanged —
        // and critically, this still exercises the question that matters: does the caster
        // wrongly fall through to the owner-only GAIN arm? (Pre-fix: yes, caster gains a charge.)
        const immuneEnemy: EnemyAttacker = {
            ...enemyWithCharges({
                id: 'e-immune',
                attack: 9000,
                chargeCount: 1,
                startCharged: true,
            }),
            chargeLossImmune: true,
        };
        const actors = runAndTapRounds(
            {
                ...playerInput(chargeAbility(1, 'enemy-highest-attack', 'start-of-round', 'p-c')),
                enemyAttackers: [immuneEnemy],
            },
            1
        );

        // The caster must NOT have gained a charge: that is the exact pre-fix failure mode.
        expect(chargesOf(actors, 'attacker')).toBe(0);
        // The immune enemy must be untouched too (charge-loss-immune, not merely "not selected").
        //
        // #399 final-review Finding 6: this arm exercises `removeChargesFrom`'s OWN
        // immunity skip (the selector resolves to a real, living candidate — `e-immune` — and
        // `removeChargesFrom` then declines to touch it), NOT the separate
        // `if (selectedId === undefined) return;` guard in `triggers.ts`'s selector branch, which
        // covers "no living candidate at all" and has no direct coverage in this file. A future
        // reader should not read this arm's green as proving that guard too.
        expect(chargesOf(actors, 'e-immune')).toBe(1);
    });
});
