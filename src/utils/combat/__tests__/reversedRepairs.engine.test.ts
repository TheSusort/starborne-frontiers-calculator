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
    ...(args.incomingHeal !== undefined
        ? { preFight: preFightWith(args.incomingHeal) }
        : {}),
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
        ...(args.incomingHeal !== undefined
            ? { preFight: preFightWith(args.incomingHeal) }
            : {}),
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
    // A single catch-all subscription would need one `bus.on` per event type; these three are the
    // only channels any assertion below reads, and collecting them by name keeps each test's filter
    // explicit about what it is looking for.
    for (const type of [
        'ship-destroyed',
        'cheat-death-activated',
        'heal-performed',
    ] as const) {
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

    return {
        victimHp: victim!.currentHp,
        victimShield: victim!.shieldPool,
        protectorHp: protector?.currentHp ?? 0,
        events,
        result,
        medicId: opts.victimSide === 'player' ? FOCUS_ID : MEDIC_ID,
        zosimosId: opts.victimSide === 'player' ? ZOSIMOS_ID : FOCUS_ID,
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

// ══ R1 ═══════════════════════════════════════════════════════════════════════════════════════
// "No defensive layers. No shield drain, no Protection redirect, no defence mitigation, no
// Barrier. A raw HP burn at face value." All four are owned by the damage funnel
// (`applyVictimDamage`), which the reversal deliberately never enters — so the rulings are
// satisfied by the branch's POSITION, and these tests prove it sits there.
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

// ══ R7 ═══════════════════════════════════════════════════════════════════════════════════════
// "It can kill, and the kill is credited to the HEALER whose repair was reversed — never to the
// Zosimos that applied the debuff." The two carry different ids in both arms, so the assertion
// can tell them apart.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R7 — a lethal reversal credits the healer, not the debuff applier', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: ship-destroyed names the medic as killer`, () => {
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
            // The healer, explicitly not the applier. The two ids differ in both arms.
            expect(reversed.medicId).not.toBe(reversed.zosimosId);
            expect(kills[0].killerId).toBe(reversed.medicId);
            expect(kills[0].killerId).not.toBe(reversed.zosimosId);
            // A reversed repair is not a hit: the consumables that spend on a direct hit must not
            // see one.
            expect(kills[0].byDirectDamage).toBeFalsy();
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

// ══ R10 ══════════════════════════════════════════════════════════════════════════════════════
// "Surfaces as OVERHEALING for the healer. Its healing total shows the repair fully wasted; its
// damage-dealt total is not credited. No new report field." Delivered by returning the EXISTING
// `{ consumed: 0, overheal: raw }` shape, which every call site already books that way.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R10 — a reversed repair books as the healer’s overheal, and as nobody’s damage', () => {
    // The source-axis buckets exist only for a PLAYER healer: an enemy heal is `healEventOnly`
    // (E5 §4.1) and contributes nothing to the healing report. The enemy arm asserts the same
    // ruling through `heal-performed.perTarget[].overheal`, which IS team-symmetric — and both
    // arms assert the HP and damage halves.
    it('player-side victim: the healer’s overheal gains RAW and its effectiveHeal gains 0', () => {
        const DEFICIT_START = VICTIM_MAX_HP / 2; // deficit ≫ RAW, so the control fully CONSUMES
        const { reversed, control } = bothArms({
            victimSide: 'player',
            victimStartHp: DEFICIT_START,
        });

        const controlRound = control.result.healing!.rounds[0];
        const reversedRound = reversed.result.healing!.rounds[0];

        // NON-VACUITY: with a real deficit the control books the OPPOSITE split — all effective,
        // no overheal. On a full-HP victim both runs would book `overheal: RAW` and the assertion
        // could not fail.
        expect(controlRound.perActor.get(control.medicId)!.effectiveHeal).toBe(RAW);
        expect(controlRound.perActor.get(control.medicId)!.overheal).toBe(0);

        expect(reversedRound.perActor.get(reversed.medicId)!.effectiveHeal).toBe(0);
        expect(reversedRound.perActor.get(reversed.medicId)!.overheal).toBe(RAW);
        // The raw = effective + overheal identity still holds.
        expect(reversedRound.perActor.get(reversed.medicId)!.directHeal).toBe(RAW);

        // The recipient axis agrees.
        expect(reversedRound.perRecipient.get(VICTIM_ID)!.overheal).toBe(RAW);
        expect(reversedRound.perRecipient.get(VICTIM_ID)!.effectiveHeal).toBe(0);
    });

    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: the burn is credited as nobody’s damage`, () => {
            const { reversed, control } = bothArms({
                victimSide,
                victimStartHp: VICTIM_MAX_HP / 2,
                // A real attack, so every damage channel this asserts on is demonstrably non-zero
                // in BOTH runs — "no damage credited" over an all-zero board is vacuous.
                zosimosAttack: 20_000,
            });

            const dmgOf = (run: FixtureRun) => run.result.rounds[0].perTargetDamage?.[VICTIM_ID] ?? 0;
            const intakeOf = (run: FixtureRun) =>
                run.result.rounds[0].perActorIncoming?.[VICTIM_ID]?.incoming ?? 0;

            // The channels are live.
            expect(dmgOf(control)).toBeGreaterThan(0);
            expect(intakeOf(control)).toBeGreaterThan(0);
            // …and the reversal added nothing to either, while unmistakably moving HP.
            expect(dmgOf(reversed)).toBe(dmgOf(control));
            expect(intakeOf(reversed)).toBe(intakeOf(control));
            expect(control.victimHp - reversed.victimHp).toBe(2 * RAW);
        });

        it(`${victimSide}-side victim: heal-performed reports the whole repair as over-repair`, () => {
            const { reversed, control } = bothArms({
                victimSide,
                victimStartHp: VICTIM_MAX_HP / 2,
            });

            const perTargetOf = (run: FixtureRun) =>
                healPerformed(run.events)
                    .filter((e) => e.casterId === run.medicId)
                    .flatMap((e) => e.perTarget ?? [])
                    .filter((t) => t.targetId === VICTIM_ID);

            // NON-VACUITY: the control's repair lands entirely, so it reports NO over-repair.
            const controlRows = perTargetOf(control);
            expect(controlRows).toHaveLength(1);
            expect(controlRows[0].amount).toBe(RAW);
            expect(controlRows[0].overheal ?? 0).toBe(0);

            const reversedRows = perTargetOf(reversed);
            expect(reversedRows).toHaveLength(1);
            expect(reversedRows[0].amount).toBe(RAW);
            expect(reversedRows[0].overheal).toBe(RAW);
        });
    }
});
