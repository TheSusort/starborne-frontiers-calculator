/**
 * #375 — the per-RECIPIENT healing axis must be team-symmetric.
 *
 * ── WHAT WAS BROKEN, AND WHAT THE ISSUE GOT WRONG ─────────────────────────────────────────────
 * #375 was filed as "the recipient axis is PLAYER-SIDE ONLY". Measured, it is narrower than that:
 * the axis is already side-agnostic at four of its six credit sites — both per-victim leeches
 * (`engine.ts` `creditLandedRepair`), the reactive executor (`triggers.ts`) and the player cast
 * path all key by the LANDING actor with no side gate at all, which is precisely why
 * `healingEngineAdapter` has to filter the axis through `playerRecipientIds` before it reports it.
 *
 * The two arms that were missing are the two `healEventOnly` arms in `playerTurn.ts` — i.e. the
 * ENEMY side of the two channels that route through `runPlayerTurn`:
 *
 *   1. THE ENEMY CAST HEAL. The `healEventOnly` heal branch applies HP to each recipient's own
 *      pool and emits `heal-performed`, but credited NEITHER axis. Skipping the SOURCE axis is
 *      correct and deliberate (E5 §4.1 — an enemy heal contributes nothing to the player healing
 *      buckets). Skipping the RECIPIENT axis was not: that axis answers "what landed on this
 *      actor", which has no side to it.
 *   2. THE ENEMY HoT TICK. `tickHot`'s `if (healEventOnly) return;` sat ABOVE the recipient
 *      credit, so #369's lift moved the HP without booking where it landed.
 *
 * ── WHY IT MATTERS ────────────────────────────────────────────────────────────────────────────
 * The axis is the only per-actor repair total the engine keeps, so it is what the Simulator's
 * "Healing received" column has to read (#375's other half). While these two arms were missing, a
 * substitution regressed every enemy row from correct (via `heal-performed`) to 0 — which is what
 * the issue observed and mis-attributed to the axis as a whole.
 *
 * ── THE INVARIANT THIS FILE ALSO GUARDS ───────────────────────────────────────────────────────
 * Lifting the recipient credit must NOT lift the source credit with it. `perActor` staying empty
 * for an enemy healer is the E5 §4.1 contract and the thing `enemySideHotTick.test.ts` was really
 * protecting; every enemy arm below asserts it explicitly, so a fix that lifted both would fail
 * here rather than silently teach the healing report to count enemy repairs as the player's.
 *
 * ── FIXTURE SHAPE ─────────────────────────────────────────────────────────────────────────────
 * Harness adapted from `enemySideHotTick.test.ts` (real `runCombat`, hand-built abilities, the
 * same three roles mirrored across both sides):
 *
 *   - FOCUS   an inert player attacker, ALWAYS the heal anchor and never a subject. Nothing here
 *             can be an artefact of the subject being the anchor.
 *   - MEDIC   the repair SOURCE, at FULL HP. Its own fanned share is therefore pure overheal,
 *             which is what pins the axis's GROSS contract (see below).
 *   - HOLDER  the repair RECIPIENT, at half HP so a repair has room to land.
 *
 * Every arm runs TWICE, once per side, from one builder — the player arm is the positive control
 * that proves the assertions can pass at all, so an enemy-arm green is never the vacuous kind.
 *
 * GROSS, NOT EFFECTIVE. `directHeal`/`hotHeal` on this axis are the repair that ARRIVED, before
 * overheal clipping; `effectiveHeal`/`overheal` split it. The medic's own share (full HP, 100%
 * wasted) asserts all three at once on both sides, so a fix that credited `consumed` into the
 * gross bucket fails here.
 *
 * NO RNG SEEDING: every actor has `crit: 0` and `attack: 0`, so no rate gate has a live stream and
 * no damage confounds a subject's HP.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { Position } from '../../../types/encounters';

const FOCUS_ID = 'attacker';
const MEDIC_ID = 'medic';
const HOLDER_ID = 'holder';
const FOE_ID = 'foe';

const MEDIC_MAX_HP = 100_000;
const HOLDER_MAX_HP = 100_000;
/** Focus / filler: large enough that nothing in these fixtures can touch it. */
const INERT_HP = 10_000_000;

const REPAIR_PCT = 10;
/** One repair = the medic's max HP × pct — arithmetic, not a golden. */
const REPAIR = (MEDIC_MAX_HP * REPAIR_PCT) / 100; // 10,000
const HOLDER_START = HOLDER_MAX_HP / 2; // 50,000 — five repairs of headroom

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Side = 'player' | 'enemy';
const SIDES: readonly Side[] = ['player', 'enemy'];

// ── Abilities ─────────────────────────────────────────────────────────────────────────────────

/** A cast repair scaling off the CASTER's max HP. `target: 'ally'` fans to the caster's whole
 *  side, the caster included — so the medic repairs the holder AND itself, which is what gives
 *  the gross-vs-effective assertions a wasted share to read. `noCrit` keeps the amount exact. */
const allyRepair: Ability = {
    id: 'ab-ally-repair',
    type: 'heal',
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: REPAIR_PCT, basis: 'hp', noCrit: true },
};

/** An ally-targeted buff carrying `hotPct`, so the whole side holds a copy and ticks. Scales off
 *  the APPLIER's max HP, same as the cast repair above — one tick is also `REPAIR`. */
const allyHotBuff: Ability = {
    id: 'ab-ally-hot',
    type: 'buff',
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Repair Over Time II',
        parsedEffects: { hotPct: REPAIR_PCT },
        stacks: 1,
        isStackable: false,
        duration: 5,
    },
};

const activeSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
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
    /** Which side the MEDIC and the HOLDER stand on. The focus/anchor is always player-side. */
    subjectSide: Side;
    /** `'cast'` gives the medic the cast repair; `'hot'` gives it the HoT-granting buff. */
    channel: 'cast' | 'hot';
    /** Default true. `false` reproduces a legacy healing-calculator run, where the recipient axis
     *  must stay EMPTY — the byte-identical guarantee every existing healing golden rests on. */
    perRecipientApply?: boolean;
    numRounds?: number;
}

interface FixtureRun {
    /** The holder's LIVE final HP (the tap hands out the real actor objects). */
    holderHpAfter: number;
    events: CombatEvent[];
    result: ReturnType<typeof runCombat>;
}

function runFixture(opts: FixtureOpts): FixtureRun {
    // Speed 900 vs 500: the medic always acts first, so a cast repair lands before the holder's
    // own turn and a HoT applier has banked its turn ctx before the holder ticks (the strict
    // applier-ctx rule — without this the tick is skipped and the fixture measures nothing).
    const medicShape: RoleShape = {
        id: MEDIC_ID,
        position: 'M2',
        speed: 900,
        hp: MEDIC_MAX_HP,
        slots: [activeSlot([opts.channel === 'cast' ? allyRepair : allyHotBuff])],
    };
    const holderShape: RoleShape = {
        id: HOLDER_ID,
        position: 'M4',
        speed: 500,
        hp: HOLDER_MAX_HP,
        slots: [],
    };

    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['heal-performed', 'hot-ticked'] as const)
        bus.on(type, (e: CombatEvent) => events.push(e));

    let holder: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        holder = actors.find((a) => a.id === HOLDER_ID);
        if (holder) holder.currentHp = HOLDER_START;
    };

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
        // The anchor is the FOCUS in every arm — never the medic and never the holder.
        healTargetId: FOCUS_ID,
        mode: 'healing' as const,
        perRecipientHealApply: opts.perRecipientApply ?? true,
        hacking: 100_000,
        __testTapActors: seed,
        bus,
    };

    const focus = {
        ...common,
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: INERT_HP,
        speed: 1,
        position: 'M1' as const,
        chargeCount: 0,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: { slots: [activeSlot([])] },
    };

    const input: CombatEngineInput =
        opts.subjectSide === 'player'
            ? {
                  ...focus,
                  teamActors: [walkedAlly(medicShape), walkedAlly(holderShape)],
                  // One inert enemy: the fight needs an opposing side, and this one does nothing.
                  enemyAttackers: [
                      enemyShip({ id: FOE_ID, position: 'M1', speed: 1, hp: INERT_HP }),
                  ],
              }
            : {
                  ...focus,
                  teamActors: [],
                  enemyAttackers: [enemyShip(medicShape), enemyShip(holderShape)],
              };

    return { result: runCombat(input), events, holderHpAfter: holder!.currentHp };
}

const healingRound = (run: FixtureRun, round = 0) => run.result.healing!.rounds[round];

// ══ 1: the cast channel, both sides ═══════════════════════════════════════════════════════════

describe('#375 — a cast repair credits the recipient axis on BOTH sides', () => {
    for (const subjectSide of SIDES) {
        it(`${subjectSide}-side medic: the repair lands on the holder's recipient entry`, () => {
            const run = runFixture({ subjectSide, channel: 'cast' });

            // LIVENESS. The repair really happened, so a zero below is a reporting gap and not an
            // absent repair. Nominal, not directional: casterMaxHp × pct, fully consumed.
            expect(run.holderHpAfter - HOLDER_START).toBe(REPAIR);

            const recipient = healingRound(run).perRecipient.get(HOLDER_ID);
            expect(recipient).toBeDefined();
            expect(recipient!.directHeal).toBe(REPAIR);
            expect(recipient!.effectiveHeal).toBe(REPAIR);
            expect(recipient!.overheal).toBe(0);
        });

        it(`${subjectSide}-side medic: its OWN wasted share books GROSS, not the consumed 0`, () => {
            const run = runFixture({ subjectSide, channel: 'cast' });

            // The medic is at full HP, so its fanned share of its own `ally` repair is 100%
            // wasted. This is the arm that separates the gross bucket from the effective one: a
            // fix that mirrored `consumed` into `directHeal` would report 0 here.
            const medic = healingRound(run).perRecipient.get(MEDIC_ID);
            expect(medic).toBeDefined();
            expect(medic!.directHeal).toBe(REPAIR);
            expect(medic!.effectiveHeal).toBe(0);
            expect(medic!.overheal).toBe(REPAIR);
        });
    }

    it('the ENEMY medic still credits NO source-axis bucket (E5 §4.1 preserved)', () => {
        const run = runFixture({ subjectSide: 'enemy', channel: 'cast' });
        // Precondition, so the empty map below can never be the vacuous kind: the repair the
        // source axis must not book actually happened.
        expect(run.holderHpAfter - HOLDER_START).toBe(REPAIR);
        // An enemy heal contributes nothing to the PLAYER healing buckets. The recipient axis
        // above is a different question — where HP landed — and the two must not move together.
        expect([...healingRound(run).perActor.keys()]).toEqual([]);
    });

    it('the PLAYER medic DOES credit the source axis (the control for the assertion above)', () => {
        const run = runFixture({ subjectSide: 'player', channel: 'cast' });
        // THREE recipients on the medic's side — the focus stands there too, so `ally` fans to
        // focus + medic + holder — and the source axis carries all three shares under the
        // CASTER's id. (The enemy arm has only two, the focus being player-side.) Without this
        // control, "enemy books nothing" could be true because nothing books anywhere.
        expect(healingRound(run).perActor.get(MEDIC_ID)!.directHeal).toBe(3 * REPAIR);
    });
});

// ══ 2: the HoT channel, both sides ════════════════════════════════════════════════════════════

describe('#375 — a HoT tick credits the recipient axis on BOTH sides', () => {
    for (const subjectSide of SIDES) {
        it(`${subjectSide}-side holder: the tick lands on the holder's recipient entry`, () => {
            // Two rounds: the buff is granted on the medic's round-1 turn, and the holder's tick
            // needs a turn of its own after that. Round index 1 is the round the tick happens in.
            const run = runFixture({ subjectSide, channel: 'hot', numRounds: 2 });

            // LIVENESS — the tick really moved HP.
            expect(run.holderHpAfter).toBeGreaterThan(HOLDER_START);

            const recipient = healingRound(run, 1).perRecipient.get(HOLDER_ID);
            expect(recipient).toBeDefined();
            expect(recipient!.hotHeal).toBe(REPAIR);
            expect(recipient!.effectiveHeal).toBe(REPAIR);
        });
    }

    it('the ENEMY holder still credits NO source-axis bucket (E5 §4.1 preserved)', () => {
        const run = runFixture({ subjectSide: 'enemy', channel: 'hot', numRounds: 2 });
        expect(run.holderHpAfter).toBeGreaterThan(HOLDER_START);
        expect([...healingRound(run, 1).perActor.keys()]).toEqual([]);
    });
});

// ══ 3: the flag-off guarantee, on the newly-lifted side ═══════════════════════════════════════

describe('#375 — the lift respects the `perRecipientApply` gate', () => {
    for (const channel of ['cast', 'hot'] as const) {
        it(`enemy ${channel}: the axis stays EMPTY with per-recipient accounting off`, () => {
            const run = runFixture({
                subjectSide: 'enemy',
                channel,
                perRecipientApply: false,
                numRounds: channel === 'hot' ? 2 : 1,
            });
            // The HP still moves — the gate governs ACCOUNTING, never APPLICATION.
            expect(run.holderHpAfter).toBeGreaterThan(HOLDER_START);
            // …and every round's map is empty, which is the byte-identical guarantee every legacy
            // healing golden rests on. Checked across all rounds, not just the one that ticked.
            for (const round of run.result.healing!.rounds) {
                expect([...round.perRecipient.keys()]).toEqual([]);
            }
        });
    }
});
