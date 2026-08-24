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

/** A positioned enemy that never fires back. `slots` lets one of them carry a passive (the
 *  Protection aura below); left empty it is a pure damageable body, as before. */
const passiveEnemyAt = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/**
 * Grants SELF `Protection` the PRODUCTION way — an aura (a `buff` config with NO duration +
 * isStackable), the classification a real Meatshield's "gains N stacks of Protection" passive parses
 * to. Copied from `protectionTransfer.integration.test.ts` (which exports nothing); that file's
 * enemy-side-symmetry test proves this exact shape makes a positioned enemy a live protector.
 *
 * Protector DEFENCE is deliberately 0 here (`passiveEnemyAt`), so the chunk re-mitigates at ratio 1
 * and `protectorChunk + targetRemainder` is EXACTLY the undiverted hit — which is what lets the
 * assertion below be an equality rather than a hand-computed mitigation product.
 */
const protectionAuraPassive = (stacks: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'meatshield-protection',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Protection',
                parsedEffects: {},
                stacks,
                isStackable: true,
            },
        },
    ],
});

/**
 * The focus player at M1 fires `slots`. `crit: 100` with a neutral-affinity roster makes every
 * (sub-attack, victim) pair crit. Two occupied enemy cells ⟹ an `all` footprint has 2 victims,
 * which is what makes the per-target/per-attack distinction observable at all.
 */
const focusCast = (
    slots: ShipSkills['slots'],
    pattern: ParsedPattern,
    opts: { protectTarget?: boolean } = {}
): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
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
    mode: 'healing',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    // 'anchor' (M4, the FRONT column) is what `target:'front'` binds to; 'covered' (M3) is the
    // second footprint cell for the `all` pattern — and, under `protectTarget`, the ally holding
    // Protection, so part of every hit on 'anchor' is redirected onto it.
    enemyAttackers: [
        passiveEnemyAt('anchor', 'M4'),
        passiveEnemyAt('covered', 'M3', opts.protectTarget ? [protectionAuraPassive(3)] : []),
    ],
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
const cast = (
    hits: number,
    pattern: ParsedPattern,
    opts: { protectTarget?: boolean } = {}
): CombatEngineInput => {
    idc = 0;
    alwaysFire();
    return focusCast([attackSkill(hits), bloodthirstPassive()], pattern, opts);
};

/** Total damage `id` actually TOOK across the run (post-transfer), read from the per-actor intake
 *  bucket — the same read `protectionTransfer.integration.test.ts`'s `totalIncoming` uses. */
const incomingOf = (input: CombatEngineInput, id: string): number => {
    let sum = 0;
    for (const rd of runCombat(input).rounds) sum += rd.perActorIncoming?.[id]?.incoming ?? 0;
    return sum;
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

    it('heals off the FULL delivered amount when Protection redirects part of the hit', () => {
        const unprotected = healAmounts(cast(1, basePattern()));
        const withProtector = healAmounts(cast(1, basePattern(), { protectTarget: true }));

        expect(unprotected).toHaveLength(1);
        expect(withProtector).toHaveLength(1);
        // Locked ruling (in-game verified 2026-08-08): "if protection triggers, it will heal based
        // on the total damage of the damage to the protector, and whatever damage is left on the
        // target." The redirect MOVES damage between victims; it must not shrink the basis.
        // Pre-fix `deliveredDamage` was the victim's booked REMAINDER only, so this measured 1400
        // against an unprotected 2000 — exactly the 0.7x the 3-stack redirect leaves behind. The
        // sibling test below is what keeps this from passing vacuously if the cascade goes inert.
        expect(withProtector[0]).toBeCloseTo(unprotected[0], 4);
    });

    it('…and the redirect it heals through is real: the protector took 30%, the target kept 70%', () => {
        // NON-VACUITY GUARD for the test above. If the fixture ever stopped redirecting, that
        // assertion would pass trivially (both sides equal because nothing moved). These read the
        // post-transfer per-actor intake directly, so they fail the moment the cascade goes inert.
        const victimAlone = incomingOf(cast(1, basePattern()), 'anchor');
        const protectedInput = cast(1, basePattern(), { protectTarget: true });
        const victimProtected = incomingOf(protectedInput, 'anchor');
        const protector = incomingOf(protectedInput, 'covered');

        expect(victimAlone).toBeGreaterThan(0);
        // 3 stacks → 30% diverted. Protector defence is 0, so the chunk re-mitigates at ratio 1 and
        // the two shares sum back to exactly the undiverted hit — the arithmetic that makes the
        // equality above exact rather than approximate.
        expect(victimProtected).toBeCloseTo(0.7 * victimAlone, 4);
        expect(protector).toBeCloseTo(0.3 * victimAlone, 4);
        expect(protector).toBeGreaterThan(0);
        expect(victimProtected + protector).toBeCloseTo(victimAlone, 4);
    });
});

/**
 * Locked rule 2 coverage: "if dot, no heal." A DoT-transformed portion of a sub-attack contributes
 * NOTHING to the damage-dealt basis — this is the only one of the five locked rules that shipped
 * with no assertion anywhere. Pre-PR7, `triggerDamage` was `e.damage` (the pre-funnel
 * `directDamage`), which INCLUDED the transformed portion, so a fully-transformed sub-attack still
 * healed; post-PR7 it reads `deliveredDamage`, which nets the transform out, so its basis is 0.
 *
 * `Hit Mitigation` is the vehicle (as in perSubAttackEvents.integration.test.ts's funnel-diversion
 * case): a one-shot that blocks the NEXT direct hit, converting it wholesale into a DoT, so exactly
 * sub-attack 0 of a 3-hit cast is diverted and sub-attacks 1-2 land normally — the asymmetry that
 * makes the diverted sub-attack's silence observable against non-zero siblings in the SAME run.
 *
 * PR6 UPDATE (this file's assertion moved with it): a repair whose gross is 0 no longer emits
 * `reactive-heal-performed` at all, because a repair that repaired nothing must not open a
 * combat-log row (`triggers.ts`, symmetric with the shield branch's `shieldRecipientIds.length > 0`).
 * So rule 2's observable is now the ABSENCE of the diverted sub-attack's event, not an `amount: 0`
 * event. Absence alone would also be satisfied by a lost sub-attack, so the undiverted CONTROL below
 * pins that the same cast emits three when nothing is diverted — the missing one is the diverted one.
 */
describe('Bloodthirst emits no repair off a DoT-transformed sub-attack (locked rule 2, PR7/PR6)', () => {
    afterEach(() => resetRateGateRng());

    /** 'anchor' self-casts a long Hit Mitigation from its ACTIVE slot and acts first (speed 999
     *  vs the focus's forced speed 1 below), so the block is armed before the focus attacker's
     *  cast lands. Shape copied from perSubAttackEvents.integration.test.ts's `blockingEnemyAt`. */
    const mitigatingAnchor = (): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
        id: 'anchor',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 999 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        affinity: 'antimatter',
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Hit Mitigation',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 99, // never expires inside the fixture
                            },
                        }),
                    ],
                },
            ],
        },
    });

    it('the diverted sub-attack emits no repair at all while its siblings repair normally', () => {
        idc = 0;
        alwaysFire();
        const input: CombatEngineInput = {
            ...focusCast([attackSkill(3), bloodthirstPassive()], basePattern()),
            speed: 1, // slower than the mitigating anchor, so the block is up before the cast
            enemyAttackers: [mitigatingAnchor()],
        };

        const heals = healAmounts(input);

        // THE rule-2 assertion: the diverted sub-attack contributes NOTHING — and since PR6 a
        // nothing-repair opens no log row, so only its two siblings are here.
        expect(heals).toHaveLength(2);
        // Both survivors are real repairs — same pct of the same undiverted delivered damage.
        expect(heals[0]).toBeGreaterThan(0);
        expect(heals[1]).toBeGreaterThan(0);
        expect(heals[1]).toBeCloseTo(heals[0], 6);
    });

    it('CONTROL: the same 3-hit cast with NOTHING diverted emits three repairs', () => {
        // Without this, the length-2 assertion above would also be satisfied by a sub-attack that
        // never fired the reactive at all, rather than one correctly suppressed for repairing 0.
        idc = 0;
        alwaysFire();
        const heals = healAmounts(focusCast([attackSkill(3), bloodthirstPassive()], basePattern()));

        expect(heals).toHaveLength(3);
        for (const amount of heals) expect(amount).toBeGreaterThan(0);
    });
});
