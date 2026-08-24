/**
 * #358 ADDENDUM 2 — the RAW intake axis (`ActorIntake.incomingRaw`).
 *
 * ── WHAT THIS AXIS IS ─────────────────────────────────────────────────────────────────────────
 * `ActorIntake.incoming` is recorded AFTER the caller folded the victim's defence-mitigation
 * factor into the hit (`engine.ts`'s funnel documents the parameter as "the DEFENCE mitigation
 * factor the CALLER already folded into `rawDamage`"). It therefore counts damage that GOT
 * THROUGH, not damage that was THROWN. `incomingRaw` is the same intake with the defence term
 * removed, recorded at the same instant and scaled by the same incoming-block / Protection
 * factors — never reconstructed by dividing (lossy, and undefined at a factor of 0).
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
 *   1. positional firing hit   `victimHitDamage` via `drivePositionalApply`   (182,548 corpus calls)
 *   2. positional passive-slot hit `stagePassiveSlotHit`                       (121)
 *   4. counter-attack          `applyCounterAttack`                            (624)
 *   5. reactive damage proc    `applyReactiveDamage` (attack-basis branch)     (775)
 *   6. reflect / thorns        `reflectedDamageForHit`                         (231)
 *   7. Protection transfer     `protectionCascade` chunk                       (477)
 *
 * The seventh, the LEGACY NON-POSITIONAL aggregate apply, is deliberately NOT fixed and so is
 * deliberately not tested — the probe recorded ZERO calls through it in the whole corpus (every
 * enemy attack takes the positional branch), so a fix there could not be exercised by any test.
 * It is parked with the corpus-unreachable group (#357) and carries a comment at its call site.
 *
 * The remaining seven paths (bomb splash, bomb/accumulator burst, forced detonation, DoT-detonation
 * bypass, DoT tick batch, tank DoT) fold NO defence, so raw === post there by construction — the
 * `?? rawDamage` default in the funnel, and the suite-health test at the bottom.
 *
 * ── FIXTURE SHAPE ─────────────────────────────────────────────────────────────────────────────
 *   FOCUS     an inert player actor at M1 (back). Never an attacker, never a victim; it exists
 *             because the engine needs a focus. Huge HP keeps it irrelevant.
 *   ATTACKER / DEFENDER  at M4 (the FRONT column — a `front` selection binds there, not to M1).
 * NO RNG anywhere: crit 0 on every actor and `noCrit` on every hit, so no rate gate has a live
 * stream and every figure below is exact arithmetic rather than a seeded draw.
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
        hacking: 0,
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

// ══ Suite health ══════════════════════════════════════════════════════════════════════════════

describe('#358 A2 — the invariant', () => {
    it('raw >= post for EVERY actor in EVERY run this file performs', () => {
        // Spec B3's global inequality, over the union of every fixture above rather than one of
        // them — so a future path that folds defence without recording raw shows up here even if
        // no dedicated test covers it yet.
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
