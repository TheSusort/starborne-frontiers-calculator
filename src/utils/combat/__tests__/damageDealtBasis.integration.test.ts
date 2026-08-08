/**
 * Multi-hit full-walk attacks, PR7 — the `basis:'damage-dealt'` reactive resolves PER SUB-ATTACK
 * off the damage that attack actually DELIVERED.
 *
 * Two locked game rules (user-verified in-game, 2026-08-08), landing together because they are the
 * same defect — an OUTGOING effect resolving at victim scope instead of sub-attack scope:
 *
 *  R-BASIS. "X% of damage dealt" scales off the FINAL on-screen damage: post-crit,
 *           post-outgoing-amplification, post-victim-defence, including the chunk a Protection
 *           cascade redirected onto an ally, excluding a portion deferred into a DoT. That is
 *           `ability-performed.deliveredDamage` (PR7 Tasks 1-2), NOT `.damage` — the latter is the
 *           pre-funnel DISPLAY basis buildCombatLog reads and must not move.
 *  R-COUNT. PER ATTACK, NOT PER TARGET. An AoE fires the effect ONCE however many victims crit,
 *           and heals MORE through a bigger AMOUNT, not through more procs. A multi-hit skill is
 *           N consecutive full-walk attacks (R1), each already emitting its own `ability-performed`
 *           (PR2), so N sub-attacks fire it N times.
 *
 * Measured against 471c2dce, the pre-fix listener (`for i < critHits`, `triggerDamage: e.damage`)
 * produced, for a 20%-of-damage-dealt on-crit self-heal over a 2-victim footprint:
 *
 *              pattern/hits   heals (pre-fix)          heals (correct)
 *              base  h1       [2000]                   [2000]
 *              base  h3       [2000, 2000, 2000]       [2000, 2000, 2000]
 *              all   h1       [2000, 2000]             [4000]
 *              all   h3       6 x 2000                 3 x 4000
 *
 * Both defects are visible only when the footprint has >1 victim: the base-pattern rows are
 * unchanged, which is why Enforcer's in-game-verified 3 Defense Shred stacks at `hits: 3` (the
 * other real consumer of this listener, `Pattern-Base`) cannot move.
 *
 * Fixtures are copied from `subAttackProcGates.integration.test.ts` rather than imported — that
 * file exports nothing, and PR2/PR4 deliberately kept their fixtures local.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bt${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/**
 * An N-hit damage active. `hits` is omitted at N=1 so the fixture matches a normal ship.
 *
 * MEASURED, because the sibling files' docstrings disagree: this helper passes a FIXED
 * `multiplier: 100` alongside `hits`, so a 3-hit cast deals 3x a 1-hit cast (30000 vs 10000 here),
 * and the engine then splits that folded total back across the 3 emitted events. Net effect: ONE
 * sub-attack of a 3-hit cast delivers exactly what a 1-hit cast delivers. The multiplier is NOT
 * re-split by the fixture, so an assertion of the form `three[0] ~= one[0] / 3` would be wrong.
 */
const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

const HEAL_PCT = 20;

/**
 * Bloodthirst's shape, copied from `buildEquipmentAbilities.ts:628-645`: a passive-slot on-crit
 * SELF heal scaling off damage dealt. The real implant also carries a top-level `procChance`; it is
 * DELIBERATELY OMITTED here so the heal fires unconditionally. PR7 is about the basis and the
 * count, not the gate — and `passesProcChanceGate` returns early when `procChance` is undefined, so
 * including it would add a second RNG dependency to every assertion below. (That early return is
 * exactly what made one of PR4's new tests vacuous.)
 */
const bloodthirstPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            config: { type: 'heal', pct: HEAL_PCT, basis: 'damage-dealt' },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
/** Single-cell footprint: the anchor only. */
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
/** Whole-roster footprint: every occupied cell is struck by each sub-attack. */
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

/** A positioned enemy that never fires back. */
const passiveEnemyAt = (id: string, position: Position) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots: [] },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/**
 * The focus player at M1 fires `slots`. `crit: 100` with a neutral-affinity roster makes every
 * (sub-attack, victim) pair crit. Two occupied enemy cells ⟹ an `all` footprint has 2 victims,
 * which is what makes the per-target/per-attack distinction observable at all.
 */
const focusCast = (slots: ShipSkills['slots'], pattern: ParsedPattern): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
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
    affinity: 'antimatter',
    defence: 0,
    hp: 1_000_000_000,
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    enemyAttackers: [passiveEnemyAt('anchor', 'M4'), passiveEnemyAt('covered', 'M3')],
});

/** Everything fires: crit gates, landing gates, proc gates. */
const alwaysFire = (): void => {
    setRateGateRng(() => 0);
    setKeyedRng(() => 0);
};

/**
 * Runs one cast and returns the focus ship's own reactive-heal amounts, in resolution order.
 *
 * The event is `reactive-heal-performed`, NOT `heal-performed`: a drain-time reactive heal is
 * LOG-ONLY and never emits the cast event (chain guard — `heal-performed` drives the on-repair
 * listeners). Subscribing to `heal-performed` here would observe nothing and every assertion below
 * would pass on an empty array.
 */
const healAmounts = (input: CombatEngineInput): number[] => healsAndAttacks(input).heals;

/** As `healAmounts`, but also captures the focus ship's own damage `ability-performed` events. */
const healsAndAttacks = (
    input: CombatEngineInput
): { heals: number[]; attacks: AbilityPerformed[] } => {
    const heals: number[] = [];
    const attacks: AbilityPerformed[] = [];
    const bus = createEventBus();
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === 'attacker') heals.push(e.amount);
    });
    bus.on('ability-performed', (e) => {
        if (e.actorId === 'attacker' && e.abilityType === 'damage') attacks.push(e);
    });
    runCombat({ ...input, bus });
    return { heals, attacks };
};

/** One pinned cast: `hits` sub-attacks over `pattern`, with Bloodthirst in the passive slot. */
const cast = (hits: number, pattern: ParsedPattern): CombatEngineInput => {
    idc = 0;
    alwaysFire();
    return focusCast([attackSkill(hits), bloodthirstPassive()], pattern);
};

describe('Bloodthirst damage-dealt basis (PR7)', () => {
    afterEach(() => resetRateGateRng());

    it('an AoE crit fires ONCE per sub-attack, not once per critting victim', () => {
        // Pre-fix: 2 — the listener looped `critHits` times, and a 1-hit cast over a 2-victim
        // footprint reports critHits: 2. R-COUNT says an AoE footprint is ONE attack.
        expect(healAmounts(cast(1, allPattern()))).toHaveLength(1);
    });

    it('an AoE heals MORE than a single-target hit — via the amount, not the count', () => {
        const single = healAmounts(cast(1, basePattern()));
        const aoe = healAmounts(cast(1, allPattern()));

        expect(single).toHaveLength(1);
        expect(aoe).toHaveLength(1);
        // Locked ruling: "trigger per attack, not per target. so an aoe attack would heal more."
        expect(aoe[0]).toBeGreaterThan(single[0]);
        // Quantitatively: the whole 2-victim footprint's delivered damage, not one victim's share.
        // Pre-fix these two were EQUAL (both 20% of the pre-funnel `damage`) and the AoE simply
        // fired twice, so the strict inequality above is the load-bearing half.
        expect(aoe[0]).toBeCloseTo(single[0] * 2, 6);
    });

    it.each([
        ['base', basePattern()],
        ['all', allPattern()],
    ] as const)('a 3-hit %s cast heals three times — one per sub-attack', (_label, pattern) => {
        // Enforcer's shape. `base` was already correct pre-fix (critHits: 1 per event ⟹ 3) and is
        // kept as the guard that the collapse did NOT go too far — an implementation that fired
        // once per CAST would report 1 here. `all` is the row that discriminates: pre-fix 6.
        expect(healAmounts(cast(3, pattern))).toHaveLength(3);
    });

    it('each heal is pct x THAT sub-attack’s DELIVERED damage, not its display damage', () => {
        const { heals, attacks } = healsAndAttacks(cast(3, allPattern()));

        expect(attacks).toHaveLength(3);
        expect(heals).toHaveLength(3);
        // Guard against fixture drift silently making the assertion below vacuous: the two bases
        // must actually differ here (10000 display vs 20000 delivered over 2 victims), or "heals
        // off delivered" and "heals off display" would be indistinguishable.
        for (const a of attacks) expect(a.deliveredDamage).not.toBeCloseTo(a.damage!, 6);

        attacks.forEach((a, i) => {
            expect(heals[i]).toBeCloseTo((a.deliveredDamage! * HEAL_PCT) / 100, 6);
        });
    });
});
