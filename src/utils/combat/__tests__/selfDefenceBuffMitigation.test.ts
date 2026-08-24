/**
 * ADDENDUM A2/A5 (#358) — a defender's OWN defence modifier reduces the damage it takes, on both
 * sides, in both directions.
 *
 * ── WHAT WAS BROKEN ───────────────────────────────────────────────────────────────────────────
 * On the positional APPLIED damage path, `victimDefenseProfileOf` read the victim's BASE
 * `stats.defence` and paired it with `defenceModifierPct: m.enemyDefenseModifier` — a channel that
 * carried enemy-sourced debuffs ONLY. So an enemy's `Defense Shred` worked and the victim's own
 * `Defense Up` did not: two independent places a self-defence term could enter, and it entered
 * neither. (Its twin channel one line away, `incomingDamageModifier`, had carried a self-sourced
 * term since D-PR12 — the parallel that made this an oversight rather than a design choice. Every
 * OTHER direct-damage site — counter, reactive proc, Protection fallback — already mitigated on
 * `effectiveStatsOf(...).defence`, i.e. the buff-folded stat. The positional applied path was the
 * sole hold-out.)
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
 * THE GOLDEN SUITES DO NOT GATE THIS CHANGE. Measured before the fix landed, with a probe on
 * `victimIncomingModifiers`: `simGolden`, `dpsGoldenParity` and `healingGoldenParity` produce ZERO
 * non-zero self-defence reads (their fixtures are synthetic and carry no self-side defence buff at
 * all), while `realKitFingerprints` produces 2534 — and cannot report them, because it is
 * deliberately STRUCTURAL ("does this clause still fire"), not numeric. So a sign error, an
 * off-by-one on stacks or a missing floor would ALL have produced a completely green golden run.
 * Every property below is therefore pinned here, explicitly, or it is not pinned anywhere.
 *
 * ── THE THREE PROPERTIES ──────────────────────────────────────────────────────────────────────
 *  1. DIRECTION. `defenceModifierPct` is SIGNED and consumed as `v.defence * (1 + pct / 100)`.
 *     Fold the term in with the wrong sign and `Defense Up` becomes a debuff — while every
 *     magnitude-only assertion still passes, because the number still MOVED. Asserted as an
 *     inequality, not inferred from a constant.
 *  2. THE -100% FLOOR. `Overload` is a self-buff at '-10% Defense' stacking to 10, so a real ship
 *     reaches exactly -100%: effective defence 0. `victimDefenceMitigation` guards this with
 *     `effectiveDefense > 0 ? ... : 0`, so the reduction floors at zero instead of inverting into a
 *     damage BONUS. An unclamped implementation is indistinguishable from a clamped one on every
 *     fixture that never reaches -100%, so the floor gets its own arm — including an OVER-shot
 *     (-150%) arm, since "floors" and "happens to be 0 at exactly -100" are different claims.
 *  3. TEAM SYMMETRY. Engine changes in this project must be team-symmetric. Every arm runs TWICE
 *     from one builder, once per side.
 *
 * ── WHY THE ABILITY CHANNEL, NOT `selfBuffs` ──────────────────────────────────────────────────
 * `victimSelfBuffs` reads three channels: scheduled (`selfBuffLookup`), timed ability statuses and
 * auras. The SCHEDULED one has a pre-existing player-only gap — the engine's `selfBuffLookup` is
 * built from `[...selfBuffs, ...teamActors.flatMap(t => t.selfBuffs)]` and BOTH the enemy runtime
 * and the walked-team runtime are constructed with `selfBuffLookup: new Map()`. A symmetry test
 * written on `selfBuffs` would therefore pass on the player side and be VACUOUS on the enemy side,
 * proving nothing about the thing it claims to prove. These fixtures grant the buff as a
 * self-targeted ABILITY, which is both side-agnostic and how a real ship's Defense Up arrives.
 *
 * ── FIXTURE SHAPE ─────────────────────────────────────────────────────────────────────────────
 *   - FOCUS     an inert player actor at M1 (back). Never an attacker, never a victim; it exists
 *               because the engine needs a focus. Its huge HP keeps it irrelevant.
 *   - ATTACKER  M4 (FRONT) on one side, a flat 100%-of-attack single-target hit.
 *   - DEFENDER  M4 (FRONT) on the other side, so the attacker's `front` selection binds to it and
 *               not to the focus. Optionally self-buffs its own defence on cast.
 * The DEFENDER is faster than the attacker, so its own on-cast self-buff is already standing when
 * the hit lands — otherwise every arm would measure the unbuffed value and quietly agree.
 *
 * NO RNG: `crit: 0` on every actor and `noCrit` on the hit, so no rate gate has a live stream and
 * the intake is exact arithmetic rather than a seeded draw.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { parsePattern, parseTarget } from '../../targetingParser';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { Position } from '../../../types/encounters';

// NOT 'attacker': that id is RESERVED for the focus actor and runCombat rejects the collision.
const ATTACKER_ID = 'striker';
const DEFENDER_ID = 'defender';

const ATTACK = 20_000;
const DEFENCE = 5_000;
/** Large enough that the defender comfortably survives every arm, including the -100% one. */
const DEFENDER_HP = 100_000_000;
const INERT_HP = 1_000_000_000;

/** The engine's own defence term, reproduced for the oracle:
 *  `victimDefenceMitigation` = 1 - damageReduction/100, guarded at non-positive defence. */
const mit = (defence: number): number =>
    defence > 0 ? 1 - calculateDamageReduction(defence) / 100 : 1;

type Side = 'player' | 'enemy';
const SIDES: readonly Side[] = ['player', 'enemy'];
type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Abilities ─────────────────────────────────────────────────────────────────────────────────

/** A plain 100%-of-attack single hit on the front enemy. Declared EXPLICITLY: an actor whose
 *  active slot exists but is empty performs no attack at all (the engine only synthesizes a basic
 *  hit for an actor with NO shipSkills). */
const basicHit: Ability = {
    id: 'ab-basic-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1, noCrit: true },
};

/** A self-targeted defence buff on the ABILITY channel (see the header on why not `selfBuffs`).
 *  `pct` is signed: +30 is 'Defense Up II', -100 is 'Overload' at its 10-stack cap. */
const selfDefenceBuff = (pct: number): Ability => ({
    id: 'ab-self-defence',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Defense Up II',
        parsedEffects: { defense: pct },
        stacks: 1,
        isStackable: false,
        duration: 'recurring',
    },
});

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
    attack: number;
    defence: number;
    slots: ShipSkills['slots'];
}

const walkedAlly = (a: RoleShape): TeamActorEngineInput => ({
    id: a.id,
    speed: a.speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: a.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: { slots: a.slots },
        stats: {
            attack: a.attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: a.defence,
            hp: a.hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const enemyShip = (a: RoleShape): EnemyAttackerInput => ({
    id: a.id,
    stats: {
        attack: a.attack,
        crit: 0,
        critDamage: 0,
        defence: a.defence,
        hp: a.hp,
        speed: a.speed,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: a.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: a.slots },
});

// ── The fixture ───────────────────────────────────────────────────────────────────────────────

interface FixtureOpts {
    /** Which side the DEFENDER stands on. The attacker always stands on the other one. */
    defenderSide: Side;
    /** Signed self-defence percentage, or `undefined` for the no-buff control. */
    buffPct?: number;
    /** Defaults to DEFENCE. Set 0 for the "what does an undefended ship take" oracle. */
    defence?: number;
}

/** The HP the defender lost over one round — the measured intake. */
function intake(opts: FixtureOpts): number {
    // Speed 900 vs 500: the defender always acts (and so self-buffs) before the attacker fires.
    // Without this every arm would measure the unbuffed value and silently agree with the control.
    const defenderShape: RoleShape = {
        id: DEFENDER_ID,
        position: 'M4',
        speed: 900,
        hp: DEFENDER_HP,
        attack: 0,
        defence: opts.defence ?? DEFENCE,
        slots: [activeSlot(opts.buffPct === undefined ? [] : [selfDefenceBuff(opts.buffPct)])],
    };
    const attackerShape: RoleShape = {
        id: ATTACKER_ID,
        position: 'M4',
        speed: 500,
        hp: INERT_HP,
        attack: ATTACK,
        defence: 0,
        slots: [activeSlot([basicHit])],
    };

    let defender: CombatActor | undefined;
    const seed = (actors: CombatActor[]): void => {
        defender = actors.find((x) => x.id === DEFENDER_ID);
    };

    const focus = {
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
        hacking: 0,
        __testTapActors: seed,
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
        opts.defenderSide === 'player'
            ? {
                  ...focus,
                  teamActors: [walkedAlly(defenderShape)],
                  enemyAttackers: [enemyShip(attackerShape)],
              }
            : {
                  ...focus,
                  teamActors: [walkedAlly(attackerShape)],
                  enemyAttackers: [enemyShip(defenderShape)],
              };

    runCombat(input);
    return DEFENDER_HP - defender!.currentHp;
}

// ══ 1: direction ══════════════════════════════════════════════════════════════════════════════

describe('A2 — a defender’s own Defense Up reduces the damage it takes', () => {
    for (const defenderSide of SIDES) {
        it(`${defenderSide}-side defender: +30% Defense mitigates on 1.30x, in the RIGHT direction`, () => {
            const plain = intake({ defenderSide });
            const buffed = intake({ defenderSide, buffPct: 30 });

            // LIVENESS, so no assertion below can be the vacuous kind: the attacker really hit,
            // and the unbuffed arm really mitigated on the base stat.
            expect(plain).toBeCloseTo(ATTACK * mit(DEFENCE), 4);
            expect(plain).toBeGreaterThan(0);

            // DIRECTION — the load-bearing half. A sign error still moves `buffed` off `plain`
            // and still satisfies any "it changed" assertion; only this one fails.
            expect(buffed).toBeLessThan(plain);
            // MAGNITUDE — and the exact one, so a term that arrives at half strength or double
            // counts is caught too. 5000 x 1.30 = 6500.
            expect(buffed).toBeCloseTo(ATTACK * mit(DEFENCE * 1.3), 4);
        });
    }
});

// ══ 2: the -100% floor ════════════════════════════════════════════════════════════════════════

describe('A5 — a self-inflicted defence COST applies too, and floors at zero mitigation', () => {
    for (const defenderSide of SIDES) {
        it(`${defenderSide}-side defender: a negative self-defence buff makes it take MORE`, () => {
            const plain = intake({ defenderSide });
            // Overload at 5 stacks. Sign-agnostic by ruling: the app used to grant Overload's
            // damage upside while ignoring the defensive cost printed on the same card.
            const overloaded = intake({ defenderSide, buffPct: -50 });

            expect(overloaded).toBeGreaterThan(plain);
            expect(overloaded).toBeCloseTo(ATTACK * mit(DEFENCE * 0.5), 4);
        });

        it(`${defenderSide}-side defender: -100% zeroes defence and does NOT invert into a bonus`, () => {
            // Overload at its 10-stack cap — a value real ships reach, not a synthetic extreme.
            const capped = intake({ defenderSide, buffPct: -100 });
            // The oracle is an actual undefended ship, not a formula: at -100% the defender must
            // take exactly what a defence-0 ship takes, i.e. the raw hit with no reduction.
            const undefended = intake({ defenderSide, defence: 0 });

            expect(capped).toBeCloseTo(undefended, 4);
            expect(capped).toBeCloseTo(ATTACK, 4);

            // THE FLOOR, as distinct from "0 happens to fall out at exactly -100". Overshooting
            // makes `effectiveDefense` NEGATIVE, and `victimDefenceMitigation`'s
            // `effectiveDefense > 0` guard must clamp the reduction to 0 rather than let a
            // negative defence turn into a damage BONUS. Without the guard this arm exceeds
            // `capped`; an unclamped build is indistinguishable from a clamped one on every
            // fixture that stops short of -100%.
            const overshot = intake({ defenderSide, buffPct: -150 });
            expect(overshot).toBeCloseTo(capped, 4);
            expect(overshot).not.toBeGreaterThan(capped);
        });
    }
});

// ══ 3: team symmetry, stated as one assertion ═════════════════════════════════════════════════

describe('A3 — the self-defence term is team-symmetric', () => {
    it('both sides’ defenders mitigate identically for the same buff', () => {
        // The two arms above already run per side, but each compares a side against ITSELF: a term
        // that reached only one side would still show a consistent within-side story if the other
        // side's control were equally wrong. This compares ACROSS sides, which is the actual
        // symmetry claim.
        for (const pct of [30, -50, -100]) {
            expect(intake({ defenderSide: 'player', buffPct: pct })).toBeCloseTo(
                intake({ defenderSide: 'enemy', buffPct: pct }),
                4
            );
        }
        // And the controls match too, so the equalities above cannot be two identical zeroes.
        expect(intake({ defenderSide: 'player' })).toBeCloseTo(
            intake({ defenderSide: 'enemy' }),
            4
        );
        expect(intake({ defenderSide: 'player' })).toBeGreaterThan(0);

        // NON-VACUITY, measured rather than assumed. A cross-side EQUALITY is satisfied by an
        // engine where the term reaches NEITHER side — verified by neutralising the fix, which
        // turned the six per-side arms above red and left this one green. So this test must also
        // assert the term is live at all: each buff really moves the number away from the control.
        for (const pct of [30, -50, -100]) {
            for (const defenderSide of SIDES) {
                expect(intake({ defenderSide, buffPct: pct })).not.toBeCloseTo(
                    intake({ defenderSide }),
                    4
                );
            }
        }
    });
});
