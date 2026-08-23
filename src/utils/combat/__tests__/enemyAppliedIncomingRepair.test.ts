/**
 * #367 — an ENEMY-APPLIED `Inc. Repair Down` must actually reduce the repairs landing on its
 * victim.
 *
 * ── THE BUG THIS FILE PINS ────────────────────────────────────────────────────────────────────
 * `incomingHealBuff` is summed only from an actor's OWN self-side statuses (`foldActorBuffTotals`
 * / `effectiveDamageStatsOf` — scheduled self-buffs + timed SELF ability statuses + `preFight`).
 * An enemy-inflicted debuff lands in the PER-VICTIM ENEMY store, which no incoming-heal fold read.
 * So `Inc. Repair Down I/II/III` — documented as -25/-50/-75% incoming repair, and inflicted by 9
 * corpus ships — reduced nothing at all. `reversedRepairs.engine.test.ts`'s R6 block records this
 * as a known pre-existing limitation and routes around it via `preFight`; this file is the fix.
 *
 * The fix is ONE fold: `engine.ts`'s `buildTurnArgs` computes the victim's own enemy-applied heal
 * modifiers (`victimOwnEnemyHealModifiers`) per turn and hands them to `runPlayerTurn`, which folds
 * them into `scheduledTotals` right beside `preFight`. That single fold reaches every incoming-heal
 * reader, because they all read `dmgStats.totals.incomingHealBuff` or the `turnCtx` published from
 * it. The tests below drive the two structurally different arms:
 *
 *   - the SELF arm (`incomingPctFor`'s `rid === actor.id` branch) — test 5;
 *   - the OTHER-RECIPIENT arm (`engine.ts`'s `recipientIncomingHealPct`), which itself has two
 *     halves: the published-ctx half (test 4) and the PRE-FIRST-TURN fallback half (test 3).
 *
 * ⚠️ THE DOUBLE-COUNT TRAP, and why tests 3 and 4 differ by ONE number. Once the term is inside
 * the victim's published `turnCtx`, adding it again in `recipientIncomingHealPct` would make -50%
 * read as -100% and zero the repair outright. So the term belongs ONLY on that function's
 * pre-first-turn fallback arm. Tests 3 and 4 are the SAME fixture with only `medicSpeed` changed
 * (700 → 300), which is exactly what moves the repair from before the victim's first turn to after
 * it. Test 3 fails if the fallback arm is missing; test 4 fails if the term is added
 * unconditionally.
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
const castStatus = (buffName: string, parsedEffects: ParsedBuffEffects = {}): Ability => ({
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
        duration: 5,
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
const selfIncomingBuff = (buffName: string, incomingHeal: number): Ability => ({
    id: `ab-self-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: { incomingHeal },
        stacks: 1,
        isStackable: false,
        duration: 5,
    },
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

const enemyShip = (args: RoleShape): EnemyAttackerInput =>
    ({
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
    }) as EnemyAttackerInput;

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
    /** A self-side incoming-repair buff on the victim's own passive slot (test 2's `Inc. Repair
     *  Up II`), standing from combat start. */
    victimSelfBuff?: { name: string; incomingHeal: number };
    /** The medic's own active-slot kit. Omitted → the medic does nothing (test 5, where the victim
     *  repairs itself). */
    medicAbilities?: Ability[];
    /** 300 (the default) puts the medic's repair AFTER the victim's own turn, so the victim's
     *  `turnCtx` is live in `lastTurnCtxByActor` — the double-count arm. 700 puts it BEFORE, so
     *  no ctx exists and only `recipientIncomingHealPct`'s fallback arm can carry the term. */
    medicSpeed?: number;
    /** The victim's own active-slot kit (test 5's self-repair). */
    victimAbilities?: Ability[];
}

interface FixtureRun {
    /** Net HP the victim gained over the run (the repair, less nothing — no attacks in any of
     *  these fixtures). Negative would mean HP was lost, which nothing here can cause. */
    healedAmount: number;
    /** The buff names actually standing in the victim's PER-VICTIM ENEMY store when the run ends.
     *  Read off the LIVE status engine, which is the exact store the fix folds from — so this is a
     *  direct existence check on the thing under test, not a proxy for it. */
    victimDebuffNames: string[];
    /** The buff names standing in the victim's own SELF store (test 2's `Inc. Repair Up II`). */
    victimSelfBuffNames: string[];
    /** The buff names standing in the MEDIC's per-victim enemy store — the existence check for the
     *  OUTGOING-channel test, where the debuff is on the healer rather than on the recipient. */
    medicDebuffNames: string[];
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

    const zosimosSlots: ShipSkills['slots'] = [
        activeSlot(
            opts.enemyStatuses.map((s) =>
                castStatus(s.name, {
                    ...(s.incomingHeal === undefined ? {} : { incomingHeal: s.incomingHeal }),
                    ...(s.outgoingHeal === undefined ? {} : { outgoingHeal: s.outgoingHeal }),
                })
            )
        ),
    ];
    const medicAbilities = opts.medicAbilities ?? [];

    // `front` binds to the FRONT-MOST cell (M4), so swapping the two positions is what decides
    // which of them Zosimos's debuff lands on.
    const onMedic = opts.debuffTarget === 'medic';
    const victimPosition: Position = onMedic ? 'M1' : 'M4';
    const medicPosition: Position = onMedic ? 'M4' : 'M1';

    const victimShape: RoleShape = {
        id: VICTIM_ID,
        position: victimPosition,
        speed: 500,
        hp: VICTIM_MAX_HP,
        slots: [
            ...(opts.victimAbilities ? [activeSlot(opts.victimAbilities)] : []),
            ...(opts.victimSelfBuff
                ? [
                      passiveSlot([
                          selfIncomingBuff(
                              opts.victimSelfBuff.name,
                              opts.victimSelfBuff.incomingHeal
                          ),
                      ]),
                  ]
                : []),
        ],
    };

    let victim: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        victim = actors.find((a) => a.id === VICTIM_ID);
        if (victim) victim.currentHp = START_HP;
    };
    let statusEngine: StatusEngine | undefined;

    const common = {
        numRounds: 1,
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
                  shipSkills: { slots: [activeSlot(medicAbilities)] },
                  teamActors: [walkedAlly(victimShape)],
                  enemyAttackers: [
                      enemyShip({
                          id: ZOSIMOS_ID,
                          position: 'M1',
                          speed: 950,
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
                  speed: 950,
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
                          slots: [activeSlot(medicAbilities)],
                      }),
                  ],
              };

    runCombat(input);

    const medicId = opts.victimSide === 'player' ? FOCUS_ID : MEDIC_ID;
    return {
        healedAmount: victim!.currentHp - START_HP,
        medicDebuffNames: statusEngine!
            .timedAbilityStatuses('enemy', undefined, medicId)
            .map((s) => s.payload.buffName),
        victimDebuffNames: statusEngine!
            .timedAbilityStatuses('enemy', undefined, VICTIM_ID)
            .map((s) => s.payload.buffName),
        victimSelfBuffNames: statusEngine!
            .timedAbilityStatuses('self', VICTIM_ID)
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
// This arm is not a formality: 7 of the 9 corpus appliers inflict `Inc. Repair Down` from a DAMAGE
// clause, which can land in round 1 before the victim has taken a turn — exactly this window.
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
    }
});
