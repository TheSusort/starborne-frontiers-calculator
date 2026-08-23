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
 *   - `procStandingLeechesPerVictim` — the damage-DEALT leech (sections 1-3);
 *   - `procTakenLeechesPerVictim` — the damage-TAKEN leech (sections 4-5).
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
 * Every behavioural claim is DIFFERENTIAL against an inert-marker control casting through the
 * identical path, and every one asserts the control's leech is NON-ZERO first — otherwise "reduced
 * to nothing" and "never leeched at all" are the same green.
 *
 * THREE ROLES, identical on both side arms — only which side they stand on changes:
 *   - ZOSIMOS  applies the status (a plain on-cast `target: 'enemy'` debuff) and, in the
 *              damage-TAKEN sections, also attacks. Speed 950, so it always acts first and the
 *              status is standing before the leech fires.
 *   - VICTIM   the LEECHING ship. Speed 500, at M4 so Zosimos's `front` targeting binds to it.
 *   - MEDIC    an inert bystander that exists only to be the healing ANCHOR, so nothing here can
 *              be an artefact of the leecher happening to be the heal target. It has no kit.
 *
 * NO RNG SEEDING, exactly as both source files: `crit: 0` removes the crit stream rather than
 * fixing it and `application: 'apply'` skips the landing roll, so both arms of every comparison
 * are deterministic without a keyed provider (which is keyed per `ownerId` and would hand the two
 * SIDE arms different draws).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
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
 *  one self-side source `liveHealChannelPct` can read for an actor with no published ctx yet —
 *  which is exactly the leecher's state when its own turn fires in round 1 (`lastTurnCtxByActor`
 *  is written AFTER the turn dispatch that applied the damage).
 *
 *  A passive-seeded `Inc. Repair Up II` status would NOT work in a one-round fixture, and that is
 *  measured rather than assumed: the same leech credits 10,000 / 15,000 / 15,000 over three rounds
 *  with one standing from combat start, so round 1 misses it and rounds 2+ see it. A two-round
 *  fixture reading round 2 would therefore be measuring the ctx's publication timing on top of the
 *  fold under test. The residual is recorded at the fold itself in `engine.ts`. */
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
}

/**
 * One run. Both side arms build the SAME three roles with the same speeds, positions and stats —
 * only which side they stand on changes — so the two arms' deltas are directly comparable.
 *
 * Speeds: Zosimos 950 (always first, so the status is standing before anything leeches), the
 * leecher 500, the medic 300 (inert, and last).
 */
function runFixture(opts: FixtureOpts): FixtureRun {
    const zosimosAttack = opts.leechKind === 'taken' ? ATTACK : 0;
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

    const victimShape: RoleShape = {
        id: VICTIM_ID,
        position: 'M4',
        speed: 500,
        hp: VICTIM_MAX_HP,
        attack: opts.leechKind === 'dealt' ? ATTACK : 0,
        slots:
            opts.leechKind === 'dealt'
                ? [activeSlot([basicAttack()]), passiveSlot([standingLeech(LEECH_PCT)])]
                : [passiveSlot([takenLeech(LEECH_PCT)])],
        ...(opts.victimPreFight ? { preFight: opts.victimPreFight } : {}),
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

    return {
        victimHp: victim!.currentHp,
        victimDirectHeal: result.healing!.rounds[0].perActor.get(VICTIM_ID)?.directHeal ?? 0,
        victimDebuffNames: statusEngine!
            .timedAbilityStatuses('enemy', undefined, VICTIM_ID)
            .map((s) => s.payload.buffName),
        victimPreFightIncomingHeal: victim!.preFight?.incomingHeal ?? 0,
    };
}

const SIDES = ['player', 'enemy'] as const;

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
// (`preFight.incomingHeal`) rather than a second enemy cast carrying a positive payload: NO ship in
// `docs/ship-skills.csv` grants `Inc. Repair Up` at all (0 occurrences, swept 2026-08-23) — it
// reaches a ship only through the calculator's buff picker, gear, or a pre-fight modifier, all of
// which are self-side channels. The fold is one additive sum either way; what matters is that a
// positive total RAISES the leech instead of being ignored or clamped away.

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
