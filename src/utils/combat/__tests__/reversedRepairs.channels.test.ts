/**
 * `Reversed Repairs` (#362) — CHANNEL COVERAGE (R2) and REACTION INERTNESS (R5).
 *
 * Task 5 shipped the reversal itself and proved the magnitude rulings (R1/R3/R4/R6/R7/R8/R10)
 * through ONE channel: a cast repair. It deliberately left the two COVERAGE claims to this file.
 *
 *  - **R2** — *every* repair channel reverses, and a shield GRANT does not. Task 5 rests that on
 *    the branch's position (`applyHealToTarget` is the only line in the engine where HP goes up).
 *    A structural argument is not a measurement: this file drives each channel for real.
 *  - **R5** — *nothing* reacts to the resulting damage. Structurally this holds because all four
 *    reactions subscribe to the `attacked` event (`triggers.ts:1036` for `on-attacked`, `:1157`
 *    for `on-ally-attacked`) which is emitted only by `emitAttacked` / `emitPerVictimAttacked`,
 *    and by `perActorReflected`/`takenLeechesByOwner` reads that live *inside* `applyVictimDamage`
 *    — none of which the reversal branch touches. Again: verified here, not assumed.
 *
 * ── THE TEST-DESIGN RULE THIS FILE IS BUILT AROUND ────────────────────────────────────────────
 * Every "it does NOT happen" assertion is worthless unless the SAME fixture proves the thing DOES
 * happen in an equivalent non-reversed scenario. A fixture with no counterattacker passes "no
 * counterattack fired" trivially. So:
 *
 *   - Each R5 arm runs TWICE against the same victim kit: once with a reversed repair landing
 *     (assert silent) and once with an ordinary attack of at least the repair's magnitude
 *     (assert the reaction fires, with a non-zero payload).
 *   - Each R2 positive channel runs TWICE: with the debuff (HP goes DOWN by X) and without it
 *     (HP goes UP by the SAME X). A channel that silently restores nothing in the fixture would
 *     pass a one-armed "HP did not go up" test while proving nothing at all.
 *
 * ── Harness ───────────────────────────────────────────────────────────────────────────────────
 * Same shape as `reversedRepairs.engine.test.ts` (real `runCombat`, hand-built abilities, the
 * status planted through the real `applyTimedAbilityStatus` seam, a `CONTROL` twin that plants an
 * unmodelled name through the identical path, and both `victimSide` arms of every behavioural
 * test). A test-double `HealingRuntimeCtx` has no reversal branch, so nothing here uses one.
 *
 * THREE ROLES, identical on both sides — only which side they stand on changes:
 *   - ZOSIMOS  applies the status (a plain on-cast `target: 'enemy'` debuff) and optionally
 *              attacks. Speed 950, so it always acts first.
 *   - VICTIM   carries the status. Speed 500, at M4 so `front` targeting binds to it.
 *   - MEDIC    the repair source. Speed 300 by default (acts last, after the status is standing);
 *              900 for the HoT channel, which needs the applier's turn ctx to exist first.
 *
 * NO RNG SEEDING, exactly as Task 5: every gate is pinned by RATE (`makeRateGate` fires whenever
 * `rate >= 1` and never when `rate <= 0`), so `crit: 0` removes the stream instead of fixing it.
 * `setupKeyedTestRng` is keyed per-`ownerId` and would hand the two side arms different draws,
 * which is exactly what the cross-arm equality assertions cannot tolerate.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { Position } from '../../../types/encounters';
import type { SelectedGameBuff } from '../../../types/calculator';

const REVERSED = 'Reversed Repairs';
/** A control run plants an unmodelled status name through the identical path, so every comparison
 *  isolates the 'Reversed Repairs' name and nothing else about the fixture. */
const CONTROL = 'Inert Marker';

const FOCUS_ID = 'attacker';
const VICTIM_ID = 'victim';
/** Non-focus ids for the two roles; whichever of them is the focus answers to FOCUS_ID instead. */
const MEDIC_ID = 'medic';
const ZOSIMOS_ID = 'zosimos';

const MEDIC_HP = 100_000;
const VICTIM_MAX_HP = 100_000;
const ZOSIMOS_HP = 10_000_000; // large enough that the victim's own attacks never kill it
/** The repair, as a % of a 100,000-HP basis — so its magnitude is arithmetic, not a golden. */
const REPAIR_PCT = 10;
const RAW = (MEDIC_HP * REPAIR_PCT) / 100; // 10,000

/** An ordinary attack that lands for AT LEAST what the repair reverses for. Every R5 instrument
 *  arm uses it, and asserts the landed damage really is >= RAW — so "the reaction did not fire on
 *  the reversal" can never be explained away as "the burn was too small to react to". */
const INSTRUMENT_ATTACK = 20_000;

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Ability factories ─────────────────────────────────────────────────────────────────────────

/** Zosimos's shape: a plain on-cast enemy debuff, landing through the per-victim
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
        duration: 5,
        application: 'apply',
    },
});

/** CHANNEL 1 — a cast repair. `'lowest-hp-ally'` excludes the caster and is footprint-exempt, so
 *  on a two-actor side it resolves to the victim with no positional coupling at all. */
const castRepair = (pct: number): Ability => ({
    id: 'ab-cast-repair',
    type: 'heal',
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'hp', noCrit: true },
});

/** CHANNEL 2 — a foreign-applier HoT. An ally-targeted `buff` carrying `hotPct`; the holder ticks
 *  it at its own turn start (`playerTurn.ts` `tickHot`) scaled by the APPLIER's effective max HP
 *  and credited to the APPLIER. The applier and the holder are deliberately different actors.
 *
 *  `target: 'ally'` FANS to the whole side, the caster included — the shape `healing.test.ts`'s
 *  own foreign-applier fixture uses and documents. So the applier holds a copy and self-ticks too,
 *  which is why the applier's `hotHeal` is a SUM and the test asserts `> 0` on it rather than an
 *  exact figure. The exact figures are asserted on `effectiveHeal`/`overheal`, which only the
 *  holder-is-the-anchor tick can book — i.e. only the victim's. */
const allyHotBuff = (hotPct: number): Ability => ({
    id: 'ab-ally-hot',
    type: 'buff',
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Repair Over Time II',
        parsedEffects: { hotPct },
        stacks: 1,
        isStackable: false,
        duration: 5,
    },
});

/** CHANNEL 3 — a standing damage-DEALT leech ("repair X% of damage dealt"), passive slot, self.
 *  Procs through the engine's `procStandingLeechesPerVictim`, never through the cast path. */
const standingLeech = (pct: number): Ability => ({
    id: 'ab-standing-leech',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all', noCrit: true },
});

/** CHANNEL 4 — a reactive repair fired from a passive slot through `triggers.ts`'s `executeIntent`
 *  (`start-of-round`, so it needs no attack to fire). `basis: 'target-hp'` resolves to the
 *  RECIPIENT's max HP, making the magnitude exact rather than owner-scoped. */
const reactiveRepair = (pct: number): Ability => ({
    id: 'ab-reactive-repair',
    type: 'heal',
    target: 'self',
    trigger: 'start-of-round',
    conditions: [],
    config: { type: 'heal', pct, basis: 'target-hp', noCrit: true },
});

/** CHANNEL 5, the NEGATIVE case — a cast SHIELD grant. Routes through `grantShieldToTarget`, a
 *  different closure with no reversal branch. Shields are not repairs (R2). */
const castShield = (pct: number): Ability => ({
    id: 'ab-cast-shield',
    type: 'shield',
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'shield', pct, basis: 'hp' },
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
    crit?: number;
    critDamage?: number;
    defence?: number;
    slots?: ShipSkills['slots'];
    /** Charge CAP for this actor. Only R9's Zosimos needs a non-zero one. */
    chargeCount?: number;
}

const walkedAlly = (args: RoleShape): TeamActorEngineInput => ({
    id: args.id,
    speed: args.speed,
    chargeCount: args.chargeCount ?? 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: args.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
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
        stats: {
            attack: args.attack ?? 0,
            crit: args.crit ?? 0,
            critDamage: args.critDamage ?? 0,
            defence: args.defence ?? 0,
            hp: args.hp,
            speed: args.speed,
            hacking: 100_000,
        },
        chargeCount: args.chargeCount ?? 0,
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
    /** `REVERSED` or `CONTROL`. */
    statusName: string;
    /** The medic's own active-slot kit — the repair or shield channel under test. */
    medicAbilities?: Ability[];
    /** Default 300 (acts LAST, so the status is standing). The HoT channel needs 900: a foreign
     *  HoT applier is skipped outright unless `lastTurnCtxByActor` already holds its turn ctx. */
    medicSpeed?: number;
    /** Extra slots on the victim's own kit (its leech, its reactive repair, its reactions). */
    victimSlots?: ShipSkills['slots'];
    /** The victim's ATTACK STAT. Stat only — it adds no ability, so a fixture decides for itself
     *  whether the victim also gets an active attack (channel 3) or only a counterattack (R5). */
    victimAttack?: number;
    victimMaxHp?: number;
    /** Seeded onto the live actor before round 1 via `__testTapActors`. Default: full HP. */
    victimStartHp?: number;
    /** >0 → Zosimos also fires a real attack at the victim. Every R5 instrument arm uses this. */
    zosimosAttack?: number;
    /** Extra slots on ZOSIMOS's own kit (R9's `on-enemy-repaired` charge passive). */
    zosimosSlots?: ShipSkills['slots'];
    /** Zosimos's charge CAP. A self-gain is clamped to it, so the R9 fence needs headroom — at 0
     *  (the default everywhere else) the grant would be capped away and the test would pass or
     *  fail for a reason that has nothing to do with the reversal. */
    zosimosChargeCount?: number;
    /** `'victim'` anchors the healing report on the victim — required by the HoT channel, whose
     *  tick applies HP only when the holder IS the anchor. Player-side arm only. */
    healAnchor?: 'focus' | 'victim';
    /** Top-level `enemyDebuffs` — the calculator's buff-picker channel (the SCHEDULED arm of the
     *  status read). These carry NO applier identity, which is the whole point of the fixture that
     *  uses them. Default `[]`, so every other test in this file is untouched. */
    scheduledEnemyDebuffs?: SelectedGameBuff[];
    numRounds?: number;
}

interface FixtureRun {
    /** The victim's LIVE final HP (the actor objects the tap hands out are the real ones). */
    victimHp: number;
    victimShield: number;
    events: CombatEvent[];
    result: ReturnType<typeof runCombat>;
    /** Whichever id the medic answers to in this arm — 'attacker' on the player arm, 'medic' on
     *  the enemy arm. Deliberately a DIFFERENT id from `zosimosId` in both arms. */
    medicId: string;
    zosimosId: string;
}

/** Every event type any assertion in this file reads. Collecting a superset is harmless. */
const COLLECTED = [
    'attacked',
    'heal-performed',
    'reactive-heal-performed',
    'reactive-damage-performed',
    'buff-applied',
    'charge-changed',
    'ship-destroyed',
] as const;

/**
 * One run of the fixture. Both arms build the SAME three roles with the same speeds, positions and
 * stats — only which side they stand on changes — so the two arms' deltas are directly comparable.
 */
function runFixture(opts: FixtureOpts): FixtureRun {
    const victimMaxHp = opts.victimMaxHp ?? VICTIM_MAX_HP;
    const zosimosAttack = opts.zosimosAttack ?? 0;
    const victimAttack = opts.victimAttack ?? 0;
    const medicSpeed = opts.medicSpeed ?? 300;

    const zosimosAbilities: Ability[] = [
        castStatus(opts.statusName),
        ...(zosimosAttack > 0 ? [basicAttack()] : []),
    ];
    const zosimosSlots: ShipSkills['slots'] = [
        activeSlot(zosimosAbilities),
        ...(opts.zosimosSlots ?? []),
    ];
    const zosimosChargeCount = opts.zosimosChargeCount ?? 0;
    const medicAbilities = opts.medicAbilities ?? [];

    const victimShape: RoleShape = {
        id: VICTIM_ID,
        position: 'M4' as Position,
        speed: 500,
        hp: victimMaxHp,
        attack: victimAttack,
        slots: opts.victimSlots ?? [],
    };

    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of COLLECTED) bus.on(type, (e: CombatEvent) => events.push(e));

    let victim: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        victim = actors.find((a) => a.id === VICTIM_ID);
        if (victim && opts.victimStartHp !== undefined) victim.currentHp = opts.victimStartHp;
    };

    // The heal ANCHOR. `'focus'` (the default) is never the victim, so nothing in those tests can
    // be an artefact of the victim happening to be the anchor.
    const healTargetId = opts.healAnchor === 'victim' ? VICTIM_ID : FOCUS_ID;

    const common = {
        numRounds: opts.numRounds ?? 1,
        selfBuffs: [],
        enemyDebuffs: opts.scheduledEnemyDebuffs ?? [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        defensePenetration: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        healTargetId,
        mode: 'healing' as const,
        // Turns on per-recipient APPLICATION: without it a repair aimed at a non-anchor ally never
        // reaches `applyHealToTarget` at all.
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
                  crit: 0,
                  critDamage: 0,
                  defence: 0,
                  hp: MEDIC_HP,
                  speed: medicSpeed,
                  position: 'M1',
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
                          attack: zosimosAttack,
                          chargeCount: zosimosChargeCount,
                          slots: zosimosSlots,
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
                  hp: ZOSIMOS_HP,
                  speed: 950,
                  position: 'M1',
                  chargeCount: zosimosChargeCount,
                  target: parseTarget('front'),
                  pattern: parsePattern('Pattern-Base'),
                  shipSkills: { slots: zosimosSlots },
                  teamActors: [],
                  enemyAttackers: [
                      enemyShip(victimShape),
                      enemyShip({
                          id: MEDIC_ID,
                          position: 'M1',
                          speed: medicSpeed,
                          chargeCount: 0,
                          hp: MEDIC_HP,
                          slots: [activeSlot(medicAbilities)],
                      }),
                  ],
              };

    const result = runCombat(input);

    return {
        victimHp: victim!.currentHp,
        victimShield: victim!.shieldPool,
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

const eventsOfType = <T extends CombatEvent['type']>(
    events: CombatEvent[],
    type: T
): Extract<CombatEvent, { type: T }>[] =>
    events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);

/** The victim's landed HP intake from ORDINARY attacks this round — the damage-funnel channel,
 *  read off `perActorIncoming` rather than off HP because the repair moves HP too. */
const attackIntakeOf = (run: FixtureRun) =>
    run.result.rounds[0].perActorIncoming?.[VICTIM_ID]?.incoming ?? 0;

// ══ R2 ═══════════════════════════════════════════════════════════════════════════════════════
// "EVERY repair, from ANY source, reverses." Task 5 rests this on the branch's POSITION: the
// closure is the only line in the engine where HP goes up, so cast / HoT / leech / reactive all
// funnel through it. These fixtures drive each one for real.
//
// EVERY positive channel below runs BOTH arms of the same fixture. The control arm is not
// decoration: a channel that silently restores nothing in a given fixture would pass a one-armed
// "the HP did not go up" test while proving nothing at all. So the control must show HP going UP
// by exactly the amount the reversal takes DOWN.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('R2 channel 1 — a CAST repair reverses', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: HP down by the repair, and the same fixture heals without the debuff`, () => {
            const START = VICTIM_MAX_HP / 2;
            const { reversed, control } = bothArms({
                victimSide,
                medicAbilities: [castRepair(REPAIR_PCT)],
                victimStartHp: START,
            });

            // The channel is LIVE in this fixture: without the debuff the repair lands for RAW.
            expect(control.victimHp - START).toBe(RAW);
            // …and with it, the same RAW comes off HP instead.
            expect(START - reversed.victimHp).toBe(RAW);
        });
    }
});

describe('R2 channel 2 — a HoT tick reverses', () => {
    // ⚠️ TWO STRUCTURAL CONSTRAINTS, both pre-existing and neither introduced by #362:
    //
    //  (a) The HoT tick applies HP only when the holder IS the healing anchor
    //      (`playerTurn.ts`: `if (actor.id === healing.targetId)`). So this fixture anchors the
    //      report on the victim (`healAnchor: 'victim'`) instead of on the focus.
    //  (b) The WHOLE HoT tick block sits inside `if (!healEventOnly)`, and `healEventOnly` is
    //      `true` for every enemy-side actor (`engine.ts` `enemyTurnBindings`). An enemy-side
    //      holder therefore never ticks a HoT at all, in ANY implementation. The enemy arm is
    //      not omitted — it is asserted below as the structural fact it is, with the CONTROL run
    //      proving the channel is dead there rather than merely quiet.
    //
    // THE ATTRIBUTION TRAP: `applyHealToTarget`'s `repairSourceId` for a HoT is the APPLIER, not
    // the holder. With a self-applied HoT the two coincide and an attribution bug is invisible, so
    // the applier here is the MEDIC and the holder is the VICTIM — different actors, and the
    // source-axis assertions below pin which one is credited.
    it('player-side victim: HP down by the tick, and the same fixture heals without the debuff', () => {
        const START = VICTIM_MAX_HP / 2;
        // The medic must act BEFORE the victim: a foreign applier whose turn ctx is not yet in
        // `lastTurnCtxByActor` is SKIPPED outright (the strict corrosion applier-ctx rule), which
        // would produce a fixture in which the tick never happens at all.
        const arm = (statusName: string) =>
            runFixture({
                victimSide: 'player',
                statusName,
                medicAbilities: [allyHotBuff(REPAIR_PCT)],
                medicSpeed: 900,
                healAnchor: 'victim',
                victimStartHp: START,
            });
        const control = arm(CONTROL);
        const reversed = arm(REVERSED);

        // The channel is LIVE: the tick is the medic's 100,000 max HP × 10% = RAW.
        expect(control.victimHp - START).toBe(RAW);
        expect(START - reversed.victimHp).toBe(RAW);

        // ATTRIBUTION — the trap this fixture exists for. The tick is credited to the APPLIER (the
        // medic, the focus here), never to the holder. The holder does not merely receive a
        // smaller share: it has NO source-axis entry at all. With a self-applied HoT the applier
        // and the holder would be the same actor and this could not fail.
        const round = (run: FixtureRun) => run.result.healing!.rounds[0];
        expect(round(control).perActor.get(FOCUS_ID)!.hotHeal).toBeGreaterThan(0);
        expect(round(control).perActor.get(VICTIM_ID)).toBeUndefined();
        expect(round(reversed).perActor.get(VICTIM_ID)).toBeUndefined();

        // R10′ — the GROSS bucket for this channel is `hotHeal`, not `directHeal`, and the reversed
        // tick books none of it. A DIFFERENTIAL rather than a zero, deliberately: `target: 'ally'`
        // fans to the caster too, so the medic also holds a copy and self-ticks — and that tick is
        // NOT reversed (the medic carries no debuff). The applier's `hotHeal` therefore drops by
        // exactly the victim's tick and no more.
        const controlHot = round(control).perActor.get(FOCUS_ID)!.hotHeal;
        const reversedHot = round(reversed).perActor.get(FOCUS_ID)!.hotHeal;
        expect(controlHot - reversedHot).toBe(RAW);
        // The consumption split isolates the VICTIM's tick specifically: a tick whose holder is
        // not the anchor books `hotHeal` and nothing else, so `effectiveHeal`/`overheal` here can
        // only have come from the victim's own tick — and R10′ says the reversed one books neither.
        expect(round(control).perActor.get(FOCUS_ID)!.effectiveHeal).toBe(RAW);
        expect(round(control).perActor.get(FOCUS_ID)!.overheal).toBe(0);
        expect(round(reversed).perActor.get(FOCUS_ID)!.effectiveHeal).toBe(0);
        expect(round(reversed).perActor.get(FOCUS_ID)!.overheal).toBe(0);
    });

    // NOT a behavioural claim about #362 — a fence over constraint (b) above. If a future change
    // ever lets an enemy-side holder tick a HoT, this test goes red and whoever makes that change
    // owes the enemy arm of the test above.
    it('enemy-side victim: the HoT channel does not exist at all (healEventOnly skips the tick)', () => {
        const START = VICTIM_MAX_HP / 2;
        const control = runFixture({
            victimSide: 'enemy',
            statusName: CONTROL,
            medicAbilities: [allyHotBuff(REPAIR_PCT)],
            medicSpeed: 900,
            victimStartHp: START,
        });
        // The CONTROL run is the measurement: the tick restores nothing on an enemy holder, so
        // there is no repair here for a reversal to reverse.
        expect(control.victimHp).toBe(START);
    });
});

describe('R2 channel 3 — a damage-dealt LEECH self-repair reverses', () => {
    for (const victimSide of SIDES) {
        // The victim attacks with its own basic attack and repairs itself from its own standing
        // leech (`procStandingLeechesPerVictim`), a path that never touches the cast pipeline.
        it(`${victimSide}-side victim: HP down by the leech, and the same fixture heals without the debuff`, () => {
            const START = VICTIM_MAX_HP / 2;
            const LEECH_PCT = 50;
            const { reversed, control } = bothArms({
                victimSide,
                victimAttack: 20_000,
                victimSlots: [activeSlot([basicAttack()]), passiveSlot([standingLeech(LEECH_PCT)])],
                victimStartHp: START,
            });

            // The channel is LIVE, and its magnitude is read off the control run rather than
            // predicted from the damage formula — the assertion below is an exact equality
            // against it, so a leech that restored nothing would fail the `> 0` check here.
            const leeched = control.victimHp - START;
            expect(leeched).toBeGreaterThan(0);
            // …and the reversal takes exactly that amount off instead.
            expect(START - reversed.victimHp).toBe(leeched);

            // R10′ on the leech channel. A self-leech's "healer" is the victim itself, so this is
            // the same ruling read on the one channel where source and recipient coincide — and it
            // is the only coverage of the ENGINE's leech call sites' credit move (the cast and
            // reactive sites are covered elsewhere in this file and in the engine suite).
            const bucketOf = (run: FixtureRun) =>
                run.result.healing!.rounds[0].perActor.get(VICTIM_ID)?.directHeal ?? 0;
            expect(bucketOf(control)).toBeGreaterThan(0);
            expect(bucketOf(reversed)).toBe(0);
        });
    }
});

describe('R2 channel 4 — a REACTIVE repair from a passive slot reverses', () => {
    // ⚠️ WHY THIS ONE RUNS TWO ROUNDS. The reactive fires at `start-of-round`, which is BEFORE any
    // actor takes a turn — so in round 1 Zosimos has not cast yet and the status is not standing.
    // Round 1 therefore repairs in BOTH arms (that is the control, and it is a real one: it proves
    // the channel restores HP in this exact fixture). Round 2's tick is the one under test.
    // A one-round version of this test would have measured a repair that landed before the debuff
    // existed and called the result a reversal failure.
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: round 2's tick burns what round 1's tick repaired`, () => {
            const START = VICTIM_MAX_HP / 2;
            const { reversed, control } = bothArms({
                victimSide,
                victimSlots: [passiveSlot([reactiveRepair(REPAIR_PCT)])],
                victimStartHp: START,
                numRounds: 2,
            });

            // It really is the REACTIVE executor doing the work: that executor emits
            // `reactive-heal-performed` and deliberately emits NO `heal-performed` (the chain
            // guard), so this event is unique to this path — a cast repair could not produce it.
            const reactivesOf = (run: FixtureRun) =>
                eventsOfType(run.events, 'reactive-heal-performed').filter(
                    (e) => e.casterId === VICTIM_ID
                );
            expect(reactivesOf(control)).toHaveLength(2);
            expect(reactivesOf(reversed)).toHaveLength(2);
            // `basis: 'target-hp'` → 10% of the victim's 100,000 max HP.
            expect(reactivesOf(control)[0].amount).toBe(RAW);

            // Optional, not `!`: under R10′ a reversed round credits the owner NOTHING, so its
            // per-round entry can be absent entirely. A `!` here would throw on the very state
            // the ruling requires.
            const perRound = (run: FixtureRun, i: number) =>
                run.result.healing!.rounds[i].perActor.get(VICTIM_ID);
            // ROUND 1 — status not yet standing: both arms repair, identically. The channel is
            // demonstrably LIVE, in the reversed run's own fixture.
            expect(perRound(control, 0)!.effectiveHeal).toBe(RAW);
            expect(perRound(reversed, 0)!.effectiveHeal).toBe(RAW);
            // ROUND 2 — Zosimos's round-1 cast is standing. Only the reversed arm burns.
            expect(perRound(control, 1)!.directHeal).toBe(RAW);
            expect(perRound(control, 1)!.effectiveHeal).toBe(RAW);
            expect(perRound(control, 1)!.overheal).toBe(0);
            // R10′: all three buckets, gross included. Asserting only `overheal === 0` would pass
            // against a build that still credited the owner the whole repair as repairs cast.
            expect(perRound(reversed, 1)?.directHeal ?? 0).toBe(0);
            expect(perRound(reversed, 1)?.effectiveHeal ?? 0).toBe(0);
            expect(perRound(reversed, 1)?.overheal ?? 0).toBe(0);

            // …and the HP endpoints agree: +2×RAW for the control, exactly back to START for the
            // reversal (round 1 repaired RAW, round 2 burned the same RAW off).
            expect(control.victimHp).toBe(START + 2 * RAW);
            expect(reversed.victimHp).toBe(START);
        });
    }
});

describe('R2 channel 5 (the NEGATIVE case) — a shield GRANT is not a repair', () => {
    for (const victimSide of SIDES) {
        // `grantShieldToTarget` is a DIFFERENT closure with no reversal branch. The pool must grow
        // and `currentHp` must not move — identically in both arms.
        it(`${victimSide}-side victim: the pool grows and HP is untouched, debuff or not`, () => {
            const START = VICTIM_MAX_HP / 2;
            const { reversed, control } = bothArms({
                victimSide,
                medicAbilities: [castShield(REPAIR_PCT)],
                victimStartHp: START,
            });

            // NON-VACUITY: the grant really lands — a fixture whose shield never applied would
            // pass "HP unchanged" trivially.
            expect(control.victimShield).toBe(RAW);
            expect(reversed.victimShield).toBe(RAW);
            // Not a repair: HP does not move in EITHER direction, in EITHER arm.
            expect(control.victimHp).toBe(START);
            expect(reversed.victimHp).toBe(START);
        });
    }
});

// ══ R5 ═══════════════════════════════════════════════════════════════════════════════════════
// "NOTHING reacts to the resulting damage." Four reactions, four tests, each run twice against
// the SAME victim kit:
//
//   SILENT      — a reversed repair lands and nothing else happens. Assert the reaction is quiet
//                 AND, crucially, that the burn really occurred (`victimHp === START - RAW`). A
//                 fixture in which nothing happened at all would pass "the reaction was quiet".
//   INSTRUMENT  — the identical kit, no reversal, and an ORDINARY attack that lands for at least
//                 the burn's magnitude. Assert the reaction fires with a non-zero payload. This
//                 half is the whole test: "did not fire" alone is what a broken fixture reports.
//
// Structurally all four are fenced by the same choice — the reversal writes `victim.currentHp`
// directly and never enters `applyVictimDamage`, so no `attacked` event is emitted (the trigger
// both `on-attacked` and `on-ally-attacked` subscribe to) and neither the Reflect block nor the
// taken-leech proc, which live INSIDE that funnel, is ever reached. The last test in this section
// pins that shared root cause directly.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** REACTION 1 — a counterattack. `type: 'counter'` on a passive slot, `on-attacked`. Its payload
 *  is `owner.attack × multiplier%`, so the victim carries an attack stat purely to make the
 *  counter's damage non-zero — it has NO active attack ability of its own. */
const counterPassive = (multiplier: number): Ability => ({
    id: 'ab-counter',
    type: 'counter',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'counter', multiplier },
});

/** REACTION 2 — Reflect thorns. Collected off the PASSIVE slot into `incomingAbilitiesById` by
 *  `config.type`, and consumed inside `applyVictimDamage`. `type: 'modifier'` is the placeholder
 *  the production Reflect gear-set recipe uses (`buildEquipmentAbilities.ts` REFLECT). */
const reflectPassive = (pct: number): Ability => ({
    id: 'ab-reflect',
    type: 'modifier',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage-reflection', pct },
});

/** REACTION 3 — an INCOMING leech ("when damaged, repair"). Passive slot, `basis: 'damage-taken'`;
 *  the engine's enemy-attack block owns it, so the trigger is `on-cast`, not `on-attacked`. */
const takenLeechPassive = (pct: number): Ability => ({
    id: 'ab-taken-leech',
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'damage-taken', noCrit: true },
});

const ON_DAMAGED_BUFF = 'Counter Shield';
/** REACTION 4 — an on-damaged passive that grants its owner a buff. Passive slot, `on-attacked`. */
const onDamagedBuffPassive = (): Ability => ({
    id: 'ab-on-damaged',
    type: 'buff',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: {
        type: 'buff',
        buffName: ON_DAMAGED_BUFF,
        parsedEffects: { attack: 10 },
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

const R5_START = VICTIM_MAX_HP / 2;

/**
 * The two R5 runs for one reaction. Identical kits; they differ ONLY in (status name, attack).
 * The medic repairs in both, so the reversal is what the silent run's burn comes from.
 */
function r5Arms(
    victimSide: (typeof SIDES)[number],
    reaction: Ability,
    victimAttack = 0
): { silent: FixtureRun; instrument: FixtureRun } {
    const shared = {
        victimSide,
        medicAbilities: [castRepair(REPAIR_PCT)],
        victimSlots: [passiveSlot([reaction])],
        victimStartHp: R5_START,
        victimAttack,
    };
    return {
        silent: runFixture({ ...shared, statusName: REVERSED }),
        instrument: runFixture({
            ...shared,
            statusName: CONTROL,
            zosimosAttack: INSTRUMENT_ATTACK,
        }),
    };
}

/** The two preconditions every R5 test shares, asserted before its own reaction-specific claim.
 *  Without these, "the reaction stayed quiet" is a statement about an empty fixture. */
function expectR5Preconditions(silent: FixtureRun, instrument: FixtureRun): void {
    // (1) The burn REALLY happened in the silent run: exactly RAW came off the victim's HP.
    expect(R5_START - silent.victimHp).toBe(RAW);
    // (2) The instrument's attack really landed on the victim, for at least as much as the burn —
    //     so "the reaction did not fire on the reversal" can never be read as "the burn was too
    //     small to react to".
    expect(attackIntakeOf(instrument)).toBeGreaterThanOrEqual(RAW);
    expect(attackIntakeOf(silent)).toBe(0);
}

describe('R5 reaction 1 — a counterattack does not fire on a reversed repair', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: silent on the reversal, and it counters an ordinary attack`, () => {
            const { silent, instrument } = r5Arms(victimSide, counterPassive(100), 20_000);
            expectR5Preconditions(silent, instrument);

            const countersOf = (run: FixtureRun) =>
                eventsOfType(run.events, 'reactive-damage-performed').filter(
                    (e) => e.sourceId === VICTIM_ID
                );
            // THE INSTRUMENT FIRES: an ordinary attack on this very victim provokes a counter that
            // lands for a real, non-zero amount.
            expect(countersOf(instrument).length).toBeGreaterThan(0);
            expect(countersOf(instrument)[0].amount).toBeGreaterThan(0);
            expect(countersOf(instrument)[0].targetId).toBe(instrument.zosimosId);
            // …and the reversal provokes none.
            expect(countersOf(silent)).toHaveLength(0);
        });
    }
});

describe('R5 reaction 2 — Reflect thorns do not fire on a reversed repair', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: silent on the reversal, and it reflects an ordinary attack`, () => {
            const { silent, instrument } = r5Arms(victimSide, reflectPassive(40));
            expectR5Preconditions(silent, instrument);

            const reflectedOf = (run: FixtureRun) => run.result.rounds[0].perActorReflected ?? {};
            // THE INSTRUMENT FIRES: the ordinary attack bounces back at its attacker.
            expect(reflectedOf(instrument)[instrument.zosimosId] ?? 0).toBeGreaterThan(0);
            // …and the reversal reflects at nobody — not at the medic whose repair it was, not at
            // the Zosimos that applied the debuff, not at anyone.
            expect(Object.keys(reflectedOf(silent))).toHaveLength(0);
        });
    }
});

describe('R5 reaction 3 — an incoming leech does not proc on a reversed repair', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: silent on the reversal, and it leeches off an ordinary attack`, () => {
            const { silent, instrument } = r5Arms(victimSide, takenLeechPassive(50));
            expectR5Preconditions(silent, instrument);

            // The leech credits its OWNER (the victim). The medic's cast repair credits the MEDIC,
            // so this bucket is unique to the leech and cannot be confused with the repair.
            const leechedBy = (run: FixtureRun) =>
                run.result.healing!.rounds[0].perActor.get(VICTIM_ID)?.directHeal ?? 0;
            // THE INSTRUMENT FIRES: the ordinary attack feeds a real, non-zero leech.
            expect(leechedBy(instrument)).toBeGreaterThan(0);
            // …and the reversal feeds none. (Precondition (1) above already pinned the victim's HP
            // at exactly START − RAW, which independently rules out a leech having restored any.)
            expect(leechedBy(silent)).toBe(0);
        });
    }
});

describe('R5 reaction 4 — an on-damaged passive does not fire on a reversed repair', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: silent on the reversal, and it grants on an ordinary attack`, () => {
            const { silent, instrument } = r5Arms(victimSide, onDamagedBuffPassive());
            expectR5Preconditions(silent, instrument);

            const grantsOf = (run: FixtureRun) =>
                eventsOfType(run.events, 'buff-applied').filter(
                    (e) => e.actorId === VICTIM_ID && e.buffName === ON_DAMAGED_BUFF
                );
            // THE INSTRUMENT FIRES: the ordinary attack grants the buff, stamped as a reaction to
            // the attacker's turn.
            expect(grantsOf(instrument).length).toBeGreaterThan(0);
            expect(grantsOf(instrument)[0].reactive).toBe(true);
            // …and the reversal grants nothing.
            expect(grantsOf(silent)).toHaveLength(0);
        });
    }
});

describe('R5 root cause — a reversed repair emits no `attacked` event', () => {
    for (const victimSide of SIDES) {
        // The single fact all four reactions above rest on: `on-attacked` / `on-ally-attacked`
        // subscribe to `attacked` (triggers.ts :1036 / :1157), which only `emitAttacked` /
        // `emitPerVictimAttacked` produce — both inside the damage funnel the reversal skips.
        // Pinning it here means a future change that started routing the burn through the funnel
        // fails HERE, at the cause, rather than only in whichever reaction happened to be covered.
        it(`${victimSide}-side victim: no attacked event for the burn, one for an ordinary attack`, () => {
            const { silent, instrument } = r5Arms(victimSide, counterPassive(100), 20_000);
            expectR5Preconditions(silent, instrument);

            const attackedOn = (run: FixtureRun) =>
                eventsOfType(run.events, 'attacked').filter((e) => e.targetId === VICTIM_ID);
            expect(attackedOn(instrument).length).toBeGreaterThan(0);
            expect(attackedOn(silent)).toHaveLength(0);
        });
    }
});

// ══ THE SCHEDULED CHANNEL — a reversal with NO APPLIER ═══════════════════════════════════════
// R7′ books the burn on the actor that inflicted the status. A debuff hand-ticked in the
// calculator's enemy-debuff picker was never cast by anyone, so there is no such actor: the read
// yields `{ applierId: undefined }`.
//
// That is a REAL state, not an error, and it must not be papered over: no fallback to the healer
// (the very attribution R7′ rejects), no invented sentinel id. The burn still lands, nothing is
// credited to anyone, and nothing crashes.
//
// TEAM SYMMETRY here is the side GATE, not a mirrored burn. `enemyAlwaysSnap` (statusEngine.ts)
// builds from a single GLOBAL list with no per-victim keying at all — pass it any id and it
// answers the same — so the scheduled arm is gated on `victim.side === 'enemy'`. The player-side
// arm below is that gate measured end-to-end: the same picker entry must leave a PLAYER victim's
// repairs healing normally. (`reversedRepairs.read.test.ts` pins the same gate at the read.)
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('the scheduled channel — a hand-picked Reversed Repairs has no applier', () => {
    const pickerEntry = (buffName: string): SelectedGameBuff => ({
        id: buffName,
        buffName,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    });

    /** Total damage booked as DEALT to the victim, summed over every attacker. */
    const dealtToVictim = (run: FixtureRun) =>
        Object.values(run.result.rounds[0].perTargetDealt ?? {}).reduce(
            (sum, byVictim) => sum + (byVictim[VICTIM_ID] ?? 0),
            0
        );

    it('enemy-side victim: the burn lands, and it is credited to nobody', () => {
        const START = VICTIM_MAX_HP / 2;
        const arm = (enemyDebuffs: SelectedGameBuff[]) =>
            runFixture({
                victimSide: 'enemy',
                // No CAST status at all: the medic still repairs, but Zosimos's own debuff ability
                // plants a name nothing models, so the ONLY Reversed Repairs in the run is the
                // hand-picked one. Otherwise the timed arm would answer first and supply a caster.
                statusName: CONTROL,
                medicAbilities: [castRepair(REPAIR_PCT)],
                victimStartHp: START,
                scheduledEnemyDebuffs: enemyDebuffs,
            });

        const control = arm([]);
        const reversed = arm([pickerEntry(REVERSED)]);

        // NON-VACUITY: without the picker entry the very same fixture REPAIRS for RAW.
        expect(control.victimHp - START).toBe(RAW);
        // …and with it, the same RAW is burned off instead.
        expect(START - reversed.victimHp).toBe(RAW);

        // The victim-keyed intake IS booked — it demonstrably lost the HP, and the
        // Protection-redirect site sets the same precedent for a chunk with no single attacker.
        expect(reversed.result.rounds[0].perTargetDamage?.[VICTIM_ID] ?? 0).toBe(RAW);
        // But NOTHING is credited as dealt: not to the medic whose repair it was, not to anyone.
        // A build that fell back to the healer would book RAW here.
        expect(dealtToVictim(reversed)).toBe(0);
        expect(dealtToVictim(control)).toBe(0);

        // R10′ still holds on this channel: the healer books nothing either.
        const medic = reversed.result.healing!.rounds[0].perActor.get(reversed.medicId);
        expect(medic?.directHeal ?? 0).toBe(0);
        expect(medic?.effectiveHeal ?? 0).toBe(0);
        expect(medic?.overheal ?? 0).toBe(0);
    });

    it('enemy-side victim: a LETHAL applier-less reversal kills with no killer named', () => {
        const run = runFixture({
            victimSide: 'enemy',
            statusName: CONTROL,
            medicAbilities: [castRepair(REPAIR_PCT)],
            victimStartHp: RAW / 2, // < RAW ⇒ lethal
            scheduledEnemyDebuffs: [pickerEntry(REVERSED)],
        });

        expect(run.victimHp).toBe(0);
        const kills = eventsOfType(run.events, 'ship-destroyed').filter(
            (e) => e.actorId === VICTIM_ID
        );
        expect(kills).toHaveLength(1);
        // No applier ⇒ no killer. Explicitly NOT the medic — the retracted ruling's answer.
        expect(kills[0].killerId).toBeUndefined();
        expect(kills[0].byDirectDamage).toBeFalsy();
    });

    // The GATE, end to end. `enemyDebuffs` means "debuffs the OPPOSING team carries", and the
    // underlying store has no per-victim keying to enforce it — so without the side gate this
    // picker entry would reverse the USER'S OWN team's repairs into damage.
    it('player-side victim: the same picker entry leaves a player victim healing normally', () => {
        const START = VICTIM_MAX_HP / 2;
        const run = runFixture({
            victimSide: 'player',
            statusName: CONTROL,
            medicAbilities: [castRepair(REPAIR_PCT)],
            victimStartHp: START,
            scheduledEnemyDebuffs: [pickerEntry(REVERSED)],
        });
        // Repaired, not burned — the delta's SIGN is the assertion.
        expect(run.victimHp - START).toBe(RAW);
    });
});

// ══ R9 ═══════════════════════════════════════════════════════════════════════════════════════
// "Zosimos's own charge passive still fires." It keys off an enemy CASTING a repair
// (`on-enemy-repaired`, riding `heal-performed`), which is UPSTREAM of the heal-apply closure —
// so the reversal must not suppress it. A fence against an accidental regression, not new
// behaviour.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Zosimos's first passive: "When an enemy repairs, this Unit gains a charge to its Charged
 *  Skill." — the exact ability `buildShipAbilities` produces for that text. */
const chargeOnEnemyRepair = (): Ability => ({
    id: 'ab-zos-charge',
    type: 'charge',
    target: 'self',
    trigger: 'on-enemy-repaired',
    conditions: [],
    config: { type: 'charge', amount: 1 },
});

describe('R9 — Zosimos still gains its charge from a repair that is then reversed', () => {
    for (const victimSide of SIDES) {
        it(`${victimSide}-side victim: the charge lands, and no repair means no charge`, () => {
            const START = VICTIM_MAX_HP / 2;
            const arm = (statusName: string, medicAbilities: Ability[]) =>
                runFixture({
                    victimSide,
                    statusName,
                    medicAbilities,
                    victimStartHp: START,
                    zosimosSlots: [passiveSlot([chargeOnEnemyRepair()])],
                    // Headroom: a self-gain is clamped to the charge CAP, and at the default 0 the
                    // grant would be capped away — the test would then pass for a reason with
                    // nothing to do with the reversal.
                    zosimosChargeCount: 10,
                });

            const gained = (run: FixtureRun) =>
                eventsOfType(run.events, 'charge-changed')
                    .filter((e) => e.actorId === run.zosimosId && e.reason === 'manip')
                    .reduce((sum, e) => sum + (e.newCharge - e.oldCharge), 0);

            const noRepair = arm(REVERSED, []);
            const controlRepair = arm(CONTROL, [castRepair(REPAIR_PCT)]);
            const reversedRepair = arm(REVERSED, [castRepair(REPAIR_PCT)]);

            // NON-VACUITY (1): the passive is repair-driven, not free — remove the repair and the
            // charge does not appear. Without this, "a charge was gained" proves nothing about the
            // repair having triggered it.
            expect(gained(noRepair)).toBe(0);
            // NON-VACUITY (2): an ordinary, un-reversed repair grants exactly one charge.
            expect(gained(controlRepair)).toBe(1);

            // The ruling: the repair WAS reversed (the victim lost RAW instead of gaining it) …
            expect(START - reversedRepair.victimHp).toBe(RAW);
            expect(controlRepair.victimHp - START).toBe(RAW);
            // … and Zosimos gained its charge anyway. The passive watches the cast, not the
            // landing.
            expect(gained(reversedRepair)).toBe(1);
        });
    }
});

// ══ DPS-MODE INERTNESS ═══════════════════════════════════════════════════════════════════════
// The spec's third derived consequence: with no HP model there is no `healingCtx`, so the
// calculator ignores the debuff entirely.
//
// ⚠️ THIS MATTERS MORE THAN IT LOOKS. A scheduled `enemyDebuffs` entry is not per-victim — it is
// a single global list (`enemyAlwaysSnap` has no per-victim keying at all), so it applies to every
// enemy at once. A leak here would silently change every DPS number for any user who ticks
// `Reversed Repairs` in the enemy-debuff picker.
//
// The fixture is a plain single-ship DPS run: `mode` is left at its default `'dps'` and there is
// NO `healTargetId` (the two are mutually exclusive), which is precisely the state in which
// `healingCtx` is never built.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('DPS mode — a scheduled Reversed Repairs changes nothing', () => {
    const scheduled = (buffName: string, parsedEffects: SelectedGameBuff['parsedEffects']) => ({
        id: `sched-${buffName}`,
        buffName,
        stacks: 1,
        isStackable: false,
        parsedEffects,
    });

    const dpsRun = (enemyDebuffs: SelectedGameBuff[]) =>
        runCombat({
            numRounds: 3,
            attack: 20_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: MEDIC_HP,
            speed: 100,
            position: 'M1',
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            shipSkills: { slots: [activeSlot([basicAttack()])] },
            selfBuffs: [],
            enemyDebuffs,
            selfDotModifier: 0,
            defensePenetration: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            chargeCount: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hacking: 100_000,
            enemyAttackers: [
                enemyShip({
                    id: 'foe',
                    position: 'M1',
                    speed: 50,
                    hp: ZOSIMOS_HP,
                    attack: 5_000,
                    defence: 8_000,
                }),
            ],
        });

    /** Every damage channel a round carries, projected out of the RoundData. Deliberately NOT the
     *  whole `RoundData`: a scheduled debuff legitimately shows up in the round's
     *  `activeEnemyDebuffs` display list, and a whole-object comparison would fail on that
     *  cosmetic difference while telling us nothing about the damage.
     *
     *  `rawTotals` is projected too but is NOT sufficient on its own — on a positioned roster the
     *  aggregate `direct`/`cumulative` counters stay at 0 (the damage is booked per victim), so a
     *  `rawTotals`-only comparison would be vacuously equal. */
    const damageShape = (r: ReturnType<typeof runCombat>) => ({
        rawTotals: r.rawTotals,
        rounds: r.rounds.map((rd) => ({
            round: rd.round,
            perTargetDamage: rd.perTargetDamage,
            perTargetDealt: rd.perTargetDealt,
            perActorIncoming: rd.perActorIncoming,
            totalRoundDamage: rd.totalRoundDamage,
            cumulativeDamage: rd.cumulativeDamage,
            enemyHpPct: rd.enemyHpPct,
        })),
    });
    const dealtTotal = (r: ReturnType<typeof runCombat>) =>
        r.rounds.reduce((sum, rd) => sum + (rd.perTargetDamage?.foe ?? 0), 0);

    it('the damage result is identical with and without the debuff', () => {
        const base = dpsRun([]);
        const withReversed = dpsRun([scheduled(REVERSED, {})]);

        // NON-VACUITY (1): there IS damage in this fixture for a leak to change.
        expect(dealtTotal(base)).toBeGreaterThan(0);
        // NON-VACUITY (2): the `enemyDebuffs` CHANNEL is demonstrably live here — a modelled entry
        // moves the very numbers asserted below. Without this the "identical" assertion could just
        // as easily mean the fixture ignores `enemyDebuffs` altogether.
        const withIncomingUp = dpsRun([scheduled('Inc. Damage Up II', { incomingDamage: 50 })]);
        expect(dealtTotal(withIncomingUp)).toBeGreaterThan(dealtTotal(base));
        expect(damageShape(withIncomingUp)).not.toEqual(damageShape(base));

        // THE FENCE: Reversed Repairs contributes nothing at all to any damage channel.
        expect(damageShape(withReversed)).toEqual(damageShape(base));
    });
});
