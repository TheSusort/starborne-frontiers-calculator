/**
 * Ship-kit Wave 4, Task 6 — on-cast `extend-status` executor (Sokol/Ripper/Lev).
 *
 * Task 5 built the parser/buildShipAbilities emit for a new generic `extend-status`
 * ability (`{type:'extend-status', statusKind:'buff'|'debuff', turns}`), Task 4 built the
 * StatusEngine primitives (`extendAllDebuffsDuration` on `enemyMaps`, `extendAllBuffsDuration`
 * on `selfMaps`). This suite exercises the NEW on-cast executor block in `playerTurn.ts`
 * (beside the purge/steal/shield-strip blocks) that wires the two together:
 *   - Sokol (charged, target 'enemy', statusKind 'debuff'): extends the hit enemy's debuffs.
 *   - Ripper (PASSIVE slot, target 'all-allies', statusKind 'buff'): extends every living
 *     ally's timed self-buffs — sourced from `gatedPassive`, not `gatedSkill` (unlike the
 *     purge/steal blocks, whose abilities are never passive-slot in the corpus).
 *   - Lev (charged, target 'all-enemies', statusKind 'debuff', gated on a `self-crit`
 *     condition): extends every hit enemy's debuffs ONLY when this cast crit.
 *
 * Harness: direct `runPlayerTurn` calls with hand-built `PlayerActorRuntime`/`PlayerTurnArgs`
 * (mirrors `bombCountdownReduce.test.ts`'s first describe block) — a single isolated cast,
 * no round-decrement noise, full control over the pre-existing StatusEngine state and the
 * deterministic crit gate.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs, RateGate } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createStatusEngine, StatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';

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

function makeRuntime(
    actorId: string,
    skills: ShipSkills,
    overrides: {
        side?: 'player' | 'enemy';
        hasChargedSkill?: boolean;
        chargeCount?: number;
        startCharged?: boolean;
        activeCritGate?: RateGate;
        chargedCritGate?: RateGate;
    } = {}
): PlayerActorRuntime {
    const {
        side = 'player',
        hasChargedSkill = true,
        chargeCount = 1,
        startCharged = true,
        activeCritGate = () => false,
        chargedCritGate = () => false,
    } = overrides;

    const actor = createActor({
        id: actorId,
        side,
        kind: 'attacker',
        stats: baseStats(),
        chargeCount,
        startCharged,
    });

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill,
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
        activeCritGate,
        chargedCritGate,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeEnemy(id: string, side: 'player' | 'enemy' = 'enemy'): CombatActor {
    return createActor({
        id,
        side,
        kind: 'enemy',
        stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
    });
}

function makeArgs(
    runtime: PlayerActorRuntime,
    enemy: CombatActor,
    statusEngine: StatusEngine,
    overrides: Partial<PlayerTurnArgs> = {}
): PlayerTurnArgs {
    return {
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
        ...overrides,
    };
}

/** Seeds a 'Defense Down' timed debuff on `victimId`'s enemyMaps entry. */
function seedEnemyDebuff(
    statusEngine: StatusEngine,
    victimId: string,
    duration: number,
    round = 1
): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName: 'Defense Down', stacks: 1, parsedEffects: { defense: -5 } },
    };
    // 3rd param (recipientId) is IGNORED for enemy-side statuses; the enemy target id is the
    // 4th param (enemyTargetId) — see applyTimedAbilityStatus's side-resolution comment.
    statusEngine.applyTimedAbilityStatus(round, status, undefined, victimId);
}

/** Seeds a timed 'Attack Up' self-buff on `ownerId`'s selfMaps entry. */
function seedSelfBuff(
    statusEngine: StatusEngine,
    ownerId: string,
    duration: number,
    round = 1
): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 10 } },
    };
    statusEngine.applyTimedAbilityStatus(round, status, ownerId);
}

const enemyDebuffTurns = (statusEngine: StatusEngine, victimId: string): number | undefined =>
    statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .find((s) => s.payload.buffName === 'Defense Down')?.active.turnsRemaining as
        | number
        | undefined;

const selfBuffTurns = (statusEngine: StatusEngine, ownerId: string): number | undefined =>
    statusEngine
        .timedAbilityStatuses('self', ownerId)
        .find((s) => s.payload.buffName === 'Attack Up')?.active.turnsRemaining as
        | number
        | undefined;

// ---------------------------------------------------------------------------
// Sokol — charged debuff-extend (target 'enemy').
// ---------------------------------------------------------------------------
const sokolExtendDebuff = (turns = 1): Ability => ({
    id: 'sokol-extend',
    type: 'extend-status',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extend-status', statusKind: 'debuff', turns },
});

const sokolSkills = (): ShipSkills => ({
    slots: [{ slot: 'charged', abilities: [sokolExtendDebuff(1)] }],
});

describe('Sokol — on-cast charged debuff-extend', () => {
    it('extends a 2-turn enemy debuff to 3 turns', () => {
        const runtime = makeRuntime('sokol', sokolSkills());
        const enemy = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedEnemyDebuff(statusEngine, enemy.id, 2);

        runPlayerTurn(makeArgs(runtime, enemy, statusEngine));

        expect(enemyDebuffTurns(statusEngine, enemy.id)).toBe(3);
    });

    // Team symmetry: an ENEMY-side Sokol must extend a PLAYER-side victim's debuff identically.
    it('is team-symmetric: an ENEMY-side Sokol extends a PLAYER-side debuff the same way', () => {
        const runtime = makeRuntime('enemy-sokol', sokolSkills(), { side: 'enemy' });
        const victim = makeEnemy('player1', 'player');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedEnemyDebuff(statusEngine, victim.id, 2);

        runPlayerTurn(makeArgs(runtime, victim, statusEngine));

        expect(enemyDebuffTurns(statusEngine, victim.id)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Ripper — PASSIVE all-allies buff-extend (target 'all-allies'); the ability lives on the
// passive slot, so the executor must scan `gatedPassive`, not just `gatedSkill`.
// ---------------------------------------------------------------------------
const ripperExtendBuff = (turns = 1): Ability => ({
    id: 'ripper-extend',
    type: 'extend-status',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extend-status', statusKind: 'buff', turns },
});

const ripperSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: [ripperExtendBuff(1)] },
    ],
});

describe('Ripper — on-cast passive all-allies buff-extend', () => {
    it("extends a living ally's timed self-buff by 1 turn (fan-out beyond the caster)", () => {
        const runtime = makeRuntime('ripper', ripperSkills(), {
            hasChargedSkill: false,
            chargeCount: 0,
            startCharged: false,
        });
        const ally = createActor({
            id: 'ally-1',
            side: 'player',
            kind: 'team',
            stats: baseStats(),
        });
        const enemy = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, ally.id, 2);

        runPlayerTurn(
            makeArgs(runtime, enemy, statusEngine, {
                sameSideLiving: [runtime.actor, ally],
            })
        );

        expect(selfBuffTurns(statusEngine, ally.id)).toBe(3);
    });

    it("also extends the caster's OWN timed self-buff (Ripper is one of 'all allies')", () => {
        const runtime = makeRuntime('ripper', ripperSkills(), {
            hasChargedSkill: false,
            chargeCount: 0,
            startCharged: false,
        });
        const enemy = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, runtime.actor.id, 4);

        runPlayerTurn(
            makeArgs(runtime, enemy, statusEngine, {
                sameSideLiving: [runtime.actor],
            })
        );

        expect(selfBuffTurns(statusEngine, runtime.actor.id)).toBe(5);
    });

    // CodeRabbit #264: the buff branch must NOT be gated on an enemy targetId — an all-allies
    // buff-extend needs no enemy target, so it must still fire when targetId is undefined (DPS
    // dummy sink / enemy-less cast). Regression for the split-guard fix.
    it('extends allies even when there is no enemy target (targetId undefined)', () => {
        const runtime = makeRuntime('ripper', ripperSkills(), {
            hasChargedSkill: false,
            chargeCount: 0,
            startCharged: false,
        });
        const enemy = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, runtime.actor.id, 4);

        runPlayerTurn(
            makeArgs(runtime, enemy, statusEngine, {
                targetId: undefined,
                sameSideLiving: [runtime.actor],
            })
        );

        expect(selfBuffTurns(statusEngine, runtime.actor.id)).toBe(5);
    });

    // Team symmetry: an ENEMY-side Ripper must extend its ENEMY-side allies' buffs.
    it('is team-symmetric: an ENEMY-side Ripper extends an enemy-side ally the same way', () => {
        const runtime = makeRuntime('enemy-ripper', ripperSkills(), {
            side: 'enemy',
            hasChargedSkill: false,
            chargeCount: 0,
            startCharged: false,
        });
        const ally = createActor({
            id: 'enemy-ally-1',
            side: 'enemy',
            kind: 'team',
            stats: baseStats(),
        });
        const victim = makeEnemy('player1', 'player');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, ally.id, 2);

        runPlayerTurn(
            makeArgs(runtime, victim, statusEngine, {
                sameSideLiving: [runtime.actor, ally],
            })
        );

        expect(selfBuffTurns(statusEngine, ally.id)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Lev — charged all-enemies debuff-extend gated on a self-crit condition (Task 5's chosen
// shape: `trigger:'on-cast'` + `conditions:[{subject:'self-crit',derivable:true}]`, NOT a
// reactive on-crit listener). The negative (non-crit) case is the essential proof that the
// gate actually suppresses the extension.
// ---------------------------------------------------------------------------
const levExtendDebuff = (turns = 1): Ability => ({
    id: 'lev-extend',
    type: 'extend-status',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [{ subject: 'self-crit', derivable: true }],
    config: { type: 'extend-status', statusKind: 'debuff', turns },
});

const levSkills = (): ShipSkills => ({
    slots: [{ slot: 'charged', abilities: [levExtendDebuff(1)] }],
});

describe('Lev — on-cast charged all-enemies debuff-extend gated on self-crit', () => {
    it('CRIT: extends every hit enemy debuff by 1 turn (fans over aoeVictimIds)', () => {
        const runtime = makeRuntime('lev', levSkills(), { chargedCritGate: () => true });
        const enemy1 = makeEnemy('enemy1');
        const enemy2 = makeEnemy('enemy2');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedEnemyDebuff(statusEngine, enemy1.id, 2);
        seedEnemyDebuff(statusEngine, enemy2.id, 3);

        runPlayerTurn(
            makeArgs(runtime, enemy1, statusEngine, {
                aoeVictimIds: [enemy1.id, enemy2.id],
                opposingVictimById: new Map([
                    [enemy1.id, enemy1],
                    [enemy2.id, enemy2],
                ]),
            })
        );

        expect(enemyDebuffTurns(statusEngine, enemy1.id)).toBe(3);
        expect(enemyDebuffTurns(statusEngine, enemy2.id)).toBe(4);
    });

    it('NON-CRIT: does NOT extend the enemy debuff (self-crit gate blocks it)', () => {
        const runtime = makeRuntime('lev', levSkills(), { chargedCritGate: () => false });
        const enemy1 = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedEnemyDebuff(statusEngine, enemy1.id, 2);

        runPlayerTurn(
            makeArgs(runtime, enemy1, statusEngine, {
                aoeVictimIds: [enemy1.id],
                opposingVictimById: new Map([[enemy1.id, enemy1]]),
            })
        );

        expect(enemyDebuffTurns(statusEngine, enemy1.id)).toBe(2);
    });

    // Team symmetry: an ENEMY-side Lev, on crit, must extend PLAYER-side victims' debuffs.
    it('is team-symmetric: an ENEMY-side crit Lev extends PLAYER-side debuffs the same way', () => {
        const runtime = makeRuntime('enemy-lev', levSkills(), {
            side: 'enemy',
            chargedCritGate: () => true,
        });
        const victim = makeEnemy('player1', 'player');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedEnemyDebuff(statusEngine, victim.id, 2);

        runPlayerTurn(
            makeArgs(runtime, victim, statusEngine, {
                aoeVictimIds: [victim.id],
                opposingVictimById: new Map([[victim.id, victim]]),
            })
        );

        expect(enemyDebuffTurns(statusEngine, victim.id)).toBe(3);
    });
});
