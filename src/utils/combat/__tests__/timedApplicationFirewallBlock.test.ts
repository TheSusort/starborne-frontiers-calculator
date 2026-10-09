/**
 * A turn-scoped timed enemy application (the non-positional landing decision) is blocked while the
 * target has a Firewall proc pending: it lands nothing and draws no landing roll, whether the
 * debuff is `apply` or `inflict`. With no pending
 * proc the same cast lands.
 *
 * Harness: one direct `runPlayerTurn` cast on a non-positional turn (no victim footprint), the
 * `anchorDebuffLandingRealAffinity` shape, with `blockDebuffPendingFor` supplied the way the engine
 * does.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs, RateGate } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';

const stats = (over: Record<string, number> = {}) => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 20_000,
    speed: 100,
    ...over,
});

type Application = 'apply' | 'inflict';

const scheduledDebuff = (application: Application): PlayerActorRuntime['timedEnemyBySlot'] => [
    {
        kind: 'timed',
        duration: 3,
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        payload: {
            buffName: 'Defense Down',
            parsedEffects: { defense: -50 },
            application,
            stacks: 1,
        },
    },
];

function cast(application: Application, firewallPending: boolean) {
    let draws = 0;
    const countingGate: RateGate = () => {
        draws++;
        return true;
    };
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: stats({ hacking: 200 }),
        chargeCount: 0,
        startCharged: false,
        affinity: 'chemical',
    });
    const runtime: PlayerActorRuntime = {
        actor,
        focus: true,
        castSkills: { slots: [] },
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: scheduledDebuff(application),
        hasChargedSkill: false,
        attack: 1000,
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
        attackerAffinity: 'chemical',
        activeCritGate: () => false,
        chargedCritGate: () => false,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: countingGate,
        extendChanceGate: () => false,
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
    const enemy = createActor({
        id: 'anchor',
        side: 'enemy',
        kind: 'enemy',
        stats: stats({ attack: 0, hp: 1e9, speed: 50, security: 0 }),
        // Chemical against thermal is not an affinity disadvantage for the caster.
        affinity: 'thermal',
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    const bus = createEventBus();
    const outcomes: { kind: 'applied' | 'resisted'; viaLandingRoll?: boolean }[] = [];
    bus.on('debuff-applied', () => outcomes.push({ kind: 'applied' }));
    bus.on('debuff-resisted', (e) =>
        outcomes.push({ kind: 'resisted', viaLandingRoll: e.viaLandingRoll })
    );
    const args: PlayerTurnArgs = {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 1e9,
        enemyType: undefined,
        bus,
        round: 1,
        targetId: enemy.id,
        blockDebuffPendingFor: (id) => firewallPending && id === enemy.id,
    };
    runPlayerTurn(args);
    return { outcomes, draws: () => draws };
}

describe('a scheduled slot debuff, non-positional turn', () => {
    for (const application of ['apply', 'inflict'] as const) {
        it(`${application}: a pending Firewall proc blocks it without drawing a landing roll`, () => {
            const { outcomes, draws } = cast(application, true);
            expect(outcomes.map((o) => o.kind)).toEqual(['resisted']);
            expect(outcomes[0].viaLandingRoll).toBeFalsy();
            expect(draws()).toBe(0);
        });

        it(`${application}: control: with no Firewall proc pending it lands${
            application === 'inflict' ? ' after one landing roll' : ' without a roll'
        }`, () => {
            const { outcomes, draws } = cast(application, false);
            expect(outcomes.map((o) => o.kind)).toEqual(['applied']);
            expect(draws()).toBe(application === 'inflict' ? 1 : 0);
        });
    }
});
