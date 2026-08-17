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
 * (effectiveStats.ts:221), but consumed differently:
 *   - corrosion (LIVE path): `detonate()`'s non-bomb branch reads the DETONATING actor's
 *     CURRENT-round modifier (`recipe.detonationMult`) — container detonation by the buff
 *     holder.
 *   - bomb (SNAPSHOT path): the modifier is captured onto `PendingBomb.detonationDamageModifier`
 *     at APPLICATION time (playerTurn.ts's `applyNewDoTs`) and read back from that snapshot at
 *     burst, regardless of the holder's modifier at burst time.
 * Both bursts surface on the same non-positional aggregate `dot-detonated` event (engine.ts
 * folds `result.total = bomb + inferno + corrosion` there — `bomb-detonated` fires too for the
 * bomb portion alone, but summing that ALONGSIDE `dot-detonated` would double-count it).
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
import { createEventBus, type CombatEvent } from '../events';
import { BUFFS } from '../../../constants/buffs';
import { parseBuffEffects } from '../../calculators/buffParser';
import type { Ability, ShipSkills } from '../../../types/abilities';

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
    enemyAttackers: [],
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: HP,
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

/** Total damage credited across the run via the non-positional aggregate `dot-detonated`
 *  event — which already sums bomb + inferno + corrosion for a given round (engine.ts folds
 *  `result.total` there), so this single listener covers both paths without double-counting
 *  the bomb-only `bomb-detonated` event that fires alongside it. */
function detonationTotal(input: CombatEngineInput): number {
    const bus = createEventBus();
    let total = 0;
    bus.on('dot-detonated', (e: Extract<CombatEvent, { type: 'dot-detonated' }>) => {
        total += e.damage;
    });
    runCombat({ ...input, bus });
    return total;
}

describe('Out. Detonation Damage Up III scales detonation bursts', () => {
    it('is inert when the buff is absent (baseline)', () => {
        const withoutBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [activeSlot([applyCorrosion(), detonateCorrosion()])],
                },
            })
        );
        expect(withoutBuff).toBeGreaterThan(0);
    });

    it('scales the burst by exactly +45% when the buff is held (live detonationMult path)', () => {
        const withoutBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [activeSlot([applyCorrosion(), detonateCorrosion()])],
                },
            })
        );
        const withBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [activeSlot([detonationBuff(), applyCorrosion(), detonateCorrosion()])],
                },
            })
        );
        expect(withoutBuff).toBeGreaterThan(0);
        expect(withBuff / withoutBuff).toBeCloseTo(1 + EXPECTED_PCT / 100, 6);
    });

    it('scales a bomb applied while holding the buff by exactly +45% (PendingBomb snapshot path)', () => {
        const withoutBuff = detonationTotal(
            BASE({ shipSkills: { slots: [activeSlot([applyBomb(), detonateBomb()])] } })
        );
        const withBuff = detonationTotal(
            BASE({
                shipSkills: {
                    slots: [activeSlot([detonationBuff(), applyBomb(), detonateBomb()])],
                },
            })
        );
        expect(withoutBuff).toBeGreaterThan(0);
        expect(withBuff / withoutBuff).toBeCloseTo(1 + EXPECTED_PCT / 100, 6);
    });
});
