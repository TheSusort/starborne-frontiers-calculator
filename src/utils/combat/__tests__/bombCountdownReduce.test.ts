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
 *     bus emission and a direct HP/shield debit on that victim, then splices the entry.
 *   - Runs BEFORE `applyNewDoTs` so the Bomb III this SAME cast inflicts is never itself
 *     reduced.
 *
 * Harness mirrors detonationRecipe.test.ts: constructs PlayerTurnArgs by hand and calls
 * runPlayerTurn directly (no full engine).
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor, PendingBomb, CombatActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';

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
