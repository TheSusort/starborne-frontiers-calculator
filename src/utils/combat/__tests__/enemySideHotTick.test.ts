/**
 * #369 — a `Repair Over Time` tick belongs to the HOLDER: on EITHER side of the board, and
 * whether or not the holder happens to be the healing anchor.
 *
 * ── WHAT WAS BROKEN ───────────────────────────────────────────────────────────────────────────
 * Two independent restrictions kept HP from reaching a HoT holder, and #369 lifts both:
 *
 *  1. SIDE. The whole HoT block sat inside `if (!healEventOnly)`, and `healEventOnly` is true for
 *     every enemy-side actor. An enemy carrying `Repair Over Time` (Flamel I/II, Graphite III,
 *     Oleander II — all of which appear on the enemy side) never ticked at all. The gate was a
 *     deliberate patch, not an oversight: it existed so an enemy holder could not credit the
 *     PLAYER healing map under its own id. #369 keeps that invariant and drops the side
 *     restriction, by gating the CREDIT instead of the APPLICATION (the split the enemy cast-heal
 *     arm has used since E5 §4.1).
 *  2. ANCHOR. `tickHot` returned early for any holder that was not `healing.targetId`, after
 *     crediting the gross bucket. Since the anchor is always player-side that blocked the enemy
 *     half above — but it ALSO meant an off-anchor PLAYER ally was credited for a tick it never
 *     received. Both halves are covered here.
 *
 * ── FIXTURE SHAPE ─────────────────────────────────────────────────────────────────────────────
 * Harness copied from `reversedRepairs.channels.test.ts` (real `runCombat`, hand-built abilities,
 * both side arms of the same three roles), reduced to the three roles this file needs:
 *
 *   - FOCUS   an inert player attacker. It is ALWAYS the heal anchor and never the holder UNDER
 *             TEST, so nothing here can be an artefact of the holder being the anchor. On the
 *             player arm it does pick up a fanned copy of the HoT (see `allyHotBuff`) and therefore
 *             ticks as a third holder — which the source-axis assertions account for explicitly.
 *   - MEDIC   the HoT APPLIER. A FOREIGN applier deliberately: with a self-applied HoT the applier
 *             and the holder coincide and an attribution bug is invisible (the trap
 *             `reversedRepairs.channels.test.ts` documents at its own HoT channel).
 *   - HOLDER  carries the HoT. Speed 500; starts at half HP so a tick has room to land.
 *
 * The applier's slot decides the ordering, and the two settings are two different fixtures:
 *   - `applierSlot: 'active'` → medic speed 900, so it casts the HoT and banks its turn ctx
 *     BEFORE the holder acts. This is the positive fixture.
 *   - `applierSlot: 'passive'` → medic speed 100. The passive-slot grant is seeded onto every ally
 *     at combat start (`seedPassiveTimedStatuses`, round 1), so the holder carries the HoT on its
 *     round-1 turn while the applier still has NO turn ctx. That is the strict-applier-ctx
 *     fixture, and it is two-armed (1 round: skipped; 2 rounds: ticks once) so "no HP moved"
 *     cannot pass vacuously.
 *
 * NO RNG SEEDING, and nothing in this file needs any: every actor has `crit: 0` and `attack: 0`,
 * so no rate gate has a live stream and no damage confounds the holder's HP.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { Position } from '../../../types/encounters';

/** The player focus's id, fixed by the engine. Always the heal anchor here. */
const FOCUS_ID = 'attacker';
const MEDIC_ID = 'medic';
const HOLDER_ID = 'holder';
const FOE_ID = 'foe';

const APPLIER_MAX_HP = 100_000;
const HOLDER_MAX_HP = 100_000;
/** Focus / filler ship: large enough that nothing in these fixtures can kill it. */
const INERT_HP = 10_000_000;

const HOT_PCT = 10;
/** One tick = applierMaxHp × hotPct% × stacks(1) — arithmetic, not a golden. */
const EXPECTED_TICK = (APPLIER_MAX_HP * HOT_PCT) / 100; // 10,000
const START = HOLDER_MAX_HP / 2; // 50,000 — 5 ticks of headroom before overheal

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Abilities ─────────────────────────────────────────────────────────────────────────────────

/** An ally-targeted buff carrying `hotPct`. `target: 'ally'` FANS to the caster's whole side, the
 *  caster included — so EVERY actor on the medic's side holds a copy and ticks: three of them on
 *  the player arm (focus, medic, holder), two on the enemy arm (medic, holder). That is why the
 *  applier's `hotHeal` below is a SUM rather than one tick. */
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
    /** Which side the MEDIC and the HOLDER stand on. The focus/anchor is always player-side. */
    holderSide: 'player' | 'enemy';
    /** See the header: `'active'` banks the applier's turn ctx first, `'passive'` deliberately
     *  does not. Default `'active'`. */
    applierSlot?: 'active' | 'passive';
    hotPct?: number;
    holderStartHp?: number;
    /** Default true. `false` reproduces a legacy healing-calculator run, where the recipient axis
     *  stays empty — the tick's HP application must not depend on it (#369). */
    perRecipientApply?: boolean;
    numRounds?: number;
}

interface FixtureRun {
    /** The holder's LIVE final HP (the tap hands out the real actor objects). */
    holderHpAfter: number;
    events: CombatEvent[];
    result: ReturnType<typeof runCombat>;
}

const COLLECTED = ['heal-performed', 'buff-applied'] as const;

function runFixture(opts: FixtureOpts): FixtureRun {
    const hotPct = opts.hotPct ?? HOT_PCT;
    const applierSlot = opts.applierSlot ?? 'active';
    // ACTIVE applier: speed 900 → acts BEFORE the holder (speed 500), so `lastTurnCtxByActor`
    // holds its turn ctx when the holder ticks. PASSIVE applier: speed 100 → acts AFTER.
    const medicSpeed = applierSlot === 'active' ? 900 : 100;
    const medicSlots: ShipSkills['slots'] =
        applierSlot === 'active'
            ? [activeSlot([allyHotBuff(hotPct)])]
            : [activeSlot([]), passiveSlot([allyHotBuff(hotPct)])];

    const medicShape: RoleShape = {
        id: MEDIC_ID,
        position: 'M2' as Position,
        speed: medicSpeed,
        hp: APPLIER_MAX_HP,
        slots: medicSlots,
    };
    const holderShape: RoleShape = {
        id: HOLDER_ID,
        position: 'M4' as Position,
        speed: 500,
        hp: HOLDER_MAX_HP,
        slots: [],
    };

    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of COLLECTED) bus.on(type, (e: CombatEvent) => events.push(e));

    let holder: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        holder = actors.find((a) => a.id === HOLDER_ID);
        if (holder) holder.currentHp = opts.holderStartHp ?? START;
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
        // The anchor is the FOCUS in every arm — never the holder.
        healTargetId: FOCUS_ID,
        mode: 'healing' as const,
        perRecipientHealApply: opts.perRecipientApply ?? true,
        hacking: 100_000,
        __testTapActors: seed,
        bus,
    };

    // The focus is inert in both arms: no abilities, no attack. It exists to be the anchor.
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
        opts.holderSide === 'player'
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
                  enemyAttackers: [enemyShip(holderShape), enemyShip(medicShape)],
              };

    const result = runCombat(input);
    return { holderHpAfter: holder!.currentHp, events, result };
}

const healingRound = (run: FixtureRun, round = 0) => run.result.healing!.rounds[round];
const healPerformed = (run: FixtureRun) => run.events.filter((e) => e.type === 'heal-performed');

// ══ 1 + 2: the core #369 fix, on the ENEMY side ═══════════════════════════════════════════════

describe('#369 — an enemy-side HoT holder ticks', () => {
    it('an enemy ship carrying Repair Over Time gains HP on its own turn', () => {
        const run = runFixture({ holderSide: 'enemy' });
        expect(run.holderHpAfter).toBeGreaterThan(START);
        // Nominal, not merely directional: applierMaxHp × hotPct% × stacks.
        expect(run.holderHpAfter - START).toBe(EXPECTED_TICK);
    });

    it('an enemy tick credits no player healing bucket and emits no heal-performed', () => {
        const run = runFixture({ holderSide: 'enemy' });
        // Precondition, so a green bucket assertion can never be the vacuous kind: the tick that
        // must not be credited actually HAPPENED.
        expect(run.holderHpAfter - START).toBe(EXPECTED_TICK);
        // …and it credited nothing on EITHER axis. This is the invariant the old whole-block gate
        // was really protecting — an enemy holder must not appear in the player healing map.
        expect([...healingRound(run).perActor.keys()]).toEqual([]);
        expect([...healingRound(run).perRecipient.keys()]).toEqual([]);
        // R2: a HoT tick is not a "performed repair" — it fires no on-repaired trigger, so the
        // block emits no `heal-performed` on either side.
        expect(healPerformed(run)).toHaveLength(0);
    });
});

// ══ 3 + 4: the side-independent half — an OFF-ANCHOR player ally ══════════════════════════════

describe('#369 — an off-anchor player holder ticks', () => {
    it('an off-anchor PLAYER ally carrying a HoT gains HP', () => {
        const run = runFixture({ holderSide: 'player' });
        expect(run.holderHpAfter - START).toBe(EXPECTED_TICK);
    });

    it('the tick lands even on a legacy run with the recipient axis off', () => {
        // `perRecipientApply` governs the recipient-side ACCOUNTING, never whether a HoT reaches
        // its holder. With it off the recipient map stays empty (the byte-identical guarantee
        // legacy healing runs rely on) while the HP still moves.
        const run = runFixture({ holderSide: 'player', perRecipientApply: false });
        expect(run.holderHpAfter - START).toBe(EXPECTED_TICK);
        expect([...healingRound(run).perRecipient.keys()]).toEqual([]);
    });

    it('credits the APPLIER, not the holder, for an off-anchor tick', () => {
        const run = runFixture({ holderSide: 'player' });
        const round = healingRound(run);

        // SOURCE axis. The applier is the medic and the holder is a different actor, so this can
        // fail — with a self-applied HoT the two would coincide and it could not.
        // `target: 'ally'` fans to the medic's WHOLE side, so all THREE player actors hold a copy
        // (focus, medic, holder) and each ticks once: three ticks of gross, all on the medic.
        expect(round.perActor.get(MEDIC_ID)!.hotHeal).toBe(3 * EXPECTED_TICK);
        // Neither of the other two holders has ANY source-axis entry — not merely a smaller share.
        expect(round.perActor.get(HOLDER_ID)).toBeUndefined();
        expect(round.perActor.get(FOCUS_ID)).toBeUndefined();
        // Consumption splits the three ticks apart: only the holder sits below max HP, so its tick
        // is the only consumed one and the focus's and the medic's own are pure overheal.
        expect(round.perActor.get(MEDIC_ID)!.effectiveHeal).toBe(EXPECTED_TICK);
        expect(round.perActor.get(MEDIC_ID)!.overheal).toBe(2 * EXPECTED_TICK);

        // RECIPIENT axis, the counterpart: keyed by who the repair LANDED on, so the holder is
        // present here for exactly one tick and is credited its own consumption.
        expect(round.perRecipient.get(HOLDER_ID)!.hotHeal).toBe(EXPECTED_TICK);
        expect(round.perRecipient.get(HOLDER_ID)!.effectiveHeal).toBe(EXPECTED_TICK);
        expect(round.perRecipient.get(HOLDER_ID)!.overheal).toBe(0);
    });
});

// ══ 5: the strict applier-ctx rule survives the lift, on BOTH sides ═══════════════════════════

describe('#369 — a foreign applier with no turn ctx yet still skips the tick', () => {
    for (const holderSide of ['player', 'enemy'] as const) {
        it(`${holderSide}-side holder: skipped in round 1, ticks in round 2`, () => {
            // Round 1: the passive-slot grant is already on the holder (combat-start seeding) but
            // its applier acts LAST, so `applierMaxHp` is undefined → SKIP, with no base-stat
            // fallback. The second arm is what makes that a measurement rather than a fixture that
            // never had a HoT: by round 2 the applier has a turn ctx and the same holder ticks.
            const oneRound = runFixture({ holderSide, applierSlot: 'passive', numRounds: 1 });
            expect(oneRound.holderHpAfter).toBe(START);

            const twoRounds = runFixture({ holderSide, applierSlot: 'passive', numRounds: 2 });
            expect(twoRounds.holderHpAfter - START).toBe(EXPECTED_TICK);
        });
    }
});
