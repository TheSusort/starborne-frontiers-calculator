/**
 * #358 ADDENDUM 2/3 — the RAW intake axis (`ActorIntake.incomingRaw`).
 *
 * ── WHAT THIS AXIS IS ─────────────────────────────────────────────────────────────────────────
 * `ActorIntake.incoming` is recorded AFTER the caller folded the victim's defence-mitigation
 * factor into the hit (`engine.ts`'s funnel documents the parameter as "the DEFENCE mitigation
 * factor the CALLER already folded into `rawDamage`"). It therefore counts damage that GOT
 * THROUGH, not damage that was THROWN. `incomingRaw` is the same intake with the defence term
 * removed, recorded at the same instant — never reconstructed by dividing (lossy, and undefined
 * at a factor of 0).
 *
 * ADDENDUM 3 WIDENED IT past defence: EVERY victim-side reduction now comes off this axis (the
 * victim's own `Inc. Damage Down` family and pre-fight incoming baseline, `equipReductionPct`,
 * `incomingDotReductionPct`, the reflect channel's incoming-reduction), while attacker-side
 * modifiers and enemy-APPLIED amplification (`Out. Damage Up`, `Exposed`) stay in.
 *
 * ⚠️ SCALING — READ THIS BEFORE TRUSTING AN OLDER COMMENT. This axis is scaled by the Protection
 * retention fraction but NOT by the incoming-block proc. Addendum 3 DELETED the
 * `damageRaw *= (1 - blocked)` line: a blocked hit was thrown in full, so scaling the thrown axis
 * by the block made a defensive proc lower its own owner's headline. Comments (here and in
 * `engine.ts`) that said "scaled by the same incoming-block / Protection factors" outlived that
 * deletion by a full review cycle; they are corrected, and the per-channel direction arm in
 * `defenseSurvivabilitySim.test.ts` (channel 5/5) is what holds the line now.
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
 * MEASURED, not assumed: in `healingGoldenParity` 194 of 194 focus rows have
 * `incomingDamageRaw === incomingDamage` — those fixtures carry no self-side defence at all, so
 * the healing goldens produce ZERO relevant reads. (`dpsGoldenParity` does pin the dominant
 * path — 219 rows where raw > post, because its enemy victims carry defence — but only in the
 * player→enemy direction.) So a sign error, a dropped path or a silently-inert field would leave
 * a completely green golden run. Every property below is pinned here or it is pinned nowhere.
 *
 * ── THE FOLD-SITE WORK LIST ───────────────────────────────────────────────────────────────────
 * A stack-frame probe over the whole combat + calculator corpus (406 files / 3935 tests) found
 * 14 paths into the intake bucket, SEVEN of which fold the defence factor. Six are covered here,
 * one per test:
 *
 *   1. positional firing hit   `victimHitDamageParts` via `drivePositionalApply` (182,548 corpus calls)
 *   2. positional passive-slot hit `stagePassiveSlotHit`                       (121)
 *   4. counter-attack          `applyCounterAttack`                            (624)
 *   5. reactive damage proc    `applyReactiveDamage` (attack-basis branch)     (775)
 *   6. reflect / thorns        `reflectedDamageParts`                          (231)
 *   7. Protection transfer     `protectionCascade` chunk                       (477)
 *
 * (Paths 1 and 6 are named for the PARTS helpers they call today. Both used to be a `…ForHit`
 * single-axis function plus a hand-copied pre-defence twin; the twins are gone and each path now
 * gets both axes from ONE evaluation, so a comment naming the old single-axis entry point sends
 * the next reader to a function the positional path no longer calls.)
 *
 * The seventh, the LEGACY NON-POSITIONAL aggregate apply, is deliberately NOT fixed and so is
 * deliberately not tested — the probe recorded ZERO calls through it in the whole corpus (every
 * enemy attack takes the positional branch), so a fix there could not be exercised by any test.
 * It is parked with the corpus-unreachable group (#357) and carries a comment at its call site.
 *
 * ADDENDUM 3 ADDED AN EIGHTH, from the widened definition rather than from a new call site:
 *
 *   8. per-victim DoT tick batch  `tickDoTs` → `applyVictimDamage`  (the ALLY branch)
 *
 * The remaining paths (bomb splash, bomb/accumulator burst, forced detonation, DoT-detonation
 * bypass) fold no defence and meet no other victim-side reduction, so raw === post there by
 * construction — the `?? rawDamage` default in the funnel, and the suite-health test at the bottom.
 * The DoT tick batch was in that group under addendum 2 and is NOT any more: `incomingDotReductionPct`
 * (Vortex Veil) is a victim-side reduction, so a tick on a veil carrier has two distinct axes. Both
 * tick sites carry a `preMitigationDamage` write; only the heal-target one had a test.
 *
 * ── FIXTURE SHAPE ─────────────────────────────────────────────────────────────────────────────
 *   FOCUS     an inert player actor at M1 (back). Never an attacker, never a victim; it exists
 *             because the engine needs a focus. Huge HP keeps it irrelevant.
 *   ATTACKER / DEFENDER  at M4 (the FRONT column — a `front` selection binds there, not to M1).
 * NO LIVE RNG anywhere: crit 0 on every actor and `noCrit` on every hit, so no rate gate has a
 * live stream and every figure below is exact arithmetic rather than a seeded draw. Path 8 passes
 * through the debuff-landing gate, but at a chance of exactly 1 (hacking 200 vs the walked ally's
 * default security 100) — certain, not drawn. Lower the attacker's hacking there and the DoT stops
 * landing entirely rather than landing sometimes.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { parsePattern, parseTarget } from '../../targetingParser';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

const ATTACK = 20_000;
const DEFENCE = 5_000;
const BIG_HP = 1_000_000_000;

/** The engine's own defence term, reproduced for the oracle:
 *  `victimDefenceMitigation` = 1 - damageReduction/100, guarded at non-positive defence. */
const mit = (defence: number): number =>
    defence > 0 ? 1 - calculateDamageReduction(defence) / 100 : 1;

type Side = 'player' | 'enemy';
const SIDES: readonly Side[] = ['player', 'enemy'];
type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Shapes ────────────────────────────────────────────────────────────────────────────────────

interface RoleShape {
    id: string;
    position: Position;
    speed: number;
    hp: number;
    attack: number;
    defence: number;
    slots: ShipSkills['slots'];
    /** Base hacking. Omitted → 0, the value every pre-existing fixture here used. Supplied only
     *  by path 8, whose DoT must LAND: `liveDebuffLandingChance` defaults a missing base to 200
     *  and a missing security to 100, so hacking 0 against the walked ally's default security
     *  produces a landing chance of ZERO and the DoT silently never applies. */
    hacking?: number;
}

const activeSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities,
});
const passiveSlot = (abilities: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities,
});

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

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself: normalizeTeamActorsToWalked
// synthesizes NEUTRAL_WALK_STATS with **hp: 1** for a team actor arriving without one, silently
// discarding a bare `stats.hp`.
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
        hacking: a.hacking ?? 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: a.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: a.slots },
});

const inertFocus = (
    numRounds: number
): Omit<CombatEngineInput, 'teamActors' | 'enemyAttackers'> => ({
    numRounds,
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
    attack: 0,
    crit: 0,
    critDamage: 0,
    defence: 0,
    hp: BIG_HP,
    speed: 1, // acts last; does nothing anyway
    position: 'M1' as const,
    chargeCount: 0,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [activeSlot([])] },
    healTargetId: 'attacker',
    mode: 'healing',
});

// ── The measurement seam ──────────────────────────────────────────────────────────────────────

interface Axis {
    post: number;
    raw: number;
}

/** Σ over rounds of ONE actor's per-victim intake bucket, both axes. Reads
 *  `RoundData.perActorIncoming` — the only surface that exposes the raw axis for an arbitrary
 *  actor on EITHER side, which is what makes the team-symmetry test below possible at all. */
function axisFor(rounds: ReturnType<typeof runCombat>['rounds'], actorId: string): Axis {
    let post = 0;
    let raw = 0;
    for (const r of rounds) {
        const e = r.perActorIncoming?.[actorId];
        if (!e) continue;
        post += e.incoming;
        raw += e.incomingRaw;
    }
    return { post, raw };
}

/** Every actor's axis in the run — the input to the suite-health invariant at the bottom. */
function allAxes(rounds: ReturnType<typeof runCombat>['rounds']): Map<string, Axis> {
    const out = new Map<string, Axis>();
    for (const r of rounds) {
        for (const [id, e] of Object.entries(r.perActorIncoming ?? {})) {
            const cur = out.get(id) ?? { post: 0, raw: 0 };
            cur.post += e.incoming;
            cur.raw += e.incomingRaw;
            out.set(id, cur);
        }
    }
    return out;
}

/** Every run this file performs, collected so the invariant test sees ALL of them. */
const everyRun: { label: string; axes: Map<string, Axis> }[] = [];

function run(label: string, input: CombatEngineInput): ReturnType<typeof runCombat>['rounds'] {
    const { rounds } = runCombat(input);
    everyRun.push({ label, axes: allAxes(rounds) });
    return rounds;
}

// ══ Path 1: the positional firing hit — plus team symmetry and the exact-equality case ════════

describe('#358 A2 — path 1: the positional firing hit', () => {
    /** One attacker at M4 firing a plain 100% hit at a defender at M4 on the other side. */
    function firingHit(opts: { defenderSide: Side; defence: number }): Axis {
        const defender: RoleShape = {
            id: 'defender',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: 0,
            defence: opts.defence,
            slots: [activeSlot([])], // never attacks → nothing else books on either bucket
        };
        const striker: RoleShape = {
            id: 'striker',
            position: 'M4',
            speed: 500,
            hp: BIG_HP,
            attack: ATTACK,
            defence: 0,
            slots: [activeSlot([basicHit])],
        };
        const input: CombatEngineInput =
            opts.defenderSide === 'player'
                ? {
                      ...inertFocus(1),
                      teamActors: [walkedAlly(defender)],
                      enemyAttackers: [enemyShip(striker)],
                  }
                : {
                      ...inertFocus(1),
                      teamActors: [walkedAlly(striker)],
                      enemyAttackers: [enemyShip(defender)],
                  };
        return axisFor(run(`path1/${opts.defenderSide}/def${opts.defence}`, input), 'defender');
    }

    for (const defenderSide of SIDES) {
        it(`${defenderSide}-side defender: raw counts what was THROWN, post what got THROUGH`, () => {
            const armoured = firingHit({ defenderSide, defence: DEFENCE });

            // LIVENESS first, so nothing below can be the vacuous kind: the hit really landed and
            // the post axis really mitigated on the defender's stat.
            expect(armoured.post).toBeGreaterThan(0);
            expect(armoured.post).toBeCloseTo(ATTACK * mit(DEFENCE), 4);

            // THE INEQUALITY (spec B3). Raw is the full amount thrown — defence-independent.
            expect(armoured.raw).toBeGreaterThan(armoured.post);
            expect(armoured.raw).toBeCloseTo(ATTACK, 4);
        });

        it(`${defenderSide}-side defender: at ZERO effective defence the two axes are EXACTLY equal`, () => {
            // The equality half of B3. Not "close to" — the funnel books the same `damage` value on
            // both axes when no caller folded anything, so this is exact.
            const undefended = firingHit({ defenderSide, defence: 0 });
            expect(undefended.post).toBeGreaterThan(0);
            expect(undefended.raw).toBe(undefended.post);
        });
    }

    it('TEAM SYMMETRY: a player-side and an enemy-side defender report the identical raw axis', () => {
        // Engine changes in this project must be team-symmetric. Both `TurnBindings` forward the
        // new pre-mitigation argument (`applyOutgoingToEnemy` / `applyIncomingToTarget`); if either
        // one stopped, exactly one side of this pair would collapse to raw === post.
        const player = firingHit({ defenderSide: 'player', defence: DEFENCE });
        const enemy = firingHit({ defenderSide: 'enemy', defence: DEFENCE });
        expect(enemy.raw).toBe(player.raw);
        expect(enemy.post).toBe(player.post);
        // Non-vacuity: the pair would also be "identical" if the axis were dead on BOTH sides.
        expect(player.raw).toBeGreaterThan(player.post);
    });
});

// ══ Path 2: the positional passive-slot hit ═══════════════════════════════════════════════════

describe('#358 A2 — path 2: the positional passive-slot hit', () => {
    it('a passive-slot damage instance books its own pre-defence figure', () => {
        // The passive slot lands a SECOND positional damage instance in the same turn, through its
        // own `tb.applyToVictim` call. Before the fix it was the classic one-site-fix casualty:
        // the firing hit would record raw and this instance would not.
        const passiveDamage: Ability = {
            id: 'ab-passive-slot',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 50, hits: 1, noCrit: true },
        };
        const defender: RoleShape = {
            id: 'defender',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: 0,
            defence: DEFENCE,
            slots: [activeSlot([])],
        };
        const striker: RoleShape = {
            id: 'striker',
            position: 'M4',
            speed: 500,
            hp: BIG_HP,
            attack: ATTACK,
            defence: 0,
            slots: [activeSlot([basicHit]), passiveSlot([passiveDamage])],
        };
        const withPassive = axisFor(
            run('path2/with', {
                ...inertFocus(1),
                teamActors: [walkedAlly(defender)],
                enemyAttackers: [enemyShip(striker)],
            }),
            'defender'
        );
        const withoutPassive = axisFor(
            run('path2/without', {
                ...inertFocus(1),
                teamActors: [walkedAlly(defender)],
                enemyAttackers: [enemyShip({ ...striker, slots: [activeSlot([basicHit])] })],
            }),
            'defender'
        );

        // NON-VACUITY: the passive slot must actually have added a hit, or this proves nothing.
        expect(withPassive.post).toBeGreaterThan(withoutPassive.post);

        // The DELTA is the passive instance alone. It must appear on BOTH axes, and its raw share
        // must exceed its post share by the defender's mitigation — a differential assertion, so a
        // fix that recorded raw only for the firing hit fails here even though the totals moved.
        const deltaPost = withPassive.post - withoutPassive.post;
        const deltaRaw = withPassive.raw - withoutPassive.raw;
        expect(deltaPost).toBeCloseTo(ATTACK * 0.5 * mit(DEFENCE), 4);
        expect(deltaRaw).toBeCloseTo(ATTACK * 0.5, 4);
        expect(deltaRaw).toBeGreaterThan(deltaPost);
    });
});

// ══ Path 4: the counter-attack ════════════════════════════════════════════════════════════════

describe('#358 A2 — path 4: the counter-attack', () => {
    it("a counter books the pre-defence figure against the ATTACKER's defence", () => {
        // The counter's victim is the original attacker, so the fold is on ITS defence — a
        // direction the firing-hit fixture never exercises.
        const counter: Ability = {
            id: 'ab-counter',
            type: 'counter',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: { type: 'counter', multiplier: 100, hits: 1 },
        };
        const defender: RoleShape = {
            id: 'defender',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: ATTACK, // the counter is scaled off the OWNER's attack
            defence: 0,
            slots: [activeSlot([]), passiveSlot([counter])],
        };
        const striker: RoleShape = {
            id: 'striker',
            position: 'M4',
            speed: 500,
            hp: BIG_HP,
            attack: ATTACK,
            defence: DEFENCE, // the counter victim's defence — the term under test
            slots: [activeSlot([basicHit])],
        };
        // `striker` never takes a firing hit (the defender's active slot is empty), so everything
        // in its bucket is the counter.
        const strikerAxis = axisFor(
            run('path4/counter', {
                ...inertFocus(1),
                teamActors: [walkedAlly(defender)],
                enemyAttackers: [enemyShip(striker)],
            }),
            'striker'
        );

        expect(strikerAxis.post).toBeGreaterThan(0);
        expect(strikerAxis.post).toBeCloseTo(ATTACK * mit(DEFENCE), 4);
        expect(strikerAxis.raw).toBeGreaterThan(strikerAxis.post);
        expect(strikerAxis.raw).toBeCloseTo(ATTACK, 4);
    });
});

// ══ Path 6: reflect / thorns ══════════════════════════════════════════════════════════════════

describe('#358 A2 — path 6: reflect', () => {
    it('reflected thorns book their own pre-defence figure', () => {
        // Reflect goes through `reflectedDamageForHit`, a DIFFERENT expression from
        // `victimHitDamage` — it folds `attackerDefenceReductionPct` itself. A fix confined to
        // `victimHitDamage` leaves this path booking raw === post.
        const reflectPct = 10;
        const reflection: Ability = {
            id: 'ab-reflect',
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage-reflection', pct: reflectPct },
        };
        const defender: RoleShape = {
            id: 'defender',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: 0,
            defence: 0, // 0 so the defender's own HP loss is the full hit — a clean reflect basis
            slots: [activeSlot([]), passiveSlot([reflection])],
        };
        const striker: RoleShape = {
            id: 'striker',
            position: 'M4',
            speed: 500,
            hp: BIG_HP,
            attack: ATTACK,
            defence: DEFENCE, // the REFLECT victim's defence — the term under test
            slots: [activeSlot([basicHit])],
        };
        const withReflect = axisFor(
            run('path6/with', {
                ...inertFocus(1),
                teamActors: [walkedAlly(defender)],
                enemyAttackers: [enemyShip(striker)],
            }),
            'striker'
        );
        const withoutReflect = axisFor(
            run('path6/without', {
                ...inertFocus(1),
                teamActors: [walkedAlly({ ...defender, slots: [activeSlot([]), passiveSlot([])] })],
                enemyAttackers: [enemyShip(striker)],
            }),
            'striker'
        );

        // NON-VACUITY: the control must reflect NOTHING, so every figure below is the reflection.
        expect(withoutReflect.post).toBe(0);
        expect(withoutReflect.raw).toBe(0);

        expect(withReflect.post).toBeGreaterThan(0);
        expect(withReflect.post).toBeCloseTo(ATTACK * (reflectPct / 100) * mit(DEFENCE), 4);
        expect(withReflect.raw).toBeGreaterThan(withReflect.post);
        expect(withReflect.raw).toBeCloseTo(ATTACK * (reflectPct / 100), 4);
    });
});

// ══ Path 5: the reactive damage proc ══════════════════════════════════════════════════════════

describe('#358 A2 — path 5: the reactive damage proc', () => {
    it('a reactive damage proc books its own pre-defence figure', () => {
        // `applyReactiveDamage`'s attack-basis branch runs its own `victimHitDamage` walk, separate
        // from both the firing hit and the counter. (Its `flatBasis` sibling — Demolisher's
        // bomb-splash copy — folds no defence at all and correctly books raw === post.)
        const reactiveDamage: Ability = {
            id: 'ab-reactive-damage',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: { type: 'damage', multiplier: 100, hits: 1, noCrit: true },
        };
        const defender: RoleShape = {
            id: 'defender',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: ATTACK, // the proc is scaled off the OWNER's attack
            defence: 0,
            slots: [activeSlot([]), passiveSlot([reactiveDamage])],
        };
        const striker: RoleShape = {
            id: 'striker',
            position: 'M4',
            speed: 500,
            hp: BIG_HP,
            attack: ATTACK,
            defence: DEFENCE, // the proc victim's defence — the term under test
            slots: [activeSlot([basicHit])],
        };
        const withProc = axisFor(
            run('path5/with', {
                ...inertFocus(1),
                teamActors: [walkedAlly(defender)],
                enemyAttackers: [enemyShip(striker)],
            }),
            'striker'
        );
        const withoutProc = axisFor(
            run('path5/without', {
                ...inertFocus(1),
                teamActors: [walkedAlly({ ...defender, slots: [activeSlot([]), passiveSlot([])] })],
                enemyAttackers: [enemyShip(striker)],
            }),
            'striker'
        );

        // NON-VACUITY: the control must proc NOTHING, so every figure below is the proc.
        expect(withoutProc.post).toBe(0);

        expect(withProc.post).toBeGreaterThan(0);
        expect(withProc.post).toBeCloseTo(ATTACK * mit(DEFENCE), 4);
        expect(withProc.raw).toBeGreaterThan(withProc.post);
        expect(withProc.raw).toBeCloseTo(ATTACK, 4);
    });
});

// ══ Path 7: the Protection transfer chunk ═════════════════════════════════════════════════════

describe('#358 A2 — path 7: the Protection transfer chunk', () => {
    it("a redirected chunk books the PROTECTOR's own pre-defence figure", () => {
        // The chunk is re-mitigated on the PROTECTOR's defence inside `protectionCascade`, so its
        // pre-defence figure has to come off the cascade's P-space inflow — not off
        // `victimHitDamage`, and not by dividing `perStack` back out. For a tank-role defender this
        // is the single most on-topic path in the whole inventory.
        // The PRODUCTION route for Protection: an AURA (a passive-slot `buff` with no duration +
        // isStackable), the same classification a real Meatshield's "gains N stacks of Protection"
        // passive parses to. It flows through `activeAbilityStatuses`, which is what
        // `protectorsFor` reads for a non-focus actor.
        const protectionAura: Ability = {
            id: 'ab-protection-aura',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Protection',
                parsedEffects: {},
                stacks: 5,
                isStackable: true,
            },
        };
        const protector: RoleShape = {
            id: 'protector',
            position: 'M3',
            speed: 800,
            hp: BIG_HP,
            attack: 0,
            defence: DEFENCE,
            slots: [activeSlot([]), passiveSlot([protectionAura])],
        };
        const defender: RoleShape = {
            id: 'defender',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: 0,
            defence: 0,
            slots: [activeSlot([])],
        };
        const striker: RoleShape = {
            id: 'striker',
            position: 'M4',
            speed: 500,
            hp: BIG_HP,
            attack: ATTACK,
            defence: 0,
            slots: [activeSlot([basicHit])],
        };
        const rounds = run('path7/protection', {
            ...inertFocus(1),
            teamActors: [walkedAlly(defender), walkedAlly(protector)],
            enemyAttackers: [enemyShip(striker)],
        });
        const chunk = axisFor(rounds, 'protector');

        // NON-VACUITY: a cascade really redirected something onto the protector. Without this the
        // two assertions below are 0 > 0 and 0 === 0, and pass while proving nothing.
        expect(chunk.post).toBeGreaterThan(0);

        // The chunk is mitigated on the PROTECTOR's defence, so raw must exceed post by exactly
        // that factor — the proof it came off the cascade's pre-defence inflow.
        expect(chunk.raw).toBeGreaterThan(chunk.post);
        expect(chunk.post / chunk.raw).toBeCloseTo(mit(DEFENCE), 6);
    });
});

// ══ Path 8: the per-victim DoT tick batch (#358 ADDENDUM 3) ═══════════════════════════════════
//
// WHY THIS PATH IS HERE AT ALL, when the file header lists the DoT tick batch among the paths that
// "fold NO defence, so raw === post there by construction". That was true under addendum 2, whose
// only victim-side term was DEFENCE. Addendum 3 widened "damage absorbed" to exclude EVERY
// victim-side reduction, and a DoT tick has one: `incomingDotReductionPct` (Vortex Veil, the DoT
// half of D-PR3). So the batch grew a genuine second axis, and the engine grew two writes to carry
// it — `preMitigationDamage: tankDotDamagePreMit` on the heal-target branch and
// `preMitigationDamage: totalPreMit` on the per-victim twin.
//
// ONLY THE FIRST WAS REACHED BY ANY TEST. MEASURED: deleting `preMitigationDamage: totalPreMit`
// left all 584 files / 6520 tests green, because the defense simulator's focus ship IS the heal
// target and so always takes the other branch. The twin needs a victim that is NOT the focus —
// i.e. an ALLY — which is exactly what this file's walked-team harness provides.
describe('#358 A3 — path 8: the per-victim DoT tick batch on an ALLY', () => {
    it("an ally's ticks book the pre-REDUCTION figure on the raw axis", () => {
        const VEIL_PCT = 50;
        // Vortex Veil: the DoT half of D-PR3. PASSIVE slot is mandatory — `incomingAbilitiesById`
        // filters `slot.slot !== 'passive'`, so an active-slot copy reduces nothing and every
        // figure below would come back equal, passing for the wrong reason.
        const vortexVeil: Ability = {
            id: 'ab-veil',
            type: 'incoming-reduction',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-reduction',
                scope: 'dot',
                condition: 'always',
                pct: VEIL_PCT,
                critFamily: false,
            },
        };
        const infernoOnAlly: Ability = {
            id: 'ab-dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 3, duration: 6 },
        };
        // The ALLY, not the focus: `inertFocus` sets `healTargetId: 'attacker'`, so the focus takes
        // the heal-target branch and this actor is the one that reaches the per-victim twin.
        const ally: RoleShape = {
            id: 'ally',
            position: 'M4',
            speed: 500, // slower than the DoT applier, so a tick has been armed by its turn
            hp: BIG_HP,
            attack: 0,
            defence: DEFENCE, // irrelevant to a DoT tick — asserted below, not assumed
            slots: [activeSlot([])],
        };
        const dotter: RoleShape = {
            id: 'dotter',
            position: 'M4',
            speed: 900,
            hp: BIG_HP,
            attack: ATTACK,
            defence: 0,
            // hacking 200 vs the ally's default security 100 → a landing chance of exactly 1, so
            // the DoT lands deterministically and no rate gate has a live stream. At the file's
            // usual hacking 0 the chance is ZERO and the DoT never applies at all: MEASURED, that
            // build reported intake 0 on both axes and every assertion below passed vacuously.
            hacking: 200,
            slots: [activeSlot([infernoOnAlly])],
        };
        const axes = (allySlots: ShipSkills['slots']) =>
            axisFor(
                run(`path8/${allySlots.length > 1 ? 'veiled' : 'bare'}`, {
                    ...inertFocus(1),
                    teamActors: [walkedAlly({ ...ally, slots: allySlots })],
                    enemyAttackers: [enemyShip(dotter)],
                }),
                'ally'
            );
        const bare = axes([activeSlot([])]);
        const veiled = axes([activeSlot([]), passiveSlot([vortexVeil])]);

        // NON-VACUITY: ticks actually landed, and a DoT folds no DEFENCE — the bare ally's two
        // axes coincide despite its 5,000 defence. That is the control the veiled run moves off.
        expect(bare.post).toBeGreaterThan(0);
        expect(bare.raw).toBe(bare.post);

        // The veil really halves what ARRIVES…
        expect(veiled.post).toBeCloseTo(bare.post * (1 - VEIL_PCT / 100), 6);
        // …and is INVISIBLE on the thrown axis: the same DoT was applied either way, so the raw
        // total is the bare run's, to the last decimal. Delete `preMitigationDamage: totalPreMit`
        // from the per-victim branch and the funnel's `?? rawDamage` default books the reduced
        // amount here instead, collapsing this to `veiled.post`.
        expect(veiled.raw).toBeCloseTo(bare.raw, 6);
        expect(veiled.raw).toBeGreaterThan(veiled.post);
    });
});

// ══ The emptiness gate: a FULLY blocked hit still has to report on the raw axis ═══════════════

describe('#358 A3 — a 100% incoming-block still reports on the raw axis', () => {
    /** `blockPct: 1` at `procChance: 1` on an unconditional trigger — 100% of the hit blocked,
     *  every hit. The MAGNITUDE is not a synthetic extreme: `abilityDefaults.ts` defaults an
     *  incoming-block to `blockPct: 1`, a full block, and the defense calculator's own skill editor
     *  hands the user that. The `procChance: 1` here IS the fixture's own choice — the default
     *  chance is 0, so the editor's out-of-the-box block never fires until the user sets one. */
    const fullBlock: Ability = {
        id: 'ab-full-block',
        type: 'incoming-block',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'incoming-block',
            condition: 'always',
            procChance: 1,
            blockPct: 1,
            oncePerRound: false,
        },
    };

    for (const defenderSide of SIDES) {
        it(`${defenderSide}-side defender: post is ZERO, raw is the full thrown hit`, () => {
            const defender: RoleShape = {
                id: 'defender',
                position: 'M4',
                speed: 900,
                hp: BIG_HP,
                attack: 0,
                defence: DEFENCE,
                slots: [activeSlot([]), passiveSlot([fullBlock])],
            };
            const striker: RoleShape = {
                id: 'striker',
                position: 'M4',
                speed: 500,
                hp: BIG_HP,
                attack: ATTACK,
                defence: 0,
                slots: [activeSlot([basicHit])],
            };
            const input: CombatEngineInput =
                defenderSide === 'player'
                    ? {
                          ...inertFocus(1),
                          teamActors: [walkedAlly(defender)],
                          enemyAttackers: [enemyShip(striker)],
                      }
                    : {
                          ...inertFocus(1),
                          teamActors: [walkedAlly(striker)],
                          enemyAttackers: [enemyShip(defender)],
                      };
            const axis = axisFor(run(`fullblock/${defenderSide}`, input), 'defender');

            // NOTHING GOT THROUGH — the whole hit was blocked.
            expect(axis.post).toBe(0);
            // …and the full attack was still THROWN, so the raw axis carries it. `damageRaw` is
            // deliberately NOT scaled by `(1 - blocked)` (addendum 3 C2: an incoming-block is a
            // victim-side reduction), and this arm is what proves the resulting bucket SURVIVES
            // the emptiness gate in `engine.ts`. Drop `v.incomingRaw === 0` from that gate and the
            // whole bucket is skipped, `perActorIncoming` has no 'defender' key, and `axisFor`
            // returns 0/0 — so `axis.post` still passes and THIS assertion goes red.
            //
            // The oracle is the pre-defence hit, because the raw axis strips the defence factor
            // too: 100% of 20,000 attack, undiminished by the defender's 5,000 defence.
            expect(axis.raw).toBeCloseTo(ATTACK, 4);
            // And the two axes really are apart here — this is not a fixture where they coincide.
            expect(axis.raw).toBeGreaterThan(axis.post);
        });
    }
});

// ══ Suite health ══════════════════════════════════════════════════════════════════════════════

describe('#358 A2 — the invariant', () => {
    it('raw >= post for every actor in every TRANSFORM-FREE run this file performs', () => {
        // Spec B3's global inequality, over the union of every fixture above rather than one of
        // them — so a future path that folds defence without recording raw shows up here even if
        // no dedicated test covers it yet.
        //
        // ⚠️ SCOPE, stated because the old name over-claimed it ("EVERY actor in EVERY run"). The
        // inequality is a WINDOW-SUM invariant, not a per-round one, and the ONE construction that
        // violates it per round is the DoT transform: it books the full raw amount at THROW time
        // while the ticks that re-book the deferred slice carry `perTickPreMitigation: 0` and
        // contribute real post damage. This file performs NO transform run, so the union below is
        // transform-free and the assertion holds as written. A transform fixture added above would
        // have to sum its window (or be excluded here) — it must NOT be dropped into `everyRun`
        // and left to this arm.
        expect(everyRun.length).toBeGreaterThan(0);
        const violations: string[] = [];
        let strictlyGreater = 0;
        for (const { label, axes } of everyRun) {
            for (const [id, a] of axes) {
                if (a.raw < a.post - 1e-9) {
                    violations.push(`${label}/${id}: raw ${a.raw} < post ${a.post}`);
                }
                if (a.raw > a.post + 1e-9) strictlyGreater += 1;
            }
        }
        expect(violations).toEqual([]);
        // NON-VACUITY: a dead field satisfies `raw >= post` everywhere by reporting 0 === 0. The
        // union must contain real spread, or this test is a tautology.
        expect(strictlyGreater).toBeGreaterThan(0);
    });
});
