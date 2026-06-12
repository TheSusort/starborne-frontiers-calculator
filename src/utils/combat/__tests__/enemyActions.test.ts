import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS } from '../../../types/abilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import {
    registerReactiveListeners,
    partitionReactiveAbilities,
    executeIntent,
    Intent,
    IntentExecContext,
} from '../triggers';
import { createEventBus, CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import {
    runPlayerTurn,
    PlayerActorRuntime,
    PlayerTurnArgs,
    HealingRuntimeCtx,
} from '../playerTurn';
import type { PlayerRoundCtx } from '../playerTurn';
import { createActor } from '../state';
import type { CombatActor } from '../state';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import type { SelectedGameBuff } from '../../../types/calculator';

describe('Phase 4c PR 4 — enemy-action triggers', () => {
    it('registers on-enemy-repaired and on-enemy-cleansed as live triggers', () => {
        expect(LIVE_TRIGGERS.has('on-enemy-repaired')).toBe(true);
        expect(LIVE_TRIGGERS.has('on-enemy-cleansed')).toBe(true);
    });

    function reactiveAbility(trigger: Ability['trigger']): Ability {
        return {
            id: `${trigger}-ab`,
            type: 'charge',
            target: 'self',
            trigger,
            conditions: [],
            config: { type: 'charge', amount: 1 },
        };
    }

    it('on-enemy-repaired enqueues only for enemy-side heal-performed', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'zosimos',
                    reactiveAbilities: [
                        { ability: reactiveAbility('on-enemy-repaired'), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => enqueued.push(i),
            isEnemySide: (id) => id === 'enemy',
        });
        bus.emit({
            type: 'heal-performed',
            casterId: 'enemy',
            targets: ['enemy'],
            round: 1,
            amount: 0,
        });
        bus.emit({
            type: 'heal-performed',
            casterId: 'ally',
            targets: ['tank'],
            round: 1,
            amount: 100,
        });
        expect(enqueued).toHaveLength(1);
    });

    it('on-enemy-cleansed enqueues only for enemy-side cleanse-performed', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'grif',
                    reactiveAbilities: [
                        { ability: reactiveAbility('on-enemy-cleansed'), sourceSlot: 'passive' },
                    ],
                },
            ],
            enqueue: (i) => enqueued.push(i),
            isEnemySide: (id) => id === 'enemy',
        });
        bus.emit({ type: 'cleanse-performed', casterId: 'enemy', count: 1, round: 1 });
        bus.emit({ type: 'cleanse-performed', casterId: 'ally', count: 1, round: 1 });
        expect(enqueued).toHaveLength(1);
    });

    it('routes a damage ability with a live trigger to the reactive path', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'grif-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-enemy-cleansed',
                            conditions: [],
                            config: { type: 'damage', multiplier: 0.75, noCrit: true },
                        },
                        {
                            id: 'normal-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 1 },
                        },
                    ],
                },
            ],
        };
        const { reactiveAbilities, castSkills } = partitionReactiveAbilities(shipSkills);
        expect(reactiveAbilities.map((r) => r.ability.id)).toEqual(['grif-dmg']);
        expect(castSkills.slots[0].abilities.map((a) => a.id)).toEqual(['normal-dmg']);
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 4 Task 4: reactive direct-damage executor branch (Grif).
//
// A `damage` intent folds the owner's last-turn ctx bomb-style
// (effectiveAttack × multiplier × affinityMult — NO defense, NO crit) and
// credits it via creditReactiveDamage. Before the owner's first turn (no
// lastTurnCtx entry) it skips, exactly like a bomb follow-up.
// ----------------------------------------------------------------------
describe('Phase 4c PR 4 Task 4: damage reactive executor branch', () => {
    const makeRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            landsTimedEnemyApplication: () => true,
            debuffLandingGate: (_rate: number) => true,
            debuffLandingChance: 1,
        }) as unknown as PlayerActorRuntime;

    // defence/maxHp/heal fields are sentinels not read by the damage branch.
    const makePlayerRoundCtx = (effectiveAttack: number, affinityMult: number): PlayerRoundCtx => ({
        effectiveAttack,
        dotMult: 1,
        affinityMult,
        effectiveDefence: 0,
        effectiveMaxHp: 0,
        outgoingHealPct: 0,
        incomingHealPct: 0,
    });

    const makeExecCtx = (
        overrides: Partial<IntentExecContext> & Pick<IntentExecContext, 'creditReactiveDamage'>
    ): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                ['grif', makeRuntime('grif')],
                ['grif-noctx', makeRuntime('grif-noctx')],
            ]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['grif'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            ...overrides,
        };
    };

    const makeDamageIntent = (ownerId: string): Intent => ({
        ownerId,
        sourceSlot: 'passive',
        ability: {
            id: 'grif-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-cleansed',
            conditions: [],
            config: { type: 'damage', multiplier: 0.75, noCrit: true },
        },
    });

    it('credits owner pool with bomb-style fold, skips without ctx', () => {
        const credited: { ownerId: string; amount: number }[] = [];
        const ctx = makeExecCtx({
            creditReactiveDamage: (ownerId, amount) => credited.push({ ownerId, amount }),
            lastTurnCtxByActor: new Map([['grif', makePlayerRoundCtx(1000, 1.5)]]),
        });

        executeIntent(makeDamageIntent('grif'), ctx);
        expect(credited).toEqual([{ ownerId: 'grif', amount: 1000 * 0.75 * 1.5 }]);

        credited.length = 0;
        executeIntent(makeDamageIntent('grif-noctx'), ctx);
        expect(credited).toHaveLength(0);
    });

    it('skips creditReactiveDamage when effectiveAttack is 0 (zero-damage guard)', () => {
        // Owner ctx present but effectiveAttack is 0 → amount is 0 → guard swallows it,
        // creditReactiveDamage must NOT be called.
        const credited: { ownerId: string; amount: number }[] = [];
        const ctx = makeExecCtx({
            creditReactiveDamage: (ownerId, amount) => credited.push({ ownerId, amount }),
            lastTurnCtxByActor: new Map([['grif', makePlayerRoundCtx(0, 1.5)]]),
        });
        executeIntent(makeDamageIntent('grif'), ctx);
        expect(credited).toHaveLength(0);
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 4 Task 5a: event-only enemy heal/cleanse EMISSION.
//
// When runPlayerTurn is called with `healEventOnly: true` (the enemy walk),
// a CAST skill carrying heal/cleanse abilities must EMIT `heal-performed` /
// `cleanse-performed` with the actor's id, but mutate NOTHING on the shared
// player healing ctx — no credit / applyHealToTarget / grantShieldToTarget.
// This is the load-bearing guard: a single leaked healing.* call would credit
// the player healing map under an enemy id (or heal the tank).
// ----------------------------------------------------------------------
describe('Phase 4c PR 4 Task 5a: event-only enemy heal/cleanse emission', () => {
    // A spy healing ctx that records EVERY mutation. If event-only mode is honoured,
    // none of these arrays receive an entry.
    interface HealingSpy {
        healing: HealingRuntimeCtx;
        credits: { actorId: string; bucket: string; amount: number }[];
        applied: number[];
        shields: number[];
    }
    const makeHealingSpy = (): HealingSpy => {
        const credits: { actorId: string; bucket: string; amount: number }[] = [];
        const applied: number[] = [];
        const shields: number[] = [];
        const healing: HealingRuntimeCtx = {
            targetId: 'tank',
            credit: (actorId, bucket, amount) => credits.push({ actorId, bucket, amount }),
            recipientMaxHp: () => 10000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => 10000,
            applyHealToTarget: (raw) => {
                applied.push(raw);
                return { consumed: raw, overheal: 0 };
            },
            grantShieldToTarget: (raw) => shields.push(raw),
            playerIds: ['enemy1', 'tank'],
        };
        return { healing, credits, applied, shields };
    };

    // An enemy-side runtime whose ACTIVE cast skill heals an ally and cleanses.
    const makeRuntime = (skills: ShipSkills): PlayerActorRuntime => {
        const actor = createActor({
            id: 'enemy1',
            side: 'player', // runPlayerTurn is side-agnostic; the engine flags enemy via healEventOnly
            kind: 'attacker',
            stats: {
                attack: 5000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 10000,
                speed: 100,
            },
            chargeCount: 0,
            startCharged: false,
        });
        const noGate: PlayerActorRuntime['activeCritGate'] = () => false;
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
            hp: 10000,
            healModifier: 0,
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            affinityDisadvantage: false,
            activeCritGate: noGate,
            chargedCritGate: noGate,
            activeHealCritGate: noGate,
            chargedHealCritGate: noGate,
            debuffLandingGate: makeRateGate(),
            extendChanceGate: makeRateGate(),
            landsTimedEnemyApplication: () => true,
            selfBuffLookup: new Map(),
            enemyDebuffLookup: new Map(),
        };
    };

    const makeArgs = (
        runtime: PlayerActorRuntime,
        healing: HealingRuntimeCtx,
        healEventOnly: boolean
    ): PlayerTurnArgs => {
        const enemy = createActor({
            id: 'tank',
            side: 'enemy',
            kind: 'enemy',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
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
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: 10_000_000,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            enemyHpDecline: 0,
            healing,
            healEventOnly,
        };
    };

    // Cast skill: a heal (ally target) + a cleanse, both on-cast.
    const healCleanseSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'ea-heal',
                        type: 'heal',
                        target: 'ally',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'heal', pct: 20, basis: 'hp' },
                    },
                    {
                        id: 'ea-cleanse',
                        type: 'cleanse',
                        target: 'ally',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'cleanse', count: 2 },
                    },
                ],
            },
        ],
    });

    it('emits heal-performed + cleanse-performed with the actor id and mutates NOTHING', () => {
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills()), spy.healing, true);
        args.bus.on('heal-performed', (e) => events.push(e));
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        const heal = events.find((e) => e.type === 'heal-performed');
        const cleanse = events.find((e) => e.type === 'cleanse-performed');

        // Both events fired with the enemy actor's id.
        expect(cleanse).toBeDefined();
        expect(cleanse!.casterId).toBe('enemy1');
        expect(cleanse!.count).toBe(2);
        expect(heal).toBeDefined();
        expect(heal!.casterId).toBe('enemy1');
        // Event-only heal carries NO numeric (amount 0, no crit info).
        expect(heal!.amount).toBe(0);
        expect(heal!.critHits).toBeUndefined();

        // CRITICAL: not a single healing.* mutation ran in event-only mode.
        expect(spy.credits).toHaveLength(0);
        expect(spy.applied).toHaveLength(0);
        expect(spy.shields).toHaveLength(0);
    });

    it('normal mode (healEventOnly false) DOES credit and emit cleanse-performed', () => {
        // Sanity / symmetry: the player path credits buckets AND now emits cleanse-performed.
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills()), spy.healing, false);
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        const cleanse = events.find((e) => e.type === 'cleanse-performed');
        expect(cleanse).toBeDefined();
        expect(cleanse!.casterId).toBe('enemy1');
        expect(cleanse!.count).toBe(2);
        // Player path credited cleanseCount + directHeal (mutations DID run).
        expect(spy.credits.some((c) => c.bucket === 'cleanseCount')).toBe(true);
        expect(spy.credits.some((c) => c.bucket === 'directHeal')).toBe(true);
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 4 Task 5 (code-review fix): HoT-ticking guard.
//
// The healing block ticks HoT (Repair Over Time) sources ABOVE the cast
// heal/shield/cleanse loop, crediting `hotHeal` (and, when the holder is the
// heal target, applying to the target). That ticking is NOT a cast — it has
// its own pre-loop. In event-only (enemy) mode it MUST be suppressed too,
// otherwise a HoT-carrying enemy would credit the PLAYER healing map under
// its own id (and could mutate the tank's HP). This proves the
// `if (!healEventOnly)` guard around BOTH HoT loops.
// ----------------------------------------------------------------------
describe('Phase 4c PR 4 Task 5 fix: HoT ticking is gated behind healEventOnly', () => {
    interface HealingSpy {
        healing: HealingRuntimeCtx;
        credits: { actorId: string; bucket: string; amount: number }[];
        applied: number[];
        shields: number[];
    }
    const makeHealingSpy = (): HealingSpy => {
        const credits: { actorId: string; bucket: string; amount: number }[] = [];
        const applied: number[] = [];
        const shields: number[] = [];
        const healing: HealingRuntimeCtx = {
            targetId: 'tank',
            credit: (actorId, bucket, amount) => credits.push({ actorId, bucket, amount }),
            recipientMaxHp: () => 10000,
            recipientIncomingHealPct: () => 0,
            applierMaxHp: () => 10000,
            applyHealToTarget: (raw) => {
                applied.push(raw);
                return { consumed: raw, overheal: 0 };
            },
            grantShieldToTarget: (raw) => shields.push(raw),
            playerIds: ['attacker', 'tank'],
        };
        return { healing, credits, applied, shields };
    };

    // An always-active self-buff carrying hotPct 10. Always-active because it has no
    // skillSource / skillDuration (isAlwaysActive), so the status engine surfaces it in
    // entry.activeSelfBuffs every round → loop (b) of the HoT ticker reads it.
    const hotBuff = (): SelectedGameBuff => ({
        id: 'hot-1',
        buffName: 'Repair Over Time',
        stacks: 1,
        parsedEffects: { hotPct: 10 },
        isStackable: false,
    });

    // Runtime mirrors the 5a enemy-side runtime, but its selfBuffLookup maps the HoT
    // buff name to the buff so loop (b)'s expandBuffs surfaces the hotPct.
    // actor.id is 'attacker' so the status engine surfaces the always-active HoT buff in
    // snapshot(actor.id).activeSelfBuffs (selfAlwaysSnap only populates for the 'attacker'
    // owner). holder ('attacker') !== heal target ('tank') → loop (b) credits hotHeal only.
    const makeRuntime = (): PlayerActorRuntime => {
        const actor = createActor({
            id: 'attacker',
            side: 'player',
            kind: 'attacker',
            stats: {
                attack: 5000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 10000,
                speed: 100,
            },
            chargeCount: 0,
            startCharged: false,
        });
        const noGate: PlayerActorRuntime['activeCritGate'] = () => false;
        return {
            actor,
            focus: true,
            // No cast abilities: the ONLY healing.* a misbehaving enemy could trigger here is
            // the HoT tick, isolating the guard under test.
            castSkills: { slots: [] },
            reactiveAbilities: [],
            timedSelfBySlot: [],
            timedEnemyBySlot: [],
            hasChargedSkill: false,
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 10000,
            healModifier: 0,
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            affinityDisadvantage: false,
            activeCritGate: noGate,
            chargedCritGate: noGate,
            activeHealCritGate: noGate,
            chargedHealCritGate: noGate,
            debuffLandingGate: makeRateGate(),
            extendChanceGate: makeRateGate(),
            landsTimedEnemyApplication: () => true,
            selfBuffLookup: new Map([['Repair Over Time', [hotBuff()]]]),
            enemyDebuffLookup: new Map(),
        };
    };

    // Seed the status engine with the HoT buff so its name lands in entry.activeSelfBuffs.
    const makeArgs = (
        runtime: PlayerActorRuntime,
        healing: HealingRuntimeCtx,
        healEventOnly: boolean
    ): PlayerTurnArgs => {
        const enemy = createActor({
            id: 'tank',
            side: 'enemy',
            kind: 'enemy',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                defence: 0,
                hp: 10_000_000,
                speed: 50,
            },
        });
        const statusEngine = createStatusEngine({
            selfBuffs: [hotBuff()],
            enemyDebuffs: [],
        });
        statusEngine.beginRound(1);
        return {
            runtime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: 10_000_000,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            enemyHpDecline: 0,
            healing,
            healEventOnly,
        };
    };

    it('event-only mode: HoT ticking credits/applies NOTHING on the player map', () => {
        const spy = makeHealingSpy();
        runPlayerTurn(makeArgs(makeRuntime(), spy.healing, true));

        // The guard suppressed BOTH HoT loops: no hotHeal credit, no applyHealToTarget,
        // no shield grant under the enemy id.
        expect(spy.credits).toHaveLength(0);
        expect(spy.applied).toHaveLength(0);
        expect(spy.shields).toHaveLength(0);
    });

    it('normal mode: the same HoT source DOES credit hotHeal (proves the source is real)', () => {
        const spy = makeHealingSpy();
        runPlayerTurn(makeArgs(makeRuntime(), spy.healing, false));

        // Contrast: with the guard inactive (player path), loop (b) ticks the HoT and
        // credits the holder's hotHeal bucket. (Holder !== target → no applyHealToTarget.)
        expect(spy.credits.some((c) => c.bucket === 'hotHeal' && c.amount > 0)).toBe(true);
    });
});

// ----------------------------------------------------------------------
// Phase 4c PR 4 Task 5b: integration — a ship-backed enemy attacker whose
// cast cleanses emits cleanse-performed (casterId = enemy id), credits NO
// player healing buckets under the enemy id, and a Grif-like player's
// on-enemy-cleansed damage proc credits the enemy pool.
// ----------------------------------------------------------------------
describe('Phase 4c PR 4 Task 5b: enemy cleanse cast → cleanse-performed + Grif proc', () => {
    const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `i${Math.random().toString(36).slice(2)}`,
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    // A focus player (the heal target) carrying a Grif-style on-enemy-cleansed damage proc.
    const grifSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-enemy-cleansed',
                        config: { type: 'damage', multiplier: 2, noCrit: true },
                    }),
                ],
            },
        ],
    });

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        enemyDefense: 0,
        enemyHp: 10_000_000,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 10000,
        ...overrides,
    });

    it('enemy cleanse cast emits cleanse-performed (enemy id), no player credit, Grif procs', () => {
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));
        bus.on('heal-performed', (e) => events.push(e));

        const result = runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                shipSkills: grifSkills(),
                bus,
                enemyAttackers: [
                    {
                        id: 'enemy1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 50 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        ab({
                                            type: 'cleanse',
                                            target: 'self',
                                            config: { type: 'cleanse', count: 1 },
                                        }),
                                    ],
                                },
                            ],
                        },
                    },
                ],
            })
        );

        // cleanse-performed fired with the ENEMY's id (every round it cast).
        const cleanseEvents = events.filter((e) => e.type === 'cleanse-performed');
        expect(cleanseEvents.length).toBeGreaterThan(0);
        for (const e of cleanseEvents) {
            expect(e.casterId).toBe('enemy1');
            expect(e.count).toBe(1);
        }

        // The enemy credited NO player healing buckets under its own id.
        const enemyRows = (result.healing?.rounds ?? []).map((rd) => rd.perActor.get('enemy1'));
        for (const row of enemyRows) {
            if (!row) continue;
            expect(row.cleanseCount ?? 0).toBe(0);
            expect(row.directHeal ?? 0).toBe(0);
            expect(row.effectiveHeal ?? 0).toBe(0);
        }

        // Grif's on-enemy-cleansed damage proc credited the focus player's damage pool
        // (creditReactiveDamage → direct). The focus has NO cast damage of its own, so any
        // directDamage in the result comes solely from the on-enemy-cleansed proc. The proc
        // folds the owner's last-turn ctx bomb-style: focusAttack × multiplier × affinityMult,
        // with NO defense and NO crit (noCrit). The focus acts before the enemy each round, so
        // its ctx is already populated when the enemy cleanses — the proc lands every round.
        // Deterministic value: 5000 attack × 2 multiplier × 1.0 affinityMult (no affinity set)
        // × 3 rounds = 30000.
        const grifDamage = result.rounds.reduce((sum, rd) => sum + rd.directDamage, 0);
        const perRoundProc = 5000 * 2 * 1.0;
        expect(grifDamage).toBe(perRoundProc * 3);
    });
});
