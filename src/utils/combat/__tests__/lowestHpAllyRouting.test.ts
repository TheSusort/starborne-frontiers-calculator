/**
 * SP-4e Task 1 — containment for the new `'lowest-hp-ally'` target variant.
 *
 * The variant is a SINGLE-recipient selector: the living same-side ally with the lowest
 * currentHp/maxHp, caster EXCLUDED. Nothing in the parser emits it yet (Task 3 flips that), so
 * this suite is written from the DEFECT rather than from a shipped kit: every consumer that
 * merely *filters* a roster would fan a single-recipient selector out to every ally, and the
 * skill editor (Task 1, Step 10) makes such an ability constructible today.
 *
 * Two levels are pinned:
 *   1. `resolveSupportRecipients` — the shared helper every support caller funnels through;
 *   2. the on-cast `extend-status` BUFF path in `runPlayerTurn`, the one live caller that hands
 *      the helper an unresolved whole-roster `base`.
 */
import { describe, expect, it } from 'vitest';
import { resolveSupportRecipients } from '../supportRecipients';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createStatusEngine, StatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';

describe("SP-4e 'lowest-hp-ally' containment", () => {
    // resolveSupportRecipients only FILTERS its baseRecipients — it has no live HP, so it cannot
    // resolve this selector itself. The routing rule is that each caller resolves it via
    // `lowestHpAllyRecipients` and uses that result DIRECTLY, never routing it back through
    // resolveSupportRecipients. Reaching this branch at all is therefore a caller bug, and a
    // multi-id base is the shape that used to silently fan a single-recipient target out to
    // everyone (`slice(0, 1)` used to "protect" against this by picking the first id) — pin that
    // it now throws instead. Deleting the guard would make this multi-id call fall through to the
    // generic footprint filter and silently return `['p2', 'p3']` (both ids are in the footprint),
    // so this test fails loudly (no throw) if the guard is removed.
    it('throws rather than silently clamping a multi-id unresolved base', () => {
        expect(() =>
            resolveSupportRecipients({
                target: 'lowest-hp-ally',
                casterId: 'p1',
                baseRecipients: ['p2', 'p3'],
                footprintAllyIds: ['p1', 'p2', 'p3'],
            })
        ).toThrow(/lowest-hp-ally/);
    });

    // A length-1 base is NOT a safe passthrough case either: an unresolved lone-caster roster is
    // also length 1 (`[casterId]`), so a clamp/passthrough keyed on length alone would silently
    // reproduce the self-target bug the reviewer demonstrated (caller routing reverted, lone
    // caster, `slice(0, 1)` selects the caster's own id). This must throw too.
    it('throws on a single-id base — length alone cannot prove it was pre-resolved', () => {
        expect(() =>
            resolveSupportRecipients({
                target: 'lowest-hp-ally',
                casterId: 'p1',
                baseRecipients: ['p1'],
                footprintAllyIds: ['p1', 'p2'],
            })
        ).toThrow(/lowest-hp-ally/);
    });
});

// ---------------------------------------------------------------------------
// The live fan-out caller: the on-cast `extend-status` buff branch, which passes
// `supportRecipients(ab.target, allyRoster, …)` — the whole same-side roster.
// Harness mirrors extendStatusCastPath.test.ts.
// ---------------------------------------------------------------------------
const ATTACKER_AFFINITY: AffinityName = 'thermal';

const baseStats = () => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 20_000,
    speed: 100,
});

const lowestHpAllyExtendBuff = (turns = 1): Ability => ({
    id: 'lowest-hp-ally-extend',
    type: 'extend-status',
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extend-status', statusKind: 'buff', turns },
});

const passiveExtendSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: [lowestHpAllyExtendBuff(1)] },
    ],
});

function makeRuntime(actorId: string, skills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: actorId,
        side: 'player',
        kind: 'attacker',
        stats: baseStats(),
        chargeCount: 0,
        startCharged: false,
    });

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20_000,
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

function makeAlly(id: string, currentHp: number): CombatActor {
    const ally = createActor({ id, side: 'player', kind: 'team', stats: baseStats() });
    ally.currentHp = currentHp;
    return ally;
}

/** Seeds a timed 'Attack Up' self-buff on `ownerId`'s selfMaps entry. */
function seedSelfBuff(statusEngine: StatusEngine, ownerId: string, duration: number): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 10 } },
    };
    statusEngine.applyTimedAbilityStatus(1, status, ownerId);
}

const selfBuffTurns = (statusEngine: StatusEngine, ownerId: string): number | undefined =>
    statusEngine
        .timedAbilityStatuses('self', ownerId)
        .find((s) => s.payload.buffName === 'Attack Up')?.active.turnsRemaining as
        | number
        | undefined;

describe("SP-4e 'lowest-hp-ally' on the on-cast buff-extend path", () => {
    it('extends ONLY the lowest-HP living ally, not the whole roster', () => {
        const runtime = makeRuntime('caster', passiveExtendSkills());
        // The caster is the most wounded actor on its side — it must still be EXCLUDED
        // ("the OTHER ally"), so the selector picks the wounded ally, not the caster.
        runtime.actor.currentHp = 1_000;
        const wounded = makeAlly('wounded', 4_000);
        const healthy = makeAlly('healthy', 20_000);
        const enemy = createActor({
            id: 'enemy1',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
        });

        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, runtime.actor.id, 2);
        seedSelfBuff(statusEngine, wounded.id, 2);
        seedSelfBuff(statusEngine, healthy.id, 2);

        runPlayerTurn({
            runtime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: enemy.currentHp,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            targetId: enemy.id,
            sameSideLiving: [runtime.actor, wounded, healthy],
        } as PlayerTurnArgs);

        expect(selfBuffTurns(statusEngine, wounded.id)).toBe(3);
        expect(selfBuffTurns(statusEngine, healthy.id)).toBe(2);
        expect(selfBuffTurns(statusEngine, runtime.actor.id)).toBe(2);
    });

    it('extends nobody when the caster is the only living ally', () => {
        const runtime = makeRuntime('lone-caster', passiveExtendSkills());
        const enemy = createActor({
            id: 'enemy1',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
        });

        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, runtime.actor.id, 2);

        runPlayerTurn({
            runtime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: enemy.currentHp,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            targetId: enemy.id,
            sameSideLiving: [runtime.actor],
        } as PlayerTurnArgs);

        expect(selfBuffTurns(statusEngine, runtime.actor.id)).toBe(2);
    });
});
