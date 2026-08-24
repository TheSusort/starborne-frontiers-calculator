/**
 * Positional per-victim detonation recipe.
 *
 * When `runPlayerTurn` runs in POSITIONAL mode it must NOT detonate the anchor enemy's
 * containers (no consume / no credit / no `bomb-detonated` emit) — instead it returns a
 * `positionalDetonation` recipe so the engine can detonate each footprint victim later.
 * Non-positional behavior stays byte-identical (legacy anchor detonation).
 *
 * Harness mirrors positionalScalars.test.ts: it constructs PlayerTurnArgs and calls
 * runPlayerTurn directly, with the anchor seeded with pendingBombs and a detonate-dot skill.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor, PendingBomb } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';

const ATTACKER_AFFINITY: AffinityName = 'thermal';
const AFFINITY_DAMAGE_MODIFIER = 25;
const ENEMY_DEFENCE = 850;

function makeRuntime(skills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 12000,
            crit: 50,
            critDamage: 65,
            defensePenetration: 20,
            shieldPenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
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
        attack: 12000,
        crit: 50,
        critDamage: 65,
        defensePenetration: 20,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: AFFINITY_DAMAGE_MODIFIER,
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

function makeBomb(): PendingBomb {
    return {
        countdown: 3,
        damagePerStack: 5000,
        stacks: 2,
        tier: 100,
        sourceId: 'attacker',
        affinityMult: 1,
        detonationDamageModifier: 0,
        splashModifier: 0,
    };
}

function makeArgs(runtime: PlayerActorRuntime, pendingBombs: PendingBomb[]): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: ENEMY_DEFENCE,
            hp: 10_000_000,
            speed: 50,
        },
    });

    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);

    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs,
        pendingAccumulators: [],
        enemyDefense: ENEMY_DEFENCE,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
    };
}

// A skill that BOTH deals damage (realistic firing hit) and detonates bombs.
const SKILLS: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 80, hits: 1 },
                },
                {
                    id: 'detonate',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
                },
            ],
        },
    ],
};

describe('positionalDetonation recipe', () => {
    it('positional: does NOT detonate the anchor; exposes the recipe instead', () => {
        const runtime = makeRuntime(SKILLS);
        const pendingBombs = [makeBomb()];
        const args = makeArgs(runtime, pendingBombs);

        const emitted: unknown[] = [];
        args.bus.on('bomb-detonated', (e) => emitted.push(e));

        const result = runPlayerTurn({ ...args, positional: true });

        expect(result.positionalDetonation).toBeDefined();
        const recipe = result.positionalDetonation!;
        expect(recipe.dets).toEqual([{ dotType: 'bomb', powerPct: 100 }]);
        expect(recipe.effectiveAttack).toBeGreaterThan(0);
        expect(recipe.dotMult).toBeGreaterThan(0);
        expect(recipe.affinityMult).toBeGreaterThan(0);
        expect(recipe.detonationMult).toBe(1);

        // Anchor's bombs UNCONSUMED.
        expect(pendingBombs).toHaveLength(1);
        expect(pendingBombs[0].stacks).toBe(2);

        // No anchor credit, no event.
        expect(result.detonationDamage).toBe(0);
        expect(emitted).toHaveLength(0);
    });

    it('legacy (no positional): detonates the anchor; no recipe exposed', () => {
        const runtime = makeRuntime(SKILLS);
        const pendingBombs = [makeBomb()];
        const args = makeArgs(runtime, pendingBombs);

        const emitted: unknown[] = [];
        args.bus.on('bomb-detonated', (e) => emitted.push(e));

        const result = runPlayerTurn(args);

        expect(result.positionalDetonation).toBeUndefined();

        // Anchor's bombs CONSUMED.
        expect(pendingBombs).toHaveLength(0);

        // Anchor credited + event emitted.
        expect(result.detonationDamage).toBeGreaterThan(0);
        expect(emitted).toHaveLength(1);
    });
});
