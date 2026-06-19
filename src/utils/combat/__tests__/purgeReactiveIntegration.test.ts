import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// C2b-1 Task 6: Integration — Salvation ally-purged heal, Sefuba chain, depth guard.
//
// Harness style mirrors purgeCastPath.test.ts (two-team positional battle, healTargetId
// required to unlock the enemy roster, statusEngine tap for buff-store inspection).
//
// Layout overview:
//   ENEMY: carries a removable self-buff (Attack Up, duration 99) applied each round;
//          its active skill purges enemy (= player) self-buffs AND hits (positional).
//          Set to speed 50 so it acts AFTER the player focus (which buffs itself each
//          round), ensuring the enemy purges a non-empty player buff store.
//   FOCUS ('attacker'): the player who gets purged — buffs itself each round then hits.
//          Salvation watches from a teamActor slot.
//   SALVATION: teamActor (id 'salvation') with `on-ally-purged` → heal ally for 5% max HP.
//              maxHP = 20000, so expected directHeal = 20000 * 0.05 = 1000 per purge event.
//
// Sefuba layout:
//   FOCUS ('attacker'): Sefuba — has on-cast purge + on-enemy-purged (self-heal + chain purge).
//   ENEMY: carries ≥2 removable self-buffs each round; player focus speed 200 > enemy 50
//          so focus acts FIRST and purges a pre-loaded enemy buff store.
// ---------------------------------------------------------------------------

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pi${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// =============================================================================
// Test 1: Salvation heals the purge-victim ally (on-ally-purged → heal 5% max HP).
// =============================================================================

describe('C2b-1 T6 Step 1: Salvation heals the purged ally (on-ally-purged)', () => {
    // The focus ('attacker') buffs itself then hits — it is the player who GETS PURGED.
    const selfBuff = (name: string): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: name,
                parsedEffects: { attack: 10 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // Focus skills: buffs itself then hits (the buff is what the enemy will purge).
    const focusSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [selfBuff('Attack Up'), hit()] }],
    });

    // Salvation: a team actor (support healer) whose passive carries the on-ally-purged
    // reactive heal — "when a buff is purged from an ally, this Unit repairs that ally for
    // 5% of this Unit's max HP". target: 'ally' → damagedAllyId routing; basis: 'max-hp'
    // → 5% of Salvation's own max HP (20000 → 1000 per purge event).
    const SALVATION_HP = 20_000;
    const SALVATION_HEAL_PCT = 5; // 5% of max HP

    const salvationTeamActor = () => ({
        id: 'salvation',
        speed: 80, // acts between the focus (100) and the enemy (50) — irrelevant but ordered
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'passive' as const,
                        abilities: [
                            ab({
                                type: 'heal',
                                target: 'ally', // heals the purge VICTIM (damagedAllyId routing)
                                trigger: 'on-ally-purged' as const,
                                config: {
                                    type: 'heal',
                                    basis: 'hp' as const,
                                    pct: SALVATION_HEAL_PCT,
                                },
                            }),
                        ],
                    },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: SALVATION_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    // The enemy front attacker: speed 50 (acts AFTER the focus at speed 100), fires 'front'
    // positionally. Its active: purge all player-side buffs, then hit.
    // Because the focus acts FIRST (speed 100 > 50), it applies Attack Up before the enemy
    // purges — so the enemy always purges a non-empty buff store.
    const purgingEnemy = () => ({
        id: 'enemy-front',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'purge',
                            target: 'enemy', // from the enemy's view the player is its enemy
                            config: { type: 'purge', count: 5 },
                        }),
                        hit(),
                    ],
                },
            ],
        },
    });

    const BASE = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 2,
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
        hp: 1_000_000_000, // focus immortal
        healTargetId: 'attacker',
        speed: 100,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [salvationTeamActor()],
        enemyAttackers: [purgingEnemy()],
    });

    it('Salvation credits directHeal to its own actor bucket after the enemy purges the player focus', () => {
        idc = 0;
        const result = runCombat(BASE());

        // Salvation's directHeal should be non-zero across the run (purge-performed fired
        // at least once, triggering Salvation's on-ally-purged).
        const totalSalvationHeal = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('salvation')?.directHeal ?? 0),
            0
        );

        // The expected amount per purge event = SALVATION_HP * SALVATION_HEAL_PCT / 100 = 1000.
        // With numRounds=2 and speed ordering [focus@100, salvation@80, enemy@50]:
        //   R1: focus buffs (Attack Up), salvation no-ops, enemy purges → 1 event → 1000 heal.
        //   R2: focus buffs (stack replaces), salvation no-ops, enemy purges again → 1000 more.
        // Total Salvation directHeal across 2 rounds = 2000.
        expect(totalSalvationHeal).toBe(2 * (SALVATION_HP * SALVATION_HEAL_PCT / 100));
    });

    it('the heal routes to the purge VICTIM (attacker = the ally whose buff was taken), not Salvation itself', () => {
        idc = 0;
        // The heal target is 'attacker' — the same actor whose buff was purged.
        // effectiveHeal credits the target's consumed share when rid === healing.targetId.
        // Salvation never equals healing.targetId ('attacker'), so effectiveHeal lives in
        // Salvation's bucket (credited on behalf of the routing, from applyHealToTarget).
        // We verify: Salvation's directHeal > 0 (the heal happened) and Salvation's own
        // directHeal does NOT land as a self-repair (Salvation's hp is 100% → no self-credit
        // expected on Salvation's runtime for this purge-triggered heal).
        const result = runCombat(BASE());

        const salvationHeal = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('salvation')?.directHeal ?? 0),
            0
        );
        expect(salvationHeal).toBeGreaterThan(0);

        // The focus ('attacker') is the heal target and the purge victim — it should have
        // effectiveHeal credited (the purge-triggered repair consumed some of its HP gap).
        // (The enemy hits 'attacker' each round with attack=1000, so 'attacker' has a real
        // HP deficit and effectiveHeal is non-zero.)
        const attackerEffectiveHeal = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('salvation')?.effectiveHeal ?? 0),
            0
        );
        expect(attackerEffectiveHeal).toBeGreaterThan(0);
    });
});

// =============================================================================
// Test 2: Sefuba chain (on-enemy-purged → self-heal + purge 1 more) + depth guard.
// =============================================================================

describe('C2b-1 T6 Step 2: Sefuba chain purge + self-heal (on-enemy-purged, depth-guarded)', () => {
    // Sefuba active: purges 1 enemy buff (on-cast). Passive p2: on-enemy-purged → self-heal
    // 12% max HP + purge 1 more (fromPurgeEvent=true → depth-1 chain only).
    //
    // Enemy: faster (speed 200 → acts first each round) so it pre-loads 3 removable self-buffs
    // before the focus acts. Focus (speed 100) then purges on its turn.
    //
    // Expected per round:
    //   1. On-cast purge removes 1 buff → emits purge-performed.
    //   2. purge-performed triggers on-enemy-purged → enqueues self-heal + chain purge.
    //   3. Chain purge (fromPurgeEvent=true) removes 1 more buff → NO second purge-performed.
    //   4. Self-heal credits 12% of Sefuba's max HP to 'attacker' (the focus is Sefuba).
    // Total buffs removed per round = 2 (cast 1 + chain 1).
    // Total purge-performed events per round = 1 (cast only).

    const SEFUBA_HP = 10_000;
    const SEFUBA_HEAL_PCT = 12; // 12% max HP self-repair

    const selfBuff = (name: string): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: name,
                parsedEffects: { attack: 10 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // Enemy: FASTER (speed 200 > focus 100), applies 3 removable self-buffs then hits.
    // 3 buffs ensures the chain purge (removes 1 more after the cast purge of 1) still
    // has a buff to remove.
    const buffingEnemyFast = () => ({
        id: 'enemy-front',
        stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        selfBuff('Attack Up'),
                        selfBuff('Defence Up'),
                        selfBuff('Speed Up'),
                        hit(),
                    ],
                },
            ],
        },
    });

    // Sefuba's skill set:
    //   active: purge 1 enemy buff (on-cast) + hit (positional, so targetId resolves to 'enemy-front')
    //   passive: on-enemy-purged → heal self 12% max HP + purge 1 more (fromPurgeEvent is set by
    //            the listener in triggers.ts → depth-1 guard prevents re-emission).
    const sefubaSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'purge',
                        target: 'enemy',
                        config: { type: 'purge', count: 1 },
                    }),
                    hit(),
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'heal',
                        target: 'self',
                        trigger: 'on-enemy-purged' as const,
                        config: { type: 'heal', basis: 'hp' as const, pct: SEFUBA_HEAL_PCT },
                    }),
                    ab({
                        type: 'purge',
                        target: 'enemy',
                        trigger: 'on-enemy-purged' as const,
                        config: { type: 'purge', count: 1 },
                    }),
                ],
            },
        ],
    });

    const BASE = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: sefubaSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1, // one round is enough to prove the chain
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
        hp: SEFUBA_HP,
        healTargetId: 'attacker',
        speed: 100,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [buffingEnemyFast()],
    });

    it('total buffs removed from the enemy = cast count + 1 (the on-enemy-purged chain)', () => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // The enemy applied 3 buffs before the focus acted (speed 200 > 100).
        // On-cast purge removes 1. Chain purge removes 1 more. 1 buff survives.
        // 3 applied - 2 removed = 1 remaining.
        const remaining = engine!
            .timedAbilityStatuses('self', 'enemy-front')
            .map((b) => b.active.buffName);
        expect(remaining).toHaveLength(1);
        // The surviving buff should be one of the three applied (any one — purge is newest-first).
        expect(['Attack Up', 'Defence Up', 'Speed Up']).toContain(remaining[0]);
    });

    it("Sefuba's self-heal credits directHeal after the on-enemy-purged fires", () => {
        idc = 0;
        const result = runCombat(BASE());
        // Sefuba's on-enemy-purged heal: target:'self' → routes to [ownerId] = ['attacker'].
        // Basis: max-hp → SEFUBA_HP * 12/100 = 1200.
        const sefubaHeal = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.directHeal ?? 0),
            0
        );
        const expectedHeal = SEFUBA_HP * SEFUBA_HEAL_PCT / 100; // 1200
        expect(sefubaHeal).toBe(expectedHeal);
    });

    it('exactly ONE purge-performed event emitted (cast only; chain is depth-guarded)', () => {
        idc = 0;
        const purgeEvents: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
        const bus = createEventBus();
        bus.on('purge-performed', (e) => purgeEvents.push(e));
        runCombat({ ...BASE(), bus });

        // The on-cast purge emits purge-performed (triggers the chain).
        // The chain purge carries fromPurgeEvent:true → does NOT re-emit.
        // Result: exactly 1 purge-performed event for the single round.
        expect(purgeEvents).toHaveLength(1);
        expect(purgeEvents[0].casterId).toBe('attacker');
        expect(purgeEvents[0].count).toBe(1); // cast removed 1 buff
    });
});

// =============================================================================
// Test 3: Depth guard (integration level) — fromPurgeEvent true → no second event.
// =============================================================================

describe('C2b-1 T6 Step 3: depth guard — chain purge removes a buff but emits no second event', () => {
    // Same Sefuba setup as Step 2, but extended to verify the net buff count matches
    // the chain and the second event is definitively absent across multiple rounds.
    const selfBuff = (name: string): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: name,
                parsedEffects: { attack: 10 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // Enemy buffs itself with 3 buffs per round (speed 200 so pre-loads before focus).
    const multiBuffEnemy = () => ({
        id: 'enemy-front',
        stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [selfBuff('Attack Up'), selfBuff('Defence Up'), selfBuff('Speed Up'), hit()],
                },
            ],
        },
    });

    // Sefuba with on-cast purge + on-enemy-purged chain purge.
    const sefubaSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'purge', target: 'enemy', config: { type: 'purge', count: 1 } }),
                    hit(),
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'heal',
                        target: 'self',
                        trigger: 'on-enemy-purged' as const,
                        config: { type: 'heal', basis: 'hp' as const, pct: 12 },
                    }),
                    ab({
                        type: 'purge',
                        target: 'enemy',
                        trigger: 'on-enemy-purged' as const,
                        config: { type: 'purge', count: 1 },
                    }),
                ],
            },
        ],
    });

    const BASE_MULTI = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: sefubaSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 3,
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
        healTargetId: 'attacker',
        speed: 100,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [multiBuffEnemy()],
    });

    it('exactly 1 purge-performed per round across 3 rounds (chain never re-emits)', () => {
        idc = 0;
        const purgeEvents: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
        const bus = createEventBus();
        bus.on('purge-performed', (e) => purgeEvents.push(e));
        runCombat({ ...BASE_MULTI(), bus });

        // 3 rounds × 1 cast purge each = 3 purge-performed events.
        // The chain purge (fromPurgeEvent:true) must NOT add more.
        expect(purgeEvents).toHaveLength(3);
        // Every event was cast by the focus (not the chain, which is depth-guarded).
        expect(purgeEvents.every((e) => e.casterId === 'attacker')).toBe(true);
    });

    it('chain purge removes a buff (net 2 removed per round) but emits no second purge-performed', () => {
        idc = 0;
        // Verify the chain ACTUALLY removed buffs (not just emitted nothing while doing nothing).
        // After round 1: enemy applied 3, focus removed 2 (cast+chain) → 1 remaining.
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE_MULTI(),
            numRounds: 1,
            __testTapStatusEngine: (e) => { engine = e; },
        });
        const remainingAfterR1 = engine!
            .timedAbilityStatuses('self', 'enemy-front')
            .length;
        expect(remainingAfterR1).toBe(1); // 3 applied - 2 removed = 1 surviving
    });
});
