/**
 * Task C2 (Wave 5) — `bomb-detonated` gains a `victimId` field (the enemy the bomb detonated
 * on) alongside the existing `actorId` (the bomb's original applier). Purely additive plumbing:
 * C3 (Demolisher's adjacent-enemy splash) anchors its fan-out on `victimId`.
 *
 * Covers the two most structurally distinct emit paths:
 *   1. Natural countdown-0 burst via `processBombs` (non-positional single-opponent enemy turn) —
 *      mirrors `engine.events.test.ts`'s Case 5 harness (`baseInput`/`collect`).
 *   2. Attacker-turn `detonate()` aggregate bomb branch (legacy non-positional path) — mirrors
 *      `detonationRecipe.test.ts`'s "legacy (no positional)" harness.
 * In both, `actorId` (the applier) and `victimId` (the bombed enemy) are asserted independently
 * to prove the new field is NOT just a copy of the existing one.
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor, PendingBomb } from '../state';
import { createEventBus, CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

// ---------------------------------------------------------------------------
// Path 1: natural countdown-0 detonation via processBombs (enemy turn, single real opponent).
// ---------------------------------------------------------------------------

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const bombSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 120 } }),
                ab({
                    type: 'dot',
                    config: { type: 'dot', dotType: 'bomb', tier: 10, stacks: 2, duration: 2 },
                }),
            ],
        },
        {
            slot: 'charged',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 280 } })],
        },
    ],
});

const baseInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // SP-4b-2b: a real opponent is now required. This is a DAMAGE fixture (15000 attack, 120%
    // active + bomb bursts over 4 rounds) so it takes the 10M-HP form — the 500k default is not a
    // survival guarantee and a mid-sim death would cut the bomb cycle short. `enemyDefense: 8000`
    // is carried onto the roster entry's own `stats.defence`; the fight-wide scalar is inert (M6).
    // The opponent has 0 attack, so it draws no RNG and the crit stream is unchanged.
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, defence: 8000 } }),
    attack: 15000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 10,
    chargeCount: 3,
    shipSkills: bombSkills(),
    enemyDefense: 8000,
    enemyHp: 400000,
    numRounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 6000,
    hp: 30000,
    ...overrides,
});

const collectBombDetonated = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('bomb-detonated', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

describe('bomb-detonated victimId — processBombs natural countdown-0 path', () => {
    it("stamps victimId as the bombed enemy's own id, distinct from actorId (the applier, 'attacker')", () => {
        const events = collectBombDetonated(baseInput({ numRounds: 4 }));

        const bombDetonated = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDetonated.length).toBeGreaterThan(0);
        for (const e of bombDetonated) {
            if (e.type !== 'bomb-detonated') throw new Error('unreachable');
            expect(e.actorId).toBe('attacker');
            // M1: the bombed enemy is the real roster entry. Pre-SP-4b-2b this was the vestigial
            // `enemy` sink, which is what the run reached when no roster was supplied at all. The
            // property under test is unchanged: victimId is the BOMBED enemy and actorId is the
            // APPLIER, so the two are still asserted independently and are still different ids.
            expect(e.victimId).toBe(BARE_ENEMY_ID);
        }
    });
});

// ---------------------------------------------------------------------------
// Path 2: attacker-turn detonate() aggregate bomb branch (legacy non-positional).
// ---------------------------------------------------------------------------

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
        sourceId: 'ally-applier',
        affinityMult: 1,
        detonationDamageModifier: 0,
        splashModifier: 0,
    };
}

function makeArgs(runtime: PlayerActorRuntime, pendingBombs: PendingBomb[]): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy-victim',
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
    } as PlayerTurnArgs;
}

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
                } as Ability,
                {
                    id: 'detonate',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'detonate-dot', dotType: 'bomb', powerPct: 100 },
                } as Ability,
            ],
        },
    ],
};

describe('bomb-detonated victimId — attacker-turn detonate() aggregate path', () => {
    it("stamps victimId as the bomb's holder ('enemy-victim'), distinct from actorId (this path's documented actorId = the casting attacker's id, not the bomb's original applier)", () => {
        const runtime = makeRuntime(SKILLS);
        const pendingBombs = [makeBomb()];
        const args = makeArgs(runtime, pendingBombs);

        const emitted: Extract<CombatEvent, { type: 'bomb-detonated' }>[] = [];
        args.bus.on('bomb-detonated', (e) => emitted.push(e));

        runPlayerTurn(args);

        expect(emitted).toHaveLength(1);
        // This path's documented quirk (events.ts jsdoc): the attacker-turn detonate() aggregate
        // branch emits the CASTING actor's id, not bomb.sourceId — 'attacker', not 'ally-applier'.
        expect(emitted[0].actorId).toBe('attacker');
        expect(emitted[0].victimId).toBe('enemy-victim');
    });
});
