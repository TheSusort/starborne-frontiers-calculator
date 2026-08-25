/**
 * #367 — an ENEMY-APPLIED `Inc. Repair Down` must actually reduce the repairs landing on its
 * victim.
 *
 * ── THE BUG THIS FILE PINS ────────────────────────────────────────────────────────────────────
 * `incomingHealBuff` is summed only from an actor's OWN self-side statuses (`foldActorBuffTotals`
 * / `effectiveDamageStatsOf` — scheduled self-buffs + timed SELF ability statuses + `preFight`).
 * An enemy-inflicted debuff lands in the PER-VICTIM ENEMY store, which no incoming-heal fold read.
 * So `Inc. Repair Down I/II/III` — documented as -25/-50/-75% incoming repair, and inflicted by 8
 * corpus ships (9 carry one of these two families; the ninth, Nayra, carries only the OUTGOING
 * one) — reduced nothing at all. `reversedRepairs.engine.test.ts`'s R6 block records this
 * as a known pre-existing limitation and routes around it via `preFight`; this file is the fix.
 *
 * The fix is ONE fold plus one freshness correction. The fold: `engine.ts`'s `buildTurnArgs`
 * computes the victim's own enemy-applied heal modifiers (`victimOwnEnemyHealModifiers`) per turn
 * and hands them to `runPlayerTurn`, which folds them into `scheduledTotals` right beside
 * `preFight` — reaching every incoming-heal reader at once, because they all read
 * `dmgStats.totals.incomingHealBuff` or the `turnCtx` published from it. The correction: a
 * published ctx is only as fresh as its actor's last turn, so every CROSS-ACTOR reader re-reads
 * the enemy-applied half live through `triggers.ts`'s `liveHealChannelPct` (section 7).
 *
 * The tests below drive the structurally different arms:
 *
 * (The numbers below are the SECTION banners that divide this file, not `it` ordinals — each
 * section runs one `it` per side arm.)
 *
 *   - the SELF arm (`incomingPctFor`'s `rid === actor.id` branch) — section 5;
 *   - the OTHER-RECIPIENT arm (`engine.ts`'s `recipientIncomingHealPct`), which itself has two
 *     halves: the published-ctx half and the PRE-FIRST-TURN fallback half — section 3/4;
 *   - the OUTGOING channel (`Out. Repair Down II` on the HEALER) — section 6;
 *   - and, once a published ctx is involved at all, whether it is FRESH — section 7.
 *
 * Sections 8 and 9 are a different kind of test: TRIPWIRES for the §3.4 zero-floor, at the CAST
 * consumption sites and at the REACTIVE one respectively. Both reach a combination the corpus
 * cannot (a synthetic second reducer) and both state their own departure from the differential
 * convention below, because a claim whose value is 0 has no ratio to take.
 *
 * ⚠️ THE DOUBLE-COUNT TRAP, and why section 3/4's two tests differ by ONE number. The victim's
 * published `turnCtx` already contains the enemy-applied term, so a cross-actor reader that simply
 * ADDED it again would make -50% read as -100% and zero the repair outright. What the reader does
 * instead is subtract the ctx's own published enemy-applied portion and re-add a live one (see
 * section 7 for why the live re-read is necessary), which cancels exactly when the two agree.
 * Section 3/4's two tests are the SAME fixture with only `medicSpeed` changed (700 → 300), which
 * is exactly what moves the repair from before the victim's first turn to after it. The 700 test
 * fails if the pre-first-turn arm carries no term; the 300 test fails if the subtraction is
 * missing.
 *
 * ── Harness ───────────────────────────────────────────────────────────────────────────────────
 * Copied from `reversedRepairs.channels.test.ts` — the same three roles on either side, the same
 * real `runCombat`, the same `application: 'apply'` status cast so the landing roll cannot explain
 * a result. Two additions:
 *
 *   - `parsedEffects` on the cast status, so a run can inflict a status that really carries
 *     `incomingHeal` percentage points instead of an inert marker;
 *   - `__testTapStatusEngine`, so every test can assert the status ACTUALLY LANDED in the
 *     per-victim enemy store before it asserts anything about an amount. A green heal-amount
 *     assertion proves nothing if the debuff never applied.
 *
 * Every behavioural claim is DIFFERENTIAL: the same fixture runs with the payload and with an
 * inert-marker control, and the assertion is on the RATIO. A nominal assertion would pass just as
 * happily on a fixture whose repair was zero all along.
 *
 * NO RNG SEEDING, exactly as the file this harness comes from: `crit: 0` removes the crit stream
 * rather than fixing it, and `application: 'apply'` skips the landing roll — so both arms of every
 * comparison are deterministic without a keyed provider (which is keyed per `ownerId` and would
 * hand the two SIDE arms different draws).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';
import type { Position } from '../../../types/encounters';

/** A control run plants an unmodelled status name carrying NO effects through the identical cast
 *  path, so every comparison isolates the `incomingHeal` payload and nothing else about the run —
 *  not the cast, not the landing roll, not the turn order. */
const CONTROL = 'Inert Marker';

const FOCUS_ID = 'attacker';
const VICTIM_ID = 'victim';
/** Non-focus ids for the two roles; whichever of them is the focus answers to FOCUS_ID instead. */
const MEDIC_ID = 'medic';
const ZOSIMOS_ID = 'zosimos';

const MEDIC_HP = 100_000;
const VICTIM_MAX_HP = 100_000;
const ZOSIMOS_HP = 10_000_000; // large enough that nothing in these fixtures kills it

/** The repair, as a % of a 100,000-HP basis — so its magnitude is arithmetic, not a golden. */
const REPAIR_PCT = 10;
const RAW = (MEDIC_HP * REPAIR_PCT) / 100; // 10,000
/** Start the victim at half HP so a 10,000 repair never clips the overheal clamp (50k + 10k). */
const START_HP = VICTIM_MAX_HP / 2;

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Ability factories ─────────────────────────────────────────────────────────────────────────

/** Zosimos's shape: a plain on-cast enemy debuff, landing through the per-victim
 *  `applyTimedAbilityStatus` seam (`playerTurn.ts`, `writeState`). `application: 'apply'` always
 *  lands, isolating the behaviour under test from the hacking-vs-security landing roll. */
const castStatus = (
    buffName: string,
    parsedEffects: ParsedBuffEffects = {},
    duration = 5
): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects,
        stacks: 1,
        isStackable: false,
        duration,
        application: 'apply',
    },
});

/** A cast repair aimed at an ALLY. `'lowest-hp-ally'` excludes the caster and is footprint-exempt,
 *  so on a two-actor side it resolves to the victim with no positional coupling at all. Routes
 *  through `incomingPctFor`'s NON-self arm → the engine's `recipientIncomingHealPct`. */
const allyRepair = (pct: number): Ability => ({
    id: 'ab-ally-repair',
    type: 'heal',
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp', noCrit: true },
});

/** A cast repair aimed at the caster's WHOLE side, including itself. Fixture-only (no corpus heal
 *  carries this target) — its sole purpose is section 8's floor test, which needs a SECOND,
 *  undebuffed recipient in the SAME cast: `heal-performed`'s emit gate is `healRawSum > 0` for the
 *  WHOLE cast, so a single deeply-suppressed recipient's negative `raw` would sum to a negative
 *  total and the event would never fire at all — hiding the very corruption under test. The
 *  medic's own undebuffed share keeps the cast's sum positive so the event fires and
 *  `perTarget` exposes the victim's entry on its own. Both roles' `pattern: 'Pattern-Base'` is a
 *  non-`support` pattern, so `supportFootprintAllyIds` narrows nothing here — `'all-allies'`
 *  reaches the caster's whole side unfiltered. */
const allAlliesRepair = (pct: number): Ability => ({
    id: 'ab-all-allies-repair',
    type: 'heal',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp', noCrit: true },
});

/** A cast repair aimed at the CASTER. Routes through `incomingPctFor`'s `rid === actor.id` arm,
 *  which reads `dmgStats.totals` directly and never touches `recipientIncomingHealPct` — the arm
 *  an engine-only fix misses entirely. `basis: 'hp'` → 10% of the caster's own max HP. */
const selfRepair = (pct: number): Ability => ({
    id: 'ab-self-repair',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp', noCrit: true },
});

/** A SELF-side incoming-repair buff, granted from the victim's own PASSIVE slot so it is standing
 *  from combat start (`seedPassiveTimedStatuses`) rather than from the victim's first cast — the
 *  distinction matters, because a buff applied during a turn is not in that turn's own fold. */
const selfHealChannelBuff = (
    buffName: string,
    parsedEffects: { incomingHeal?: number; outgoingHeal?: number }
): Ability => ({
    id: `ab-self-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects,
        stacks: 1,
        isStackable: false,
        duration: 5,
    },
});
const selfIncomingBuff = (buffName: string, incomingHeal: number): Ability =>
    selfHealChannelBuff(buffName, { incomingHeal });

/** A REACTIVE (passive-slot) ally repair, fired from the round tail. The only way to observe
 *  OUTGOING-channel staleness: a CAST repair recomputes the caster's own totals at its own turn, so
 *  it can never be stale — only a reader of the owner's PUBLISHED ctx can be, and
 *  `triggers.ts`'s reactive-heal `ownerOutgoing` is the sole such reader in the engine.
 *  `basis: 'hp'` is not one of the reactive path's special bases, so it falls to the executor's
 *  default `ownerCtx?.effectiveMaxHp ?? owner.hp` — the medic's own max HP, i.e. the same RAW. */
const reactiveAllyRepair = (pct: number): Ability => ({
    id: 'ab-reactive-ally-repair',
    type: 'heal',
    target: 'lowest-hp-ally',
    trigger: 'end-of-round',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp', noCrit: true },
});

/** The reactive twin of `selfRepair`: a round-tail repair on its OWN owner. Routes through
 *  `triggers.ts`'s `incomingPctFor` `rid === intent.ownerId` branch — the third cross-actor-stale
 *  reader, and the one neither the engine's `recipientIncomingHealPct` nor `ownerOutgoing` covers. */
const reactiveSelfRepair = (pct: number): Ability => ({
    id: 'ab-reactive-self-repair',
    type: 'heal',
    target: 'self',
    trigger: 'end-of-round',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp', noCrit: true },
});

const activeSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities,
});
const passiveSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities,
});

// ── Roster builders ───────────────────────────────────────────────────────────────────────────

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself: normalizeTeamActorsToWalked
// synthesizes NEUTRAL_WALK_STATS with **hp: 1** for a team actor arriving without one, silently
// discarding a bare `stats.hp`.
interface RoleShape {
    id: string;
    position: Position;
    speed: number;
    hp: number;
    slots?: ShipSkills['slots'];
}

const walkedAlly = (args: RoleShape): TeamActorEngineInput => ({
    id: args.id,
    speed: args.speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: args.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: { slots: args.slots ?? [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 100_000,
            defence: 0,
            hp: args.hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const enemyShip = (args: RoleShape): EnemyAttackerInput => ({
    id: args.id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: args.hp,
        speed: args.speed,
        hacking: 100_000,
    },
    chargeCount: 0,
    startCharged: false,
    position: args.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: args.slots ?? [] },
});

// ── The fixture ───────────────────────────────────────────────────────────────────────────────

interface FixtureOpts {
    /** Which side the VICTIM stands on. Both arms of every behavioural test. */
    victimSide: 'player' | 'enemy';
    /** The statuses Zosimos inflicts, in cast order, on whichever actor `debuffTarget` names. Each
     *  is a real cast through the per-victim enemy store; `incomingHeal` / `outgoingHeal`
     *  (percentage POINTS — -50 means -50%) are the payloads under test. */
    enemyStatuses: { name: string; incomingHeal?: number; outgoingHeal?: number }[];
    /** Which actor Zosimos's `front` targeting binds to. `'victim'` (the default) puts the victim
     *  at the front-most cell; `'medic'` swaps the two positions so the debuff lands on the REPAIR
     *  SOURCE instead — the only way to exercise the OUTGOING channel, which belongs to the healer
     *  rather than to the recipient. */
    debuffTarget?: 'victim' | 'medic';
    /** A self-side incoming-repair buff on the victim's own passive slot (section 2's R1 fixture uses
     *  `Inc. Repair Up II` here), standing from combat start. */
    victimSelfBuff?: { name: string; incomingHeal: number };
    /** #396: the same idea on the MEDIC's own passive slot, for the OUTGOING channel — the only
     *  way to put one named family in BOTH stores for the healer rather than the recipient. */
    medicSelfBuff?: { name: string; outgoingHeal: number };
    /** The medic's own active-slot kit. Omitted → the medic does nothing (section 5, where the victim
     *  repairs itself). */
    medicAbilities?: Ability[];
    /** 300 (the default) puts the medic's repair AFTER the victim's own turn, so the victim's
     *  `turnCtx` is live in `lastTurnCtxByActor` — the double-count arm. 700 puts it BEFORE, so
     *  no ctx exists and only `recipientIncomingHealPct`'s fallback arm can carry the term. */
    medicSpeed?: number;
    /** The victim's own active-slot kit (section 5's self-repair). */
    victimAbilities?: Ability[];
    /** Zosimos's speed. 950 (the default) makes the APPLIER the fastest actor on the board, so the
     *  debuff is standing before anything else acts. A value BELOW the victim's 500 inverts that:
     *  the victim publishes its `turnCtx` BEFORE the debuff exists, so any CROSS-ACTOR reader that
     *  trusts that published total reads a STALE one. Section 7 is that ordering. */
    applierSpeed?: number;
    /** Reactive (passive-slot) abilities on the medic — section 7's outgoing-channel arm. */
    medicReactiveAbilities?: Ability[];
    /** Reactive (passive-slot) abilities on the VICTIM — section 7's self-repair arm, which routes
     *  through `triggers.ts`'s own `incomingPctFor` self branch rather than through the engine's
     *  `recipientIncomingHealPct`. */
    victimReactiveAbilities?: Ability[];
    /** Duration of every inflicted status, in turns. Default 5. `1` is the corpus's real
     *  short-lived shape (Larkspur's, Ripper's and Sha Xing's actives apply `Inc. Repair Down II` for ONE
     *  turn,
     *  Sansi's passive applies `III` for one turn) — a debuff that can expire having reduced
     *  nothing at all if the reduction is only visible from the victim's next turn onward. */
    duration?: number;
}

interface FixtureRun {
    /** Net HP the victim gained over the run (the repair, less nothing — no attacks in any of
     *  these fixtures). Negative would mean HP was lost, which nothing here can cause. */
    healedAmount: number;
    /** The buff names actually standing in the victim's PER-VICTIM ENEMY store when the run ends.
     *  Read off the LIVE status engine, which is the exact store the fix folds from — so this is a
     *  direct existence check on the thing under test, not a proxy for it. */
    victimDebuffNames: string[];
    /** The buff names standing in the victim's own SELF store (section 2's `Inc. Repair Up II`). */
    victimSelfBuffNames: string[];
    medicSelfBuffNames: string[];
    /** The buff names standing in the MEDIC's per-victim enemy store — the existence check for the
     *  OUTGOING-channel test, where the debuff is on the healer rather than on the recipient. */
    medicDebuffNames: string[];
    /** Every `heal-performed` event this run emitted (section 8's floor test only — every other
     *  section reads `healedAmount` and never taps the bus). `amount`/`perTarget[].amount` are the
     *  REPORTED numbers `incomingHealFactor` protects: `applyHealToTarget` already floors HP on
     *  both its paths, so a bug here would be invisible on `healedAmount` and visible ONLY here. */
    healPerfs: Extract<CombatEvent, { type: 'heal-performed' }>[];
    /** The engine's healing report, when the run produced one. Section 9's floor test is the only
     *  reader: the reactive executor's `directHeal` credit is booked from the pre-apply RAW and is
     *  UNGATED, which makes it the one place an unclamped negative factor is observable — the
     *  `reactive-heal-performed` emit is gated on `healSum > 0` and simply does not fire in either
     *  state, and HP is floored by `applyHealToTarget` on both its paths. */
    healing: ReturnType<typeof runCombat>['healing'];
}

/**
 * One run. Both side arms build the SAME three roles with the same speeds, positions and stats —
 * only which side they stand on changes — so the two arms' deltas are directly comparable.
 *
 * Speeds: Zosimos 950 (always first, so the status is standing before anything repairs), victim
 * 500, medic 300 or 700 (see `medicSpeed`).
 *
 * Positions: whichever of the victim and the medic `debuffTarget` names stands at M4, the
 * front-most cell, so Zosimos's `front` targeting binds to it; the other stands at M1. By default
 * that is the victim.
 */
function runFixture(opts: FixtureOpts): FixtureRun {
    const medicSpeed = opts.medicSpeed ?? 300;

    const applierSpeed = opts.applierSpeed ?? 950;
    const zosimosSlots: ShipSkills['slots'] = [
        activeSlot(
            opts.enemyStatuses.map((s) =>
                castStatus(
                    s.name,
                    {
                        ...(s.incomingHeal === undefined ? {} : { incomingHeal: s.incomingHeal }),
                        ...(s.outgoingHeal === undefined ? {} : { outgoingHeal: s.outgoingHeal }),
                    },
                    opts.duration
                )
            )
        ),
    ];
    const medicPassiveAbilities: Ability[] = [
        ...(opts.medicReactiveAbilities ?? []),
        ...(opts.medicSelfBuff
            ? [
                  selfHealChannelBuff(opts.medicSelfBuff.name, {
                      outgoingHeal: opts.medicSelfBuff.outgoingHeal,
                  }),
              ]
            : []),
    ];
    const medicSlots: ShipSkills['slots'] = [
        activeSlot(opts.medicAbilities ?? []),
        ...(medicPassiveAbilities.length > 0 ? [passiveSlot(medicPassiveAbilities)] : []),
    ];

    // `front` binds to the FRONT-MOST cell (M4), so swapping the two positions is what decides
    // which of them Zosimos's debuff lands on.
    const onMedic = opts.debuffTarget === 'medic';
    const victimPosition: Position = onMedic ? 'M1' : 'M4';
    const medicPosition: Position = onMedic ? 'M4' : 'M1';

    // ONE passive slot, holding BOTH passive-sourced options — a real ship has exactly one, and
    // the engine's slot consumers are SPLIT on how they read it:
    //   - most iterate every slot (`for (const slot of …slots)`): combat-start status seeding
    //     (`engine.ts`'s `seedPassiveTimedStatuses`) and reactive registration, which is what
    //     `victimSelfBuff` and `victimReactiveAbilities` respectively go through;
    //   - two take only the FIRST match (`slots.find((s) => s.slot === 'passive')`):
    //     `playerTurn.ts`'s `passiveSkill` — the self-modifier fold, heal-amplification and the
    //     modifier/gating ability lists — and `engine.ts`'s all-allies modifier auras.
    // So this is HARDENING, not a live-bug fix, and the honest scope matters: MEASURED, by running
    // section 9 (the only test that sets both) against the previous two-spread version — both arms
    // pass identically, because neither of today's two options is read through a `find`. What the
    // merge removes is the trap for the NEXT passive-sourced option: a `modifier`- or
    // `heal-amplification`-typed ability added as a third spread would land in a second
    // `slot: 'passive'` entry and be silently dropped, with the fixture reporting a clean green.
    const victimPassiveAbilities: Ability[] = [
        ...(opts.victimReactiveAbilities ?? []),
        ...(opts.victimSelfBuff
            ? [selfIncomingBuff(opts.victimSelfBuff.name, opts.victimSelfBuff.incomingHeal)]
            : []),
    ];
    const victimShape: RoleShape = {
        id: VICTIM_ID,
        position: victimPosition,
        speed: 500,
        hp: VICTIM_MAX_HP,
        slots: [
            ...(opts.victimAbilities ? [activeSlot(opts.victimAbilities)] : []),
            ...(victimPassiveAbilities.length > 0 ? [passiveSlot(victimPassiveAbilities)] : []),
        ],
    };

    let victim: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        victim = actors.find((a) => a.id === VICTIM_ID);
        if (victim) victim.currentHp = START_HP;
    };
    let statusEngine: StatusEngine | undefined;
    const bus = createEventBus();
    const healPerfs: Extract<CombatEvent, { type: 'heal-performed' }>[] = [];
    bus.on('heal-performed', (e) => healPerfs.push(e));

    const common = {
        numRounds: 1,
        bus,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        defensePenetration: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        // The anchor is the FOCUS, never the victim — so nothing below can be an artefact of the
        // victim happening to be the reported heal target.
        healTargetId: FOCUS_ID,
        mode: 'healing' as const,
        // Turns on per-recipient APPLICATION: without it a repair aimed at a non-anchor ally never
        // reaches `applyHealToTarget` at all and every amount below would be zero.
        perRecipientHealApply: true,
        hacking: 100_000,
        __testTapActors: seed,
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
    };

    const input: CombatEngineInput =
        opts.victimSide === 'player'
            ? // PLAYER-side victim: the focus is the MEDIC, Zosimos is the lone enemy.
              {
                  ...common,
                  attack: 0,
                  crit: 0,
                  critDamage: 0,
                  defence: 0,
                  hp: MEDIC_HP,
                  speed: medicSpeed,
                  position: medicPosition,
                  chargeCount: 0,
                  target: parseTarget('front'),
                  pattern: parsePattern('Pattern-Base'),
                  shipSkills: { slots: medicSlots },
                  teamActors: [walkedAlly(victimShape)],
                  enemyAttackers: [
                      enemyShip({
                          id: ZOSIMOS_ID,
                          position: 'M1',
                          speed: applierSpeed,
                          hp: ZOSIMOS_HP,
                          slots: zosimosSlots,
                      }),
                  ],
              }
            : // ENEMY-side victim: the focus is ZOSIMOS, and the medic + victim are both enemies.
              {
                  ...common,
                  attack: 0,
                  crit: 0,
                  critDamage: 0,
                  defence: 0,
                  hp: ZOSIMOS_HP,
                  speed: applierSpeed,
                  position: 'M1',
                  chargeCount: 0,
                  target: parseTarget('front'),
                  pattern: parsePattern('Pattern-Base'),
                  shipSkills: { slots: zosimosSlots },
                  teamActors: [],
                  enemyAttackers: [
                      enemyShip(victimShape),
                      enemyShip({
                          id: MEDIC_ID,
                          position: medicPosition,
                          speed: medicSpeed,
                          hp: MEDIC_HP,
                          slots: medicSlots,
                      }),
                  ],
              };

    const result = runCombat(input);

    const medicId = opts.victimSide === 'player' ? FOCUS_ID : MEDIC_ID;
    return {
        healing: result.healing,
        healedAmount: victim!.currentHp - START_HP,
        medicDebuffNames: statusEngine!
            .timedAbilityStatuses('enemy', undefined, medicId)
            .map((s) => s.payload.buffName),
        victimDebuffNames: statusEngine!
            .timedAbilityStatuses('enemy', undefined, VICTIM_ID)
            .map((s) => s.payload.buffName),
        healPerfs,
        victimSelfBuffNames: statusEngine!
            .timedAbilityStatuses('self', VICTIM_ID)
            .map((s) => s.payload.buffName),
        medicSelfBuffNames: statusEngine!
            .timedAbilityStatuses('self', medicId)
            .map((s) => s.payload.buffName),
    };
}

const SIDES = ['player', 'enemy'] as const;

/** The inert-marker twin of a run: the identical fixture with the payload stripped from every
 *  inflicted status, so the ratio isolates `incomingHeal` and nothing else. */
const control = (opts: Omit<FixtureOpts, 'enemyStatuses'>): FixtureRun =>
    runFixture({ ...opts, enemyStatuses: [{ name: CONTROL }] });

// ══ 1 — THE CORE #367 FIX ════════════════════════════════════════════════════════════════════

describe('#367 — an enemy-applied Inc. Repair Down reduces the repairs landing on its victim', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: Inc. Repair Down II halves an ally repair`, () => {
            const shared = { victimSide, medicAbilities: [allyRepair(REPAIR_PCT)] };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            // EXISTENCE FIRST. A green amount assertion proves nothing if the debuff never
            // landed — and this reads the very store the fix folds from.
            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(baseline.victimDebuffNames).toEqual([CONTROL]);

            // The channel is LIVE in this fixture: the un-debuffed repair really lands for RAW.
            expect(baseline.healedAmount).toBe(RAW);
            // …and -50% takes exactly half of it. DIFFERENTIAL, so a fixture whose repair was
            // zero all along could not pass.
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });

        // The magnitude is not hard-coded to one tier: the fold is a plain sum of percentage
        // points, so all three corpus tiers must scale linearly off the SAME baseline.
        it(`${victimSide}-side victim: all three tiers scale by their own percentage points`, () => {
            const shared = { victimSide, medicAbilities: [allyRepair(REPAIR_PCT)] };
            const baseline = control(shared);
            // LIVENESS, and it is load-bearing: every assertion in the loop is a RATIO off this
            // one figure, so a fixture that drifted to a zero repair would pass all three tiers as
            // `0 ≈ 0`. Pinning the baseline nominally is what stops that.
            expect(baseline.healedAmount).toBe(RAW);
            for (const [name, pct, factor] of [
                ['Inc. Repair Down I', -25, 0.75],
                ['Inc. Repair Down II', -50, 0.5],
                ['Inc. Repair Down III', -75, 0.25],
            ] as const) {
                const run = runFixture({
                    ...shared,
                    enemyStatuses: [{ name, incomingHeal: pct }],
                });
                expect(run.victimDebuffNames).toContain(name);
                expect(run.healedAmount).toBeCloseTo(baseline.healedAmount * factor, 5);
            }
        });
    }
});

// ══ 2 — R1's EXACT RULED SCENARIO ════════════════════════════════════════════════════════════
// LOCKED game rule R1: non-stackable statuses sharing a name family overwrite each other by
// HIGHEST TIER; the survivors then combine ADDITIVELY. `Inc. Repair Up` and `Inc. Repair Down` are
// DIFFERENT families (`deriveFamilyKey` strips the roman suffix, leaving 'Inc. Repair Up' vs
// 'Inc. Repair Down'), so the Up survives alongside the Down — but Down I is shadowed by Down II
// within its own family. +50 - 50 + 0 = 0 → a FULL repair.
//
// Nothing in the fix implements tier logic: `applyTimedAbilityStatus` already did the shadowing
// before the fold runs. This test is what proves that inheritance is real rather than assumed —
// if Down I were also summed, the total would be -25 and the repair would land at 75%.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#367 R1 — Up II (self) + Down II + Down I (enemy) nets to a full repair', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: the shadowed Down I contributes nothing, and +50/-50 cancels`, () => {
            const shared = {
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                victimSelfBuff: { name: 'Inc. Repair Up II', incomingHeal: 50 },
            };
            const run = runFixture({
                ...shared,
                enemyStatuses: [
                    { name: 'Inc. Repair Down II', incomingHeal: -50 },
                    { name: 'Inc. Repair Down I', incomingHeal: -25 },
                ],
            });
            const baseline = control(shared);

            // EXISTENCE, on both sides of the sum. The Up II must really be standing (otherwise
            // "full repair" would just mean the Down did nothing), and Down II must really be
            // standing (otherwise "full repair" would mean nothing landed at all).
            expect(run.victimSelfBuffNames).toContain('Inc. Repair Up II');
            expect(run.victimDebuffNames).toContain('Inc. Repair Down II');
            // R1's shadowing, inherited from the status engine: Down I is NOT in the store.
            expect(run.victimDebuffNames).not.toContain('Inc. Repair Down I');

            // The baseline carries the same +50 self buff, so it repairs for 1.5 × RAW — which is
            // what makes this a real measurement of the SUM rather than of the Down alone.
            expect(baseline.healedAmount).toBeCloseTo(RAW * 1.5, 5);
            // +50 - 50 = 0 → exactly RAW. Not `baseline`: the point is that the Down cancels the
            // Up back to the un-buffed figure.
            expect(run.healedAmount).toBeCloseTo(RAW, 5);
        });
    }
});

// ══ 3 & 4 — THE TWO HALVES OF `recipientIncomingHealPct` ═════════════════════════════════════
// The SAME fixture, differing only in `medicSpeed`. 700 → the medic repairs at speed 700, between
// Zosimos (950) and the victim (500), so the repair lands BEFORE the victim's first turn and
// `lastTurnCtxByActor` holds nothing for it. 300 → the medic repairs last, so the ctx is live.
//
// This arm is not a formality: 7 of the 8 corpus `Inc. Repair Down` appliers inflict it from a
// DAMAGE clause, which can land in round 1 before the victim has taken a turn — exactly this
// window. (8, not 9: 9 ships carry one of the two Repair Down families, but Nayra's is the
// OUTGOING one. The eighth incoming applier, Sansi, inflicts reactively, on being hit.)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#367 — both halves of recipientIncomingHealPct', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: applies to a repair landing BEFORE the victim's first turn`, () => {
            const shared = {
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                medicSpeed: 700,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            // The repair really happened in this ordering (the pre-first-turn window is not one in
            // which the medic silently does nothing).
            expect(baseline.healedAmount).toBe(RAW);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });

        it(`${victimSide}-side victim: does NOT double-count once the victim has a turn ctx`, () => {
            const shared = {
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                medicSpeed: 300,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(baseline.healedAmount).toBe(RAW);
            // -50%, not -100%. The explicit `> 0` is the double-count fence: folding the term into
            // BOTH the published ctx and the engine's read would zero the repair outright, and a
            // bare ratio assertion against 0.5 would then fail with a much less legible message.
            expect(withDebuff.healedAmount).toBeGreaterThan(0);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });
    }
});

// ══ 5 — THE SELF ARM ════════════════════════════════════════════════════════════════════════
// A ship repairing ITSELF resolves through `incomingPctFor`'s `rid === actor.id` branch, which
// reads `dmgStats.totals.incomingHealBuff` directly and never calls `recipientIncomingHealPct`.
// An engine-only fix (patching just `recipientIncomingHealPct`) misses this channel entirely,
// which is why it gets its own test rather than being folded into test 1.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#367 — the SELF arm: a ship repairing itself under an enemy-applied Inc. Repair Down', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: its own self-repair is halved`, () => {
            const shared = { victimSide, victimAbilities: [selfRepair(REPAIR_PCT)] };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            // The self-repair channel is LIVE: 10% of the victim's own 100,000 max HP.
            expect(baseline.healedAmount).toBe(RAW);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });
    }
});

// ══ 6 — THE OUTGOING CHANNEL ════════════════════════════════════════════════════════════════
// The same fold carries `outgoingHealPct`, because `victimOwnEnemyHealModifiers` returns both
// channels and both land in the same layer-1 totals. That is NOT a dormant line: `Out. Repair
// Down II` ('-50% Outgoing Repair') is a real corpus status — Nayra inflicts it from a passive and
// Ruiner from its charged skill — and `buffParser` resolves its description to
// `outgoingHeal: -50`. So wiring the second line changes production behaviour today, and this test
// exists so that change is pinned rather than shipped untested.
//
// The distinguishing feature: the debuff sits on the REPAIR SOURCE, not on the recipient. So this
// arm also fences the two channels apart — an implementation that folded `incomingHealPct` into
// both totals would pass every test above and fail this one.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#367 — the OUTGOING channel: Out. Repair Down II on the healer', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: halves what the debuffed MEDIC repairs`, () => {
            const shared = {
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                debuffTarget: 'medic' as const,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Out. Repair Down II', outgoingHeal: -50 }],
            });
            const baseline = control(shared);

            // EXISTENCE, and on the RIGHT actor: the debuff is on the MEDIC's store, and the
            // victim's store carries nothing — so a result here cannot be the incoming channel
            // leaking in.
            expect(withDebuff.medicDebuffNames).toContain('Out. Repair Down II');
            expect(withDebuff.victimDebuffNames).toEqual([]);

            expect(baseline.healedAmount).toBe(RAW);
            expect(withDebuff.healedAmount).toBeGreaterThan(0);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });

        // The direction check: `Out. Repair Down` belongs to the ship PERFORMING the repair, not
        // to the one receiving it. It fences the fold against one that read `outgoingHealPct` off
        // the RECIPIENT's own enemy store instead of the healer's.
        //
        // That bug breaks this test and the one directly above SYMMETRICALLY, and the probe run
        // confirmed it: swapping the fold to read off `rid` reddens both, on both side arms. The
        // reason is that each fixture is the other's mirror — here the debuff sits on the victim,
        // so a recipient-store read finds it and wrongly halves; above it sits on the medic, so a
        // recipient-store read finds an EMPTY store and wrongly fails to halve. Neither test alone
        // distinguishes "reads the right store" from "reads the store this fixture happens to have
        // populated"; the PAIR does, which is why the pair exists.
        //
        // (An earlier version of this comment claimed the bug would slip past every other test in
        // the file. That was false — the probe output in the task report disproves it. Left
        // recorded because the file's whole method is that a claim about what a test catches is
        // itself a claim that has to be measured.)
        it(`${victimSide}-side victim: placed on the RECIPIENT instead of the healer, does nothing`, () => {
            const shared = {
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                debuffTarget: 'victim' as const,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Out. Repair Down II', outgoingHeal: -50 }],
            });
            const baseline = control(shared);

            // EXISTENCE, and on the RIGHT actor: the debuff really landed on the VICTIM's store
            // (this fixture deliberately misplaces it there) and the MEDIC's store carries
            // nothing — the mirror image of the existence check in the test above.
            expect(withDebuff.victimDebuffNames).toContain('Out. Repair Down II');
            expect(withDebuff.medicDebuffNames).toEqual([]);

            // LIVENESS: the un-debuffed repair really lands for RAW, so "no reduction" below is
            // distinguishable from "no repair happened at all".
            expect(baseline.healedAmount).toBe(RAW);
            // Misplaced on the recipient, the debuff changes nothing: the repair still lands at
            // the full baseline amount, not half of it.
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount, 5);
        });
    }
});

// ══ 7 — THE SLOWER-APPLIER ORDERING (the published ctx is STALE) ═════════════════════════════
// Sections 1-6 all put the applier FIRST (Zosimos at speed 950), so every victim's published
// `turnCtx` already contained the debuff. That is the easy half of the board. Invert the order and
// a second defect appears:
//
//   `lastTurnCtxByActor` is written ONLY at an actor's own turn. So a cross-actor reader of a
//   victim's `incomingHealPct` — `engine.ts`'s `recipientIncomingHealPct`, `triggers.ts`'s
//   reactive-heal `ownerOutgoing`/`incomingPctFor` — reads that victim's LAST TURN's folded total.
//   When the applier is SLOWER than the victim, the debuff lands AFTER the victim's turn, so a
//   repair later in the same round reads a ctx that predates the debuff and the reduction is
//   invisible.
//
// That is not a corner case: `Inc. Repair Down II` is applied for ONE turn by Larkspur's,
// Ripper's and Sha Xing's actives and `III` for one turn by Sansi's passive, so against a faster victim such a
// debuff could expire having reduced exactly nothing.
//
// THE FIX, and why these tests can tell it apart from the double-count bug: `playerTurn` publishes
// the enemy-applied portion SEPARATELY (`enemyAppliedIncomingHealPct` /
// `enemyAppliedOutgoingHealPct`) from the same values the fold consumed, so a cross-actor reader
// subtracts that stale portion back out and re-adds a LIVE `victimOwnEnemyHealModifiers` read. The
// subtraction cancels by construction. Section 3/4's "does NOT double-count" test is the guard on
// the other side of that arithmetic: with a FASTER applier the stale and live values are equal, so
// the de-staling must be a no-op there and the repair must still land at exactly -50%, never -100%.
//
// Ordering in both tests below: Zosimos is the SLOWEST actor at 400, under the victim's 500.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#367 — a SLOWER applier still reduces a repair landing later in the same round', () => {
    for (const victimSide of SIDES) {
        // Turn order: victim (500) → Zosimos (400, applies the debuff) → medic (300, repairs).
        // The victim's ctx was published one turn BEFORE the debuff existed.
        it(`${victimSide}-side victim: INCOMING — a 1-turn Inc. Repair Down II applied after the victim's turn`, () => {
            const shared = {
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                medicSpeed: 300,
                applierSpeed: 400,
                duration: 1,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            // EXISTENCE FIRST, on the live store: the 1-turn debuff really is standing when the
            // medic repairs. (Read at run end; a duration that expired before the repair would
            // show up here as an empty store, not as a silently green ratio.)
            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(baseline.victimDebuffNames).toEqual([CONTROL]);
            // The channel is live in THIS ordering too — the medic really does repair for RAW when
            // nothing reduces it, so a reduced figure below is a reduction and not a missing cast.
            expect(baseline.healedAmount).toBe(RAW);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });

        // Turn order: medic (700, publishes its ctx) → victim (500) → Zosimos (400, applies
        // `Out. Repair Down II` to the MEDIC) → round tail → the medic's reactive repair fires.
        // The medic casts nothing on its own turn, so the ONLY repair in the run is the reactive
        // one, and it reads the medic's ctx from before the debuff landed.
        it(`${victimSide}-side victim: OUTGOING — Out. Repair Down II applied after the healer's turn`, () => {
            const shared = {
                victimSide,
                medicReactiveAbilities: [reactiveAllyRepair(REPAIR_PCT)],
                medicSpeed: 700,
                applierSpeed: 400,
                debuffTarget: 'medic' as const,
                duration: 1,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Out. Repair Down II', outgoingHeal: -50 }],
            });
            const baseline = control(shared);

            // EXISTENCE, and on the RIGHT actor: the debuff is on the HEALER's store and the
            // recipient's store is empty, so nothing here can be the incoming channel leaking in.
            expect(withDebuff.medicDebuffNames).toContain('Out. Repair Down II');
            expect(withDebuff.victimDebuffNames).toEqual([]);
            expect(baseline.healedAmount).toBe(RAW);
            expect(withDebuff.healedAmount).toBeGreaterThan(0);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });

        // Turn order: victim (500, publishes its ctx) → Zosimos (400, applies the debuff) → round
        // tail → the victim's own reactive self-repair fires. The reader here is `triggers.ts`'s
        // `incomingPctFor` SELF branch, not the engine's `recipientIncomingHealPct` — so this is
        // the one of the three de-staled readers the two tests above cannot reach.
        it(`${victimSide}-side victim: INCOMING, reactive SELF-repair — the owner's own ctx is stale too`, () => {
            const shared = {
                victimSide,
                victimReactiveAbilities: [reactiveSelfRepair(REPAIR_PCT)],
                applierSpeed: 400,
                duration: 1,
            };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(baseline.healedAmount).toBe(RAW);
            expect(withDebuff.healedAmount).toBeGreaterThan(0);
            expect(withDebuff.healedAmount).toBeCloseTo(baseline.healedAmount * 0.5, 5);
        });
    }
});

// ══ 8 — THE FACTOR IS FLOORED AT ZERO (#367 §3.4) ═══════════════════════════════════════════
// A TRIPWIRE, not a live bug: under the locked tier rule (R1, section 2 above — same-family
// statuses overwrite by highest tier, survivors add) only ONE `Inc. Repair Down` can ever stand
// on a victim, so the worst reachable value TODAY is -75% (`Inc. Repair Down III`). This section
// stacks a SECOND, synthetic reducer — a self-side debuff no corpus ship carries alongside
// `Inc. Repair Down III` — on top of it, deliberately reaching a combination the corpus cannot
// reach yet (-50 self + -75 enemy = -125%). This is the guard for whoever adds the next
// incoming-repair reducer, not evidence of a bug reachable today.
//
// Why `medicAbilities: [allAlliesRepair(...)]` instead of the usual `allyRepair`/`selfRepair`:
// `heal-performed`'s emit gate is `healRawSum > 0` for the WHOLE cast (playerTurn.ts), so a
// single-recipient cast whose one and only `raw` goes negative sums to a negative total and the
// event never fires — HP stays safe either way (`applyHealToTarget` floors it), so nothing
// would distinguish a floored repair from an unclamped negative one from OUTSIDE the engine.
// `'all-allies'` heals the medic too (undebuffed, full RAW), which keeps the cast's sum positive
// so the event actually fires and `perTarget` exposes the victim's entry — carrying the RAW
// per-recipient amount BEFORE it is folded into any masking sum — on its own.
//
// AND WHY THIS SECTION ALONE SKIPS THE FILE'S DIFFERENTIAL-AGAINST-AN-INERT-CONTROL CONVENTION
// (header, "Every behavioural claim is DIFFERENTIAL"): that convention exists because a NOMINAL
// assertion would pass on a fixture whose repair was zero all along. Here zero IS the claim — the
// floor makes the victim's repair exactly 0, an absolute floor rather than a ratio, so there is no
// RATIO to take. (A control arm is constructible — a no-reducer run repairs > 0 — so the honest
// claim is that the ratio is impossible, not the control.) Non-vacuity is carried instead by the two
// existence assertions (both reducers really landed) plus `healPerfs.length > 0` — the cast really
// emitted, which it can only do because the medic's own undebuffed share kept the sum positive.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#367 §3.4 — the incoming-repair factor is floored at zero', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: a fold below -100% reports a repair of 0, never negative`, () => {
            const run = runFixture({
                victimSide,
                medicAbilities: [allAlliesRepair(REPAIR_PCT)],
                victimSelfBuff: { name: 'FixtureRepairDown', incomingHeal: -50 },
                enemyStatuses: [{ name: 'Inc. Repair Down III', incomingHeal: -75 }],
            });

            // EXISTENCE: both reducers actually landed (-50 self, -75 enemy = -125% summed).
            expect(run.victimDebuffNames).toContain('Inc. Repair Down III');
            expect(run.victimSelfBuffNames).toContain('FixtureRepairDown');

            // HP was already safe pre-fix (applyHealToTarget floors both of its paths) — a
            // baseline, not the evidence this test exists to add.
            expect(run.healedAmount).toBe(0);

            // The evidence: the cast really emitted (proving the medic's own undebuffed share
            // kept the sum positive — a `healPerfs.length === 0` here would mean this fixture
            // regressed to the un-observable single-recipient case, not that the bug was fixed),
            // and NOTHING reported anywhere in it is negative — the amount an unclamped factor
            // would have corrupted (`healRawSum`, `heal-performed.amount`/`perTarget[].amount`,
            // and any `overheal` carried on it).
            expect(run.healPerfs.length).toBeGreaterThan(0);
            for (const perf of run.healPerfs) {
                expect(perf.amount).toBeGreaterThanOrEqual(0);
                if (perf.overheal !== undefined) expect(perf.overheal).toBeGreaterThanOrEqual(0);
                for (const t of perf.perTarget ?? []) {
                    expect(t.amount).toBeGreaterThanOrEqual(0);
                }
            }

            // The precise claim, not just "non-negative": the victim's own suppressed share
            // floors to EXACTLY 0 (a fully-suppressed repair is 0, never damage — Reversed
            // Repairs, #362, is the only sanctioned repair-to-damage channel, and it is an
            // explicit status, not a sign accident).
            const victimEntry = run.healPerfs
                .flatMap((p) => p.perTarget ?? [])
                .find((t) => t.targetId === VICTIM_ID);
            expect(victimEntry?.amount).toBe(0);
        });
    }
});

// ══ 9 — THE REACTIVE SITE IS FLOORED TOO (#367 final review) ════════════════════════════════
// Section 8 fences the floor at the CAST sites. It could not fence the fourth consumption site:
// `triggers.ts`'s reactive-heal executor computed `(1 + incomingPctFor(rid) / 100)` by hand, and
// the helper's own doc scoped itself to "this file's three sites" — an INCOMPLETE tripwire rather
// than a false one. #367 is what made the omission matter: routing `incomingPctFor` through
// `liveHealChannelPct` (section 7) means this site can see an ENEMY-APPLIED reduction for the first
// time, so the branch widened what can reach an unclamped factor while clamping elsewhere.
//
// SAME SYNTHETIC COMBINATION as section 8 (-50 self + -75 enemy = -125%), and the same disclaimer:
// unreachable in the corpus today under the tier rule, so this is the guard for whoever adds the
// next reducer. Reaching it needs BOTH a reactive ability and a self-side reducer on the victim,
// which makes this the first test in the file to set both passive-sourced options at once — see
// `victimPassiveAbilities` in `runFixture` for why they now share ONE slot, and for the measurement
// showing this section behaves identically either way (both options go through slot consumers that
// iterate every slot; the merge guards the next option, which may not).
//
// WHAT IS OBSERVABLE HERE, and why it is not the channel section 8 used:
//   - HP is floored either way (`applyHealToTarget` floors both its paths), so `healedAmount`
//     cannot distinguish a floored repair from an unclamped negative one.
//   - `reactive-heal-performed` is gated on `healSum > 0` and fires in NEITHER state (0 and
//     negative both fail the gate), so the event cannot distinguish them either. (This is the same
//     masking section 8 had to route around with an `'all-allies'` cast; the reactive executor has
//     no such multi-recipient escape here, because the reaction is a SELF-repair.)
//   - the executor's `directHeal` credit IS booked from the pre-apply `raw`, per recipient, with no
//     gate at all — so an unclamped factor lands as a NEGATIVE `directHeal` on the reacting owner's
//     row in the healing report. That is the one reported number that moves, and it is the
//     assertion below. Measured: with the floor removed the row reads -2,500 on BOTH side arms.
//
// TEAM SYMMETRY: identical assertions on both arms. The reactive executor credits its owner's row
// regardless of side (it is not on the `healEventOnly` cast path), so the enemy arm is observable
// too — verified by its own control run, which shows the reaction really fires and is credited in
// full there. Each arm carries that control so a floored 0 can never be confused with a reaction
// that never happened: the file's differential convention, adapted to a claim whose value is 0
// (there is no RATIO to take against zero — the control supplies the non-vacuity instead).

describe('#367 final review — the reactive-heal site floors the incoming factor at zero', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: a fold below -100% credits 0 repair, never a negative one`, () => {
            const shared = {
                victimSide,
                victimReactiveAbilities: [reactiveSelfRepair(REPAIR_PCT)],
                victimSelfBuff: { name: 'FixtureRepairDown', incomingHeal: -50 },
                applierSpeed: 400,
            };
            const run = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down III', incomingHeal: -75 }],
            });
            const baseline = control(shared);

            // EXISTENCE FIRST: both reducers really landed, in the two separate stores the two
            // channels read — so the fold really did reach -125% and this is not a -75%-only run
            // dressed up as one. (Both land either way; see `victimPassiveAbilities` for why the
            // slots were merged regardless.)
            expect(run.victimDebuffNames).toContain('Inc. Repair Down III');
            expect(run.victimSelfBuffNames).toContain('FixtureRepairDown');
            // The control's enemy store carries ONLY the inert marker, so its own -50% self-side
            // reducer is the only thing reducing it.
            expect(baseline.victimDebuffNames).toEqual([CONTROL]);

            // NON-VACUITY: the reaction really fires on this side and is credited in full — the
            // control's gross is the RAW halved by its self-side -50% and nothing else. A fixture
            // whose reaction never ran would report 0 here and make every assertion below hollow.
            const baselineRow = baseline.healing!.rounds[0].perActor.get(VICTIM_ID);
            expect(baselineRow!.directHeal).toBeCloseTo(RAW * 0.5, 5);
            expect(baseline.healedAmount).toBeCloseTo(RAW * 0.5, 5);

            // HP was already safe pre-fix (`applyHealToTarget` floors both of its paths) — a
            // baseline, not the evidence this test exists to add.
            expect(run.healedAmount).toBe(0);

            // THE EVIDENCE: the reacting owner's reported gross repair floors to EXACTLY 0.
            // Unclamped it is -2,500 (RAW × (1 - 1.25)) — a negative repair on a healing report.
            const row = run.healing!.rounds[0].perActor.get(VICTIM_ID);
            expect(row!.directHeal).toBe(0);
            // …and nothing else on that row went negative either: the consumption split is built
            // from the same `raw`, so an unclamped factor corrupts all three together.
            expect(row!.effectiveHeal).toBeGreaterThanOrEqual(0);
            expect(row!.overheal).toBeGreaterThanOrEqual(0);
        });
    }
});

// ══ #396 — THE HEAL CHANNELS SHADOW ACROSS THE STORE BOUNDARY ════════════════════════════════
// #367 folded the enemy-applied half of these two channels as a plain SUM, justified in its jsdoc
// on the grounds that only one `Inc. Repair Down` can stand today. That is a REACHABILITY claim,
// and the locked rule is about ARITHMETIC: highest tier wins for all buffs and debuffs regardless
// of which side applied it (DoTs and bombs excepted). So the sum was wrong wherever both stores
// carry one family, whether or not the ship corpus gets there.
//
// AND IT IS REACHABLE — just not from ship kits. A probe over all 149 corpus ships found ZERO
// families granted from both a self-targeted and an enemy-targeted ability. The straddle comes
// from the manual pickers: `GameBuffPicker` excludes only `type: 'effect'`, so `Inc. Repair Down`
// is offered in the self-side picker AND the enemy-side ones. The fixture below builds it the
// equivalent way — a self-slot grant on the victim plus a real enemy cast — because a kit-driven
// fixture cannot produce a straddle and would be vacuously green.
//
// THREE FIGURES, MUTUALLY DISTINGUISHABLE. own -30, applied -50, sum -80 → the repair lands at
// 0.70 × RAW, 0.50 × RAW or 0.20 × RAW. No arm below can be satisfied by two rules at once.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#396 — Inc. Repair Down shadows across the self/enemy store boundary', () => {
    const OWN = -30;
    const APPLIED = -50;

    it('the three candidate outcomes are mutually distinguishable', () => {
        expect(new Set([OWN, APPLIED, OWN + APPLIED]).size).toBe(3);
    });

    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: the STRONGER applied instance wins — not the sum`, () => {
            const run = runFixture({
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                // Same FAMILY on the victim's own self store, weaker tier.
                victimSelfBuff: { name: 'Inc. Repair Down II', incomingHeal: OWN },
                enemyStatuses: [{ name: 'Inc. Repair Down III', incomingHeal: APPLIED }],
            });

            // EXISTENCE on both sides of the boundary, or the numbers below would be measuring an
            // absent status rather than a shadowed one.
            expect(run.victimSelfBuffNames).toContain('Inc. Repair Down II');
            expect(run.victimDebuffNames).toContain('Inc. Repair Down III');

            expect(run.healedAmount).toBeCloseTo(RAW * 0.5, 5); // the applied III
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.2, 5); // NOT the -80 sum
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.7, 5); // NOT the own II alone
        });

        it(`${victimSide}-side victim: the STRONGER own instance wins when the applied one is weaker`, () => {
            const run = runFixture({
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                victimSelfBuff: { name: 'Inc. Repair Down III', incomingHeal: APPLIED },
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: OWN }],
            });
            expect(run.victimSelfBuffNames).toContain('Inc. Repair Down III');
            expect(run.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(run.healedAmount).toBeCloseTo(RAW * 0.5, 5);
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.2, 5);
        });

        it(`${victimSide}-side victim: DIFFERENT families still ADD — the over-collapse guard`, () => {
            // `deriveFamilyKey` strips the Roman suffix, so `Inc. Repair Up` and `Inc. Repair Down`
            // are different families and nothing shadows: +50 - 50 = 0 → a full repair. This is
            // the arm that turns red if the family key is ever collapsed to a constant, and it is
            // section 2's R1 case restated against the new code path.
            const run = runFixture({
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                victimSelfBuff: { name: 'Inc. Repair Up II', incomingHeal: 50 },
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            expect(run.healedAmount).toBeCloseTo(RAW, 5);
        });

        it(`${victimSide}-side victim: a SLOWER applier is still shadowed, not double-counted`, () => {
            // #367's staleness fence (`liveHealChannelPct`) under #396's arithmetic. The applier
            // acts AFTER the victim publishes its ctx, so the cross-actor reader must subtract the
            // stale enemy portion and add today's — and both halves are now post-shadowing DELTAS.
            // Subtracting a raw sum while adding a delta (or the reverse) would leave the
            // difference behind and land this somewhere other than 0.50 × RAW.
            const run = runFixture({
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                medicSpeed: 300,
                applierSpeed: 400, // below the victim's 500 → the victim's ctx predates the debuff
                victimSelfBuff: { name: 'Inc. Repair Down II', incomingHeal: OWN },
                enemyStatuses: [{ name: 'Inc. Repair Down III', incomingHeal: APPLIED }],
            });
            expect(run.victimDebuffNames).toContain('Inc. Repair Down III');
            expect(run.healedAmount).toBeCloseTo(RAW * 0.5, 5);
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.2, 5);
        });
    }
});

// ══ #396 — THE SAME RULE ON THE FOLD PATH, NOT ONLY THE CROSS-ACTOR ONE ══════════════════════
// MEASURED, and the reason this section exists: the six arms above are satisfied by
// `liveHealChannelPct` ALONE. Reverting `runPlayerTurn`'s fold to a plain sum leaves all six
// GREEN, because the cross-actor reader subtracts the (then-raw) stale portion and adds its own
// shadowed live one, which lands on the right answer by a different route. That makes those arms
// a real test of the cross-actor half and a VACUOUS test of the fold half.
//
// These two arms read the fold's own output instead:
//   • a SELF-repair — the victim repairs itself on its own turn, off `dmgStats.totals` computed
//     fresh that turn, never through `lastTurnCtxByActor`;
//   • the OUTGOING channel — a CAST repair recomputes the caster's totals at its own turn, which
//     is exactly why #367's own outgoing-staleness note says only a reader of a PUBLISHED ctx can
//     be stale.
// Both turn red when the fold is reverted, and neither depends on `liveHealChannelPct`.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('#396 — the turn fold itself shadows, independently of the cross-actor reader', () => {
    const OWN = -30;
    const APPLIED = -50;

    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: a SELF-repair reads the shadowed incoming total`, () => {
            const run = runFixture({
                victimSide,
                victimAbilities: [selfRepair(REPAIR_PCT)],
                victimSelfBuff: { name: 'Inc. Repair Down II', incomingHeal: OWN },
                enemyStatuses: [{ name: 'Inc. Repair Down III', incomingHeal: APPLIED }],
            });
            expect(run.victimSelfBuffNames).toContain('Inc. Repair Down II');
            expect(run.victimDebuffNames).toContain('Inc. Repair Down III');

            expect(run.healedAmount).toBeCloseTo(RAW * 0.5, 5); // the applied III
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.2, 5); // NOT the -80 sum
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.7, 5); // NOT the own II alone
        });

        it(`${victimSide}-side victim: a CAST repair reads the shadowed OUTGOING total`, () => {
            // `Out. Repair Down` belongs to the ship PERFORMING the repair, so both instances sit
            // on the medic: one in its own self store, one applied by Zosimos. `debuffTarget:
            // 'medic'` is what puts the enemy cast on the healer rather than the recipient.
            const run = runFixture({
                victimSide,
                medicAbilities: [allyRepair(REPAIR_PCT)],
                debuffTarget: 'medic',
                medicSelfBuff: { name: 'Out. Repair Down II', outgoingHeal: OWN },
                enemyStatuses: [{ name: 'Out. Repair Down III', outgoingHeal: APPLIED }],
            });
            // EXISTENCE on both sides of the boundary, on the RIGHT actor — and the victim's own
            // store stays empty, so nothing here can be the incoming channel leaking in.
            expect(run.medicSelfBuffNames).toContain('Out. Repair Down II');
            expect(run.medicDebuffNames).toContain('Out. Repair Down III');
            expect(run.victimDebuffNames).toEqual([]);

            expect(run.healedAmount).toBeCloseTo(RAW * 0.5, 5);
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.2, 5);
            expect(run.healedAmount).not.toBeCloseTo(RAW * 0.7, 5);
        });
    }
});
