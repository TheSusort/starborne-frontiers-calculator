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
 * Sections 6, 7 and 8 need shapes `runFixture` cannot express and build their own inputs inline:
 * section 6 puts a SELF-applied HoT on a holder on EACH side at different percentages (cross-side
 * source scoping), section 7 adds an OBSERVER on the side opposing the holder, carrying an
 * ability gated on `'target-repaired-this-round'`, and section 8 (the final-review REPORTING fix)
 * runs the holder's tick all the way through the production assembler. All three reuse this file's
 * roster builders and its `activeSlot` helper; none uses the MEDIC role, because a self-applied HoT
 * needs no applier ctx.
 *
 * NO RNG SEEDING, and nothing in this file needs any: every actor has `crit: 0`, so no rate gate
 * has a live stream. Sections 1–7 also have `attack: 0` everywhere, so no damage confounds the
 * holder's HP; section 8 deliberately adds ONE attacker (its BRUISER, still `crit: 0`) because the
 * assembler's DERIVED HP percentage needs a real deficit to be measurable at all — see its own
 * header for why, and note that it compares two runs which take identical damage.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { assembleBattleResult, LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';
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
    /** Default 0 — every role in sections 1–7 is inert. Section 8's BRUISER is the only actor in
     *  this file that attacks; both builders honour it so the field cannot be set on the wrong
     *  side and silently ignored. */
    attack?: number;
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
    it('an off-anchor PLAYER ally carrying a HoT gains HP, and still emits no heal-performed', () => {
        const run = runFixture({ holderSide: 'player' });
        expect(run.holderHpAfter - START).toBe(EXPECTED_TICK);
        // R2, the PLAYER arm of the assertion the enemy test above makes (team symmetry): a HoT
        // tick is not a "performed repair" on either side, so the block emits no `heal-performed`
        // even now that an off-anchor player holder really is pool-applied. The HP assertion above
        // is what stops this from passing vacuously — a fixture that never ticked would satisfy
        // "no heal-performed" trivially.
        expect(healPerformed(run)).toHaveLength(0);
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

// ══ 6: cross-side SOURCE SCOPING — each holder ticks its OWN HoT and nothing else ═════════════
//
// With the block now running for enemy actors as well, the two source reads (`selfAbilityStatuses`
// and `entry.activeSelfBuffs`) are consumed on both sides of the board for the first time. Nothing
// above places a HoT on the side OPPOSING a holder, so nothing above pins that those reads stay
// PER-SIDE. This fixture does: BOTH holders carry a SELF-applied HoT, at DIFFERENT percentages,
// and each one's HP gain names which source it read.
//
// Scope, precisely: this pins the CROSS-SIDE claim and the not-global claim. It does NOT pin the
// per-ACTOR half — each side here has exactly one holder, so a fold that leaked across actors on
// the SAME side would be invisible to this fixture. That gap is unpinned, not disproven.
//
// The two percentages must DIFFER for this to measure anything. With the same pct on both sides,
// a holder that read the OTHER side's source would land on exactly the right number and the test
// would be blind to it. At 10 vs 30 (over equal max HP) every wrong source is a distinct value:
// reading the other side's gives the other side's figure, reading both gives their sum.
// Verified as an instrument, not assumed: handing the player holder the ENEMY percentage while
// leaving the assertions alone turns the first expectation red (`expected 30000 to be 10000`).

/** A SELF-targeted HoT. Self-applied deliberately: `applierId === actor.id` short-circuits
 *  `hotApplierMaxHp` to the holder's own effective HP, so neither holder needs a foreign applier
 *  to have banked a turn ctx and the two sides stay independent by construction. */
const selfHotBuff = (hotPct: number): Ability => ({
    id: `ab-self-hot-${hotPct}`,
    type: 'buff',
    target: 'self',
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

const PLAYER_HOT_PCT = 10;
const ENEMY_HOT_PCT = 30;

describe('#369 — a HoT on each side stays scoped to its own holder', () => {
    it('each holder gains exactly its OWN percentage, neither the other side’s nor the sum', () => {
        const bus = createEventBus();
        let playerHolder: CombatActor | undefined;
        let enemyHolder: CombatActor | undefined;
        // `FOE_ID` is the inert filler enemy in `runFixture`; here the same id carries the ENEMY
        // holder's HoT. Both holders start at half HP so both ticks have room to be consumed.
        const seed = (actors: CombatActor[]): void => {
            playerHolder = actors.find((a) => a.id === HOLDER_ID);
            enemyHolder = actors.find((a) => a.id === FOE_ID);
            if (playerHolder) playerHolder.currentHp = START;
            if (enemyHolder) enemyHolder.currentHp = START;
        };

        runCombat({
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
            healTargetId: FOCUS_ID,
            mode: 'healing',
            perRecipientHealApply: true,
            hacking: 100_000,
            __testTapActors: seed,
            bus,
            // ── The FOCUS: the heal anchor (`healTargetId: FOCUS_ID` above), inert, and carrying
            // no HoT of its own (empty active slot). So neither holder under test is the anchor,
            // and the anchor contributes no tick of its own to either side's figure.
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: INERT_HP,
            speed: 1,
            position: 'M1',
            chargeCount: 0,
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            shipSkills: { slots: [activeSlot([])] },
            teamActors: [
                walkedAlly({
                    id: HOLDER_ID,
                    position: 'M4' as Position,
                    speed: 500,
                    hp: HOLDER_MAX_HP,
                    slots: [activeSlot([selfHotBuff(PLAYER_HOT_PCT)])],
                }),
            ],
            enemyAttackers: [
                enemyShip({
                    id: FOE_ID,
                    position: 'M4',
                    speed: 400,
                    hp: HOLDER_MAX_HP,
                    slots: [activeSlot([selfHotBuff(ENEMY_HOT_PCT)])],
                }),
            ],
        });

        // 10% of its own 100,000 — the PLAYER holder's own pct, and only it. Reading the enemy
        // holder's source instead would give 30,000; reading both would give 40,000.
        expect(playerHolder!.currentHp - START).toBe((HOLDER_MAX_HP * PLAYER_HOT_PCT) / 100);
        // 30% of its own 100,000 — the ENEMY holder's own pct, the mirror of the same claim
        // (10,000 for the wrong source, 40,000 for both).
        expect(enemyHolder!.currentHp - START).toBe((HOLDER_MAX_HP * ENEMY_HOT_PCT) / 100);
    });
});

// ══ 7: the tick DOES arm `'target-repaired-this-round'`, on both sides ════════════════════════
//
// ⚠️ THIS IS THE CHANNEL R2 DOES NOT COVER — not "half of R2". Calling it that would be the
// very conflation `playerTurn.ts` was rewritten to forbid, and a comment there once claimed the
// opposite outright. R2 says a HoT tick fires no on-repaired
// TRIGGER and emits no `heal-performed` — asserted above, on both sides. It says nothing about
// `repairedThisRound`, which is a DIFFERENT channel: `applyHealToTarget` adds its victim to that
// set whenever `consumed > 0` (engine.ts:3756), the engine reads it back as
// `targetRepairedThisRound` while building each actor's turn args (engine.ts:8310), and that flag
// gates the `'target-repaired-this-round'` ability CONDITION (Nayra's charged purge and its
// Stasis/Exposed inflicts).
//
// #369 widened that condition's reach: before it, only a player-side ANCHOR holder could arm the
// flag from a tick, because only the anchor was pool-applied. Now an enemy holder and an
// off-anchor player holder arm it too. Per the owner's ruling — any HP restoration counts as being
// repaired this round — that is correct and intended, and it makes every holder agree with what a
// player-side anchor holder already did before the change. Nothing covered it either way, so this
// is its fence.
//
// HOW IT IS OBSERVED: an OBSERVER on the side opposing the holder, acting AFTER it, carries one
// ability — a self-buff gated on `'target-repaired-this-round'`. The gate reads whether the
// OBSERVER'S OWN TURN TARGET was repaired, so the observer must resolve the HOLDER as its target.
// On the enemy-holder arm that is forced: the holder is the only enemy. On the player-holder arm
// the opposing side also carries the inert focus, and `parseTarget('front')` picks the front column
// (M4, the holder) over the focus at M1 — and the positive arm's own pass is the proof of it, since
// the focus is never repaired in either arm and locking onto it would leave the gate shut in both.
//
// The observer deliberately carries NO attack ability. `nayraEnemyRepairedPurge.test.ts` adds a
// basic hit to its gated caster "so targetId resolves", which reads like a requirement to copy —
// it is not one here: this fixture was run BOTH with and without such a hit and both arms are green
// either way, so the turn target resolves from the parsed target alone. One fewer moving part, and
// no damage anywhere near the holder's HP.
//
// The gate is read off the observer's own self-buff store through `__testTapStatusEngine`, the same
// channel `nayraEnemyRepairedPurge.test.ts` reads (there keyed by an enemy actor's id, which is
// what the player-holder arm below needs).

const WITNESS = 'Repaired Target Witness';
const OBSERVER_ID = 'observer';

/** The observer's gated self-buff: applied only if its turn TARGET was repaired this round. */
const repairedGateWitness = (): Ability => ({
    id: 'ab-witness',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [{ subject: 'target-repaired-this-round', derivable: true }],
    config: {
        type: 'buff',
        buffName: WITNESS,
        parsedEffects: { attack: 10 },
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

interface RepairedGateRun {
    holderHpAfter: number;
    observerSelfBuffNames: string[];
}

function runRepairedGateFixture(args: {
    holderSide: 'player' | 'enemy';
    /** `false` strips the HoT from the holder's slot — the control arm: nothing repairs it, so the
     *  gate must stay closed. Everything else about the fixture is identical. */
    hot: boolean;
}): RepairedGateRun {
    const bus = createEventBus();
    let holder: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        holder = actors.find((a) => a.id === HOLDER_ID);
        if (holder) holder.currentHp = START;
    };
    let statusEngine: StatusEngine | undefined;

    // Speed 500 for the holder, 100 for the observer: the holder must tick BEFORE the observer's
    // gate is evaluated, or the flag would not be set yet whatever the code did. Load-bearing, and
    // measured as such: at holder speed 50 (slower than the observer) both arms report the gate
    // shut, so the ordering — not some always-on grant — is what makes the positive arm pass.
    const holderSlots: ShipSkills['slots'] = args.hot
        ? [activeSlot([selfHotBuff(HOT_PCT)])]
        : [activeSlot([])];
    const holderShape: RoleShape = {
        id: HOLDER_ID,
        position: 'M4' as Position,
        speed: 500,
        hp: HOLDER_MAX_HP,
        slots: holderSlots,
    };
    const observerSlots: ShipSkills['slots'] = [activeSlot([repairedGateWitness()])];

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
        healTargetId: FOCUS_ID,
        mode: 'healing' as const,
        perRecipientHealApply: true,
        hacking: 100_000,
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        __testTapActors: seed,
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
        bus,
        chargeCount: 0,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
    };

    const input: CombatEngineInput =
        args.holderSide === 'enemy'
            ? {
                  // The player FOCUS is the observer (it is also the anchor — harmless, it holds no
                  // HoT and is never repaired). The enemy side is the holder ALONE, so the
                  // observer's target cannot be anyone else.
                  ...common,
                  hp: INERT_HP,
                  speed: 100,
                  position: 'M4' as const,
                  shipSkills: { slots: observerSlots },
                  teamActors: [],
                  enemyAttackers: [enemyShip(holderShape)],
              }
            : {
                  // Off-anchor PLAYER holder: the inert focus is the anchor, the holder is a walked
                  // team actor, and the observer is the lone enemy.
                  ...common,
                  hp: INERT_HP,
                  speed: 1,
                  position: 'M1' as const,
                  shipSkills: { slots: [activeSlot([])] },
                  teamActors: [walkedAlly(holderShape)],
                  enemyAttackers: [
                      enemyShip({
                          id: OBSERVER_ID,
                          position: 'M1',
                          speed: 100,
                          hp: INERT_HP,
                          slots: observerSlots,
                      }),
                  ],
              };

    runCombat(input);
    // On the enemy-holder arm the observer IS the focus, whose self-buff store is keyed by the
    // engine's fixed focus id rather than by `OBSERVER_ID`.
    const observerKey = args.holderSide === 'enemy' ? FOCUS_ID : OBSERVER_ID;
    return {
        holderHpAfter: holder!.currentHp,
        observerSelfBuffNames: statusEngine!
            .timedAbilityStatuses('self', observerKey)
            .map((b) => b.active.buffName),
    };
}

describe("#369 — a HoT tick counts as being repaired this round ('target-repaired-this-round')", () => {
    for (const holderSide of ['enemy', 'player'] as const) {
        it(`${holderSide}-side holder: its tick arms the gate, and without the HoT the gate stays shut`, () => {
            const ticked = runRepairedGateFixture({ holderSide, hot: true });
            const control = runRepairedGateFixture({ holderSide, hot: false });

            // PRECONDITION on both arms, so neither can pass for the wrong reason: the HoT arm
            // really ticked, and the control arm really was never repaired.
            expect(ticked.holderHpAfter - START).toBe(EXPECTED_TICK);
            expect(control.holderHpAfter).toBe(START);

            // THE RULED BEHAVIOUR: the tick restored HP, so the holder counts as repaired this
            // round and the observer's gated buff lands.
            expect(ticked.observerSelfBuffNames).toContain(WITNESS);
            // …and the gate really is the thing being measured: the identical fixture with no HoT
            // leaves it shut. Without this arm an always-firing buff would look like a pass.
            expect(control.observerSelfBuffNames).not.toContain(WITNESS);
        });
    }
});

// ══ 8: the tick reaches the REPORTED HP percentage, not just `currentHp` ══════════════════════
//
// WHAT WAS BROKEN (final-review FIX 1). `assembleBattleResult` — the assembler behind the
// Simulator's board and round cards — never reads `currentHp`. It DERIVES each ship's `hpPct` as
// `maxHp − hpLost + healed`, and `healed` was accumulated exclusively from
// `heal-performed.perTarget`. This block emits no `heal-performed` (R2, asserted in sections 1–4)
// and `RoundData` carries no healing buckets, so a HoT tick moved the engine's HP and moved
// NOTHING the UI shows: the bar width, its low-HP colour (`boardOverlays.ts` → `BattleBoard.tsx`),
// its `N% HP` aria-label and the round card's HP figure all stayed at the damaged value.
//
// #369 is what made that general. While the block was wrapped in `if (!healEventOnly)` and
// `tickHot` returned early off-anchor, only the player-side ANCHOR holder gained HP from a tick —
// one ship diverged. With every holder on both sides ticking, every holder diverged.
//
// WHAT THIS FIXTURE MEASURES. The REPORTED number, through the production assembler, subscribed
// from the production `LOG_EVENT_TYPES` list — so a `hot-ticked` missing from that list (the
// defect class `combatLogVisibility.test.ts` was written for: a handler the bus never feeds) fails
// here rather than passing quietly. Asserting `holder.currentHp` instead would be the mistake the
// fix is about: the engine's HP was never the broken half.
//
// WHY THE HOLDER MUST TAKE A HIT. The assembler starts every ship at its roster `maxHp`; it knows
// nothing about `__testTapActors` seeding. A holder at full HP therefore reports 100% before AND
// after (the tick is pure overheal, `consumed` is 0, and `clampPct` hides the rest), so the fixture
// would be blind. A BRUISER on the opposing side opens a real deficit first — hence the one
// actor in this file with `attack > 0`. Its damage does not need to be predicted: every assertion
// below is either differential between two otherwise-identical runs or a comparison of the
// reported percentage against the engine's own live HP.
//
// DETERMINISM: the bruiser has `crit: 0` like everything else here, so it draws from no rate
// stream and its damage is the same in both arms of each pair. Verified as such — the control and
// HoT runs report identical `hpLost` for the holder (asserted below), which is what makes the
// difference between them attributable to the tick alone.
//
// `mode: 'battle'`, not this file's usual `mode: 'healing'`: 'battle' is the run kind the Simulator
// page itself uses (`simulateBattle`), and it anchors the heal target to the focus, so the holder
// is off-anchor here without a `healTargetId` of its own. The HoT block is mode-independent —
// sections 1–7 exercise it under 'healing' and it behaves identically here.
//
// MEASURED AS AN INSTRUMENT, not assumed: with the assembler's `hot-ticked` fold disabled, the HoT
// arm reports 70% on both sides while the engine holds 80,000/100,000 — the exact 10-point
// under-report FIX 1 removes. Every assertion below fails in that state.

/** The one attacking actor in this file. Speed 900 → hits the holder (speed 500) BEFORE it ticks,
 *  so the tick has a deficit to land in. Attack 30,000 against defence 0 opens a deficit well
 *  clear of one 10,000 tick, so nothing here overheals or clamps. */
const BRUISER_ID = 'bruiser';
const BRUISER_ATTACK = 30_000;

/** A plain 100%-of-attack hit on the front enemy. Needed EXPLICITLY: an actor whose active slot is
 *  present but empty (`activeSlot([])`, as every inert role in this file uses) performs no attack
 *  at all — the engine only synthesizes a basic hit for an actor with NO shipSkills. Measured, not
 *  assumed: without this ability the bruiser dealt 0 and the fixture reported a clamped 100%. */
const basicHit = (): Ability => ({
    id: 'ab-basic-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

interface ReportedRun {
    /** The holder's reported HP percentage in round 1 — the number `BattleBoard`/`ShipRoundCard`
     *  render, straight out of the production assembler. */
    reportedHpPct: number;
    /** The holder's reported cumulative HP loss basis for round 1, so the two runs of a pair can be
     *  shown to have taken the SAME damage. */
    reportedDamageTaken: number;
    /** The engine's live HP for the holder — the ground truth `reportedHpPct` must agree with. */
    liveHp: number;
    /** Every `hot-ticked` the run emitted, collected through the PRODUCTION subscription list. */
    hotTicks: Extract<CombatEvent, { type: 'hot-ticked' }>[];
}

function runReportedFixture(args: {
    holderSide: 'player' | 'enemy';
    /** `false` gives the holder an empty active slot instead of the HoT — the control arm. */
    hot: boolean;
}): ReportedRun {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    // EXACTLY the production surface `simulateBattle` subscribes. Not a hand-picked list: that is
    // what makes "the assembler can see the tick" a claim about production wiring.
    for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => events.push(e as CombatEvent));

    let holder: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        holder = actors.find((a) => a.id === HOLDER_ID);
    };

    const holderShape: RoleShape = {
        id: HOLDER_ID,
        position: 'M4' as Position,
        speed: 500,
        hp: HOLDER_MAX_HP,
        slots: args.hot ? [activeSlot([selfHotBuff(HOT_PCT)])] : [activeSlot([])],
    };

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
        mode: 'battle' as const,
        perRecipientHealApply: true,
        hacking: 100_000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        __testTapActors: seed,
        bus,
        chargeCount: 0,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
    };

    const input: CombatEngineInput =
        args.holderSide === 'enemy'
            ? {
                  // The player FOCUS is the bruiser (and the anchor — it holds no HoT and is never
                  // repaired). The enemy side is the holder alone, so `front` can only bind to it.
                  ...common,
                  attack: BRUISER_ATTACK,
                  hp: INERT_HP,
                  speed: 900,
                  position: 'M4' as const,
                  shipSkills: { slots: [activeSlot([basicHit()])] },
                  teamActors: [],
                  enemyAttackers: [enemyShip(holderShape)],
              }
            : {
                  // Off-anchor PLAYER holder: the inert focus is the anchor at M1, the holder is a
                  // walked team actor at M4 (the front column, so the enemy bruiser binds to it).
                  ...common,
                  attack: 0,
                  hp: INERT_HP,
                  speed: 1,
                  position: 'M1' as const,
                  shipSkills: { slots: [activeSlot([])] },
                  teamActors: [walkedAlly(holderShape)],
                  enemyAttackers: [
                      enemyShip({
                          id: BRUISER_ID,
                          position: 'M1',
                          speed: 900,
                          hp: INERT_HP,
                          slots: [activeSlot([basicHit()])],
                          attack: BRUISER_ATTACK,
                      }),
                  ],
              };

    const engineRounds = runCombat(input).rounds;

    // The same RoundData → assembler mapping `simulateBattle` performs (battleSimulator.ts).
    const byRound = <T>(pick: (rd: (typeof engineRounds)[number]) => T | undefined) => {
        const out: Record<number, T> = {};
        for (const rd of engineRounds) out[rd.round] = pick(rd) ?? ({} as T);
        return out;
    };
    const holderIsEnemy = args.holderSide === 'enemy';
    const result = assembleBattleResult({
        events,
        perRoundPerTarget: byRound((rd) => rd.perTargetDamage),
        perRoundPerShield: byRound((rd) => rd.perActorShield),
        perRoundPerIncoming: byRound((rd) => rd.perActorIncoming),
        perRoundPerDealt: byRound((rd) => rd.perTargetDealt),
        roster: [
            {
                actorId: FOCUS_ID,
                side: 'player',
                name: 'Focus',
                position: holderIsEnemy ? 'M4' : 'M1',
                maxHp: INERT_HP,
            },
            {
                actorId: HOLDER_ID,
                side: holderIsEnemy ? 'enemy' : 'player',
                name: 'Holder',
                position: 'M4',
                maxHp: HOLDER_MAX_HP,
            },
            ...(holderIsEnemy
                ? []
                : [
                      {
                          actorId: BRUISER_ID,
                          side: 'enemy' as const,
                          name: 'Bruiser',
                          position: 'M1' as Position,
                          maxHp: INERT_HP,
                      },
                  ]),
        ],
        numRounds: 1,
    });

    const reported = result.rounds[0].ships.find((s) => s.actorId === HOLDER_ID)!;
    return {
        reportedHpPct: reported.hpPct,
        reportedDamageTaken: reported.incomingDamage,
        liveHp: holder!.currentHp,
        hotTicks: events.filter(
            (e): e is Extract<CombatEvent, { type: 'hot-ticked' }> => e.type === 'hot-ticked'
        ),
    };
}

/** One tick as a percentage of the holder's max HP — 10 points, the size of the gap. */
const TICK_PCT = (100 * EXPECTED_TICK) / HOLDER_MAX_HP;

describe('#369 final review — a HoT tick reaches the REPORTED HP percentage on both sides', () => {
    for (const holderSide of ['player', 'enemy'] as const) {
        it(`${holderSide}-side holder: the reported hpPct includes the tick`, () => {
            const ticked = runReportedFixture({ holderSide, hot: true });
            const control = runReportedFixture({ holderSide, hot: false });

            // ── PRECONDITIONS, so no assertion below can pass for the wrong reason ────────────
            // (a) The tick really happened, and it is the ONLY difference between the two runs.
            expect(ticked.liveHp - control.liveHp).toBe(EXPECTED_TICK);
            // (b) A real deficit was opened, so nothing here is a clamped 100%. Without the
            //     bruiser both runs would report 100 and the fixture would be blind.
            expect(control.reportedHpPct).toBeLessThan(100);
            expect(control.reportedDamageTaken).toBeGreaterThan(EXPECTED_TICK);
            // (c) Both runs took the SAME damage, which is what makes (2) below attributable to
            //     the tick rather than to a different hit landing.
            expect(ticked.reportedDamageTaken).toBe(control.reportedDamageTaken);

            // ── 1. THE REPORTING CHANNEL EXISTS and carries the LANDED HP ────────────────────
            // Through the production `LOG_EVENT_TYPES` subscription: a `hot-ticked` absent from
            // that list would leave this at length 0.
            expect(ticked.hotTicks).toHaveLength(1);
            expect(ticked.hotTicks[0]).toMatchObject({
                holderId: HOLDER_ID,
                amount: EXPECTED_TICK,
                round: 1,
            });
            // The control emits none — the event tracks ticks, not turns.
            expect(control.hotTicks).toHaveLength(0);

            // ── 2. THE FIX: the reported percentage agrees with the engine's live HP ─────────
            // This is the assertion that was red before FIX 1: the derived bar was short by the
            // whole tick, i.e. it reported the CONTROL's percentage for a ship that had healed.
            expect(ticked.reportedHpPct).toBeCloseTo((100 * ticked.liveHp) / HOLDER_MAX_HP, 9);
            // …and the control's agreement too, so (2) is not passing because the derivation
            // happens to be broken in a compensating direction.
            expect(control.reportedHpPct).toBeCloseTo((100 * control.liveHp) / HOLDER_MAX_HP, 9);

            // ── 3. DIFFERENTIAL: exactly one tick's worth of percentage points, no more ──────
            expect(ticked.reportedHpPct - control.reportedHpPct).toBeCloseTo(TICK_PCT, 9);

            // ── 4. The RECEIVED axis the round card shows moves with it (same fold) ──────────
            const receivedTicked = ticked.hotTicks.reduce((s, e) => s + e.amount, 0);
            expect(receivedTicked).toBe(EXPECTED_TICK);
        });
    }
});
