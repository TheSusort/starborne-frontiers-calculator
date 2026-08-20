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
import { createStatusEngine, type RegisteredAbilityStatus } from '../statusEngine';
import {
    runPlayerTurn,
    PlayerActorRuntime,
    PlayerTurnArgs,
    HealingRuntimeCtx,
} from '../playerTurn';
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
            isOpposing: (id) => id === 'enemy',
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
            isOpposing: (id) => id === 'enemy',
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
                            config: { type: 'damage', multiplier: 75, noCrit: true },
                        },
                        {
                            id: 'normal-dmg',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
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
// PR4b: reactive direct-damage executor branch (Grif/FrontLine/Judge/Chakara/
// Incinerator/Rhodium) — WIRING only. The branch now delegates the actual
// mitigation/crit math to ctx.applyReactiveDamage (mirrors the `counter`
// branch's applyCounterAttack delegate); this suite pins the ARGUMENTS the
// `damage` branch passes to that delegate, not the mitigation math itself
// (that is proven at the engine/DPS-integration level — see
// judgeStartOfRoundDamage.integration.test.ts and reactiveDamageMitigation
// integration coverage).
// ----------------------------------------------------------------------
describe('PR4b: damage reactive executor branch — applyReactiveDamage wiring', () => {
    const makeRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            attack: 800,
            landsTimedEnemyApplication: () => true,
            debuffLandingGate: (_rate: number) => true,
        }) as unknown as PlayerActorRuntime;

    type Call = {
        ownerId: string;
        victimId: string;
        abilityId: string;
        multiplier: number;
        hits: number;
        noCrit: boolean;
    };

    const makeExecCtx = (
        overrides: Partial<IntentExecContext> & Pick<IntentExecContext, 'applyReactiveDamage'>
    ): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['grif', makeRuntime('grif')]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['grif'],
            lastTurnCtxByActor: new Map(),
            recordResisted: () => {},
            ...overrides,
        };
    };

    const makeDamageIntent = (
        ownerId: string,
        config: { multiplier: number; hits?: number; noCrit?: boolean },
        eventCtx?: Intent['eventCtx']
    ): Intent => ({
        ownerId,
        sourceSlot: 'passive',
        ability: {
            id: 'grif-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-cleansed',
            conditions: [],
            config: { type: 'damage', ...config },
        },
        eventCtx,
    });

    it('NO-OPS when neither an eventCtx target nor a living opposing roster resolves (SP-4c-2d: was ctx.enemy.id)', () => {
        // This ctx supplies no `livingOpposingActorIds` delegate, so the arm's roster is empty.
        // It used to fall through to the vestigial dummy (`victimId: 'enemy-default'`); the empty
        // roster is now a NO-OP, matching the two selector arms above it in the executor.
        const calls: Call[] = [];
        const ctx = makeExecCtx({
            applyReactiveDamage: (ownerId, victimId, abilityId, multiplier, hits, noCrit) => {
                calls.push({ ownerId, victimId, abilityId, multiplier, hits, noCrit });
            },
        });

        executeIntent(makeDamageIntent('grif', { multiplier: 75, noCrit: true }), ctx);

        expect(calls).toEqual([]);
    });

    it('routes to the FIRST living opposing actor when the roster resolves one', () => {
        // The positive half of the case above, and the arm's real production route (Judge / Chakara
        // / Incinerator / Rhodium's start-of-round / end-of-round triggers, which stamp no victim).
        const calls: Call[] = [];
        const ctx = makeExecCtx({
            applyReactiveDamage: (ownerId, victimId, abilityId, multiplier, hits, noCrit) => {
                calls.push({ ownerId, victimId, abilityId, multiplier, hits, noCrit });
            },
            livingOpposingActorIds: () => ['front-enemy', 'back-enemy'],
        });

        executeIntent(makeDamageIntent('grif', { multiplier: 75, noCrit: true }), ctx);

        expect(calls).toEqual([
            {
                ownerId: 'grif',
                victimId: 'front-enemy',
                abilityId: 'grif-dmg',
                multiplier: 75,
                hits: 1,
                noCrit: true,
            },
        ]);
    });

    it('routes to eventCtx.counterTargetId when present (FrontLine on-enemy-charged-cast shape)', () => {
        const calls: Call[] = [];
        const ctx = makeExecCtx({
            applyReactiveDamage: (ownerId, victimId, abilityId, multiplier, hits, noCrit) => {
                calls.push({ ownerId, victimId, abilityId, multiplier, hits, noCrit });
            },
        });

        executeIntent(
            makeDamageIntent('grif', { multiplier: 80, hits: 1 }, { counterTargetId: 'caster-x' }),
            ctx
        );

        expect(calls).toEqual([
            {
                ownerId: 'grif',
                victimId: 'caster-x',
                abilityId: 'grif-dmg',
                multiplier: 80,
                hits: 1,
                noCrit: false,
            },
        ]);
    });

    it('defaults noCrit to false and hits to 1 when the config omits them', () => {
        const calls: Call[] = [];
        const ctx = makeExecCtx({
            applyReactiveDamage: (ownerId, victimId, abilityId, multiplier, hits, noCrit) => {
                calls.push({ ownerId, victimId, abilityId, multiplier, hits, noCrit });
            },
        });

        // SP-4c-2d: a routed victim is now REQUIRED to reach the wiring this case is about —
        // without one the executor no-ops and `calls[0]` would be undefined.
        executeIntent(
            makeDamageIntent('grif', { multiplier: 60 }, { counterTargetId: 'caster-x' }),
            ctx
        );

        expect(calls[0]).toMatchObject({ multiplier: 60, hits: 1, noCrit: false });
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
            // E5: an enemy single-'ally' heal routes to the lowest-HP living enemy ally; here the
            // sole enemy ally is the caster itself ('enemy1'), a living stand-in (currentHp > 0).
            enemyIds: ['enemy1'],
            recipientActor: (id) =>
                id === 'enemy1' ? ({ id, currentHp: 10000 } as CombatActor) : undefined,
        };
        return { healing, credits, applied, shields };
    };

    // An enemy-side runtime whose ACTIVE cast skill heals an ally and cleanses.
    // `side` mirrors the real engine: an ENEMY caster (event-only path) carries side:'enemy'
    // so E5's side-aware recipient routing fires; the normal-mode (player) test uses 'player'.
    const makeRuntime = (
        skills: ShipSkills,
        side: CombatActor['side'] = 'player'
    ): PlayerActorRuntime => {
        const actor = createActor({
            id: 'enemy1',
            side,
            kind: 'attacker',
            stats: {
                attack: 5000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
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
                shieldPenetration: 0,
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
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: 10_000_000,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
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

    // Minimal enemy-side timed debuff to seed onto a recipient's per-actor debuff store, so an
    // enemy cleanse has something REAL to remove. Shape mirrors cleanseRemoval.test.ts's mkTimed.
    const mkTimedDebuff = (
        buffName: string
    ): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 5,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    });

    it('E5: enemy heal RESTORES HP + emits a real heal-performed amount, still NO player credit', () => {
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        // side:'enemy' → E5 side-aware routing: the 'ally' heal targets the lowest-HP enemy ally
        // (the caster itself here), and applyHealToTarget runs on the enemy path.
        const args = makeArgs(makeRuntime(healCleanseSkills(), 'enemy'), spy.healing, true);
        // Seed two removable debuffs on the cleanse recipient (enemy1 — the lowest-HP enemy ally
        // the 'ally'-targeted cleanse routes to) so the lift removes a REAL count of 2.
        args.statusEngine.applyTimedAbilityStatus(
            1,
            mkTimedDebuff('Attack Down'),
            'attacker',
            'enemy1'
        );
        args.statusEngine.applyTimedAbilityStatus(
            1,
            mkTimedDebuff('Defense Down'),
            'attacker',
            'enemy1'
        );
        args.bus.on('heal-performed', (e) => events.push(e));
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        const heal = events.find((e) => e.type === 'heal-performed');
        const cleanse = events.find((e) => e.type === 'cleanse-performed');

        // Both events fired with the enemy actor's id.
        expect(cleanse).toBeDefined();
        expect(cleanse!.casterId).toBe('enemy1');
        // REAL removal of the 2 seeded debuffs (not the nominal cfg.count).
        expect(cleanse!.count).toBe(2);
        expect(heal).toBeDefined();
        expect(heal!.casterId).toBe('enemy1');
        // E5: heal-performed now carries the REAL amount (effectiveHp 10000 × 20% basis 'hp');
        // no crit (noGate → false) so critHits stays absent.
        expect(heal!.amount).toBe(2000);
        expect(heal!.critHits).toBeUndefined();

        // E5: the heal IS applied to the enemy's own pool (applied received the raw)...
        expect(spy.applied).toEqual([2000]);
        // ...but NOTHING is credited to the player healing buckets, and no shield was granted.
        expect(spy.credits).toHaveLength(0);
        expect(spy.shields).toHaveLength(0);
    });

    it('lift: enemy cleanse count 2 against ONE seeded debuff emits cleanse-performed { count: 1 }', () => {
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills(), 'enemy'), spy.healing, true);
        // Only ONE removable debuff exists → real removal clamps to 1, NOT the nominal cfg.count 2.
        args.statusEngine.applyTimedAbilityStatus(
            1,
            mkTimedDebuff('Attack Down'),
            'attacker',
            'enemy1'
        );
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        const cleanse = events.find((e) => e.type === 'cleanse-performed');
        expect(cleanse).toBeDefined();
        expect(cleanse!.casterId).toBe('enemy1');
        expect(cleanse!.count).toBe(1);
        // Still no player metric credit on the enemy path.
        expect(spy.credits).toHaveLength(0);
    });

    it('lift: enemy cleanse with NO seeded debuff removes nothing and emits no cleanse-performed', () => {
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills(), 'enemy'), spy.healing, true);
        // No debuffs seeded on enemy1 → real removal 0 → cleanse-performed must NOT fire (cadence
        // change from the old stub, which always fired by nominal count).
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        expect(events.find((e) => e.type === 'cleanse-performed')).toBeUndefined();
        expect(spy.credits).toHaveLength(0);
    });

    it('normal mode (healEventOnly false) DOES credit and emit cleanse-performed', () => {
        // Sanity / symmetry: the player path credits buckets AND now emits cleanse-performed.
        // C1 T3: cleanse now performs REAL removal, so the recipient ('tank' — the ally cleanse
        // routes to healing.targetId) must carry removable debuffs for the cleanse to remove
        // (and credit) anything. Seed two removable debuffs so the cleanse-2 removes 2,
        // preserving the count===2 assertion.
        const events: CombatEvent[] = [];
        const spy = makeHealingSpy();
        const args = makeArgs(makeRuntime(healCleanseSkills()), spy.healing, false);
        const mkDebuff = (buffName: string) => ({
            kind: 'timed' as const,
            side: 'enemy' as const,
            sourceSlot: 'active' as const,
            conditions: [],
            duration: 5,
            casterId: 'foe',
            payload: { buffName, stacks: 1, parsedEffects: {} },
        });
        // The ally cleanse routes to healing.targetId ('tank') → seed its enemy store.
        args.statusEngine.applyTimedAbilityStatus(1, mkDebuff('Attack Down'), 'foe', 'tank');
        args.statusEngine.applyTimedAbilityStatus(1, mkDebuff('Defense Down'), 'foe', 'tank');
        args.bus.on('cleanse-performed', (e) => events.push(e));

        runPlayerTurn(args);

        const cleanse = events.find((e) => e.type === 'cleanse-performed');
        expect(cleanse).toBeDefined();
        expect(cleanse!.casterId).toBe('enemy1');
        // Real removal: both seeded debuffs removed → count is the ACTUAL removed total (2).
        expect(cleanse!.count).toBe(2);
        // Player path credited cleanseCount (actual removed) + directHeal (mutations DID run).
        expect(spy.credits.some((c) => c.bucket === 'cleanseCount' && c.amount === 2)).toBe(true);
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
            // E5 fields (unused by the HoT-ticking path — present for type-correctness).
            enemyIds: ['attacker'],
            recipientActor: (id) => ({ id, currentHp: 10000 }) as CombatActor,
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
                shieldPenetration: 0,
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
                shieldPenetration: 0,
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
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: 10_000_000,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
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
// cast cleanses with NOTHING to remove now emits NO cleanse-performed and
// credits NO player healing buckets under the enemy id (symmetric cadence
// after the enemy cleanse lift). A no-op enemy cleanse no longer drives a
// Grif on-enemy-cleansed proc. The POSITIVE Grif chain (proc fires on a
// REAL removal) lives in enemyCleanse.integration.test.ts.
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
                        config: { type: 'damage', multiplier: 200, noCrit: true },
                    }),
                ],
            },
        ],
    });

    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        enemyAttackers: [],
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

    it('enemy cleanse with nothing to remove emits NO cleanse-performed and does not proc Grif (symmetric cadence)', () => {
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('cleanse-performed', (e) => events.push(e));
        bus.on('heal-performed', (e) => events.push(e));

        const result = runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                mode: 'healing',
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

        // SYMMETRIC CADENCE: the enemy cleanse has nothing to remove (no debuff was applied to
        // enemy1), so real removal is 0 → NO cleanse-performed fires (matches the player path).
        const cleanseEvents = events.filter((e) => e.type === 'cleanse-performed');
        expect(cleanseEvents).toHaveLength(0);

        // The enemy credited NO player healing buckets under its own id (unchanged by the lift).
        const enemyRows = (result.healing?.rounds ?? []).map((rd) => rd.perActor.get('enemy1'));
        for (const row of enemyRows) {
            if (!row) continue;
            expect(row.cleanseCount ?? 0).toBe(0);
            expect(row.directHeal ?? 0).toBe(0);
            expect(row.effectiveHeal ?? 0).toBe(0);
        }

        // No cleanse-performed → the focus's on-enemy-cleansed Grif proc never fires → no damage.
        const grifDamage = result.rounds.reduce((sum, rd) => sum + rd.directDamage, 0);
        expect(grifDamage).toBe(0);
    });
});
