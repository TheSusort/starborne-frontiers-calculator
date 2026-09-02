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
import {
    runPlayerTurn,
    PlayerActorRuntime,
    PlayerTurnArgs,
    RateGate,
    TimedStatus,
} from '../playerTurn';
import { createActor, CombatActor, ActiveDoTStack } from '../state';
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
        number | undefined;

const selfBuffTurns = (statusEngine: StatusEngine, ownerId: string): number | undefined =>
    statusEngine
        .timedAbilityStatuses('self', ownerId)
        .find((s) => s.payload.buffName === 'Attack Up')?.active.turnsRemaining as
        number | undefined;

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

// ---------------------------------------------------------------------------
// Asphyxiator — INFLICTED-scope debuff extend, gated on self-crit.
//
// Owner ruling 2026-09-02: "all debuffs inflicted with a critical hit have their duration
// extended". So a crit extends what THIS cast just applied — on the main target and on every
// enemy it splashed — and leaves a debuff standing from an earlier round alone. That last
// clause is the whole difference from Lev above, who grows every standing debuff.
// ---------------------------------------------------------------------------
const asphyxiatorExtend = (turns = 1): Ability => ({
    id: 'asphyxiator-extend',
    type: 'extend-status',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [{ subject: 'self-crit', derivable: true }],
    config: { type: 'extend-status', statusKind: 'debuff', turns, scope: 'inflicted' },
});

/** The cast's own debuff clause — the ability half, which recipient resolution reads. */
const asphyxiatorDebuffAbility: Ability = {
    id: 'asphyxiator-defdown',
    type: 'debuff',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Down III',
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        parsedEffects: { defense: -30 },
        duration: 1,
    },
};

/** The cast's own debuff clause — the TimedStatus half, which actually lands it. */
const asphyxiatorDebuffStatus = (): TimedStatus => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'charged',
    conditions: [],
    duration: 1,
    payload: { buffName: 'Defense Down III', stacks: 1, parsedEffects: { defense: -30 } },
});

const asphyxiatorSkills = (): ShipSkills => ({
    slots: [{ slot: 'charged', abilities: [asphyxiatorDebuffAbility, asphyxiatorExtend(1)] }],
});

/** Seeds a debuff from a family the cast never touches, so a tier overwrite cannot eat it. */
function seedUnrelatedDebuff(
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
        payload: { buffName: 'Speed Down', stacks: 1, parsedEffects: { speed: -10 } },
    };
    statusEngine.applyTimedAbilityStatus(round, status, undefined, victimId);
}

const debuffTurnsNamed = (
    statusEngine: StatusEngine,
    victimId: string,
    buffName: string
): number | undefined =>
    statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .find((s) => s.payload.buffName === buffName)?.active.turnsRemaining as number | undefined;

function runAsphyxiator(
    statusEngine: StatusEngine,
    victims: CombatActor[],
    opts: { crit: boolean; side?: 'player' | 'enemy' }
): void {
    const runtime = makeRuntime('asphyxiator', asphyxiatorSkills(), {
        side: opts.side ?? 'player',
        chargedCritGate: () => opts.crit,
    });
    runtime.timedEnemyBySlot = [asphyxiatorDebuffStatus()];
    runPlayerTurn(
        makeArgs(runtime, victims[0], statusEngine, {
            aoeVictimIds: victims.map((v) => v.id),
            opposingVictimById: new Map(victims.map((v) => [v.id, v])),
        })
    );
}

describe('Asphyxiator — inflicted-scope debuff extend on a crit', () => {
    it('CRIT: extends the debuff this cast just inflicted, on the main target AND the splashed enemy', () => {
        const main = makeEnemy('enemy1');
        const adjacent = makeEnemy('enemy2');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);

        runAsphyxiator(statusEngine, [main, adjacent], { crit: true });

        // Applied for 1 turn, extended to 2 — on both victims the cast reached.
        expect(debuffTurnsNamed(statusEngine, main.id, 'Defense Down III')).toBe(2);
        expect(debuffTurnsNamed(statusEngine, adjacent.id, 'Defense Down III')).toBe(2);
    });

    // THE discriminating case. The three assertions above pass with the scope ignored too —
    // when the only debuff on the board is the one the cast just applied, "extend what I
    // inflicted" and "extend everything standing" give the same number. Only a debuff from an
    // UNRELATED family, standing since an earlier round, tells the two apart.
    it('CRIT: leaves a debuff standing from an earlier round untouched', () => {
        const main = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        // A different FAMILY on purpose: seeding another Defense Down would be overwritten by
        // the cast's higher-tier Defense Down III (highest tier wins) and prove nothing.
        seedUnrelatedDebuff(statusEngine, main.id, 2);

        runAsphyxiator(statusEngine, [main], { crit: true });

        expect(debuffTurnsNamed(statusEngine, main.id, 'Defense Down III')).toBe(2);
        expect(debuffTurnsNamed(statusEngine, main.id, 'Speed Down')).toBe(2);
    });

    it('NON-CRIT: the freshly inflicted debuff keeps its printed duration', () => {
        const main = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);

        runAsphyxiator(statusEngine, [main], { crit: false });

        expect(debuffTurnsNamed(statusEngine, main.id, 'Defense Down III')).toBe(1);
    });

    it('is team-symmetric: an ENEMY-side Asphyxiator extends its own inflictions on a PLAYER victim', () => {
        const victim = makeEnemy('player1', 'player');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);

        runAsphyxiator(statusEngine, [victim], { crit: true, side: 'enemy' });

        expect(debuffTurnsNamed(statusEngine, victim.id, 'Defense Down III')).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// The DEFERRED arm. A debuff clause that follows its cast's damage clause is not written during
// `runPlayerTurn` at all — the engine flushes it once the damage has resolved, which is after the
// extension block has already run. Extending by name at that point would find nothing, so each
// pending write is wrapped instead. Asphyxiator's charged Stasis is the corpus instance.
//
// The test drives the flush the way the engine does (`applyState()` then `emitEvents()`, see
// engine.ts's flushDeferredEnemyApplications) rather than asserting on the store mid-turn.
// ---------------------------------------------------------------------------
const asphyxiatorDeferredStatus = (): TimedStatus => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'charged',
    conditions: [],
    duration: 1,
    afterDamageClause: true,
    payload: { buffName: 'Stasis', stacks: 1, parsedEffects: {} },
});

const asphyxiatorDeferredAbility: Ability = {
    id: 'asphyxiator-stasis',
    type: 'debuff',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Stasis',
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        parsedEffects: {},
        duration: 1,
    },
};

function runAsphyxiatorDeferred(
    statusEngine: StatusEngine,
    victim: CombatActor,
    crit: boolean
): void {
    const runtime = makeRuntime(
        'asphyxiator',
        {
            slots: [
                { slot: 'charged', abilities: [asphyxiatorDeferredAbility, asphyxiatorExtend(1)] },
            ],
        },
        { chargedCritGate: () => crit }
    );
    runtime.timedEnemyBySlot = [asphyxiatorDeferredStatus()];
    const result = runPlayerTurn(
        makeArgs(runtime, victim, statusEngine, {
            aoeVictimIds: [victim.id],
            opposingVictimById: new Map([[victim.id, victim]]),
        })
    );
    // Nothing has been written yet — this is the whole point of the arm.
    expect(debuffTurnsNamed(statusEngine, victim.id, 'Stasis')).toBeUndefined();
    for (const pending of result.deferredEnemyApplications) {
        pending.applyState();
        pending.emitEvents();
    }
}

describe('Asphyxiator — a debuff deferred past the damage clause is extended when it lands', () => {
    it('CRIT: the deferred Stasis lands at its printed duration plus the extension', () => {
        const victim = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);

        runAsphyxiatorDeferred(statusEngine, victim, true);

        expect(debuffTurnsNamed(statusEngine, victim.id, 'Stasis')).toBe(2);
    });

    it('NON-CRIT: the deferred Stasis lands at its printed duration', () => {
        const victim = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);

        runAsphyxiatorDeferred(statusEngine, victim, false);

        expect(debuffTurnsNamed(statusEngine, victim.id, 'Stasis')).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// The DoT half of the same ruling: "both debuffs are extended on the main target". Asphyxiator's
// cast lands Defense Down III (a timed debuff) AND Inferno III (a DoT), and the game counts the
// DoT as one of the debuffs it inflicted — so a crit grows its remaining rounds too, on the main
// target and on every enemy the Inferno splashed onto.
// ---------------------------------------------------------------------------
const asphyxiatorInfernoAbility: Ability = {
    id: 'asphyxiator-inferno',
    type: 'dot',
    target: 'target-and-adjacent-enemies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType: 'inferno', tier: 9, stacks: 1, duration: 3 },
};

const asphyxiatorDoTSkills = (): ShipSkills => ({
    slots: [{ slot: 'charged', abilities: [asphyxiatorInfernoAbility, asphyxiatorExtend(1)] }],
});

describe('Asphyxiator — the inflicted DoT is extended too', () => {
    it('CRIT: grows the Inferno this cast just applied to the main target', () => {
        const main = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const infernoEntries: ActiveDoTStack[] = [];
        const runtime = makeRuntime('asphyxiator', asphyxiatorDoTSkills(), {
            chargedCritGate: () => true,
        });

        runPlayerTurn(
            makeArgs(runtime, main, statusEngine, {
                infernoEntries,
                aoeVictimIds: [main.id],
                opposingVictimById: new Map([[main.id, main]]),
            })
        );

        // Applied for 3 rounds, extended to 4.
        expect(infernoEntries.map((e) => e.remainingRounds)).toEqual([4]);
    });

    it('CRIT: does NOT grow an Inferno that was already ticking before the cast', () => {
        const main = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        // A DoT from an earlier round, sitting in the container before this cast appends to it.
        const infernoEntries: ActiveDoTStack[] = [
            { stacks: 1, tier: 3, remainingRounds: 2, sourceId: 'someone-else' },
        ];
        const runtime = makeRuntime('asphyxiator', asphyxiatorDoTSkills(), {
            chargedCritGate: () => true,
        });

        runPlayerTurn(
            makeArgs(runtime, main, statusEngine, {
                infernoEntries,
                aoeVictimIds: [main.id],
                opposingVictimById: new Map([[main.id, main]]),
            })
        );

        expect(infernoEntries[0].remainingRounds).toBe(2);
        expect(infernoEntries[1].remainingRounds).toBe(4);
    });

    it("CRIT: grows the splashed neighbour's Inferno as well (gated on the MAIN target's crit)", () => {
        const main = makeEnemy('enemy1');
        const neighbour = makeEnemy('enemy2');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const runtime = makeRuntime('asphyxiator', asphyxiatorDoTSkills(), {
            chargedCritGate: () => true,
        });

        runPlayerTurn(
            makeArgs(runtime, main, statusEngine, {
                infernoEntries: [],
                aoeVictimIds: [main.id, neighbour.id],
                opposingVictimById: new Map([
                    [main.id, main],
                    [neighbour.id, neighbour],
                ]),
                adjacentEnemyIdsFor: (id: string) => (id === main.id ? [neighbour.id] : []),
            })
        );

        expect(neighbour.infernoEntries.map((e) => e.remainingRounds)).toEqual([4]);
    });

    it('NON-CRIT: the inflicted Inferno keeps its printed duration', () => {
        const main = makeEnemy('enemy1');
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const infernoEntries: ActiveDoTStack[] = [];
        const runtime = makeRuntime('asphyxiator', asphyxiatorDoTSkills(), {
            chargedCritGate: () => false,
        });

        runPlayerTurn(
            makeArgs(runtime, main, statusEngine, {
                infernoEntries,
                aoeVictimIds: [main.id],
                opposingVictimById: new Map([[main.id, main]]),
            })
        );

        expect(infernoEntries.map((e) => e.remainingRounds)).toEqual([3]);
    });
});
