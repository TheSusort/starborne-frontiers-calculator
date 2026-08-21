import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { holdsBarrierRecharging, BARRIER_RECHARGING } from '../barrierRecharging';
import { executeIntent, type Intent, type IntentExecContext } from '../triggers';
import { createEventBus } from '../events';
import { runCombat, type CombatEngineInput } from '../engine';
import type { CombatActor } from '../state';
import type { PlayerActorRuntime } from '../playerTurn';
import type { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

const timed = (buffName: string, duration: number) => ({
    payload: { buffName, stacks: 1, parsedEffects: {} },
    side: 'self' as const,
    sourceSlot: 'passive' as const,
    conditions: [],
    kind: 'timed' as const,
    duration,
});

describe('Barrier Recharging lockout predicate', () => {
    it('is true for an actor carrying the status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 3), 'a1');
        expect(holdsBarrierRecharging(eng, 'a1')).toBe(true);
    });

    it('is false for an actor without it, and for an unrelated status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Barrier', 1), 'a2');
        expect(holdsBarrierRecharging(eng, 'a2')).toBe(false);
        expect(holdsBarrierRecharging(eng, 'nobody')).toBe(false);
    });
});

// =============================================================================
// The re-arm gate — triggers.ts's reactive buff-grant recipient loop (~line 2621).
//
// Barrier Recharging's own text, "Cannot be reduced. Unremovable", says nothing about a FRESH
// grant landing on a holder who already has it — only the pre-existing BARRIER_BUFFS arm of the
// gate is stated by the text (it blocks a Barrier grant specifically). Taken literally, a second
// grant of Barrier Recharging ITSELF would go through `familyApplicationWins`, which compares
// `duration > existing.turnsRemaining`: a fresh 3-turn grant always beats a decayed 1 or 2, so
// Quixilver's every-turn re-fire would refresh the lockout back to 3 forever — a permanent
// one-shot lock, not a 3-turn cooldown. The owner-approved reading treats "cannot be reduced" as
// "cannot be re-armed while still held", so the gate's second arm blocks Barrier Recharging from
// re-applying to itself too. These tests drive `executeIntent` directly — the REACTIVE path an
// end-of-turn trigger takes (see hitCountedBarrier.integration.test.ts's reactive-path suite for
// the sibling fixture this is modeled on) — to prove the lockout actually decays to expiry and
// then re-arms, rather than refreshing every time the granter fires.
// =============================================================================

describe('Barrier Recharging: real 3-turn cooldown (re-arm gate)', () => {
    const makeAllyRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    /** Quixilver's end-of-turn grant to all allies, modeling only the Barrier Recharging half
     *  (the co-granted Barrier itself is already covered by the pre-existing BARRIER_BUFFS arm
     *  and by hitCountedBarrier.integration.test.ts). */
    const rechargingGrantIntent = (): Intent => ({
        ownerId: 'quixilver',
        sourceSlot: 'passive',
        ability: {
            id: 'barrier-recharging-grant',
            type: 'buff',
            target: 'all-allies',
            trigger: 'end-of-turn',
            conditions: [],
            config: {
                type: 'buff',
                buffName: BARRIER_RECHARGING,
                stacks: 1,
                parsedEffects: {},
                isStackable: false,
                duration: 3,
            },
        },
    });

    /** Minimal IntentExecContext for an all-allies buff intent — lifted from
     *  hitCountedBarrier.integration.test.ts's reactive-path suite (same cfg.type === 'buff'
     *  branch), re-keyed to accept an arbitrary ally id list. */
    const buildCtx = (playerIds: string[]): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            // The owner ('quixilver') needs a runtime too — executeIntent resolves it before
            // touching the recipient loop — even though it is not itself an all-allies recipient.
            runtimes: new Map([
                ['quixilver', makeAllyRuntime('quixilver')],
                ...playerIds.map((id): [string, PlayerActorRuntime] => [id, makeAllyRuntime(id)]),
            ]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds,
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            recordResisted: () => {},
            // FIX 3: now required — this suite has no live-HP view, so "nobody" is the honest
            // answer, supplied explicitly rather than by omission.
            lowestHpAllyIdFor: () => undefined,
        } as IntentExecContext;
    };

    it('does not refresh an ally already holding the lockout', () => {
        const ctx = buildCtx(['a1']);
        // a1 is already at 2 turns remaining — Quixilver's PREVIOUS grant has already ticked
        // down once via the ally's own Post-Turn. A naive re-application would beat it
        // (3 > 2, familyApplicationWins) and reset the lockout to 3 — the exact bug this test
        // proves does NOT happen.
        ctx.statusEngine.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 2), 'a1');

        executeIntent(rechargingGrantIntent(), ctx);

        // Two more Post-Turn ticks fully expire the ORIGINAL 2-turn grant. If the gate had
        // refreshed it to 3 above, a third tick would still be needed and this would fail.
        ctx.statusEngine.decrementPlayer('a1');
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(true); // 1 turn left
        ctx.statusEngine.decrementPlayer('a1');
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(false); // expired on schedule
    });

    it('re-arms once the lockout has fully decayed, letting a later grant land', () => {
        const ctx = buildCtx(['a1']);
        ctx.statusEngine.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 1), 'a1');

        // One Post-Turn tick expires the original grant entirely — the cooldown has cycled.
        ctx.statusEngine.decrementPlayer('a1');
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(false);

        // Quixilver's next end-of-turn fire finds no lockout in the way, so this is a genuinely
        // FRESH grant, not a refresh — it lands.
        executeIntent(rechargingGrantIntent(), ctx);
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(true);
    });
});

// =============================================================================
// The CAST path — playerTurn.ts's timedSelfBySlot recipient loop (~line 1749).
//
// Finding 3: the reactive path (triggers.ts, tested above) already gated Barrier grants against
// a live Barrier Recharging lockout; the CAST path did not, even though it has an identical
// recipientCarriesBlockBuff gate sitting right next to where the Barrier Recharging gate needed
// to go. Malvex, Sansi and Panon's charge all grant "Barrier for 1 hit" from a CHARGE slot — a
// cast-path grant — so without this gate a live lockout only ever stopped Quixilver's own
// reactive re-fire, never a charge-slot grant landing on a recipient already under it. Engine
// level (not a unit test on the loop directly) so the fixture exercises the real charge cadence:
// round 1 fires ACTIVE (self-grants Barrier Recharging + banks 1 charge), round 2 fires CHARGE
// (attempts to grant Barrier for 1 hit) while the round-1 grant is still live.
// =============================================================================

describe('Barrier Recharging: the CAST-path gate (a charge-slot Barrier grant vs a live lockout)', () => {
    const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
    const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.

    const noopDamage = (id: string): Ability => ({
        id,
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 0 },
    });

    /** Self-targeted charge gain — banks exactly 1 charge per ACTIVE cast (chargeCount: 1 below
     *  means the charged skill fires on the very next turn). */
    const selfChargeGain = (): Ability => ({
        id: 'self-charge',
        type: 'charge',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'charge', amount: 1 },
    });

    /** Round 1's self-grant — models Panon's own-text "applies Barrier Recharging to itself for
     *  3 turns" half, minus the "if directly damaged" gate (irrelevant here: this fixture only
     *  needs the LOCKOUT already live by round 2, not how it got there). */
    const grantBarrierRechargingSelf = (): Ability => ({
        id: 'grant-recharging',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: BARRIER_RECHARGING,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 3,
        },
    });

    /** Round 2's charge-slot grant — the "Barrier for 1 hit" shape Malvex/Sansi/Panon's charge
     *  actually carries. */
    const barrierSelfBuff = (): Ability => ({
        id: 'barrier-self',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Barrier',
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            hits: 1,
        },
    });

    const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
        raw: selection,
        side: 'enemy',
        selection,
    });
    const basePattern = (): ParsedPattern => ({
        raw: 'base',
        shape: 'base',
        range: 0,
        modifiers: {},
    });

    type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

    /** Fast (acts first every round, so its own-turn grants land before the enemy's hit),
     *  chargeCount 1 → banks a charge on round 1's ACTIVE cast and fires the CHARGE slot on
     *  round 2. */
    const holder = (): TeamActor =>
        ({
            id: 'holder',
            speed: 1000,
            chargeCount: 1,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M4' as Position,
            walk: {
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                selfChargeGain(),
                                grantBarrierRechargingSelf(),
                                noopDamage('active-dmg'),
                            ],
                        },
                        {
                            slot: 'charged',
                            abilities: [barrierSelfBuff(), noopDamage('charge-dmg')],
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
                    hp: HP,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: true,
            },
        }) as TeamActor;

    /** Slower than the holder, so its hit always lands after the holder's turn resolves. */
    const offensiveEnemy = (): EnemyAttacker =>
        ({
            id: 'enemy-1',
            stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M1' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'enemy-atk',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100, hits: 1 },
                            } as Ability,
                        ],
                    },
                ],
            },
        }) as EnemyAttacker;

    const BASE_INPUT = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
        enemyAttackers: [],
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage('focus-noop')] }] },
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
        hp: HP,
        healTargetId: 'attacker',
        mode: 'healing',
        ...overrides,
    });

    it("a charge-slot Barrier grant is silently skipped while the holder is under its own Barrier Recharging lockout — the enemy's hit lands in full", () => {
        const result = runCombat(
            BASE_INPUT({ teamActors: [holder()], enemyAttackers: [offensiveEnemy()] })
        );

        const round2 = result.rounds.find((r) => r.round === 2)!;
        const incoming = round2.perActorIncoming?.['holder'];
        // Pre-fix: the charge-slot grant landed straight through the lockout, so the round-2
        // hit was fully absorbed (barrierAbsorbed === DIRECT_HIT, taken === 0). Post-fix: the
        // grant is silently skipped (no Barrier ever exists to absorb anything) and the hit
        // lands in full.
        expect(incoming?.barrierAbsorbed ?? 0).toBe(0);
        const taken = round2.perTargetDamage?.['holder'] ?? 0;
        expect(taken).toBeCloseTo(DIRECT_HIT, 6);
    });
});
