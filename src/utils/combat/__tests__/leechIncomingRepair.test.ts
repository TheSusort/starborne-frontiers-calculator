/**
 * #367 (task 7) — the INCOMING-REPAIR channel must reach a LEECH self-repair.
 *
 * ── THE RULING ────────────────────────────────────────────────────────────────────────────────
 * Asked of the owner on 2026-08-23: "Round 2. Your Iridium has a passive that repairs it for a
 * share of the damage it deals — say 2,000 off a 10,000-damage hit. Enemy Larkspur has already hit
 * it with `Inc. Repair Down II` (−50% incoming repair). How much does Iridium's leech repair it
 * for?" — **Ruled: 1,000, halved like any repair.** A leech self-repair IS a repair, so
 * incoming-repair modifiers apply to it, in BOTH directions: an `Inc. Repair Up` of +50% raises
 * the same 2,000 to 3,000.
 *
 * ── THE BUG THIS FILE PINS ────────────────────────────────────────────────────────────────────
 * Both engine leech procs folded `healModifier` and a heal-crit draw and NOTHING else. The
 * recipient's incoming-repair percentage — the channel `Inc. Repair Down/Up` lives on, which #367
 * had already routed into the cast, HoT and reactive paths — was simply not read there. So a
 * `-50%` debuff standing on a leeching ship changed its leech by 0%.
 *
 * The fix folds `incomingHealFactor(recipientIncomingHealPct(rid))` into each proc's per-recipient
 * raw. `recipientIncomingHealPct` is `engine.ts`'s existing wrapper over `triggers.ts`'s
 * `liveHealChannelPct` — the ONE resolution path #367 consolidated (stale enemy-applied portion of
 * the published ctx subtracted, a live read re-added), reused rather than re-derived.
 * `incomingHealFactor` (`buffTotals.ts`) floors the multiplier at 0 so a fully-suppressed leech
 * lands at 0 and never flips sign.
 *
 * ── WHICH SITES THIS FILE COVERS, AND WHICH IT CANNOT ─────────────────────────────────────────
 * The engine has FOUR leech heal-apply sites. This file drives the two PER-VICTIM ones, on both
 * sides of the board:
 *   - `procStandingLeechesPerVictim` — the damage-DEALT leech (sections 1-3, and 6);
 *   - `procTakenLeechesPerVictim` — the damage-TAKEN leech (sections 4-5, and 6).
 * Section 6 is the FRESHNESS axis, which cuts across both: which ctx each proc's SELF-side half of
 * the channel is read from. It is also where the two procs legitimately DIFFER — read its header.
 * The other two — the aggregate `procStandingLeeches` and the non-positional heal-target
 * taken-leech block — are the pair #368 measured as executed by ZERO tests in the whole corpus,
 * and they are deliberately NOT changed: see the reachability notes at each site in `engine.ts`.
 *
 * ── Harness ───────────────────────────────────────────────────────────────────────────────────
 * Copied from `reversedRepairs.channels.test.ts` (whose R2-channel-3 / R5-reaction-3 tests are the
 * proof that these two procs are reachable at all), with the two additions
 * `enemyAppliedIncomingRepair.test.ts` needed for this channel:
 *
 *   - `parsedEffects` on the cast status, so a run can inflict a status that really carries
 *     `incomingHeal` percentage points instead of an inert marker;
 *   - `__testTapStatusEngine`, so every test asserts the debuff ACTUALLY LANDED in the per-victim
 *     enemy store before it asserts anything about an amount. A green amount proves nothing if the
 *     status never applied.
 *
 * Every behavioural claim is DIFFERENTIAL against a control that travels the identical path with
 * the PAYLOAD stripped — an inert-marker cast in sections 1-5, the same self-granted status name
 * with empty `parsedEffects` in section 6 — and every one asserts the control's leech is NON-ZERO
 * first, otherwise "reduced to nothing" and "never leeched at all" are the same green.
 *
 * THREE ROLES, identical on both side arms — only which side they stand on changes:
 *   - ZOSIMOS  applies the status (a plain on-cast `target: 'enemy'` debuff) and also attacks in
 *              the damage-TAKEN sections and wherever a `victimSelfGrant` is set (that grant rides
 *              `on-attacked`, so something has to hit the leecher). Speed 950, so it always acts
 *              first and both the status and the grant are standing before the leech fires.
 *   - VICTIM   the LEECHING ship. Speed 500, at M4 so Zosimos's `front` targeting binds to it.
 *   - MEDIC    an inert bystander that exists only to be the healing ANCHOR, so nothing here can
 *              be an artefact of the leecher happening to be the heal target. It has no kit.
 *
 * NO RNG SEEDING, exactly as both source files: `crit: 0` removes the crit stream rather than
 * fixing it and `application: 'apply'` skips the landing roll, so both arms of every comparison
 * are deterministic without a keyed provider (which is keyed per `ownerId` and would hand the two
 * SIDE arms different draws).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    runCombat,
    __getAggregateStandingLeechApplications,
    __resetAggregateStandingLeechApplications,
    type CombatEngineInput,
    type TeamActorEngineInput,
} from '../engine';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';
import type { Position } from '../../../types/encounters';
import type { PreFightCombatModifiers } from '../preFight/types';
import { emptyPreFightModifiers } from '../preFight/types';

/** A control run plants an unmodelled status name carrying NO effects through the identical cast
 *  path, so every comparison isolates the `incomingHeal` payload and nothing else about the run —
 *  not the cast, not the landing roll, not the turn order. */
const CONTROL = 'Inert Marker';
const REVERSED = 'Reversed Repairs';

const FOCUS_ID = 'attacker';
const VICTIM_ID = 'victim';
/** Non-focus ids for the two roles; whichever of them is the focus answers to FOCUS_ID instead. */
const MEDIC_ID = 'medic';
const ZOSIMOS_ID = 'zosimos';

const MEDIC_HP = 1_000_000;
const VICTIM_MAX_HP = 1_000_000;
const ZOSIMOS_HP = 10_000_000; // large enough that the victim's own attacks never kill it

/** The leecher starts at half HP so no leech in this file ever clips the over-repair clamp. */
const START_HP = VICTIM_MAX_HP / 2;
/** Every attack in this file: attack stat × 100% multiplier × 1 hit vs defence 0. */
const ATTACK = 20_000;
/** Both leech flavours repair 50% of that, so the un-modified leech is exactly 10,000. */
const LEECH_PCT = 50;
const LEECH_RAW = (ATTACK * LEECH_PCT) / 100;

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Ability factories ─────────────────────────────────────────────────────────────────────────

/** Zosimos's shape: a plain on-cast enemy debuff, landing through the per-victim
 *  `applyTimedAbilityStatus` seam. `application: 'apply'` always lands, isolating the behaviour
 *  under test from the hacking-vs-security landing roll. */
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

/** A standing damage-DEALT leech ("repair X% of damage dealt"), passive slot, self — the shape the
 *  ruling is about. Procs through the engine's `procStandingLeechesPerVictim`. */
const standingLeech = (pct: number): Ability => ({
    id: 'ab-standing-leech',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all', noCrit: true },
});

/** A damage-TAKEN leech ("when damaged, repair X% of the damage"), passive slot, self. The engine's
 *  attack block owns it, so the trigger is `on-cast`, not `on-attacked`. Procs through
 *  `procTakenLeechesPerVictim`. */
const takenLeech = (pct: number): Ability => ({
    id: 'ab-taken-leech',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'damage-taken', noCrit: true },
});

/** A SELF-side `Inc. Repair Up` the leecher grants ITSELF. The STATUS is the corpus's (Meatshield's
 *  active: "This Unit gains Inc. Repair Up III for 2 turns"); the ability SHAPE is not — it is an
 *  `on-attacked` reactive grant with `oncePerCombat`, for one reason only: an on-cast grant
 *  RE-APPLIES every round (a same-tier re-cast whose duration outlasts the remaining window wins),
 *  and the turn-after-expiry arm needs a status that actually runs out. Read section 6's header
 *  before treating this as a re-enactment of Meatshield — it cannot be, since Meatshield deals no
 *  damage and so never leeches. What is genuinely under test either way is the leecher's OWN
 *  `dmgStats.totals.incomingHealBuff`, published into its `turnCtx.incomingHealPct`. */
const selfGrant = (
    buffName: string,
    duration: number,
    parsedEffects: ParsedBuffEffects = {}
): Ability => ({
    id: `self-grant-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects,
        stacks: 1,
        isStackable: false,
        duration,
        oncePerCombat: true,
    },
});

const basicAttack = (): Ability => ({
    id: 'basic-attack',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

const activeSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities,
});
const passiveSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities,
});

/** The SELF-side arm of the channel, as a pre-fight modifier block. `preFight.incomingHeal` is the
 *  one self-side source `liveHealChannelPct` reads without ANY published ctx, so it is visible in
 *  every round including the first — which is why the one-round sections below use it.
 *
 *  ⚠️ THE PARAGRAPH THAT STOOD HERE IS SUPERSEDED, and its residual is CLOSED. It said a
 *  status-seeded `Inc. Repair Up` "would NOT work in a one-round fixture" because the leech read
 *  the leecher's PREVIOUS turn's ctx (measured then as 10,000 / 15,000 / 15,000 over three rounds).
 *  That was a real defect, not a property of the channel, and the #367 fix wave fixed it: the leech
 *  now reads the ACTING turn's own ctx, so a status-seeded Up lands in round 1 too. Section 6 owns
 *  that claim, with its own three-round measurement. `preFightIncoming` is kept for sections 2 and
 *  4 because it is the shortest vehicle for a one-round fixture, not because it is the only one. */
const preFightIncoming = (incomingHeal: number): PreFightCombatModifiers => ({
    ...emptyPreFightModifiers(),
    incomingHeal,
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
    attack?: number;
    slots?: ShipSkills['slots'];
    preFight?: PreFightCombatModifiers;
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
    ...(args.preFight ? { preFight: args.preFight } : {}),
    walk: {
        shipSkills: { slots: args.slots ?? [] },
        stats: {
            attack: args.attack ?? 0,
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
            attack: args.attack ?? 0,
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
        ...(args.preFight ? { preFight: args.preFight } : {}),
    }) as EnemyAttackerInput;

// ── The fixture ───────────────────────────────────────────────────────────────────────────────

interface FixtureOpts {
    /** Which side the LEECHER stands on. Both arms of every behavioural test. */
    victimSide: 'player' | 'enemy';
    /** The statuses Zosimos inflicts on the leecher, in cast order. `incomingHeal` is percentage
     *  POINTS (-50 means -50%). */
    enemyStatuses: { name: string; incomingHeal?: number }[];
    /** `'dealt'` gives the leecher an attack plus a damage-DEALT leech (it repairs off its own
     *  hit). `'taken'` gives it a damage-TAKEN leech and makes ZOSIMOS the attacker. */
    leechKind: 'dealt' | 'taken';
    /** The leecher's own pre-fight modifier block — the self-side arm of the channel. */
    victimPreFight?: PreFightCombatModifiers;
    /** Rounds to simulate. Default 1; only the FRESHNESS section (6) runs more, because the gap it
     *  covers is per-round by construction. */
    numRounds?: number;
    /** A self-granted status on the leecher (see `selfGrant`). Its presence also gives ZOSIMOS an
     *  attack in the `'dealt'` mode, since the grant rides `on-attacked`. */
    victimSelfGrant?: { name: string; duration: number; incomingHeal?: number };
}

interface FixtureRun {
    /** The leecher's LIVE final HP (the actor objects the tap hands out are the real ones). */
    victimHp: number;
    /** The leecher's total gross repair credit for round 1 — the bucket the leech books its raw
     *  into. Read instead of HP wherever the same fixture also puts damage ON the leecher (the
     *  damage-TAKEN sections), where an HP delta mixes the two. */
    victimDirectHeal: number;
    /** The buff names actually standing in the leecher's PER-VICTIM ENEMY store when the run ends.
     *  Read off the LIVE status engine — the exact store `victimOwnEnemyHealModifiers` folds from,
     *  so this is a direct existence check on the thing under test, not a proxy for it. */
    victimDebuffNames: string[];
    /** The leecher's `preFight.incomingHeal` as the ENGINE sees it on the live actor — the
     *  existence check for the self-side sections, which have no status to look up. */
    victimPreFightIncomingHeal: number;
    /** The leecher's gross repair credit PER ROUND (index 0 = round 1). Same bucket as
     *  `victimDirectHeal`, which is this array's first element. */
    victimDirectHealByRound: number[];
    /** The buff names standing in the leecher's OWN SELF store when the run ends — the store
     *  `dmgStats.totals.incomingHealBuff` folds from, i.e. a direct existence check on the
     *  self-side arm of the channel (and, when read after a longer run, on its EXPIRY). */
    victimSelfBuffNames: string[];
}

/**
 * One run. Both side arms build the SAME three roles with the same speeds, positions and stats —
 * only which side they stand on changes — so the two arms' deltas are directly comparable.
 *
 * Speeds: Zosimos 950 (always first, so the status is standing before anything leeches), the
 * leecher 500, the medic 300 (inert, and last).
 */
function runFixture(opts: FixtureOpts): FixtureRun {
    // The self-grant rides `on-attacked`, so Zosimos has to actually swing for it to fire — in the
    // `'dealt'` mode too, where it otherwise carries no attack at all.
    const zosimosAttack =
        opts.leechKind === 'taken' || opts.victimSelfGrant !== undefined ? ATTACK : 0;
    const zosimosSlots: ShipSkills['slots'] = [
        activeSlot([
            // The status FIRST, the attack second: clause order is the game rule (a debuff written
            // after a damage clause misses that cast), and the damage-TAKEN sections need the
            // reduction standing before the hit it leeches off.
            ...opts.enemyStatuses.map((s) =>
                castStatus(
                    s.name,
                    s.incomingHeal === undefined ? {} : { incomingHeal: s.incomingHeal }
                )
            ),
            ...(zosimosAttack > 0 ? [basicAttack()] : []),
        ]),
    ];

    const grant = opts.victimSelfGrant;
    const victimPassives: Ability[] = [
        opts.leechKind === 'dealt' ? standingLeech(LEECH_PCT) : takenLeech(LEECH_PCT),
        ...(grant
            ? [
                  selfGrant(
                      grant.name,
                      grant.duration,
                      grant.incomingHeal === undefined ? {} : { incomingHeal: grant.incomingHeal }
                  ),
              ]
            : []),
    ];

    const victimShape: RoleShape = {
        id: VICTIM_ID,
        position: 'M4',
        speed: 500,
        hp: VICTIM_MAX_HP,
        attack: opts.leechKind === 'dealt' ? ATTACK : 0,
        slots:
            opts.leechKind === 'dealt'
                ? [activeSlot([basicAttack()]), passiveSlot(victimPassives)]
                : [passiveSlot(victimPassives)],
        ...(opts.victimPreFight ? { preFight: opts.victimPreFight } : {}),
    };

    let victim: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        victim = actors.find((a) => a.id === VICTIM_ID);
        if (victim) victim.currentHp = START_HP;
    };
    let statusEngine: StatusEngine | undefined;

    const common = {
        numRounds: opts.numRounds ?? 1,
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
        // The anchor is the FOCUS, never the leecher — so nothing below can be an artefact of the
        // leecher happening to be the reported heal target.
        healTargetId: FOCUS_ID,
        mode: 'healing' as const,
        perRecipientHealApply: true,
        hacking: 100_000,
        __testTapActors: seed,
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
    };

    const input: CombatEngineInput =
        opts.victimSide === 'player'
            ? // PLAYER-side leecher: the focus is the inert MEDIC, Zosimos is the lone enemy.
              {
                  ...common,
                  attack: 0,
                  crit: 0,
                  critDamage: 0,
                  defence: 0,
                  hp: MEDIC_HP,
                  speed: 300,
                  position: 'M1',
                  chargeCount: 0,
                  target: parseTarget('front'),
                  pattern: parsePattern('Pattern-Base'),
                  shipSkills: { slots: [] },
                  teamActors: [walkedAlly(victimShape)],
                  enemyAttackers: [
                      enemyShip({
                          id: ZOSIMOS_ID,
                          position: 'M1',
                          speed: 950,
                          hp: ZOSIMOS_HP,
                          attack: zosimosAttack,
                          slots: zosimosSlots,
                      }),
                  ],
              }
            : // ENEMY-side leecher: the focus is ZOSIMOS, and the medic + leecher are both enemies.
              {
                  ...common,
                  attack: zosimosAttack,
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
                          position: 'M1',
                          speed: 300,
                          hp: MEDIC_HP,
                      }),
                  ],
              };

    const result = runCombat(input);

    const byRound = result.healing!.rounds.map(
        (round) => round.perActor.get(VICTIM_ID)?.directHeal ?? 0
    );

    return {
        victimHp: victim!.currentHp,
        victimDirectHeal: byRound[0] ?? 0,
        victimDirectHealByRound: byRound,
        victimDebuffNames: statusEngine!
            .timedAbilityStatuses('enemy', undefined, VICTIM_ID)
            .map((s) => s.payload.buffName),
        victimSelfBuffNames: statusEngine!
            .timedAbilityStatuses('self', VICTIM_ID)
            .map((s) => s.payload.buffName),
        victimPreFightIncomingHeal: victim!.preFight?.incomingHeal ?? 0,
    };
}

const SIDES = ['player', 'enemy'] as const;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE AGGREGATE-PROC TRIPWIRE, EXTENDED TO THIS FILE (#367 fix wave).
//
// `engine.ts` carries a measured claim that the aggregate (`!positional`) half of the
// standing-leech fork is UNREACHABLE, and that the incoming-repair fold was therefore added only to
// the PER-VICTIM twin. Until now the executable half of that claim lived solely in `leech.test.ts`.
// This file is the one that owns the incoming-repair claim AT the per-victim procs, and it was
// fenced only IMPLICITLY — by its baselines happening to come out at their nominal values. That is
// not a fence: the aggregate arm folds no incoming-repair channel at all, so a fixture that
// silently routed through it would report an UNMODIFIED leech, which is exactly the pre-fix bug
// this file exists to catch. Asserting the counter makes the misroute fail here as itself.
//
// Vitest isolates modules per test FILE, so the counter reads only this file's runs.
// ─────────────────────────────────────────────────────────────────────────────────────────────
beforeAll(() => __resetAggregateStandingLeechApplications());
afterAll(() => {
    expect(__getAggregateStandingLeechApplications()).toBe(0);
});

/** The inert-marker twin of a run: the identical fixture with the payload stripped from every
 *  inflicted status, so the ratio isolates `incomingHeal` and nothing else. */
const control = (opts: Omit<FixtureOpts, 'enemyStatuses'>): FixtureRun =>
    runFixture({ ...opts, enemyStatuses: [{ name: CONTROL }] });

// ══ 1 — THE RULED SCENARIO: a Down halves a damage-DEALT leech ═══════════════════════════════

describe('a leech self-repair is reduced by an enemy-applied Inc. Repair Down', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side leecher: Inc. Repair Down II halves the damage-dealt leech`, () => {
            const shared = { victimSide, leechKind: 'dealt' as const };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            // EXISTENCE FIRST. A green amount assertion proves nothing if the debuff never landed
            // — and this reads the very store the fold consumes.
            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(baseline.victimDebuffNames).toEqual([CONTROL]);

            // LIVENESS: the un-debuffed leech really lands, for the full 50% of a 20,000 hit.
            // Without this a suppressed-to-nothing leech and a never-fired one are the same green.
            expect(baseline.victimHp - START_HP).toBe(LEECH_RAW);
            // …and -50% takes exactly half of it. DIFFERENTIAL off the baseline, so a fixture
            // whose leech was zero all along could not pass.
            expect(withDebuff.victimHp - START_HP).toBeCloseTo(
                (baseline.victimHp - START_HP) * 0.5,
                5
            );
        });

        // The magnitude is not hard-coded to one tier: the fold is a plain sum of percentage
        // points, so all three corpus tiers must scale linearly off the SAME baseline.
        it(`${victimSide}-side leecher: all three Down tiers scale the leech by their own points`, () => {
            const shared = { victimSide, leechKind: 'dealt' as const };
            const baseline = control(shared);
            // LOAD-BEARING: every assertion in the loop is a ratio off this one figure, so a
            // fixture that drifted to a zero leech would pass all three tiers as `0 ≈ 0`.
            expect(baseline.victimHp - START_HP).toBe(LEECH_RAW);
            for (const [name, pct, factor] of [
                ['Inc. Repair Down I', -25, 0.75],
                ['Inc. Repair Down II', -50, 0.5],
                ['Inc. Repair Down III', -75, 0.25],
            ] as const) {
                const run = runFixture({ ...shared, enemyStatuses: [{ name, incomingHeal: pct }] });
                expect(run.victimDebuffNames).toContain(name);
                expect(run.victimHp - START_HP).toBeCloseTo(LEECH_RAW * factor, 5);
            }
        });
    }
});

// ══ 2 — THE OTHER DIRECTION: an Up raises the same leech ══════════════════════════════════════
// The ruling is symmetric, so the fold must be too. This arm uses the SELF side of the channel
// rather than a second enemy cast carrying a positive payload, because `Inc. Repair Up` is a
// self-side status in the corpus — no ship INFLICTS one on an enemy.
//
// ⚠️ CORRECTED 2026-08-23. The claim that stood here — "NO ship in `docs/ship-skills.csv` grants
// `Inc. Repair Up` at all (0 occurrences)" — is FALSE. MEATSHIELD's active grants ITSELF
// `Inc. Repair Up III` for 2 turns ("This Unit gains <unit-skill>Inc. Repair Up III</unit-skill>
// for 2 turns"), and it is fully modelled: `src/constants/buffs.ts` gives that name
// "+75% Incoming Repair" and `buffParser.ts` maps `%\s*Incoming\s*Repair` → `parsedEffects
// .incomingHeal`. The repo already contradicted the sweep before it was written —
// `skillTextParser.ts`'s masking note lists `Inc. Repair Up III` among the corpus's nine
// repair-bearing status names.
//
// RE-SWEPT with an RFC-4180 CSV parser over all 149 data rows (not a fixed-width grep — one of
// those silently truncated a count earlier in this epic), scanning every skill-text column:
// exactly ONE `Inc. Repair Up` occurrence, Meatshield, `active_skill_text`; zero
// `Out. Repair Up`. Cross-checked against a raw `grep -o "Inc\. Repair Up [IV]*"`, which returns
// the same single `Inc. Repair Up III`.
//
// The corrected statement therefore has TWO parts, and the second is why the old one's conclusion
// survived being built on a false premise:
//   1. `Inc. Repair Up` DOES exist in the corpus, as a SELF-GRANTED status on Meatshield — which is
//      exactly the freshness channel section 6 covers, so it is not a footnote.
//   2. It still cannot reach a LEECHING ship. Meatshield has ZERO `damage` abilities on any slot
//      (measured through `buildShipAbilities`), so a Meatshield wearing the Leech gear set deals
//      nothing to leech off, and no ship grants an `Inc. Repair Up` to an ALLY. For a leecher the
//      Up therefore still arrives only through the calculator's buff picker, gear, or a pre-fight
//      modifier.
// All of those are self-side channels; the fold is one additive sum either way, and what matters
// here is that a positive total RAISES the leech instead of being ignored or clamped away.

describe('a leech self-repair is raised by an Inc. Repair Up on the leeching ship', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side leecher: +50% incoming repair raises the damage-dealt leech by half`, () => {
            const shared = {
                victimSide,
                leechKind: 'dealt' as const,
                enemyStatuses: [{ name: CONTROL }],
            };
            const withUp = runFixture({ ...shared, victimPreFight: preFightIncoming(50) });
            // The control carries the block too, at 0 — so the ONLY difference between the two
            // runs is the number in it, not whether the engine attached a block at all.
            const baseline = runFixture({ ...shared, victimPreFight: preFightIncoming(0) });

            // EXISTENCE, the self-side analogue: the engine really put the value on the actor.
            expect(withUp.victimPreFightIncomingHeal).toBe(50);
            expect(baseline.victimPreFightIncomingHeal).toBe(0);
            // Neither arm carries a payload status — the Up is the only live term.
            expect(withUp.victimDebuffNames).toEqual([CONTROL]);

            // LIVENESS, then the differential.
            expect(baseline.victimHp - START_HP).toBe(LEECH_RAW);
            expect(withUp.victimHp - START_HP).toBeCloseTo((baseline.victimHp - START_HP) * 1.5, 5);
        });
    }
});

// ══ 3 — THE FLOOR ════════════════════════════════════════════════════════════════════════════
// `incomingHealFactor` floors the multiplier at 0, so a leech suppressed past -100% lands at 0
// rather than turning into a repair-shaped damage event with a negative gross credit. Reached with
// a SYNTHETIC pair the corpus cannot produce (tier shadowing lets only one `Inc. Repair Down`
// stand, so -75% is the worst real total): two DIFFERENT families summing to -125%.
//
// This one is NOT differential on a ratio — a claim whose value is 0 has no ratio to take. The
// control arm is still run, and it is what makes the zero meaningful: the same fixture leeches
// LEECH_RAW without the pair.

describe('a leech suppressed past -100% lands at zero, not negative', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side leecher: -125% floors the leech at 0 and books no negative credit`, () => {
            const shared = { victimSide, leechKind: 'dealt' as const };
            const suppressed = runFixture({
                ...shared,
                enemyStatuses: [
                    { name: 'Inc. Repair Down III', incomingHeal: -75 },
                    { name: 'Synthetic Repair Down', incomingHeal: -50 },
                ],
            });
            const baseline = control(shared);

            expect(suppressed.victimDebuffNames).toEqual(
                expect.arrayContaining(['Inc. Repair Down III', 'Synthetic Repair Down'])
            );
            // The instrument fires: the same fixture leeches in full without the pair.
            expect(baseline.victimHp - START_HP).toBe(LEECH_RAW);
            expect(baseline.victimDirectHeal).toBe(LEECH_RAW);

            // No HP movement, and — the part an unfloored factor would corrupt — no NEGATIVE gross
            // repair credit. `applyHealToTarget` floors HP on both its paths, so the HP assertion
            // alone could not tell a floored 0 from a -2,500 that the clamp swallowed.
            expect(suppressed.victimHp).toBe(START_HP);
            expect(suppressed.victimDirectHeal).toBe(0);
        });
    }
});

// ══ 4 — THE SECOND SITE: a damage-TAKEN leech ════════════════════════════════════════════════
// "Repair X% of the damage taken" is a self-repair from a leech too, applied by a DIFFERENT proc
// (`procTakenLeechesPerVictim`), so it needs its own coverage — a site missed is the original bug
// surviving. Measured on the repair CREDIT rather than on HP: this fixture also lands 20,000 of
// damage on the leecher, so an HP delta mixes the two channels.

describe('a damage-TAKEN leech is reduced by an enemy-applied Inc. Repair Down', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side leecher: Inc. Repair Down II halves the damage-taken leech`, () => {
            const shared = { victimSide, leechKind: 'taken' as const };
            const withDebuff = runFixture({
                ...shared,
                enemyStatuses: [{ name: 'Inc. Repair Down II', incomingHeal: -50 }],
            });
            const baseline = control(shared);

            expect(withDebuff.victimDebuffNames).toContain('Inc. Repair Down II');
            expect(baseline.victimDebuffNames).toEqual([CONTROL]);

            // LIVENESS: the un-debuffed taken-leech really books its full 50% of the 20,000 hit.
            expect(baseline.victimDirectHeal).toBe(LEECH_RAW);
            expect(withDebuff.victimDirectHeal).toBeCloseTo(baseline.victimDirectHeal * 0.5, 5);
        });

        it(`${victimSide}-side leecher: +50% incoming repair raises the damage-taken leech by half`, () => {
            const shared = {
                victimSide,
                leechKind: 'taken' as const,
                enemyStatuses: [{ name: CONTROL }],
            };
            const withUp = runFixture({ ...shared, victimPreFight: preFightIncoming(50) });
            const baseline = runFixture({ ...shared, victimPreFight: preFightIncoming(0) });

            expect(withUp.victimPreFightIncomingHeal).toBe(50);
            expect(baseline.victimPreFightIncomingHeal).toBe(0);
            expect(baseline.victimDirectHeal).toBe(LEECH_RAW);
            expect(withUp.victimDirectHeal).toBeCloseTo(baseline.victimDirectHeal * 1.5, 5);
        });
    }
});

// ══ 5 — COMPOSITION WITH #362's REVERSED REPAIRS ═════════════════════════════════════════════
// #362 locked that a leech self-repair reverses into a raw HP burn, and R6 locked that
// `Inc. Repair Down` applies FIRST so the REDUCED amount is what reverses. That ordering is
// satisfied by POSITION — the fold added by this task sits above `applyHealToTarget`, and the
// reversal branch is inside it — but position is an argument, not a measurement. This section is
// the measurement. It changes no behaviour of #362 and asserts nothing about attribution.

describe('#362 composition — a reduced leech reverses for the REDUCED amount', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side leecher: the burn is halved along with the repair`, () => {
            const shared = { victimSide, leechKind: 'dealt' as const };
            const reducedAndReversed = runFixture({
                ...shared,
                enemyStatuses: [
                    { name: 'Inc. Repair Down II', incomingHeal: -50 },
                    { name: REVERSED },
                ],
            });
            const reversedOnly = runFixture({
                ...shared,
                enemyStatuses: [{ name: CONTROL }, { name: REVERSED }],
            });

            // Both statuses landed in the arm that needs both.
            expect(reducedAndReversed.victimDebuffNames).toEqual(
                expect.arrayContaining(['Inc. Repair Down II', REVERSED])
            );
            expect(reversedOnly.victimDebuffNames).toEqual(
                expect.arrayContaining([CONTROL, REVERSED])
            );

            // LIVENESS: the reversal really burns the full leech when nothing reduces it.
            expect(START_HP - reversedOnly.victimHp).toBe(LEECH_RAW);
            // …and the halved leech burns exactly half as much. Not the full amount — which is
            // what a fold applied BELOW the reversal, or not at all, would produce.
            expect(START_HP - reducedAndReversed.victimHp).toBeCloseTo(LEECH_RAW * 0.5, 5);
        });
    }
});

// ══ 6 — FRESHNESS: THE SELF-SIDE HALF COMES FROM THE ACTING TURN, NOT THE PREVIOUS ONE ═══════
// Sections 2 and 4 prove the Up direction with `preFight.incomingHeal`, which is visible in every
// round — so they could not see the gap this section covers. The SELF-side half of the channel
// otherwise arrives through the leecher's published `turnCtx`, and on the two PLAYER-side turn
// branches `lastTurnCtxByActor.set` sits BELOW the positional apply that procs the leech. So the
// leech used to read the leecher's PREVIOUS turn:
//
//   MEASURED, pre-fix, player-side damage-dealt leech, three rounds, self-granted +75%:
//     standing all fight   10,000 / 17,500 / 17,500   ← round 1 blind
//     granted for 2 turns  10,000 / 17,500 / 17,500   ← round 1 blind AND round 3 a PHANTOM
//   MEASURED, post-fix:
//     standing all fight   17,500 / 17,500 / 17,500
//     granted for 2 turns  17,500 / 17,500 / 10,000
//
// The ENEMY-side damage-dealt arm was already correct before the fix (that branch publishes its ctx
// ABOVE its positional apply) and is asserted here so the two sides are held to one profile — the
// point of the fix is that they no longer agree by accident of statement order.
//
// THE VEHICLE, AND WHAT IT IS AND IS NOT A MODEL OF. The status name and its +75% are the corpus's:
// Meatshield's active grants ITSELF `Inc. Repair Up III` for 2 turns, the only `Inc. Repair Up`
// anywhere in `docs/ship-skills.csv`, and `src/constants/buffs.ts` prices that name at +75%.
// The SHAPE here is synthetic, deliberately and on measured grounds:
//   - Meatshield itself can never exercise this. It has ZERO `damage` abilities on any slot, so a
//     Meatshield wearing the Leech gear set has nothing to leech off. No ship grants an
//     `Inc. Repair Up` to an ALLY either, so no shipped ship can hand one to a leecher. The
//     ROUND-1 arm below is the case a real user hits — through the buff picker, gear or a pre-fight
//     modifier, all permanent — and the EXPIRY arm is a tripwire for the first timed self-side Up
//     that ships, not a re-enactment of one that exists.
//   - `selfGrant` rides `on-attacked` + `oncePerCombat` so the status can actually RUN OUT: an
//     on-cast grant re-applies every round (a same-tier re-cast that outlasts the remaining window
//     wins), leaving no expiry to observe.
//
// THE TAKEN-LEECH ARM IS DELIBERATELY ASSERTED AS STILL STALE. Its recipient is the ship being
// ATTACKED, never the actor on turn, so the acting-turn ctx cannot reach it — and it is
// corpus-inert: the whole roster's `damage-taken` passive leeches are Malvex's and Quixilver's, and
// both are SHIELDS, which this fold never touches (measured: 149 CSV rows built through
// `buildShipAbilities` + `partitionReactiveAbilities`, zero `damage-taken` HEALs). Pinning the
// stale profile makes that a tripwire rather than an omission: the day a `damage-taken` heal ships,
// this test is what says the freshness question was never answered for that site.

/** Rounds 1..3 of the leecher's gross repair credit, for one self-grant duration. */
const threeRoundProfile = (
    victimSide: (typeof SIDES)[number],
    leechKind: 'dealt' | 'taken',
    duration: number,
    incomingHeal?: number
): FixtureRun =>
    runFixture({
        victimSide,
        leechKind,
        enemyStatuses: [{ name: CONTROL }],
        numRounds: 3,
        victimSelfGrant: {
            name: 'Inc. Repair Up III',
            duration,
            ...(incomingHeal === undefined ? {} : { incomingHeal }),
        },
    });

const UP_III = 'Inc. Repair Up III';
/** +75% incoming repair — `src/constants/buffs.ts`'s own description for this status name. */
const UP_III_PCT = 75;
const UP_III_RAW = LEECH_RAW * (1 + UP_III_PCT / 100);

describe('the self-side half of the channel is read from the ACTING turn', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side leecher: a self-granted Inc. Repair Up III raises the damage-dealt leech in ROUND 1`, () => {
            const withUp = threeRoundProfile(victimSide, 'dealt', 5, UP_III_PCT);
            // The control grants the SAME status name for the SAME duration with an EMPTY payload,
            // so the two runs differ only in the percentage points it carries — not in whether a
            // status was granted, nor in the extra attack the grant's `on-attacked` trigger needs.
            const baseline = threeRoundProfile(victimSide, 'dealt', 5);

            // EXISTENCE FIRST, on both arms: the status really is standing in the leecher's own
            // self store — the store `dmgStats.totals.incomingHealBuff` folds from — at the end of
            // the run, i.e. it stood for all three rounds (duration 5).
            expect(withUp.victimSelfBuffNames).toContain(UP_III);
            expect(baseline.victimSelfBuffNames).toContain(UP_III);

            // LIVENESS: the unmodified leech really lands its full 50% of a 20,000 hit, in EVERY
            // round — so a fixture that stopped leeching after round 1 could not pass below.
            expect(baseline.victimDirectHealByRound).toEqual([LEECH_RAW, LEECH_RAW, LEECH_RAW]);

            // THE CLAIM. Round 1 included — that is the element that was 10,000 before the fix.
            expect(withUp.victimDirectHealByRound).toEqual([UP_III_RAW, UP_III_RAW, UP_III_RAW]);
        });

        it(`${victimSide}-side leecher: the round after the Up expires is not a phantom`, () => {
            const expiring = threeRoundProfile(victimSide, 'dealt', 2, UP_III_PCT);
            const baseline = threeRoundProfile(victimSide, 'dealt', 2);
            // EXISTENCE, both ends of the status's life, read off the same store:
            //  - still standing when the run stops after ROUND 1. That is what this probe SHOWS;
            //    round 2's liveness is inferred from the 2-turn duration plus round 2's own
            //    amount, not measured here. A `numRounds: 2` probe would close the gap.
            const roundOneOnly = runFixture({
                victimSide,
                leechKind: 'dealt',
                enemyStatuses: [{ name: CONTROL }],
                numRounds: 1,
                victimSelfGrant: { name: UP_III, duration: 2, incomingHeal: UP_III_PCT },
            });
            expect(roundOneOnly.victimSelfBuffNames).toContain(UP_III);
            //  - and GONE by the end of round 3, which is what makes round 3's value a claim about
            //    an expired status rather than about a status nobody can see.
            expect(expiring.victimSelfBuffNames).not.toContain(UP_III);

            // LIVENESS: the control leeches its full amount in all three rounds.
            expect(baseline.victimDirectHealByRound).toEqual([LEECH_RAW, LEECH_RAW, LEECH_RAW]);

            // Raised while it stands, back to the plain leech the round after it expires. Pre-fix
            // this read [LEECH_RAW, UP_III_RAW, UP_III_RAW]: wrong at BOTH ends.
            expect(expiring.victimDirectHealByRound).toEqual([UP_III_RAW, UP_III_RAW, LEECH_RAW]);
        });

        it(`${victimSide}-side leecher: the damage-TAKEN leech's self-side half is still one turn behind`, () => {
            const withUp = threeRoundProfile(victimSide, 'taken', 5, UP_III_PCT);
            const baseline = threeRoundProfile(victimSide, 'taken', 5);

            expect(withUp.victimSelfBuffNames).toContain(UP_III);
            expect(baseline.victimDirectHealByRound).toEqual([LEECH_RAW, LEECH_RAW, LEECH_RAW]);

            // Round 1 is the plain leech — the recipient of a taken leech is the ship being
            // attacked, never the actor whose turn is running, so no acting-turn ctx exists for it.
            // Corpus-inert (both `damage-taken` passive leeches in the roster are SHIELDS), and
            // pinned so it cannot become live and unnoticed.
            expect(withUp.victimDirectHealByRound).toEqual([LEECH_RAW, UP_III_RAW, UP_III_RAW]);
        });
    }
});
