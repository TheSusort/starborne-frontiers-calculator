/**
 * `Out. Detonation Damage Up III` (+45% Outgoing Detonation Damage) must scale detonation
 * bursts. Chimei grants it to an ally for 1 turn; it built as a name-only buff (empty
 * parsedEffects) so nothing read it.
 *
 * Unlike Exposed, this one IS a standing stat for its duration, so it rides a `parsedEffects`
 * channel rather than a name-keyed read — every consumer (bomb snapshot, live detonationMult,
 * DPS aggregates, buff UI) should see it.
 *
 * The buff's parsedEffects are produced by the PRODUCTION parser (`parseBuffEffects`) over the
 * real `BUFFS` entry, so this fails if either the buffParser pattern or the
 * `toDotAndPenModifiers` fold regresses — a hand-written `{ detonationDamage: 45 }` would prove
 * nothing about either.
 *
 * TWO DETONATION PATHS, both fed by the same `EffectiveDamageStats.detonationDamageModifier`
 * (effectiveStats.ts), but consumed differently:
 *   - corrosion (LIVE path): `detonate()`'s non-bomb branch reads the DETONATING actor's
 *     CURRENT-round modifier (`recipe.detonationMult`) — container detonation by the buff
 *     holder.
 *   - bomb (SNAPSHOT path): the modifier is captured onto `PendingBomb.detonationDamageModifier`
 *     at APPLICATION time (playerTurn.ts's `applyNewDoTs`) and read back from that snapshot at
 *     burst, regardless of the holder's modifier at burst time.
 * The two paths do NOT share one event on a positional run: container detonation surfaces on the
 * aggregate `dot-detonated`, while a bomb burst surfaces ONLY on `bomb-detonated`. Both fold into
 * `result.rawTotals.detonation`, which is what this file measures — one channel, no double-count,
 * and byte-identical to the pre-branch numbers on both paths.
 *
 * The run now fights a real, positioned enemy, which makes every cast here carry a
 * plain 100%-damage clause (`basicDamage()`). That is not decoration — a DETONATE-ONLY cast
 * resolves nobody on a positional run and its detonation is dropped entirely, so without the
 * damage clause all three cases measure 0 (a green-and-vacuous trap the ratio assertions would
 * NOT have caught, since 0/0 is NaN and the `> 0` guard is what fires). Every ship in the corpus
 * that takes this parser path carries damage in the same clause, so the damage clause is the
 * CORPUS-FAITHFUL shape, not a workaround. The pinned ratios are unchanged (+45%), and the
 * absolute burst totals are byte-identical to the pre-branch run: corrosion 120000 -> 174000,
 * bomb 600 -> 870.
 *
 * ROUND SHAPE: the buff-grant, the DoT-apply, and the detonate-dot all sit in the SAME active
 * slot, recast every round. `detonate-dot` resolves BEFORE that round's own apply (playerTurn.ts
 * Step 2.95 vs Step 3), so round 1 has nothing to detonate yet (0 credited); round 2 detonates
 * round 1's application; round 3 detonates round 2's. `numRounds: 3` (from BASE) gives two
 * non-zero bursts, confirmed empirically to land at an exact, uncontaminated +45% every round —
 * including for the bomb snapshot, because the buff-grant ability resolves before this SAME
 * cast's own DoT-apply step, so even round 1's bomb is snapshotted already-buffed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { BUFFS } from '../../../constants/buffs';
import { parseBuffEffects } from '../../calculators/buffParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

const BUFF_NAME = 'Out. Detonation Damage Up III';
const EXPECTED_PCT = 45;
const HP = 10_000_000;
const ATTACK = 10_000;

/** The buff as a real on-cast self-buff, payload straight from production parsing. */
const detonationBuff = (): Ability => {
    const entry = BUFFS.find((b) => b.name === BUFF_NAME)!;
    return {
        id: 'det-buff',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: BUFF_NAME,
            parsedEffects: parseBuffEffects(entry.name, entry.description),
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    };
};

/** A plain 100% active damage clause. Required so the cast RESOLVES a positional victim — see
 *  the SP-4b-2b note in the file header. */
const basicDamage = (): Ability => ({
    id: 'basic-damage',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

/** Applies a corrosion DoT, then detonates it on a later cast (live path). */
const applyCorrosion = (): Ability => ({
    id: 'apply-corrosion',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    // AbilityConfig's 'dot' variant uses `duration` (turns the DoT persists), not `turns`.
    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 5 },
});

const detonateCorrosion = (): Ability => ({
    id: 'det-corrosion',
    type: 'detonate-dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'detonate-dot', dotType: 'corrosion', powerPct: 100 },
});

/** Applies a bomb, then detonates it on a later cast (snapshot path). */
const applyBomb = (): Ability => ({
    id: 'apply-bomb',
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'bomb', tier: 3, stacks: 1, duration: 2 },
});

const detonateBomb = (): Ability => ({
    id: 'det-bomb',
    type: 'detonate-dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
});

const activeSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities,
});

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

/** Total detonation damage credited across the run.
 *
 *  This used to sum the aggregate `dot-detonated` event, on the reasoning that engine.ts
 *  folds `bomb + inferno + corrosion` into it. That is a NON-positional property. On a positional
 *  run a bomb burst emits `bomb-detonated` and no `dot-detonated` at all, so the old listener read
 *  0 for the whole snapshot-path case. `rawTotals.detonation` is the one channel both paths fold
 *  into, and it reproduces the pre-branch magnitudes exactly. */
function detonationTotal(input: CombatEngineInput): number {
    return runCombat(input).rawTotals.detonation;
}

describe('Out. Detonation Damage Up III scales detonation bursts', () => {
    it('is inert when the buff is absent (baseline)', () => {
        const withoutBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [activeSlot([basicDamage(), applyCorrosion(), detonateCorrosion()])],
                },
            })
        );
        // Absolute pin (byte-identical to the pre-branch, dummy-sink run): two 60000 corrosion
        // bursts. `> 0` alone would not notice the detonate-only zero this file walked into.
        expect(withoutBuff).toBe(120000);
    });

    it('scales the burst by exactly +45% when the buff is held (live detonationMult path)', () => {
        const withoutBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [activeSlot([basicDamage(), applyCorrosion(), detonateCorrosion()])],
                },
            })
        );
        const withBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [
                        activeSlot([
                            detonationBuff(),
                            basicDamage(),
                            applyCorrosion(),
                            detonateCorrosion(),
                        ]),
                    ],
                },
            })
        );
        expect(withoutBuff).toBe(120000);
        expect(withBuff).toBe(174000);
        expect(withBuff / withoutBuff).toBeCloseTo(1 + EXPECTED_PCT / 100, 6);
    });

    it('scales a bomb applied while holding the buff by exactly +45% (PendingBomb snapshot path)', () => {
        const withoutBuff = detonationTotal(
            BASE({
                shipSkills: { slots: [activeSlot([basicDamage(), applyBomb(), detonateBomb()])] },
            })
        );
        const withBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [
                        activeSlot([detonationBuff(), basicDamage(), applyBomb(), detonateBomb()]),
                    ],
                },
            })
        );
        expect(withoutBuff).toBe(600);
        expect(withBuff).toBe(870);
        expect(withBuff / withoutBuff).toBeCloseTo(1 + EXPECTED_PCT / 100, 6);
    });
});
