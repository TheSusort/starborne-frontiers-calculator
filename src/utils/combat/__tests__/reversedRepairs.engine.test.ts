/**
 * `Reversed Repairs` (#362) — "Incoming repairs damage this unit instead".
 *
 * Zosimos's charged skill inflicts it for 1 turn. The status turns every incoming repair on its
 * carrier into a raw HP burn, and the whole mechanic is ONE branch inside `applyHealToTarget`
 * (`engine.ts`) — the only line in the entire combat engine where HP goes up. Every repair channel
 * (cast, HoT tick, leech, reactive) funnels through it.
 *
 * WHY SO MANY RULINGS ARE SATISFIED BY POSITION ALONE. By the time `raw` reaches that closure it is
 * already post-crit, post-`healModifier`, post-`outgoingHealBuff`, post-`incomingHealPct` (which is
 * where `Inc. Repair Down` lives) and **pre**-deficit-clamp. So R3 (a full-HP target takes the full
 * amount), R4 (the crit carries) and R6 (the -50% applies first) are all properties of that ONE
 * number, not of anything the reversal recomputes. These fixtures exist to prove the branch sits
 * where the design says it sits — each one pins a value that only that position produces.
 *
 * ── Harness ───────────────────────────────────────────────────────────────────────────────────
 * Copied from `exposedStatus.integration.test.ts` (real `runCombat`, hand-built abilities, a
 * name-keyed status planted through the real production seam, both directions exercised) and
 * `lowestHpAllyRouting.test.ts` (the heal-routing half: a `walk`-bundled team actor, the
 * `__testTapActors` seam for seeding and reading live actor state).
 *
 * A test-double `HealingRuntimeCtx` contains no reversal branch, so a double-based test would prove
 * nothing about production. Everything here drives the real engine.
 *
 * THREE ACTORS, one job each, identical on both sides:
 *   - ZOSIMOS  applies the status (a plain on-cast `target: 'enemy'` debuff — Nayra's shape, the
 *              same seam Zosimos's charged skill produces). Fastest, so it acts first.
 *   - VICTIM   carries the status. Middle speed, so its own turn folds any `Inc. Repair Down`
 *              into `lastTurnCtxByActor` BEFORE the repair arrives (that is the channel
 *              `recipientIncomingHealPct` reads).
 *   - MEDIC    repairs the victim via `target: 'lowest-hp-ally'`, which excludes the caster and is
 *              footprint-exempt — so with exactly two actors on the side it routes to the victim
 *              deterministically, whatever the HP state. Slowest, so it acts last.
 *
 * EVERY behavioural test runs BOTH `victimSide: 'player'` and `victimSide: 'enemy'` and asserts the
 * identical delta. Team symmetry is mandatory (`feedback_engine_team_symmetry`), and the enemy arm
 * is also the only coverage of the TIMED status channel reaching a player-side victim.
 *
 * EVERY behavioural test also runs a CONTROL arm — the identical fixture with an unmodelled status
 * name planted through the identical seam. A single-arm test cannot tell "reversed" from "healed
 * nothing"; the control is what makes each delta mean something.
 *
 * NO RNG SEEDING. Every gate in this file is pinned by rate rather than by seed: `makeRateGate`
 * documents that `rate >= 1` always fires and `rate <= 0` never does, so `crit: 100` crits every
 * time and `crit: 0` never does. That is strictly stronger than `setupKeyedTestRng` — it removes
 * the stream entirely instead of fixing it — and it sidesteps the keyed-RNG-per-ownerId hazard that
 * makes cross-side amount comparisons unsafe.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import { emptyPreFightModifiers } from '../preFight/types';
import type { Position } from '../../../types/encounters';
import { assembleBattleResult, LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { buildCombatLog, type RosterEntry } from '../log/buildCombatLog';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { CombatLogEntry } from '../log/types';

const REVERSED = 'Reversed Repairs';
/** A control run plants an unmodelled status name through the identical path, so every comparison
 *  isolates the 'Reversed Repairs' name and nothing else about the fixture. */
const CONTROL = 'Inert Marker';

const FOCUS_ID = 'attacker';
const VICTIM_ID = 'victim';
const PROTECTOR_ID = 'protector';
/** Non-focus ids for the two roles; whichever of them is the focus answers to FOCUS_ID instead. */
const MEDIC_ID = 'medic';
const ZOSIMOS_ID = 'zosimos';

const MEDIC_HP = 100_000;
const VICTIM_MAX_HP = 100_000;
const PROTECTOR_MAX_HP = 100_000;
/** The repair, as a % of the MEDIC's max HP (`basis: 'hp'`) — so its magnitude is arithmetic, not
 *  a golden: 10% of 100,000. */
const REPAIR_PCT = 10;
const RAW = (MEDIC_HP * REPAIR_PCT) / 100; // 10,000

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Ability factories ─────────────────────────────────────────────────────────────────────────

/** Nayra's / Zosimos's shape: a plain on-cast enemy debuff, landing through the per-victim
 *  `applyTimedAbilityStatus` seam. `application: 'apply'` always lands, isolating the behaviour
 *  under test from the hacking-vs-security landing roll. */
const castStatus = (buffName: string): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        // Long enough that only the reversal — never expiry — can end it within a fixture's rounds.
        duration: 5,
        application: 'apply',
    },
});

/** The repair under test. `'lowest-hp-ally'` excludes the caster and is footprint-exempt, so on a
 *  two-actor side it resolves to the victim with no positional coupling at all. */
const lowestHpAllyHeal = (pct: number): Ability => ({
    id: 'ab-repair',
    type: 'heal',
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp' },
});

const basicAttack = (): Ability => ({
    id: 'basic-attack',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

/** #362 fix-wave-1 (M-3): an on-attacked reactive self-repair, the "Second Wind" shape
 *  (`equipmentAbilities.integration.test.ts`'s D-PR5) with no `procChance`/`triggerCritFilter` so
 *  it always fires. Placed on the VICTIM's own passive slot and triggered by an incoming attack —
 *  i.e. fired from INSIDE `triggers.ts`'s `executeIntent`, itself invoked from `drivePositionalApply`
 *  while resolving that same attack (the plan doc's third deferral window). This is what makes the
 *  resulting reversal genuinely reactive, unlike every other channel in this file (cast/HoT/leech),
 *  none of which fire from inside another action's resolution. */
const reactiveSelfRepair = (pct: number): Ability => ({
    id: 'ab-reactive-self-repair',
    type: 'heal',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp' },
});

/** A named no-payload self-buff cast from the actor's own ACTIVE slot — the grant shape verified
 *  working by `hitMitigation.integration.test.ts` (a passive-slot on-cast self-buff does not
 *  reliably apply in this engine). Used here for `Cheat Death`. */
const namedSelfBuff = (buffName: string): Ability => ({
    id: `self-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

/** One Protection stack on the holder, granted the PRODUCTION way: an aura ability status (a buff
 *  config with NO duration + isStackable), which is what a real Meatshield's start-of-combat
 *  "gains N stacks of Protection" passive parses to. `protectorsFor` aggregates it via
 *  `selfBuffStacksForOwner`, the channel `snapshot().activeSelfBuffs` misses for a non-focus
 *  actor — the scheduled `selfBuffs` recipe only works on the focus. */
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

const castSlots = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

// ── Roster builders ───────────────────────────────────────────────────────────────────────────

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself: normalizeTeamActorsToWalked
// synthesizes NEUTRAL_WALK_STATS with **hp: 1** for a team actor arriving without one, silently
// discarding a bare `stats.hp` (see lowestHpAllyRouting.test.ts's note).
interface RoleShape {
    id: string;
    position: Position;
    speed: number;
    hp: number;
    defence?: number;
    attack?: number;
    crit?: number;
    critDamage?: number;
    slots?: ShipSkills['slots'];
    /** Percentage points of `incomingHeal` this actor carries. See R6's note on why the reduction
     *  is installed through this channel rather than as an enemy-applied debuff. */
    incomingHeal?: number;
}

const preFightWith = (incomingHeal: number) => ({
    ...emptyPreFightModifiers(),
    incomingHeal,
});

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
    ...(args.incomingHeal !== undefined ? { preFight: preFightWith(args.incomingHeal) } : {}),
    walk: {
        shipSkills: { slots: args.slots ?? [] },
        stats: {
            attack: args.attack ?? 0,
            crit: args.crit ?? 0,
            critDamage: args.critDamage ?? 0,
            defensePenetration: 0,
            hacking: 100_000,
            defence: args.defence ?? 0,
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
        ...(args.incomingHeal !== undefined ? { preFight: preFightWith(args.incomingHeal) } : {}),
        stats: {
            attack: args.attack ?? 0,
            crit: args.crit ?? 0,
            critDamage: args.critDamage ?? 0,
            defence: args.defence ?? 0,
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
    /** Which side the repaired VICTIM stands on. Both arms of every behavioural test. */
    victimSide: 'player' | 'enemy';
    /** `REVERSED` or `CONTROL`. */
    statusName: string;
    repairPct?: number;
    /** Integer percentage points (crit `100`, not `1.0`). 100 → the medic's repair always crits. */
    medicCrit?: number;
    medicCritDamage?: number;
    victimMaxHp?: number;
    /** Seeded onto the live actor before round 1 via `__testTapActors`. Default: full HP. */
    victimStartHp?: number;
    victimDefence?: number;
    /** Seeded onto the live actor before round 1. Non-zero makes "the shield is untouched"
     *  falsifiable — on a victim with no pool it is vacuously true. */
    victimShield?: number;
    /** Extra slots on the victim's own kit (e.g. its `Cheat Death` self-cast). */
    victimSlots?: ShipSkills['slots'];
    /** R6: percentage points of `incomingHeal` the VICTIM carries (-50 = Inc. Repair Down II). */
    incomingRepairDownPct?: number;
    /** Adds a same-side ally holding one Protection stack, positioned to receive redirects. */
    withProtector?: boolean;
    /** >0 → Zosimos also fires a real attack at the victim, which is what proves the defence and
     *  Protection instruments are live in this very fixture. */
    zosimosAttack?: number;
    numRounds?: number;
}

interface FixtureRun {
    /** The victim's LIVE final HP (the actor objects the tap hands out are the real ones). */
    victimHp: number;
    victimShield: number;
    protectorHp: number;
    events: CombatEvent[];
    result: ReturnType<typeof runCombat>;
    /** Whichever id the medic answers to in this arm — 'attacker' on the player arm, 'medic' on the
     *  enemy arm. They are deliberately DIFFERENT ids from `zosimosId` so a kill-credit assertion
     *  can tell the healer from the debuff applier. */
    medicId: string;
    zosimosId: string;
    /** The run's event stream folded by the REAL `buildCombatLog`, flattened to every entry
     *  (reactions included). R11's row is only a log row if this is where it shows up. */
    logEntries: CombatLogEntry[];
    /** The victim's effective max HP for this run — the denominator the battle report's `hpPct`
     *  divides by, so the report block can state its expectation in HP rather than in percent. */
    victimMaxHp: number;
}

/**
 * One run of the fixture. Both arms build the SAME three roles with the same speeds, positions and
 * stats — only which side they stand on changes — so the two arms' deltas are directly comparable.
 *
 * Speeds 900 / 500 / 300 fix the round-1 order as Zosimos → victim → medic, which is what makes
 * R6's `Inc. Repair Down` fold visible (it is read off `lastTurnCtxByActor`, written at the
 * victim's own turn) and guarantees the status is standing when the repair lands.
 *
 * Positions put the victim at M4 (the front-most cell), so Zosimos's `front` targeting binds to it
 * rather than to the medic at M1 or the protector at M2.
 */
function runFixture(opts: FixtureOpts): FixtureRun {
    const repairPct = opts.repairPct ?? REPAIR_PCT;
    const victimMaxHp = opts.victimMaxHp ?? VICTIM_MAX_HP;
    const medicCrit = opts.medicCrit ?? 0;
    const medicCritDamage = opts.medicCritDamage ?? 0;
    const zosimosAttack = opts.zosimosAttack ?? 0;

    const zosimosAbilities: Ability[] = [
        castStatus(opts.statusName),
        ...(zosimosAttack > 0 ? [basicAttack()] : []),
    ];
    const medicAbilities: Ability[] = [lowestHpAllyHeal(repairPct)];

    const victimShape: RoleShape = {
        id: VICTIM_ID,
        position: 'M4' as Position,
        speed: 500,
        hp: victimMaxHp,
        defence: opts.victimDefence ?? 0,
        slots: opts.victimSlots,
        incomingHeal: opts.incomingRepairDownPct,
    };
    const protectorShape: RoleShape = {
        id: PROTECTOR_ID,
        position: 'M2' as Position,
        speed: 400,
        hp: PROTECTOR_MAX_HP,
        slots: [protectionAuraPassive(1)],
    };

    const bus = createEventBus();
    const events: CombatEvent[] = [];
    // Subscribes from `LOG_EVENT_TYPES` — the PRODUCTION list `simulateBattle` itself subscribes
    // from — rather than a hand-written set, deliberately. `buildCombatLog` has a handler keyed on
    // each type, but the bus only subscribes from that list, so a log-only twin omitted from it is
    // dead code and its row is invisible in the real app. Reading the production list here means
    // the R11 log-row tests below would fail if `reversed-repair-log` were left out of it.
    // `cheat-death-activated` is the one extra: it is a REAL combat event (Yazid listens to it),
    // not a log twin, so it is deliberately absent from LOG_EVENT_TYPES.
    for (const type of [...LOG_EVENT_TYPES, 'cheat-death-activated'] as const) {
        bus.on(type, (e: CombatEvent) => events.push(e));
    }

    let victim: CombatActor | undefined;
    let protector: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        victim = actors.find((a) => a.id === VICTIM_ID);
        protector = actors.find((a) => a.id === PROTECTOR_ID);
        if (victim) {
            if (opts.victimStartHp !== undefined) victim.currentHp = opts.victimStartHp;
            if (opts.victimShield !== undefined) victim.shieldPool = opts.victimShield;
        }
    };

    // Shared across both arms: everything that is not a roster slot.
    const common = {
        numRounds: opts.numRounds ?? 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        chargeCount: 0,
        defensePenetration: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        // The heal ANCHOR is the focus in both arms, and in neither arm is it the victim — so
        // nothing here can be an artefact of the victim happening to be the anchor.
        healTargetId: FOCUS_ID,
        mode: 'healing' as const,
        // Turns on per-recipient APPLICATION + the `perRecipient` accounting axis. Without it a
        // repair aimed at a non-anchor ally never reaches `applyHealToTarget` at all.
        perRecipientHealApply: true,
        hacking: 100_000,
        __testTapActors: seed,
        bus,
    };

    const input: CombatEngineInput =
        opts.victimSide === 'player'
            ? // PLAYER-side victim: the focus is the MEDIC, Zosimos is the lone enemy.
              {
                  ...common,
                  attack: 0,
                  crit: medicCrit,
                  critDamage: medicCritDamage,
                  defence: 0,
                  hp: MEDIC_HP,
                  speed: 300,
                  position: 'M1',
                  target: parseTarget('front'),
                  pattern: parsePattern('Pattern-Base'),
                  shipSkills: castSlots(medicAbilities),
                  teamActors: [
                      walkedAlly(victimShape),
                      ...(opts.withProtector ? [walkedAlly(protectorShape)] : []),
                  ],
                  enemyAttackers: [
                      enemyShip({
                          id: ZOSIMOS_ID,
                          position: 'M1',
                          speed: 900,
                          hp: MEDIC_HP,
                          attack: zosimosAttack,
                          slots: [{ slot: 'active', abilities: zosimosAbilities }],
                      }),
                  ],
              }
            : // ENEMY-side victim: the focus is ZOSIMOS, and the medic + victim are both enemies.
              {
                  ...common,
                  attack: zosimosAttack,
                  crit: 0,
                  critDamage: 0,
                  defence: 0,
                  hp: MEDIC_HP,
                  speed: 900,
                  position: 'M1',
                  target: parseTarget('front'),
                  pattern: parsePattern('Pattern-Base'),
                  shipSkills: castSlots(zosimosAbilities),
                  teamActors: [],
                  enemyAttackers: [
                      enemyShip(victimShape),
                      ...(opts.withProtector ? [enemyShip(protectorShape)] : []),
                      enemyShip({
                          id: MEDIC_ID,
                          position: 'M1',
                          speed: 300,
                          hp: MEDIC_HP,
                          crit: medicCrit,
                          critDamage: medicCritDamage,
                          slots: [{ slot: 'active', abilities: medicAbilities }],
                      }),
                  ],
              };

    const result = runCombat(input);

    const medicId = opts.victimSide === 'player' ? FOCUS_ID : MEDIC_ID;
    const zosimosId = opts.victimSide === 'player' ? ZOSIMOS_ID : FOCUS_ID;
    // Every id in the run, on the side it really stands on — buildCombatLog drops any actor the
    // roster does not name, so an incomplete roster here would silently swallow the row under test.
    const foeSide: 'player' | 'enemy' = opts.victimSide === 'player' ? 'enemy' : 'player';
    const roster: RosterEntry[] = [
        { actorId: medicId, side: opts.victimSide, name: 'Medic' },
        { actorId: VICTIM_ID, side: opts.victimSide, name: 'Victim' },
        { actorId: zosimosId, side: foeSide, name: 'Zosimos' },
        { actorId: PROTECTOR_ID, side: opts.victimSide, name: 'Protector' },
    ];

    return {
        victimHp: victim!.currentHp,
        victimShield: victim!.shieldPool,
        protectorHp: protector?.currentHp ?? 0,
        events,
        result,
        medicId,
        zosimosId,
        logEntries: flattenCombatLog({
            combatLog: buildCombatLog(events, roster, new Map()),
        }),
        victimMaxHp,
    };
}

/** Both arms of one fixture — the reversal run and its CONTROL twin, identical but for the name. */
function bothArms(opts: Omit<FixtureOpts, 'statusName'>): {
    reversed: FixtureRun;
    control: FixtureRun;
} {
    return {
        reversed: runFixture({ ...opts, statusName: REVERSED }),
        control: runFixture({ ...opts, statusName: CONTROL }),
    };
}

const SIDES = ['player', 'enemy'] as const;

const healPerformed = (events: CombatEvent[]) =>
    events.filter(
        (e): e is Extract<CombatEvent, { type: 'heal-performed' }> => e.type === 'heal-performed'
    );
const destroyed = (events: CombatEvent[]) =>
    events.filter(
        (e): e is Extract<CombatEvent, { type: 'ship-destroyed' }> => e.type === 'ship-destroyed'
    );
const cheatDeaths = (events: CombatEvent[]) =>
    events.filter(
        (e): e is Extract<CombatEvent, { type: 'cheat-death-activated' }> =>
            e.type === 'cheat-death-activated'
    );
/** #362 fix-wave-1 (M-3): generic version of the type-narrowing filters above, for the two event
 *  types (`attacked`, `reactive-heal-performed`) only the deferral-window test needs. */
function eventsOfType<T extends CombatEvent['type']>(
    events: CombatEvent[],
    type: T
): Extract<CombatEvent, { type: T }>[] {
    return events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

// ══ R1 ═══════════════════════════════════════════════════════════════════════════════════════
// "No defensive layers. No shield drain, no Protection redirect, no defence mitigation, no
// Barrier. A raw HP burn at face value." All four are owned by the damage funnel
// (`applyVictimDamage`), which the reversal deliberately never enters — so the rulings are
// satisfied by the branch's POSITION, and these tests prove it sits there.
//
// ⚠️ COVERAGE, STATED HONESTLY (#362 fix-wave-2, M-7): R1 names FOUR layers and this block drives
// THREE of them with a live instrument — shield drain, defence mitigation and the Protection
// redirect each get a fixture in which an ordinary attack demonstrably IS reduced/redirected while
// the reversal is not. The FOURTH, Barrier, is argued STRUCTURALLY only (see the R8 header below:
// Barrier lives inside `applyVictimDamage`, and the reversal never calls it — the same one fact
// that fences the other three). That argument is sound, and it is the same argument the three
// measured layers rest on, but it is DOCUMENTATION-GRADE, not a measurement: if Barrier ever moves
// out of the damage funnel, nothing in this file goes red. Recorded so a later reader does not
// mistake the prose for a test.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R1 — the reversal drains HP, never the shield pool', () => {
    for (const victimSide of SIDES) {
        // NON-VACUITY: the victim is seeded with a REAL pool and the assertion checks the pool is
        // non-zero first. "Shield unchanged" on a victim that never had a shield is true of any
        // implementation, including one that drains shields.
        it(`${victimSide}-side victim: burns exactly the repair off HP and leaves a live shield pool intact`, () => {
            const SHIELD = 30_000;
            const { reversed, control } = bothArms({
                victimSide,
                victimStartHp: VICTIM_MAX_HP / 2,
                victimShield: SHIELD,
            });

            // The instrument exists: there IS a pool to drain.
            expect(reversed.victimShield).toBeGreaterThan(0);
            expect(control.victimShield).toBe(SHIELD);
            // …and the reversal left every point of it standing.
            expect(reversed.victimShield).toBe(SHIELD);

            // The whole repair came off HP. Control repairs into the deficit (+RAW); the reversal
            // burns it (−RAW); the gap is 2×RAW, and neither endpoint is the fixture's start HP.
            expect(control.victimHp).toBe(VICTIM_MAX_HP / 2 + RAW);
            expect(reversed.victimHp).toBe(VICTIM_MAX_HP / 2 - RAW);
        });

        // NON-VACUITY: on a zero-defence victim "mitigated" and "unmitigated" are the same number,
        // so a burn magnitude alone proves nothing. This runs the fixture at defence 0 and at
        // defence 8,000 twice over:
        //   (a) WITH an ordinary attack, reading `perActorIncoming.incoming` — the mitigation
        //       instrument is demonstrably live on this very victim, at these very defence values.
        //       (Read off the intake channel, not off HP: the repair moves HP too, and the whole
        //       point of the test is that the two channels are separate.)
        //   (b) WITHOUT an attack, so the ONLY thing that moved the victim's HP is the reversal —
        //       and it moves it by exactly RAW at both defence values.
        it(`${victimSide}-side victim: defence mitigates an ordinary attack but not the reversal`, () => {
            const ATTACK = 20_000;
            const intakeOf = (run: FixtureRun) =>
                run.result.rounds[0].perActorIncoming?.[VICTIM_ID]?.incoming ?? 0;

            // (a) The instrument.
            const softHit = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: VICTIM_MAX_HP,
                victimDefence: 0,
                zosimosAttack: ATTACK,
            });
            const armouredHit = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: VICTIM_MAX_HP,
                victimDefence: 8_000,
                zosimosAttack: ATTACK,
            });
            expect(intakeOf(softHit)).toBeGreaterThan(0);
            expect(intakeOf(armouredHit)).toBeGreaterThan(0);
            expect(intakeOf(armouredHit)).toBeLessThan(intakeOf(softHit));

            // (b) The reversal, with no attack in play at all.
            const soft = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: VICTIM_MAX_HP,
                victimDefence: 0,
            });
            const armoured = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: VICTIM_MAX_HP,
                victimDefence: 8_000,
            });
            // A mitigated reversal would burn strictly less on the armoured victim.
            expect(VICTIM_MAX_HP - soft.victimHp).toBe(RAW);
            expect(VICTIM_MAX_HP - armoured.victimHp).toBe(RAW);
        });

        // NON-VACUITY: "the protector's HP did not move" is vacuously true if Protection never
        // redirects anything in this fixture. The third run fires a real attack of the same shape
        // and proves the protector DOES take a redirect here.
        it(`${victimSide}-side victim: a Protection holder takes a redirect from an attack but none from the reversal`, () => {
            const reversal = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: VICTIM_MAX_HP,
                withProtector: true,
            });
            const control = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: VICTIM_MAX_HP,
                withProtector: true,
            });
            const instrument = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: VICTIM_MAX_HP,
                withProtector: true,
                zosimosAttack: 20_000,
            });

            // The instrument fires: an ordinary attack on the victim DOES move the protector's HP.
            expect(instrument.protectorHp).toBeLessThan(PROTECTOR_MAX_HP);
            // The reversal moves the victim and nobody else.
            expect(reversal.victimHp).toBe(VICTIM_MAX_HP - RAW);
            expect(reversal.protectorHp).toBe(PROTECTOR_MAX_HP);
            expect(control.protectorHp).toBe(PROTECTOR_MAX_HP);
        });
    }
});

// ══ R3 ═══════════════════════════════════════════════════════════════════════════════════════
// "A target already at full HP takes the full amount." The reversal reads the repair's FACE
// VALUE, not the portion a heal could have consumed — because the branch sits ABOVE the deficit
// clamp. This is the ruling that a clamp-respecting implementation gets wrong.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R3 — a victim at full HP takes the full repair as damage', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: the whole face value lands despite zero deficit`, () => {
            const { reversed, control } = bothArms({
                victimSide,
                victimStartHp: VICTIM_MAX_HP, // no room whatsoever
            });

            // Control: the repair is entirely wasted and the HP does not move at all. That is the
            // exact state in which a clamp-respecting reversal would burn NOTHING.
            expect(control.victimHp).toBe(VICTIM_MAX_HP);
            // Reversal: the full face value, undiminished by the (zero) deficit.
            expect(reversed.victimHp).toBe(VICTIM_MAX_HP - RAW);
        });
    }
});

// ══ R4 ═══════════════════════════════════════════════════════════════════════════════════════
// "The crit carries. A repair that would have restored 6,000 reverses into 6,000." Satisfied by
// position: `raw` is already post-crit when it reaches the closure.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R4 — a critical repair reverses at its post-crit value', () => {
    for (const victimSide of SIDES) {
        // NON-VACUITY, in two halves.
        //   (1) The crit is pinned by RATE, not by seed: `makeRateGate` fires whenever `rate >= 1`
        //       and never when `rate <= 0`, so crit 100 / crit 0 are deterministic with the RNG
        //       untouched. The two CONTROL runs prove the crit instrument is live — the same
        //       fixture repairs for RAW×2.5 at crit 100 and for RAW at crit 0.
        //   (2) The two REVERSAL runs then have to reproduce those two distinct numbers as burns.
        //       Without the crit-0 arm, any burn magnitude would satisfy "the crit carried".
        it(`${victimSide}-side victim: burns the crit-inflated amount, not the base amount`, () => {
            const CRIT_DAMAGE = 150; // integer percentage points → ×2.5
            const CRIT_RAW = RAW * (1 + CRIT_DAMAGE / 100); // 25,000
            // Deficit ≫ CRIT_RAW, so the control runs CONSUME their whole repair and the two
            // control HP endpoints read the two repair magnitudes directly.
            const START = VICTIM_MAX_HP / 2;
            const arm = (statusName: string, medicCrit: number) =>
                runFixture({
                    victimSide,
                    statusName,
                    victimStartHp: START,
                    medicCrit,
                    medicCritDamage: CRIT_DAMAGE,
                });

            // (1) The instrument: crit 100 really does inflate the repair by ×2.5.
            expect(arm(CONTROL, 0).victimHp - START).toBe(RAW);
            expect(arm(CONTROL, 100).victimHp - START).toBe(CRIT_RAW);
            const criticalControl = arm(CONTROL, 100);
            const heals = healPerformed(criticalControl.events).filter(
                (e) => e.casterId === criticalControl.medicId
            );
            expect(heals.length).toBeGreaterThan(0);
            expect(heals.some((e) => (e.critHits ?? 0) > 0)).toBe(true);

            // (2) The reversal reproduces both magnitudes as burns — the crit carried through.
            expect(START - arm(REVERSED, 0).victimHp).toBe(RAW);
            expect(START - arm(REVERSED, 100).victimHp).toBe(CRIT_RAW);
        });
    }
});

// ══ R6 ═══════════════════════════════════════════════════════════════════════════════════════
// "`Inc. Repair Down` applies first, and the reduced amount is what reverses. 4,000 → 2,000 →
// 2,000 damage." Satisfied by position: `incomingHealPct` is folded into `raw` upstream.
//
// ⚠️ HOW THE -50% IS INSTALLED, and why not as an enemy-applied debuff. The ruling is about the
// `incomingHealPct` CHANNEL — the design names it as "where Inc. Repair Down lives" — so these
// fixtures put the reduction on that channel, via the victim's `preFight.incomingHeal` block
// (`playerTurn` folds it into `scheduledTotals.incomingHealBuff`, exactly the total that becomes
// `lastTurnCtxByActor.incomingHealPct`, which is what `recipientIncomingHealPct` reads).
//
// Applying a named `Inc. Repair Down II` debuff FROM Zosimos does not reach that channel in this
// engine, and that is a PRE-EXISTING limitation with nothing to do with #362: `incomingHealBuff`
// is summed only from an actor's own SELF statuses (`foldActorBuffTotals` /
// `effectiveDamageStatsOf` — scheduled self-buffs + timed SELF ability statuses + preFight). An
// enemy-inflicted debuff lands in the per-victim ENEMY store, which no incoming-heal fold reads.
// Installing the reduction through the enemy store would therefore have produced a fixture in
// which the reduction did nothing at all — and the "burn was halved" assertion would have failed
// for the fixture's reason rather than the engine's. The control arm below is what makes that
// distinction observable rather than assumed.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R6 — Inc. Repair Down II halves the repair, and the halved amount is what burns', () => {
    for (const victimSide of SIDES) {
        // NON-VACUITY: two independent halves.
        //   (1) the CONTROL run proves the -50% channel is actually live on this victim — its
        //       repair lands for RAW/2, not RAW. Without this, "the burn was RAW/2" could just as
        //       easily mean the fixture's repair was half-size all along.
        //   (2) the un-debuffed REVERSAL run proves the full amount is what would otherwise burn.
        it(`${victimSide}-side victim: burns the reduced amount, and the reduction is demonstrably live`, () => {
            const halvedControl = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: VICTIM_MAX_HP / 2,
                incomingRepairDownPct: -50,
            });
            const fullControl = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: VICTIM_MAX_HP / 2,
            });
            const halvedReversal = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: VICTIM_MAX_HP / 2,
                incomingRepairDownPct: -50,
            });
            const fullReversal = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: VICTIM_MAX_HP / 2,
            });

            // (1) The reduction channel is live: the repair itself is halved.
            expect(fullControl.victimHp - VICTIM_MAX_HP / 2).toBe(RAW);
            expect(halvedControl.victimHp - VICTIM_MAX_HP / 2).toBe(RAW / 2);

            // (2) The un-debuffed reversal burns the full amount…
            expect(VICTIM_MAX_HP / 2 - fullReversal.victimHp).toBe(RAW);
            // …and the debuffed one burns exactly half of it — the -50% having applied FIRST.
            expect(VICTIM_MAX_HP / 2 - halvedReversal.victimHp).toBe(RAW / 2);
        });
    }
});

// ══ R7′ ══════════════════════════════════════════════════════════════════════════════════════
// "It can kill, and the damage AND the kill belong to the DEBUFF'S APPLIER — the Zosimos that
// inflicted the status — not to the healer whose repair was reversed." Attributed the way a DoT's
// damage and kills belong to whoever applied the DoT.
//
// ⚠️ THIS INVERTS THE ORIGINAL RULING, which named the healer. The owner retracted that. The
// fixture's medic and Zosimos carry deliberately DIFFERENT ids in BOTH arms, which is the whole
// reason these assertions can tell them apart — a fixture where they coincided would pass either
// way. Every arm asserts the applier IS named and the healer is NOT.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R7′ — a lethal reversal credits the debuff applier, never the healer', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: ship-destroyed names Zosimos as killer, not the medic`, () => {
            const LETHAL_START = RAW / 2; // strictly less than the repair → the burn is lethal
            const { reversed, control } = bothArms({
                victimSide,
                victimMaxHp: VICTIM_MAX_HP,
                victimStartHp: LETHAL_START,
            });

            // The control proves the same fixture does NOT kill without the status — the victim is
            // repaired instead. Otherwise a kill here could come from anything in the fixture.
            expect(destroyed(control.events).filter((e) => e.actorId === VICTIM_ID)).toHaveLength(
                0
            );
            expect(control.victimHp).toBe(LETHAL_START + RAW);

            const kills = destroyed(reversed.events).filter((e) => e.actorId === VICTIM_ID);
            expect(kills).toHaveLength(1);
            expect(reversed.victimHp).toBe(0);
            // The applier, explicitly not the healer. The two ids differ in both arms.
            expect(reversed.medicId).not.toBe(reversed.zosimosId);
            expect(kills[0].killerId).toBe(reversed.zosimosId);
            expect(kills[0].killerId).not.toBe(reversed.medicId);
            // A reversed repair is not a hit: the consumables that spend on a direct hit must not
            // see one — and `triggers.ts` gates the killer-targeted on-destroyed reactions
            // (Faust's purge, Martyrdom, Paracelsus) on this flag, so a `true` here would make
            // them spend on a kill their owner never chose.
            // `toBe(false)`, NOT `toBeFalsy()` (#362 fix-wave-2, M-5): the field is OPTIONAL, so
            // `toBeFalsy` also passes when it is simply absent — i.e. against a build that stopped
            // setting it. `engine.ts` calls the explicit `false` REQUIRED, not merely defensible.
            expect(kills[0].byDirectDamage).toBe(false);
        });

        // The DAMAGE half of R7′, which the kill assertion above cannot reach: a NON-lethal
        // reversal books its burn on the applier's dealt axis and on the victim's taken axis.
        it(`${victimSide}-side victim: the burn books as the applier's damage dealt`, () => {
            const START = VICTIM_MAX_HP / 2; // deficit ≫ RAW ⇒ the burn is survivable
            const { reversed, control } = bothArms({ victimSide, victimStartHp: START });

            const dealtBy = (run: FixtureRun, attackerId: string) =>
                run.result.rounds[0].perTargetDealt?.[attackerId]?.[VICTIM_ID] ?? 0;
            const takenBy = (run: FixtureRun) =>
                run.result.rounds[0].perTargetDamage?.[VICTIM_ID] ?? 0;

            // NON-VACUITY: without the status the same fixture books NOTHING on either axis — so
            // the numbers below cannot be an artefact of some other damage in the fixture.
            expect(dealtBy(control, control.zosimosId)).toBe(0);
            expect(takenBy(control)).toBe(0);

            // The burn really happened…
            expect(START - reversed.victimHp).toBe(RAW);
            // …and it is booked, in full, on the APPLIER.
            expect(dealtBy(reversed, reversed.zosimosId)).toBe(RAW);
            expect(takenBy(reversed)).toBe(RAW);
            // …and NOT on the healer. This is the assertion the retracted ruling would fail.
            expect(dealtBy(reversed, reversed.medicId)).toBe(0);
        });
    }
});

// ══ R8 ═══════════════════════════════════════════════════════════════════════════════════════
// "Cheat Death intercepts a lethal reversal and is spent, exactly as against a lethal attack."
// Cheat Death is the ONLY survival layer that applies here — Barrier lives in the damage funnel,
// which the reversal never enters.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R8 — Cheat Death intercepts a lethal reversal and is spent by it', () => {
    for (const victimSide of SIDES) {
        // NON-VACUITY: the repair (RAW) is strictly larger than the victim's HP, so without an
        // intercept the victim dies — a victim that would have survived anyway proves nothing.
        // The SECOND round is what proves the save was SPENT rather than merely present: the
        // status is re-applied each round, and the second reversal must kill.
        it(`${victimSide}-side victim: survives at 1 HP once, then dies to the next reversal`, () => {
            const LETHAL_START = RAW / 2; // < RAW ⇒ lethal without the intercept
            const run = runFixture({
                victimSide,
                statusName: REVERSED,
                victimMaxHp: VICTIM_MAX_HP,
                victimStartHp: LETHAL_START,
                victimSlots: [{ slot: 'active', abilities: [namedSelfBuff('Cheat Death')] }],
                numRounds: 2,
            });

            // Exactly one intercept, in round 1.
            const saves = cheatDeaths(run.events).filter((e) => e.actorId === VICTIM_ID);
            expect(saves).toHaveLength(1);
            expect(saves[0].round).toBe(1);

            // The save was SPENT: round 2's reversal is not intercepted.
            const kills = destroyed(run.events).filter((e) => e.actorId === VICTIM_ID);
            expect(kills).toHaveLength(1);
            expect(kills[0].round).toBe(2);
            expect(run.victimHp).toBe(0);
        });

        // The single-round half of the same ruling, stated on its own so the "survives at 1 HP"
        // outcome is pinned independently of the spend.
        it(`${victimSide}-side victim: the intercepted round leaves it alive at exactly 1 HP`, () => {
            const run = runFixture({
                victimSide,
                statusName: REVERSED,
                victimMaxHp: VICTIM_MAX_HP,
                victimStartHp: RAW / 2,
                victimSlots: [{ slot: 'active', abilities: [namedSelfBuff('Cheat Death')] }],
                numRounds: 1,
            });
            expect(cheatDeaths(run.events).filter((e) => e.actorId === VICTIM_ID)).toHaveLength(1);
            expect(destroyed(run.events).filter((e) => e.actorId === VICTIM_ID)).toHaveLength(0);
            expect(run.victimHp).toBe(1);
        });
    }
});

// ══ R10′ ═════════════════════════════════════════════════════════════════════════════════════
// "A reversed repair books NOTHING on the healer." Repairs cast 0, effective healing 0,
// overhealing 0. Owner's words: "we don't need to book it as anything other than damage from a
// debuff" — and that damage is R7′'s, on the applier.
//
// ⚠️ THIS REPLACES A RETRACTED RULING that surfaced the reversal as the healer's OVERHEALING.
// All three buckets are asserted, not just `overheal`: the gross `directHeal` credit is written by
// the CALL SITE, above the apply, and the closure cannot retract it — so a build that returned
// `{consumed: 0, overheal: 0}` and changed nothing else would pass an overheal-only assertion
// while still crediting the medic the full repair as repairs cast.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R10′ — a reversed repair books nothing at all on the healer', () => {
    // The source-axis buckets exist only for a PLAYER healer: an enemy heal is `healEventOnly`
    // (E5 §4.1) and contributes nothing to the healing report. The enemy arm asserts the same
    // ruling through `heal-performed.perTarget[].overheal`, which IS team-symmetric — and both
    // arms assert the HP half.
    //
    // ⚠️ NOT a full team-symmetric test of the CREDIT MOVE (#362 fix-wave-1 review). The enemy-side
    // arm's repair runs through `playerTurn.ts`'s `healEventOnly` branch (was `:4266`), which per
    // the design brief credits NOTHING even in the control case — "not an oversight, enemy heals
    // are excluded from the player healing buckets by design" — so there is no gross bucket for a
    // reversal to suppress there in the first place. That arm therefore proves R10′'s HP half
    // team-symmetrically, but it cannot and does not exercise the bucket-credit-move logic this
    // describe block is named for: only the player arm below does that job. If this file's team
    // symmetry is ever audited for "does every ruling have a real enemy-side instrument", this is
    // the one exception, and it is exception BY DESIGN, not a gap.
    it('player-side victim: directHeal, effectiveHeal and overheal are ALL zero', () => {
        const DEFICIT_START = VICTIM_MAX_HP / 2; // deficit ≫ RAW, so the control fully CONSUMES
        const { reversed, control } = bothArms({
            victimSide: 'player',
            victimStartHp: DEFICIT_START,
        });

        const controlRound = control.result.healing!.rounds[0];
        const reversedRound = reversed.result.healing!.rounds[0];

        // NON-VACUITY: the identical fixture DOES book on the medic without the status — the full
        // repair as gross, and all of it effective. Every zero below is measured against these.
        expect(controlRound.perActor.get(control.medicId)!.directHeal).toBe(RAW);
        expect(controlRound.perActor.get(control.medicId)!.effectiveHeal).toBe(RAW);
        expect(controlRound.perActor.get(control.medicId)!.overheal).toBe(0);
        expect(controlRound.perRecipient.get(VICTIM_ID)!.directHeal).toBe(RAW);
        // …and the RECIPIENT axis is populated too, with the whole repair landing as effective
        // (#362 fix-wave-2, M-6): without this the victim's three zeros below could equally mean
        // "the per-recipient map is never written in this fixture". `overheal` has no non-zero
        // control available here BY FIXTURE DESIGN — the deficit is ≫ RAW so the control clips
        // nothing — and the `heal-performed` over-repair test below is where that one is measured
        // against a full-HP control instead.
        expect(controlRound.perRecipient.get(VICTIM_ID)!.effectiveHeal).toBe(RAW);
        expect(controlRound.perRecipient.get(VICTIM_ID)!.overheal).toBe(0);

        // R10′: nothing. The medic may have no entry at all (nothing was ever credited to it), so
        // read through an optional chain rather than `!` — a `toBe(0)` on a missing entry would
        // throw rather than assert.
        const medic = reversedRound.perActor.get(reversed.medicId);
        expect(medic?.directHeal ?? 0).toBe(0);
        expect(medic?.effectiveHeal ?? 0).toBe(0);
        expect(medic?.overheal ?? 0).toBe(0);

        // The recipient axis agrees: the victim was not repaired, so it books nothing either.
        const recipient = reversedRound.perRecipient.get(VICTIM_ID);
        expect(recipient?.directHeal ?? 0).toBe(0);
        expect(recipient?.effectiveHeal ?? 0).toBe(0);
        expect(recipient?.overheal ?? 0).toBe(0);
    });

    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: heal-performed reports NO over-repair for the reversed repair`, () => {
            const { reversed, control } = bothArms({
                victimSide,
                // FULL HP: the control's repair is entirely WASTED here, so it reports the whole
                // RAW as over-repair. That is what makes the reversed arm's absent `overheal`
                // falsifiable — on a deficit fixture both arms would report none.
                victimStartHp: VICTIM_MAX_HP,
            });

            const perTargetOf = (run: FixtureRun) =>
                healPerformed(run.events)
                    .filter((e) => e.casterId === run.medicId)
                    .flatMap((e) => e.perTarget ?? [])
                    .filter((t) => t.targetId === VICTIM_ID);

            // NON-VACUITY: the control's repair is fully wasted, so it DOES report over-repair.
            const controlRows = perTargetOf(control);
            expect(controlRows).toHaveLength(1);
            expect(controlRows[0].amount).toBe(RAW);
            expect(controlRows[0].overheal).toBe(RAW);

            // The reversed repair is not over-repair — it is damage. The row still exists (the
            // cast happened, and R9's charge passive rides it) but carries no over-repair.
            const reversedRows = perTargetOf(reversed);
            expect(reversedRows).toHaveLength(1);
            expect(reversedRows[0].amount).toBe(RAW);
            expect(reversedRows[0].overheal).toBeUndefined();
        });
    }
});

// ══ R11 ══════════════════════════════════════════════════════════════════════════════════════
// "A reversal writes its own combat-log line, including when it does not kill."
//
// The NON-LETHAL case is the one that matters: a lethal reversal at least produces a death row, so
// something in the log moves. A non-lethal one previously emitted NOTHING — the player watched a
// repair land, achieve nothing, and HP drop, with no line connecting the three.
//
// These assertions run through the REAL `buildCombatLog` over the REAL event stream, subscribed
// from the production `LOG_EVENT_TYPES` list. An event nothing displays is not a log line, so a
// bus-level `expect(events).toContainEqual(...)` would not have been enough: it would pass with
// the type missing from LOG_EVENT_TYPES, or with no handler in buildCombatLog, in both of which
// cases the row is invisible in the app.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R11 — every reversal writes a combat-log row, lethal or not', () => {
    const reversalRows = (run: FixtureRun) =>
        run.logEntries.filter((e) => e.kind === 'reversed-repair');

    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: a NON-lethal reversal produces one row naming the applier, the victim and the amount`, () => {
            const START = VICTIM_MAX_HP / 2; // deficit ≫ RAW ⇒ survivable
            const { reversed, control } = bothArms({ victimSide, victimStartHp: START });

            // NON-VACUITY: the same fixture without the status writes no such row — so the row is
            // the reversal's, not something every run of this fixture produces.
            expect(reversalRows(control)).toHaveLength(0);
            // …and the reversal really was non-lethal (the death row is what would otherwise have
            // carried the story).
            expect(reversed.victimHp).toBe(START - RAW);
            expect(destroyed(reversed.events).filter((e) => e.actorId === VICTIM_ID)).toHaveLength(
                0
            );

            const rows = reversalRows(reversed);
            expect(rows).toHaveLength(1);
            // Booked to the APPLIER (matching R7′'s damage credit), with the burned ship as the
            // target and the burn as its amount.
            expect(rows[0].actorId).toBe(reversed.zosimosId);
            expect(rows[0].actorId).not.toBe(reversed.medicId);
            expect(rows[0].targets).toEqual([{ targetId: VICTIM_ID, amount: RAW }]);
            // #362 fix-wave-1: `healerId` names the medic — DISPLAY ONLY. It rides alongside the
            // applier attribution above without displacing it: `actorId` is still Zosimos, not the
            // medic, and the assertion above already proves that independently of this one.
            expect(rows[0].healerId).toBe(reversed.medicId);
        });

        it(`${victimSide}-side victim: a LETHAL reversal writes the row too, before the death row`, () => {
            const LETHAL_START = RAW / 2;
            const run = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: LETHAL_START,
            });

            expect(run.victimHp).toBe(0);
            const rows = reversalRows(run);
            expect(rows).toHaveLength(1);
            expect(rows[0].actorId).toBe(run.zosimosId);

            // ORDER: the burn is the cause, the death is the consequence — the log must read that
            // way. Both are rank-2 consequence rows, so they keep emission order.
            const kinds = run.logEntries.map((e) => e.kind);
            expect(kinds).toContain('death');
            expect(kinds.indexOf('reversed-repair')).toBeLessThan(kinds.indexOf('death'));
        });
    }
});

// ══ R11, deferral-window nesting (#362 fix-wave-1, M-3) ═════════════════════════════════════════
// The LETHAL test above proves "cause precedes consequence" for the reversal-vs-death ordering,
// but every channel exercised so far (cast/HoT/leech) fires from the ACTOR'S OWN turn, never from
// inside another action's resolution. `emitConsequenceLog`'s comment at the reversal branch claims
// it "buffers correctly inside a deferral window (a reactive repair during a positional apply does
// exactly that)" — a claim no fixture in this file had actually driven through a real deferral
// window. This one does: the victim's own on-attacked passive reactively repairs itself while
// ZOSIMOS's attack is being resolved (`drivePositionalApply`), and that reactive repair is what
// gets reversed — so the row is written from INSIDE the attack's own resolution, not from a plain
// top-level cast.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R11 deferral-window nesting — a reactive reversal fired mid-attack still logs after the attack that triggered it', () => {
    const REACT_PCT = 10;
    const REACT_RAW = VICTIM_MAX_HP * (REACT_PCT / 100); // 10,000, off the victim's OWN max HP
    const ATTACK_STAT = 5_000;
    const reversalRows = (run: FixtureRun) =>
        run.logEntries.filter((e) => e.kind === 'reversed-repair');

    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: the reactive reversal's row is not printed above Zosimos's attack`, () => {
            const { reversed, control } = bothArms({
                victimSide,
                // Headroom for BOTH the attack's own damage (~ATTACK_STAT) and the reactive burn
                // (REACT_RAW) without the round being lethal — a death would introduce its own
                // "cause precedes consequence" row and confound which ordering this test pins.
                victimStartHp: VICTIM_MAX_HP / 2,
                victimSlots: [{ slot: 'passive', abilities: [reactiveSelfRepair(REACT_PCT)] }],
                zosimosAttack: ATTACK_STAT,
            });

            // NON-VACUITY (1): the reactive channel is really live in BOTH arms — the passive
            // fires off being attacked regardless of the status, exactly like channel 4's own
            // "the reactive is demonstrably live in the reversed run's own fixture" discipline.
            const reactiveHealsOf = (run: FixtureRun) =>
                eventsOfType(run.events, 'reactive-heal-performed').filter(
                    (e) => e.casterId === VICTIM_ID
                );
            expect(reactiveHealsOf(control)).toHaveLength(1);
            expect(reactiveHealsOf(control)[0].amount).toBe(REACT_RAW);
            expect(reactiveHealsOf(reversed)).toHaveLength(1);

            // NON-VACUITY (2): the attack that triggers the reactive really landed on the victim —
            // "no attack, no positional apply, no genuine deferral window" would otherwise make
            // this indistinguishable from the plain top-level LETHAL test above.
            const attacksOn = (run: FixtureRun) =>
                eventsOfType(run.events, 'attacked').filter((e) => e.targetId === VICTIM_ID);
            expect(attacksOn(reversed).length).toBeGreaterThan(0);

            // NON-LETHAL, so the death row cannot be what carries the ordering story here.
            expect(destroyed(reversed.events).filter((e) => e.actorId === VICTIM_ID)).toHaveLength(
                0
            );

            expect(reversalRows(control)).toHaveLength(0);

            // This fixture's medic ALSO casts its own (unrelated) repair on the victim every round
            // — `runFixture` always wires one — so it too reverses, on the MEDIC'S turn, and both
            // rows carry `kind: 'reversed-repair'`. `healerId` (#362 fix-wave-1) is what tells them
            // apart without relying on emission order alone: the reactive row's healer is the
            // VICTIM itself (a self-heal); the cast row's healer is the medic.
            const reactiveRow = reversalRows(reversed).find((e) => e.healerId === VICTIM_ID);
            expect(reactiveRow).toBeDefined();

            // ORDER: the attack is the cause (it is what triggered the reactive), the reversed
            // repair is its consequence — fired from INSIDE that attack's own positional apply, in
            // ZOSIMOS's turn, not the medic's later one. Whether `buildCombatLog` nests it into the
            // attack entry's `.reactions[]` or simply keeps it AFTER the attack entry in emission
            // order, it must never print above the attack that caused it.
            const attackIndex = reversed.logEntries.findIndex((e) => e.kind === 'attack');
            const reactiveRowIndex = reversed.logEntries.indexOf(reactiveRow!);
            expect(attackIndex).toBeGreaterThanOrEqual(0);
            expect(reactiveRowIndex).toBeGreaterThan(attackIndex);
        });
    }
});

// ══ C-1 ══════════════════════════════════════════════════════════════════════════════════════
// THE BATTLE REPORT (`assembleBattleResult` → `ShipRoundState`). Every test above measures an
// ENGINE channel; this block measures the user-facing surface those channels feed, because the
// two disagreed and the report is what the player actually reads.
//
// R10′ was implemented against the `ActorHealing` buckets — but `heal-performed` is a SECOND,
// independent channel into the same report (`healDone`/`healReceived`), and the burn's intake was
// only booked on `perTargetDamage`, not on `perActorIncoming`, which is what `hpPct` reads. The two
// omissions compounded in the SAME direction: the report credited the medic healing it never did
// AND under-counted the HP the victim lost, so the bar read high by the burn — permanently, and by
// exactly the amount that was reversed.
//
// Four numbers per victim row, all four asserted here against a CONTROL arm that differs only in
// the status name:
//   1. `healingDone`     (the medic's row)  — R10′, the heal-performed channel.
//   2. `healingReceived` (the victim's row) — R10′, the perTarget channel.
//   3. `incomingDamage`  (the victim's row) — the intake booking.
//   4. `hpPct`           (the victim's row) — the bar, which is 1–3 compounded.
//
// The `hpPct` assertion is pinned to the LIVE actor's real final HP rather than to a literal, so
// it cannot drift into agreeing with a wrong report: the fixture's own `victimHp` is the referee.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('the battle report — a reversed repair is not healing, and its burn is HP lost', () => {
    /** The run's round-1 rows, as `assembleBattleResult` (the real battle-report assembler) folds
     *  them. Built from the SAME engine output the assertions above read, so nothing here is a
     *  hand-made stand-in for the pipeline. */
    const reportRows = (run: FixtureRun, victimSide: 'player' | 'enemy') => {
        const foeSide = victimSide === 'player' ? 'enemy' : 'player';
        const rd = run.result.rounds[0];
        const battle = assembleBattleResult({
            events: run.events,
            perRoundPerTarget: { [rd.round]: rd.perTargetDamage ?? {} },
            perRoundPerIncoming: { [rd.round]: rd.perActorIncoming ?? {} },
            perRoundPerDealt: { [rd.round]: rd.perTargetDealt ?? {} },
            roster: [
                {
                    actorId: run.medicId,
                    side: victimSide,
                    name: 'Medic',
                    position: 'M1',
                    maxHp: MEDIC_HP,
                },
                {
                    actorId: VICTIM_ID,
                    side: victimSide,
                    name: 'Victim',
                    position: 'M4',
                    maxHp: run.victimMaxHp,
                },
                {
                    // Zosimos's OWN row is never read by any assertion here (only the medic's and
                    // the victim's are), so its maxHp is a placeholder rather than the fixture's
                    // real figure — it only has to be non-zero so `clampPct` has a denominator.
                    actorId: run.zosimosId,
                    side: foeSide,
                    name: 'Zosimos',
                    position: 'M1',
                    maxHp: MEDIC_HP,
                },
            ],
            numRounds: 1,
        });
        const ships = battle.rounds[0].ships;
        return {
            medic: ships.find((s) => s.actorId === run.medicId)!,
            victim: ships.find((s) => s.actorId === VICTIM_ID)!,
        };
    };

    /** The bar the report draws, and the bar the ship's REAL HP justifies. They must be equal. */
    const livePct = (run: FixtureRun) => (100 * run.victimHp) / run.victimMaxHp;

    for (const victimSide of SIDES) {
        // ARM A — the reversal is the ONLY thing that touches the victim's HP this round. This arm
        // isolates the heal-performed half: with no attack the victim has no intake entry at all,
        // so `hpLost` falls back to `damageTaken` (which already carried the burn) and the ONLY
        // way the bar can be wrong is the phantom healing cancelling the loss back out.
        it(`${victimSide}-side victim: a reversal-only round books no healing and moves the bar down`, () => {
            const START = VICTIM_MAX_HP; // full HP ⇒ the control's repair is entirely wasted
            const { reversed, control } = bothArms({ victimSide, victimStartHp: START });

            const rev = reportRows(reversed, victimSide);
            const ctl = reportRows(control, victimSide);

            // NON-VACUITY: the identical fixture, minus the status name, reports the medic doing
            // RAW of healing and the victim receiving it. Every zero below is measured against this.
            expect(ctl.medic.healingDone).toBe(RAW);
            expect(ctl.victim.healingReceived).toBe(RAW);
            expect(ctl.victim.hpPct).toBe(100);
            expect(control.victimHp).toBe(START); // …all of it clipped: the victim was already full

            // (1) + (2) — R10′ on the report's two healing axes.
            expect(rev.medic.healingDone).toBe(0);
            expect(rev.victim.healingReceived).toBe(0);
            // (3) the burn is HP the victim lost…
            expect(rev.victim.damageTaken).toBe(RAW);
            // (4) …and the bar says so. Pinned to the LIVE actor, which really is down by RAW.
            expect(reversed.victimHp).toBe(START - RAW);
            expect(rev.victim.hpPct).toBe(livePct(reversed));
            expect(rev.victim.hpPct).toBeLessThan(100);
        });

        // ARM B — an ordinary attack AND the reversal in the SAME round. This is the arm the
        // intake booking exists for: the attack gives the victim a `perActorIncoming` entry, so
        // `hpLost` stops falling back to `damageTaken` and reads the intake bucket instead — where
        // the burn was missing. Both halves of the defect are live here at once.
        it(`${victimSide}-side victim: an attack AND a reversal in one round, and the bar matches real HP`, () => {
            const START = VICTIM_MAX_HP;
            const { reversed, control } = bothArms({
                victimSide,
                victimStartHp: START,
                zosimosAttack: 40_000,
            });

            const rev = reportRows(reversed, victimSide);
            const ctl = reportRows(control, victimSide);

            // The attack is LIVE and identical in both arms (no RNG in this fixture) — so any gap
            // between the arms' HP numbers is the reversal and nothing else.
            const attackDamage = ctl.victim.incomingDamage;
            expect(attackDamage).toBeGreaterThan(0);
            expect(attackDamage).toBeLessThan(START - RAW); // survivable, both arms

            // CONTROL: the medic really repairs, and the bar reflects attack minus repair.
            expect(ctl.medic.healingDone).toBe(RAW);
            expect(ctl.victim.healingReceived).toBe(RAW);
            expect(control.victimHp).toBe(START - attackDamage + RAW);
            expect(ctl.victim.hpPct).toBe(livePct(control));

            // REVERSED, (1) + (2): nothing was healed, by anyone, for anyone.
            expect(rev.medic.healingDone).toBe(0);
            expect(rev.victim.healingReceived).toBe(0);
            // (3): the intake bucket carries the attack AND the burn — the burn passes no shield,
            // Barrier or defence layer, so all of it is HP loss.
            expect(rev.victim.incomingDamage).toBe(attackDamage + RAW);
            expect(rev.victim.damageTaken).toBe(attackDamage + RAW);
            // (4): the bar. The victim really is down by attack + burn, and the report agrees to
            // the point — this is the assertion that read 90% on a 70% ship.
            expect(reversed.victimHp).toBe(START - attackDamage - RAW);
            expect(rev.victim.hpPct).toBe(livePct(reversed));
            // …and the two arms differ by exactly 2 × RAW of bar (the repair the control got, plus
            // the burn the reversed run took), which is the whole size of the reported error.
            expect(ctl.victim.hpPct - rev.victim.hpPct).toBeCloseTo(
                (100 * 2 * RAW) / VICTIM_MAX_HP,
                10
            );
        });

        // The event still FIRES. R9 (Zosimos's "when an enemy performs a repair" charge passive)
        // and every other on-repair rider key off `heal-performed`, so the fix marks the reversed
        // portion rather than suppressing the emit. If a future change silences the event to make
        // the healing numbers zero, this is the assertion that catches it.
        it(`${victimSide}-side victim: heal-performed still fires, carrying the reversed portion`, () => {
            const { reversed } = bothArms({
                victimSide,
                victimStartHp: VICTIM_MAX_HP / 2,
            });

            const perfs = healPerformed(reversed.events).filter(
                (e) => e.casterId === reversed.medicId
            );
            expect(perfs).toHaveLength(1);
            // GROSS `amount` is unchanged — it is what the emit gate and the riders read.
            expect(perfs[0].amount).toBe(RAW);
            // …and the whole of it is flagged as having healed nobody.
            expect(perfs[0].reversedAmount).toBe(RAW);
            const pt = perfs[0].perTarget!.find((p) => p.targetId === VICTIM_ID);
            expect(pt).toBeDefined();
            expect(pt!.amount).toBe(RAW);
            expect(pt!.reversed).toBe(true);
            // A reversed repair damages; it does not WASTE. `overheal` must stay absent on both
            // axes even though the recipient's deficit was never filled.
            expect(pt!.overheal).toBeUndefined();
            expect(perfs[0].overheal).toBeUndefined();
        });
    }
});

// ══ Negative-raw clamp (code-review finding, #362) ══════════════════════════════════════════════
// `incomingHealPct` is unclamped (R6's own channel), so a big enough `Inc. Repair Down` — beyond
// -100%, not just R6's -50% — flips a positive repair into a negative `raw` by the time it reaches
// the reversal branch. The non-reversed path three lines below the reversal handles that case
// safely: `Math.max(0, Math.min(raw, targetMaxHp - currentHp))` floors a negative `raw` at 0. The
// reversal branch owes the SAME guarantee — a reversal only ever REMOVES HP — via its own
// `burn = Math.max(0, raw)` clamp.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('the negative-raw clamp — a repair reduced past -100% burns nothing, and never heals', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: -200% Inc. Repair Down flips raw negative, and the reversal burns nothing instead of healing`, () => {
            // Near max HP (not AT max), so a buggy `currentHp - raw` with raw = -RAW would have
            // pushed the victim's HP to 105,000 — past its own 100,000 max — making the uncapped
            // heal an observable violation, not just a same-value coincidence.
            const START = VICTIM_MAX_HP - RAW / 2; // 95,000

            // (1) THE INSTRUMENT: short of the sign flip, the fold still heals normally — proving
            // -200% really is what flips the sign, rather than this fixture always landing on 0
            // for some unrelated reason (e.g. START already at the deficit clamp).
            const halved = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: START,
                incomingRepairDownPct: -50,
            });
            expect(halved.victimHp).toBe(START + RAW / 2);

            // (2) The pre-existing (non-reversed) path already handles a negative raw safely: its
            // deficit clamp floors at 0, so a CONTROL run at -200% reports no change at all.
            const flippedControl = runFixture({
                victimSide,
                statusName: CONTROL,
                victimStartHp: START,
                incomingRepairDownPct: -200,
            });
            expect(flippedControl.victimHp).toBe(START);

            // (3) THE FINDING: the reversal branch must agree. Before the fix, `victim.currentHp =
            // Math.max(0, victim.currentHp - raw)` with a negative raw RAISED HP, uncapped by max
            // HP — silently, since `bookReversalDamage` and the log row both gate on a positive
            // amount. After the fix, `burn = Math.max(0, raw)` is 0, so nothing moves.
            const flippedReversal = runFixture({
                victimSide,
                statusName: REVERSED,
                victimStartHp: START,
                incomingRepairDownPct: -200,
            });
            expect(flippedReversal.victimHp).toBe(START); // did not rise
            expect(flippedReversal.victimHp).toBeLessThanOrEqual(VICTIM_MAX_HP); // never past max

            // No damage booked and no log row — the burn was genuinely zero, not merely displayed
            // as zero (mirrors R11's "a 0-magnitude burn writes no row" gate).
            const dealtBy = (run: FixtureRun, attackerId: string) =>
                run.result.rounds[0].perTargetDealt?.[attackerId]?.[VICTIM_ID] ?? 0;
            expect(dealtBy(flippedReversal, flippedReversal.zosimosId)).toBe(0);
            expect(
                flippedReversal.logEntries.filter((e) => e.kind === 'reversed-repair')
            ).toHaveLength(0);
        });
    }
});
