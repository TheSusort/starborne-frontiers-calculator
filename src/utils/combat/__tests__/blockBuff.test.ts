import { describe, it, expect } from 'vitest';
import { isBlockBuff, recipientCarriesBlockBuff } from '../blockBuffBuffs';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { RegisteredAbilityStatus } from '../statusEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: Block Buff primitive + firing-skill self/ally buff guard.
//
// "Block Buff" is a control status: a unit carrying it is IMMUNE TO RECEIVING
// BUFFS — any NEW timed buff application targeting it at the firing-skill seam is
// silently skipped (no buff-applied event, no log). It is INFLICTED on the carrier
// (lives in the per-target debuff store, read via ownerDebuffNamesFor), does NOT
// remove existing buffs, and does NOT touch stat folding or recurring auras.
// ─────────────────────────────────────────────────────────────────────────────

describe('blockBuffBuffs helpers', () => {
    describe('isBlockBuff', () => {
        it('returns true for "Block Buff"', () => {
            expect(isBlockBuff('Block Buff')).toBe(true);
        });

        it('returns false for unrelated buff names', () => {
            expect(isBlockBuff('Attack Up II')).toBe(false);
        });
    });

    describe('recipientCarriesBlockBuff', () => {
        // Seed a `Block Buff` status onto `targetId`'s inflicted-debuff store (an ENEMY-side
        // status keyed by that target — exactly what ownerDebuffNamesFor reads).
        const seedBlockBuff = (
            statusEngine: ReturnType<typeof createStatusEngine>,
            round: number,
            targetId: string
        ): void => {
            const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
                payload: { buffName: 'Block Buff', stacks: 1, parsedEffects: {} },
                side: 'enemy',
                sourceSlot: 'active',
                conditions: [],
                casterId: 'caster',
                recipients: [targetId],
                kind: 'timed',
                duration: 5,
            };
            statusEngine.applyTimedAbilityStatus(round, status, undefined, targetId);
        };

        it('returns true when the recipient carries an inflicted Block Buff', () => {
            const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            se.beginRound(1);
            seedBlockBuff(se, 1, 'target-1');
            expect(recipientCarriesBlockBuff(se, 'target-1')).toBe(true);
        });

        it('returns false when the recipient carries no Block Buff', () => {
            const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            se.beginRound(1);
            expect(recipientCarriesBlockBuff(se, 'target-1')).toBe(false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Behavioral gate-flip (engine via runCombat).
//
// The focus actor `attacker` (speed 100) has a recurring self-buff skill granting
// `Attack Up II`. An enemy attacker `e1` (speed 10 — acts AFTER the focus each round)
// inflicts `Block Buff` on the heal target (the focus actor) on its turn. So from
// ROUND 2 onward the focus carries Block Buff when it fires its self-buff at the top
// of its turn → the buff-applied emit must be SKIPPED. The control (focus skills with
// NO Block Buff inflicted on it) proves the gate flips, not vacuous.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

const blockBuffEngineBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
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
    hp: 1_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bbka${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Focus actor's active skill: a basic attack + a self-buff (`Attack Up II`). The self-buff
 *  is applied through the firing-skill seam (the guarded loop) on EVERY active cast — so it
 *  re-emits `buff-applied` each round, exposing the gate flip. */
const attackUpSelfSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'attack-up-attack',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
                {
                    id: 'attack-up-self',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up II',
                        parsedEffects: { attack: 50 },
                        stacks: 1,
                        isStackable: false,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

/** An enemy attacker (speed 10 — acts AFTER the speed-100 focus actor each round) that inflicts
 *  a `Block Buff` named debuff on the heal target (the focus actor). `hacking` omitted → defaults
 *  to 200 → 100% landing, so the Block Buff reliably lands. */
const blockBuffEnemy = (): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        enemyAb({
                            type: 'debuff',
                            config: {
                                type: 'debuff',
                                buffName: 'Block Buff',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 5,
                            },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

/** buff-applied events for the focus actor's `Attack Up II` self-buff, by round. */
const focusAttackUpRounds = (events: CombatEvent[]): number[] =>
    events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' &&
                e.actorId === 'attacker' &&
                e.buffName === 'Attack Up II'
        )
        .map((e) => e.round);

describe('Block Buff — firing-skill self-buff guard (engine)', () => {
    it('a Block-Buffed focus actor does NOT gain its self-buff once the Block Buff is live', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));

        runCombat(
            blockBuffEngineBase({
                enemyAttackers: [blockBuffEnemy()],
                shipSkills: attackUpSelfSkills(),
                bus,
            })
        );

        const rounds = focusAttackUpRounds(events);
        // Round 1: focus self-buffs BEFORE the slow enemy inflicts Block Buff → it lands.
        expect(rounds).toContain(1);
        // Rounds 2+: the focus carries Block Buff when it fires → the self-buff is skipped.
        expect(rounds).not.toContain(2);
        expect(rounds).not.toContain(3);
    });

    it('control: WITHOUT Block Buff the same focus actor gains its self-buff every round (non-vacuity)', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));

        runCombat(
            blockBuffEngineBase({
                // No enemy attacker → nothing inflicts Block Buff on the focus actor.
                shipSkills: attackUpSelfSkills(),
                bus,
            })
        );

        const rounds = focusAttackUpRounds(events);
        expect(rounds).toContain(1);
        expect(rounds).toContain(2);
        expect(rounds).toContain(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: Block Buff guard at the REACTIVE-buff executor (triggers.ts).
//
// The firing-skill seam (Task 2, playerTurn.ts) covers on-cast buffs. This seam
// covers reactively-granted buffs that flow through the `cfg.type==='buff'` branch
// in triggers.ts. The focus actor has an `on-attacked` passive granting an
// ALL-ALLIES buff (`Reactive Up`). A slow enemy attacks the focus each round and
// inflicts `Block Buff` (duration 5); the reactive resolves after the enemy turn
// body, so the Block Buff is live on the focus by the time the grant runs.
//
// Recipients of the all-allies grant are the focus actor (Block-Buffed) + one inert
// team ally (`ally-1`, never Block-Buffed). The guard must skip the Block-Buffed
// focus while the SAME grant still lands on the non-Block-Buffed ally — the ally is
// the in-grant control proving the skip is per-recipient, not the whole grant. The
// companion RED run (no guard) lands the buff on the focus too, so the skip is
// non-vacuous.
// ─────────────────────────────────────────────────────────────────────────────

/** Focus actor's on-attacked reactive: grants `Reactive Up` to ALL allies (recipients =
 *  every player id, incl. the focus and team allies). Flows through the triggers.ts
 *  reactive-buff executor — the seam this task guards. */
const reactiveAllAlliesSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'reactive-all-allies',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-attacked',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Reactive Up',
                        parsedEffects: { attack: 25 },
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                    },
                },
            ],
        },
    ],
});

/** An inert team ally — no shipSkills (a legacy card actor), so it never grants anything
 *  itself; it only RECEIVES the focus actor's all-allies reactive buff. Never Block-Buffed. */
const inertAlly = (): TeamActorEngineInput => ({
    id: 'ally-1',
    speed: 50, // acts after the focus, before nobody-of-consequence — order irrelevant (inert)
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
});

/** Rounds in which `actorId` received the `Reactive Up` buff. */
const reactiveUpRounds = (events: CombatEvent[], actorId: string): number[] =>
    events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' && e.actorId === actorId && e.buffName === 'Reactive Up'
        )
        .map((e) => e.round);

describe('Block Buff — reactive-buff executor guard (engine)', () => {
    it('a Block-Buffed recipient is skipped by an all-allies reactive grant, but a non-Block-Buffed ally still receives it', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('buff-applied', (e) => events.push(e as CombatEvent));

        runCombat(
            blockBuffEngineBase({
                enemyAttackers: [blockBuffEnemy()],
                shipSkills: reactiveAllAlliesSkills(),
                teamActors: [inertAlly()],
                bus,
            })
        );

        const focusRounds = reactiveUpRounds(events, 'attacker');
        const allyRounds = reactiveUpRounds(events, 'ally-1');

        // The Block-Buffed focus is skipped by the reactive grant in EVERY round — it carries
        // Block Buff (inflicted on the enemy's turn) by the time each grant resolves. Without
        // the guard the RED run lands the buff on the focus, so this skip is non-vacuous.
        expect(focusRounds).toEqual([]);

        // Control recipient in the SAME grant: the never-Block-Buffed ally still receives the
        // buff (the grant fired and is per-recipient, not skipped wholesale).
        expect(allyRounds.length).toBeGreaterThan(0);
    });
});
