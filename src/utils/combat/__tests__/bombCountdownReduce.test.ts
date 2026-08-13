/**
 * SP-F F3 — Lingshe's charge-skill "reduces all Bombs on the enemy targets by 1 turn, Bombs
 * reduced to 0 turns by this skill will detonate.<br />This reduction effect requires
 * hacking.<br /><br />This Unit inflicts Bomb III for 3 turns."
 *
 * Runtime behavior (playerTurn.ts's `reduceEnemyBombs`, called BEFORE `applyNewDoTs` — mirrors
 * the `extendDoTs`-before-`applyNewDoTs` ordering):
 *   - Fans over EVERY enemy victim in the footprint (aoeVictimIds/opposingVictimById), not just
 *     the bound anchor `enemy`.
 *   - Decrements each victim's PendingBomb.countdown by the ability's `turns`.
 *   - Any bomb reaching <= 0 detonates IMMEDIATELY using the EXACT `processBombs` burst formula
 *     (stacks * damagePerStack * affinityMult * (1 + detonationDamageModifier/100)), crediting
 *     the bomb's ORIGINAL applier (`bomb.sourceId`) — NOT the caster — via a `bomb-detonated`
 *     bus emission, then routes the burst through the REAL per-victim `applyVictimDamage` sink
 *     (via `PlayerTurnArgs.forceDetonateBomb`, engine-supplied) when available, else a bare
 *     shield-then-HP debit, then splices the entry.
 *   - Runs BEFORE `applyNewDoTs` so the Bomb III this SAME cast inflicts is never itself
 *     reduced.
 *
 * The FIRST describe block's harness mirrors detonationRecipe.test.ts: constructs PlayerTurnArgs
 * by hand and calls runPlayerTurn directly (no full engine, no `forceDetonateBomb` — exercises
 * the standalone fallback debit). The SECOND describe block (the Critical-finding regression
 * suite) drives the REAL engine end-to-end via `runCombat`, proving the forced detonation now
 * goes through the same Barrier/Cheat-Death/destroyedRound/detonation-tally sink a natural
 * countdown-0 burst uses — which the fallback debit above deliberately does NOT exercise.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { runCombat, CombatEngineInput } from '../engine';
import { createActor, PendingBomb, CombatActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus, CombatEvent } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

const ATTACKER_AFFINITY: AffinityName = 'thermal';
const ENEMY_DEFENCE = 850;

// The Lingshe charged skill: bomb-countdown-reduce (all-enemies, turns 1) + the "inflicts Bomb
// III for 3 turns" DoT-apply (single-target 'dot' ability — dotsFromSkill derives the anchor-
// only dotsConfig from THIS ability, mirroring buildShipAbilities' real output for the CSV text).
const LINGSHE_CHARGED_SKILL: ShipSkills = {
    slots: [
        {
            slot: 'charged',
            abilities: [
                {
                    id: 'bomb-reduce',
                    type: 'bomb-countdown-reduce',
                    target: 'all-enemies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'bomb-countdown-reduce', turns: 1 },
                } as Ability,
                {
                    id: 'bomb-iii',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 3 },
                } as Ability,
            ],
        },
    ],
};

function makeRuntime(actorId: string, skills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: actorId,
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 12000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 1,
        startCharged: true,
    });

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: true,
        attack: 12000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: ATTACKER_AFFINITY,
        activeCritGate: () => false,
        chargedCritGate: () => false,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeEnemy(id: string, pendingBombs: PendingBomb[]): CombatActor {
    const enemy = createActor({
        id,
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: ENEMY_DEFENCE,
            hp: 100_000,
            speed: 50,
        },
    });
    enemy.pendingBombs = pendingBombs;
    return enemy;
}

// Pre-existing bomb on the ANCHOR, applied by a DIFFERENT actor than the caster — countdown 1
// means it MUST detonate on this cast, crediting 'ally-applier' (not 'lingshe').
function anchorBomb(): PendingBomb {
    return {
        countdown: 1,
        damagePerStack: 1000,
        stacks: 2,
        tier: 100,
        sourceId: 'ally-applier',
        affinityMult: 1,
        detonationDamageModifier: 0,
        splashModifier: 0,
    };
}

// Pre-existing bomb on a SECOND enemy victim (covered by the all-enemies fan-out), countdown 3
// — drops to 2 this cast, does NOT detonate.
function secondVictimBomb(): PendingBomb {
    return {
        countdown: 3,
        damagePerStack: 500,
        stacks: 1,
        tier: 100,
        sourceId: 'ally-applier-2',
        affinityMult: 1,
        detonationDamageModifier: 0,
        splashModifier: 0,
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    anchor: CombatActor,
    otherVictims: CombatActor[]
): PlayerTurnArgs {
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);

    const opposingVictimById = new Map<string, CombatActor>();
    opposingVictimById.set(anchor.id, anchor);
    for (const v of otherVictims) opposingVictimById.set(v.id, v);

    return {
        runtime,
        enemy: anchor,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: anchor.pendingBombs,
        pendingAccumulators: [],
        enemyDefense: ENEMY_DEFENCE,
        enemyHp: anchor.currentHp,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        targetId: anchor.id,
        aoeVictimIds: [anchor.id, ...otherVictims.map((v) => v.id)],
        opposingVictimById,
    } as PlayerTurnArgs;
}

describe('Lingshe bomb-countdown reduction (SP-F F3)', () => {
    it('detonates a bomb that reaches countdown 0, crediting the ORIGINAL applier (not the caster)', () => {
        const runtime = makeRuntime('lingshe', LINGSHE_CHARGED_SKILL);
        const anchor = makeEnemy('enemy1', [anchorBomb()]);
        const other = makeEnemy('enemy2', [secondVictimBomb()]);
        const args = makeArgs(runtime, anchor, [other]);

        const detonated: { actorId: string; stacks: number; damage: number }[] = [];
        args.bus.on('bomb-detonated', (e) =>
            detonated.push({ actorId: e.actorId, stacks: e.stacks, damage: e.damage })
        );

        runPlayerTurn(args);

        // The anchor's pre-existing countdown-1 bomb detonated (burst = 2 * 1000 * 1 * 1 = 2000)
        // and was removed, crediting 'ally-applier' — NOT 'lingshe'.
        expect(detonated).toHaveLength(1);
        expect(detonated[0]).toMatchObject({ actorId: 'ally-applier', stacks: 2, damage: 2000 });
        expect(anchor.currentHp).toBe(100_000 - 2000);

        // Anchor's pendingBombs no longer holds the detonated entry, but DOES hold the fresh
        // Bomb III this SAME cast inflicted (countdown 3, sourceId the CASTER) — untouched by
        // the reduction (ordering: reduceEnemyBombs runs BEFORE applyNewDoTs).
        expect(anchor.pendingBombs).toHaveLength(1);
        expect(anchor.pendingBombs[0]).toMatchObject({
            countdown: 3,
            sourceId: 'lingshe',
            stacks: 1,
        });
    });

    it('fans out over every footprint victim: a separate bomb at countdown 3 drops to 2 without detonating', () => {
        const runtime = makeRuntime('lingshe', LINGSHE_CHARGED_SKILL);
        const anchor = makeEnemy('enemy1', [anchorBomb()]);
        const other = makeEnemy('enemy2', [secondVictimBomb()]);
        const args = makeArgs(runtime, anchor, [other]);

        const detonated: { actorId: string }[] = [];
        args.bus.on('bomb-detonated', (e) => detonated.push({ actorId: e.actorId }));

        runPlayerTurn(args);

        // The second victim's bomb dropped 3 -> 2 and did NOT detonate (no event for it, HP
        // unchanged, entry still present).
        expect(other.pendingBombs).toHaveLength(1);
        expect(other.pendingBombs[0]).toMatchObject({ countdown: 2, stacks: 1 });
        expect(other.currentHp).toBe(100_000);
        expect(detonated.some((d) => d.actorId === 'ally-applier-2')).toBe(false);
    });

    // Team-symmetry (mandatory per the model-completeness epic): runPlayerTurn is side-agnostic —
    // an enemy-side Lingshe must reduce/detonate PLAYER-side bombs identically to the player-side
    // case above. Mirrors it exactly, only the `side` labels flip.
    it('is team-symmetric: an ENEMY-side Lingshe reduces a PLAYER-side bomb the same way', () => {
        const runtime = makeRuntime('enemy-lingshe', LINGSHE_CHARGED_SKILL);
        runtime.actor.side = 'enemy';
        const anchor = makeEnemy('player1', [anchorBomb()]);
        anchor.side = 'player';

        const args = makeArgs(runtime, anchor, []);

        const detonated: { actorId: string; stacks: number; damage: number }[] = [];
        args.bus.on('bomb-detonated', (e) =>
            detonated.push({ actorId: e.actorId, stacks: e.stacks, damage: e.damage })
        );

        runPlayerTurn(args);

        expect(detonated).toHaveLength(1);
        expect(detonated[0]).toMatchObject({ actorId: 'ally-applier', stacks: 2, damage: 2000 });
        expect(anchor.currentHp).toBe(100_000 - 2000);
        // The fresh Bomb III this same cast inflicted survives untouched, sourced to the
        // ENEMY caster.
        expect(anchor.pendingBombs).toHaveLength(1);
        expect(anchor.pendingBombs[0]).toMatchObject({
            countdown: 3,
            sourceId: 'enemy-lingshe',
            stacks: 1,
        });
    });
});

// ---------------------------------------------------------------------------------------------
// Critical-finding regression suite: the forced detonation must route through the REAL engine
// sink (applyVictimDamage), not a hand-rolled shieldPool/currentHp debit. Drives `runCombat`
// end-to-end (focus attacker → positioned enemy victim) so the wiring (buildTurnArgs's
// `forceDetonateBomb` → reduceEnemyBombs → reduceBombsOnVictim) is exercised exactly as
// production does, not just the sink function in isolation.
// ---------------------------------------------------------------------------------------------

// A minimal active-slot skill carrying ONLY the countdown-reduce ability (no damage ability —
// `selectTurnTarget`/`buildTurnArgs` resolve the positional target from `input.position`/
// `target`/`pattern`/`enemyAttackers`, independent of the firing skill's own abilities; the
// original unit tests above already prove `runPlayerTurn` handles a damage-ability-less skill).
const reduceOnlyAbility = (turns: number): Ability => ({
    id: 'f3-reduce',
    type: 'bomb-countdown-reduce',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'bomb-countdown-reduce', turns },
});
const reduceOnlySkill = (turns: number): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [reduceOnlyAbility(turns)] }],
});

// A no-payload always-active self-buff (Barrier / Cheat Death carrier), mirroring
// applyOutgoingToEnemy.test.ts's `selfBuffSkills`.
const selfBuffAbility = (buffName: string): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: `${buffName}-self`,
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName,
                stacks: 1,
                isStackable: false,
                duration: 'recurring',
                parsedEffects: {},
            },
        },
    ],
});

const parsedFrontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
// Single-target (non-AoE) pattern — the caster's own footprint is irrelevant to this fix (the
// fan-out over multiple footprint victims is already covered above); one positioned victim is
// enough to prove the sink routing.
const singleTargetPattern = (): ParsedPattern => ({
    raw: 'base',
    shape: 'base',
    range: 0,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A single positioned enemy victim at 'front' (M4). security 0 (well below the caster's default
// 200 hacking) so the countdown-reduce's hacking-gated 'inflict' landing roll is unconditional —
// clamp((200-0)/100) = 1.0. Optional `buffSlot` grants a Barrier/Cheat-Death passive.
const victimAt = (id: string, hp: number, buffSlot?: ShipSkills['slots'][number]): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1, security: 0 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        shipSkills: {
            slots: [{ slot: 'active', abilities: [] }, ...(buffSlot ? [buffSlot] : [])],
        },
    }) as EnemyAttacker;

const bomb = (
    damagePerStack: number,
    stacks: number,
    countdown: number,
    sourceId: string
): PendingBomb => ({
    countdown,
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const REGRESSION_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: reduceOnlySkill(1),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    ...overrides,
});

const runRegression = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = [
        'bomb-detonated',
        'ship-destroyed',
        'cheat-death-activated',
    ];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('Lingshe forced detonation — REAL engine sink (Critical finding regression)', () => {
    it('honors Barrier: a Barriered victim takes 0 HP loss from the forced burst', () => {
        let victimRef: CombatActor | undefined;
        const { events, result } = runRegression(
            REGRESSION_BASE({
                enemyAttackers: [victimAt('victim', 10_000, selfBuffAbility('Barrier'))],
                __testTapActors: (actors) => {
                    victimRef = actors.find((a) => a.id === 'victim');
                    victimRef?.pendingBombs.push(bomb(5000, 1, 1, 'ally-applier'));
                },
            })
        );

        expect(victimRef).toBeDefined();
        // Barrier is FULL DAMAGE IMMUNITY — the pre-fix hand-rolled debit ignored this and drained
        // 5000 straight off currentHp regardless.
        expect(victimRef!.currentHp).toBe(10_000);
        expect(victimRef!.destroyedRound).toBeUndefined();
        // The bomb-detonated event still fires (nominal payout) and the detonation tally still
        // credits the ORIGINAL applier — mirroring processBombs' unconditional credit (the tally
        // records the NOMINAL burst, independent of Barrier absorption).
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet).toHaveLength(1);
        expect(bombDet[0]).toMatchObject({ actorId: 'ally-applier', damage: 5000, stacks: 1 });
        expect(result.rounds[0].perActorDetonation?.['ally-applier']).toBe(5000);
    });

    it('honors Cheat Death: an eligible victim survives at 1 HP instead of dying', () => {
        let victimRef: CombatActor | undefined;
        const { events } = runRegression(
            REGRESSION_BASE({
                enemyAttackers: [victimAt('victim', 2000, selfBuffAbility('Cheat Death'))],
                __testTapActors: (actors) => {
                    victimRef = actors.find((a) => a.id === 'victim');
                    victimRef?.pendingBombs.push(bomb(5000, 1, 1, 'ally-applier'));
                },
            })
        );

        // The pre-fix hand-rolled debit would floor currentHp at 0 (Math.max(0, ...)), killing the
        // Cheat-Death carrier outright instead of intercepting it at 1 HP.
        expect(victimRef!.currentHp).toBe(1);
        expect(victimRef!.destroyedRound).toBeUndefined();
        expect(
            events.some((e) => e.type === 'cheat-death-activated' && e.actorId === 'victim')
        ).toBe(true);
        expect(events.some((e) => e.type === 'ship-destroyed' && e.actorId === 'victim')).toBe(
            false
        );
    });

    it('stamps destroyedRound and emits ship-destroyed on a burst kill (no zombie unit)', () => {
        let victimRef: CombatActor | undefined;
        const { events } = runRegression(
            REGRESSION_BASE({
                enemyAttackers: [victimAt('victim', 2000)],
                __testTapActors: (actors) => {
                    victimRef = actors.find((a) => a.id === 'victim');
                    victimRef?.pendingBombs.push(bomb(5000, 1, 1, 'ally-applier'));
                },
            })
        );

        // The pre-fix hand-rolled debit mutated currentHp/shieldPool directly and NEVER called
        // recordDestroyed — the victim would keep its destroyedRound unset (a zombie that still
        // acts/targets) and no ship-destroyed would fire.
        expect(victimRef!.currentHp).toBe(0);
        expect(victimRef!.destroyedRound).toBe(1);
        expect(events.some((e) => e.type === 'ship-destroyed' && e.actorId === 'victim')).toBe(
            true
        );
    });

    it('credits the detonation tally to the ORIGINAL bomb applier, not the caster (perActorDetonation + perTargetDamage)', () => {
        const { result } = runRegression(
            REGRESSION_BASE({
                enemyAttackers: [victimAt('victim', 1_000_000)],
                __testTapActors: (actors) => {
                    actors
                        .find((a) => a.id === 'victim')
                        ?.pendingBombs.push(bomb(1234, 2, 1, 'ally-applier'));
                },
            })
        );

        expect(result.rounds[0].perActorDetonation?.['ally-applier']).toBe(2468);
        expect(result.rounds[0].perActorDetonation?.['attacker']).toBeUndefined();
        expect(result.rounds[0].perTargetDamage?.['victim']).toBe(2468);
    });

    it('does NOT crash when a forced detonation kills a victim that still holds other pending bombs (FINDING-002)', () => {
        // Interaction-audit FINDING-002 (Lingshe + a multi-bomb planter, e.g. Sha Xing/Panguan):
        // a victim carries TWO bombs, both at countdown 1 so BOTH reach 0 on this cast. The
        // backward loop detonates the LAST-pushed bomb first; that 5000 burst kills the 2000-HP
        // victim. The engine's bomb-splash-on-death then REASSIGNS `victim.pendingBombs = []`.
        // Pre-fix, `reduceBombsOnVictim` re-read the now-empty LIVE field on its next iteration
        // (`victim.pendingBombs[0]` === undefined) and threw
        // "Cannot read properties of undefined (reading 'countdown')". The fix binds a stable
        // array reference at loop start (as the sibling `processBombs` already does), so the loop
        // finishes over the pre-death snapshot and BOTH bombs detonate — matching the natural
        // countdown-0 burst on a positioned actor's own turn.
        let victimRef: CombatActor | undefined;
        const { events } = runRegression(
            REGRESSION_BASE({
                enemyAttackers: [victimAt('victim', 2000)],
                __testTapActors: (actors) => {
                    victimRef = actors.find((a) => a.id === 'victim');
                    victimRef?.pendingBombs.push(bomb(5000, 1, 1, 'ally-applier-a'));
                    victimRef?.pendingBombs.push(bomb(5000, 1, 1, 'ally-applier-b'));
                },
            })
        );

        expect(victimRef).toBeDefined();
        expect(victimRef!.destroyedRound).toBe(1);
        expect(events.some((e) => e.type === 'ship-destroyed' && e.actorId === 'victim')).toBe(
            true
        );
        // Both countdown-0 bombs detonate through the forced path (stable-reference iteration),
        // exactly as the natural burst would — crediting each ORIGINAL applier.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet).toHaveLength(2);
        expect(bombDet.map((e) => e.actorId).sort()).toEqual(['ally-applier-a', 'ally-applier-b']);
    });

    it('hacking-gate resisted: when the inflict roll fails, the countdown does NOT reduce (no detonation)', () => {
        // Uses the FIRST describe block's simple hand-built-args harness (runPlayerTurn direct, no
        // full engine) — the gate itself (`landsTimedEnemyApplicationLive`, internal to runPlayerTurn)
        // is deterministic from hacking-vs-security: attacker.stats.hacking defaults to 200
        // (unset on `runtime`), so giving the victim security 999 clamps the landing chance to
        // max(0, 200-999)/100 = 0 — `debuffLandingGate(0)` (`rng() < 0`) is unconditionally false,
        // no RNG luck involved. reduceEnemyBombs's ability-level gate short-circuits before the
        // victim's bomb is touched at all: no reduction, no detonation, no event.
        const runtime = makeRuntime('lingshe', LINGSHE_CHARGED_SKILL);
        const anchor = makeEnemy('enemy1', [anchorBomb()]);
        anchor.stats.security = 999;
        const args = makeArgs(runtime, anchor, []);

        const detonated: { actorId: string }[] = [];
        args.bus.on('bomb-detonated', (e) => detonated.push({ actorId: e.actorId }));

        runPlayerTurn(args);

        // Resisted: the pre-existing countdown-1 bomb did NOT reduce/detonate.
        expect(detonated).toHaveLength(0);
        expect(anchor.currentHp).toBe(100_000);
        expect(anchor.pendingBombs.some((b) => b.sourceId === 'ally-applier')).toBe(true);
        expect(anchor.pendingBombs.find((b) => b.sourceId === 'ally-applier')).toMatchObject({
            countdown: 1,
        });
    });
});
