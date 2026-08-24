/**
 * `Shield Converter` — "Nullifies the damage of the next direct hit, turning it into a Shield
 * instead." Granted by Quixilver's charged skill, to itself. Built as a name-only buff (empty
 * parsedEffects) so nothing read it until this wiring.
 *
 * Name-keyed rather than a `parsedEffects` entry, for the same reason Hit Mitigation is: a
 * one-shot nullify has no honest standing value, so routing it through an incoming channel would
 * leak permanent damage immunity into effective-HP and the DPS aggregate.
 *
 * Harness mirrors hitMitigation.integration.test.ts (read that file first): the victim's speed is
 * far higher than the attacker's so its own turn-start DoT tick runs BEFORE that round's incoming
 * hit, keeping "0 immediate damage this hit" and "the tick lands next turn" cleanly separated.
 *
 * The status is self-cast from the victim's ACTIVE slot for the plain nullify case (a passive-slot
 * `on-cast` self-buff does not reliably apply in this engine), but the "is spent" / ordering /
 * exclusion fixtures instead grant it from the victim's CHARGED slot (`startCharged` +
 * `chargeCount: 99`, one cast, never re-armed) — an active-slot cast re-arms every round, which
 * would mask whether the first hit actually consumed it.
 *
 * ACCOUNTING NOTE, why this differs from the sibling Hit Mitigation step: Hit Mitigation reverses
 * `.incoming` via `addIncoming(-damage)` because its damage is DEFERRED and re-books later on each
 * DoT tick. Shield Converter's damage re-books nowhere, so it follows Barrier instead: `.incoming`
 * keeps the hit, and `convertedToShield` nets out the effect. So a converted hit's `incomingBooked`
 * (what callers book into `perTargetDamage`/`perTargetDealt`) is the FULL original amount, not 0 —
 * this is what the accounting-identity test at the bottom pins.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { SHIELD_CONVERTER } from '../shieldConverter';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.
const HIT_MITIGATION_ROUNDS = 3; // Hit Mitigation's DoT spread — used only by the "both statuses" case.

const namedSelfBuff = (buffName: string, duration: number): Ability => ({
    id: `self-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration,
    },
});

const shieldConverterSelfBuff = (): Ability => namedSelfBuff(SHIELD_CONVERTER, 99);

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

let atkCounter = 0;
const basicAttack = (hits = 1): Ability => ({
    id: `basic-${++atkCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits },
});

/** The Shield Converter holder: fast (acts first, so a self-cast grant is up before the enemy's
 *  hit), never deals real damage. `abilities` defaults to self-casting the status from the ACTIVE
 *  slot; pass a list without it (e.g. `[noopDamage()]`) when the grant must come from a CHARGED
 *  slot instead — required whenever a fixture needs the status granted exactly ONCE. `extraSlots`
 *  carries that charged grant (or a passive); with a charged slot present, `charge` wires the
 *  cadence (`{ chargeCount: 99, startCharged: true }` fires it in round 1 and never again, since 99
 *  more turns of cadence never accrue). `hp` overrides the base HP stat (used by the clamp case to
 *  make max HP small relative to the hit); `attack` stays 0 for every fixture here (nothing needs
 *  the holder to deal real damage). */
const holderTeamActor = (
    id: string,
    position: Position,
    abilities: Ability[] = [shieldConverterSelfBuff(), noopDamage()],
    extraSlots: ShipSkills['slots'] = [],
    charge: { chargeCount: number; startCharged: boolean } = {
        chargeCount: 0,
        startCharged: false,
    },
    attack = 0,
    hp = HP
): TeamActor => ({
    id,
    speed: 1000,
    chargeCount: charge.chargeCount,
    startCharged: charge.startCharged,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities }, ...extraSlots] },
        stats: {
            attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: extraSlots.some((s) => s.slot === 'charged'),
    },
});

/** `speed` stays 1 (slower than every holder above) for every fixture except the ally-granted
 *  ones, where a faster granter/applier has to act first. */
const offensiveEnemy = (
    id: string,
    position: Position,
    abilities: Ability[] = [basicAttack()],
    speed = 1
): EnemyAttacker => ({
    id,
    stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities }] },
});

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
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

/** Collects hp-changed, generic dot-ticked, `attacked`, and `shield-applied-log` events for one
 *  target, plus the raw result. The last two back the IMPORTANT 1 / IMPORTANT 2 regression checks
 *  below: `attacked.shieldWasHit` for the shieldBefore-pollution bug, `shield-applied-log` for the
 *  silent-grant bug (Shield Converter's third-shield-source recurrence of the #277 defect class). */
function collectFor(input: CombatEngineInput, targetId: string) {
    const bus = createEventBus();
    const hpChanges: { round: number; oldPct: number; newPct: number }[] = [];
    const genericTicks: { round: number; damage: number }[] = [];
    const attackedEvents: { round: number; shieldWasHit: boolean }[] = [];
    const shieldAppliedLogs: { round: number; victimId: string; amount: number }[] = [];
    bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
        if (e.targetId === targetId)
            hpChanges.push({ round: e.round, oldPct: e.oldPct, newPct: e.newPct });
    });
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === targetId && e.dotType === 'generic')
            genericTicks.push({ round: e.round, damage: e.damage });
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === targetId)
            attackedEvents.push({ round: e.round, shieldWasHit: e.shieldWasHit === true });
    });
    bus.on('shield-applied-log', (e: Extract<CombatEvent, { type: 'shield-applied-log' }>) => {
        shieldAppliedLogs.push({ round: e.round, victimId: e.victimId, amount: e.amount });
    });
    const result = runCombat({ ...input, bus });
    return { hpChanges, genericTicks, attackedEvents, shieldAppliedLogs, result };
}

/** OR-accumulated `shieldWasHit` across every `attacked` event this target received in `round`
 *  (mirrors buildCombatLog's own per-target OR-accumulation for multi-hit attacks). */
function shieldWasHitInRound(
    attackedEvents: { round: number; shieldWasHit: boolean }[],
    round: number
): boolean {
    return attackedEvents.filter((e) => e.round === round).some((e) => e.shieldWasHit);
}

/** Net HP lost by `targetId` in one round, derived from the ground-truth `hp-changed` events
 *  (not the display-formula derivation `battleSimulator` uses — it also subtracts
 *  `convertedToShield` as of f7cc926b, but this helper stays on the ground-truth events rather
 *  than re-deriving from the display formula). Zero-delta crossings (the funnel
 *  emits one even for a fully-nullified hit) contribute 0, so summing is safe.
 *
 *  `maxHp` is a REQUIRED param, not the module-level `HP` constant baked in — the `oldPct`/
 *  `newPct` events are percentages of the holder's OWN effective max HP, which the clamp fixture
 *  below overrides to `SMALL_HP` (2000). Hardcoding `HP` (10,000,000) there would be off by
 *  5000x; it was only ever benign because that fixture's own assertion is a 0 delta (0 * anything
 *  is still 0) — MINOR 5 of the Shield Converter review. */
function hpLossForRound(
    hpChanges: { round: number; oldPct: number; newPct: number }[],
    round: number,
    maxHp: number
): number {
    return hpChanges
        .filter((c) => c.round === round)
        .reduce((sum, c) => sum + ((c.oldPct - c.newPct) / 100) * maxHp, 0);
}

describe('Shield Converter nullifies the next direct hit and turns it into Shield', () => {
    it('nullifies the next direct hit and converts it to Shield', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { hpChanges, attackedEvents, shieldAppliedLogs, result } = collectFor(
            input,
            'holder'
        );
        const r1 = result.rounds[0];

        // No HP moved — the hit was fully nullified.
        expect(hpLossForRound(hpChanges, 1, HP)).toBeCloseTo(0, 6);
        // The hit still ARRIVED (booked into .incoming) and was fully converted.
        expect(r1.perActorIncoming?.['holder']?.incoming).toBeCloseTo(DIRECT_HIT, 6);
        expect(r1.perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(DIRECT_HIT, 6);
        // The nullified amount landed in the shield pool.
        expect(r1.perActorShield?.['holder']?.pool).toBeCloseTo(DIRECT_HIT, 6);

        // IMPORTANT 1 (review): the pool grew from 0 to DIRECT_HIT, but nothing DRAINED it — the
        // hit was nullified, not shield-absorbed. `shieldWasHit` on the resulting `attacked` event
        // must stay false; the deposit must not read as "the shield absorbed part of this hit".
        expect(shieldWasHitInRound(attackedEvents, 1)).toBe(false);

        // IMPORTANT 2 (review): the deposit is a real shield grant — the third source alongside
        // `grantShieldToTarget` and Lifeline's mid-hit grant — so it must credit the SAME
        // `granted` accumulator (`RoundData.perActorShield[id].granted`) they do, and emit the
        // same LOG-ONLY `shield-applied-log` twin Lifeline emits, self-attributed to the victim
        // (mirrors `convertHitToSelfDot`'s `sourceId: victim.id`). Without this, `granted`
        // under-reports and the log shows an unexplained pool jump.
        expect(r1.perActorShield?.['holder']?.granted).toBeCloseTo(DIRECT_HIT, 6);
        expect(shieldAppliedLogs).toEqual([{ round: 1, victimId: 'holder', amount: DIRECT_HIT }]);
    });

    it('is spent - the SECOND direct hit lands normally', () => {
        // Granted ONCE from the CHARGED slot (not re-cast from the active slot every round),
        // so a later hit genuinely tests consumption rather than a fresh re-arm.
        //
        // Three hits, not two: hit 1's conversion deposits DIRECT_HIT into the victim's REAL
        // shield pool (Shield Converter turns the nullified damage into an actual Shield, not a
        // throwaway number) — so hit 2 does not bypass the funnel entirely, it gets absorbed by
        // THAT leftover shield via the ordinary shield-drain mechanic, landing 0 net HP damage
        // for a reason that has nothing to do with the one-shot status. The channel that proves
        // hit 2 was NOT a second conversion is `convertedToShield` reading 0 (had the status
        // still been armed, hit 2 would show convertedToShield === DIRECT_HIT again and the pool
        // would read 10000, not 0). Hit 3, once the leftover shield is drained, is the one that
        // shows the status's absence the way raw HP does: it lands at the full mitigated amount.
        const input = BASE_PLAYER_SIDE({
            numRounds: 3,
            teamActors: [
                holderTeamActor(
                    'holder',
                    'M4',
                    [noopDamage()],
                    [{ slot: 'charged', abilities: [shieldConverterSelfBuff(), noopDamage()] }],
                    { chargeCount: 99, startCharged: true }
                ),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { hpChanges, attackedEvents, result } = collectFor(input, 'holder');

        // Hit 1: nullified, converted to Shield.
        expect(hpLossForRound(hpChanges, 1, HP)).toBeCloseTo(0, 6);
        expect(result.rounds[0].perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[0].perActorShield?.['holder']?.pool).toBeCloseTo(DIRECT_HIT, 6);
        // IMPORTANT 1 (review), reconfirmed: a nullify-and-deposit is not a shield hit.
        expect(shieldWasHitInRound(attackedEvents, 1)).toBe(false);

        // Hit 2: the status was already spent by hit 1, so this hit is NOT converted — it goes
        // through the normal shield-drain path instead and is absorbed by hit 1's leftover pool.
        expect(result.rounds[1].perActorIncoming?.['holder']?.convertedToShield ?? 0).toBe(0);
        expect(result.rounds[1].perActorIncoming?.['holder']?.shieldAbsorbed).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[1].perActorShield?.['holder']?.pool ?? 0).toBe(0);
        expect(hpLossForRound(hpChanges, 2, HP)).toBeCloseTo(0, 6);
        // Differential proof the harness can actually detect a TRUE `shieldWasHit`: hit 2 is a
        // GENUINE drain of hit 1's leftover pool (not a conversion), so this — unlike hit 1 above
        // — must read true. Without this the false assertions above would be unfalsifiable.
        expect(shieldWasHitInRound(attackedEvents, 2)).toBe(true);

        // Hit 3: with the leftover shield drained and the status still gone, this hit lands at
        // full strength on raw HP — the clean "second-hit-onward lands normally" signature.
        expect(result.rounds[2].perActorIncoming?.['holder']?.convertedToShield ?? 0).toBe(0);
        expect(hpLossForRound(hpChanges, 3, HP)).toBeCloseTo(DIRECT_HIT, 6);
    });

    it('clamps the shield gain at max HP but still nullifies the hit in full', () => {
        const SMALL_HP = 2000; // far below DIRECT_HIT, so the gain must clamp.
        const PARTIAL_POOL = 1000; // pool already partly full before the hit.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [
                holderTeamActor(
                    'holder',
                    'M4',
                    [noopDamage()],
                    [{ slot: 'charged', abilities: [shieldConverterSelfBuff(), noopDamage()] }],
                    { chargeCount: 99, startCharged: true },
                    0,
                    SMALL_HP
                ),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            __testTapActors: (actors: CombatActor[]) => {
                const holder = actors.find((a) => a.id === 'holder');
                if (holder) holder.shieldPool = PARTIAL_POOL;
            },
        });
        const { hpChanges, attackedEvents, result } = collectFor(input, 'holder');
        const r1 = result.rounds[0];

        // The hit was nullified IN FULL — HP does not move even though the shield could not
        // absorb the whole amount. `SMALL_HP`, not the module-level `HP` — this fixture's
        // holder has an actual max HP of 2000, and `hp-changed`'s oldPct/newPct are percentages
        // of THAT (MINOR 5 of the Shield Converter review).
        expect(hpLossForRound(hpChanges, 1, SMALL_HP)).toBeCloseTo(0, 6);
        // Shield gain clamps at max HP: min(1000 + 5000, 2000) = 2000, not 6000.
        expect(r1.perActorShield?.['holder']?.pool).toBeCloseTo(SMALL_HP, 6);
        // But the accounting channel records the FULL nullified amount, not the clamped delta
        // (2000 - 1000 = 1000) — it explains the missing HP damage, not the shield delta.
        expect(r1.perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(DIRECT_HIT, 6);

        // Vacuity guard: an assertion on `shieldWasHitInRound` is meaningless unless this round
        // actually produced an `attacked` event for the holder — `shieldWasHitInRound` returns
        // false for an empty list too.
        expect(attackedEvents.filter((e) => e.round === 1).length).toBeGreaterThan(0);
        // Second review finding: the victim held a NON-EMPTY pool (PARTIAL_POOL = 1000) before
        // this conversion, so the naive `shieldBefore > 0 && hpDamage < damage` reading — with no
        // structural exclusion for a converted hit — would misreport this as a shield hit. It
        // isn't: nothing drained, the pool only grew. This is Shield Converter's NORMAL operating
        // state (Quixilver grants itself shield every turn), not a corner case.
        expect(shieldWasHitInRound(attackedEvents, 1)).toBe(false);
    });
});

describe('Hit Mitigation wins when the victim holds both, and Shield Converter survives', () => {
    it('hit 1 becomes a self-DoT via Hit Mitigation; Shield Converter is still armed for hit 2', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [
                holderTeamActor(
                    'holder',
                    'M4',
                    [noopDamage()],
                    [
                        {
                            slot: 'charged',
                            abilities: [
                                namedSelfBuff('Hit Mitigation', 99),
                                shieldConverterSelfBuff(),
                                noopDamage(),
                            ],
                        },
                    ],
                    { chargeCount: 99, startCharged: true }
                ),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { genericTicks, result } = collectFor(input, 'holder');

        // Hit 1 (round 1): Hit Mitigation's guard is checked first (chained `else if`), so it
        // wins — the hit becomes a 3-round self-DoT, NOT a Shield conversion.
        expect(result.rounds[0].perActorShield?.['holder']?.pool ?? 0).toBe(0);
        expect(result.rounds[0].perActorIncoming?.['holder']?.convertedToShield ?? 0).toBe(0);
        // The self-DoT tick (round 2, since the holder ticks at its own turn start before that
        // round's hit) proves damage really did go down the Hit Mitigation path.
        expect(genericTicks.map((t) => t.round)).toEqual([2]);
        expect(genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / HIT_MITIGATION_ROUNDS, 6);

        // Hit 2 (round 2): Hit Mitigation was consumed by hit 1, so Shield Converter — untouched
        // by hit 1 — now reads and converts it.
        expect(result.rounds[1].perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[1].perActorShield?.['holder']?.pool).toBeCloseTo(DIRECT_HIT, 6);
    });
});

describe('Shield Converter survives hits it never actually converted', () => {
    it('a Barrier-nullified hit does NOT spend it', () => {
        // Granted once from the CHARGED slot alongside a 1-turn Barrier — the own-turn reprieve
        // covers round 1 (the sole slow enemy's hit lands inside it); by round 2 Barrier has
        // lapsed, so that hit is the one Shield Converter reads.
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [
                holderTeamActor(
                    'holder',
                    'M4',
                    [noopDamage()],
                    [
                        {
                            slot: 'charged',
                            abilities: [
                                shieldConverterSelfBuff(),
                                namedSelfBuff('Barrier', 1),
                                noopDamage(),
                            ],
                        },
                    ],
                    { chargeCount: 99, startCharged: true }
                ),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { result } = collectFor(input, 'holder');

        // Round 1: absorbed by Barrier, not converted.
        expect(result.rounds[0].perActorIncoming?.['holder']?.barrierAbsorbed).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[0].perActorShield?.['holder']?.pool ?? 0).toBe(0);
        expect(result.rounds[0].perActorIncoming?.['holder']?.convertedToShield ?? 0).toBe(0);

        // Round 2: Barrier has lapsed, and Shield Converter — never touched by round 1's
        // Barrier-nullified hit — converts this one instead.
        expect(result.rounds[1].perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[1].perActorShield?.['holder']?.pool).toBeCloseTo(DIRECT_HIT, 6);
    });

    it('a bomb/detonation portion does NOT spend it', () => {
        const BURST = 2000; // deliberately ≠ DIRECT_HIT so the two amounts are never confusable.
        const allAlliesShieldConverter = (): Ability => ({
            id: 'sc-allies',
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: SHIELD_CONVERTER,
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });
        const timedBomb = (damagePerStack: number, countdown: number): PendingBomb => ({
            countdown,
            damagePerStack,
            stacks: 1,
            tier: 100,
            sourceId: 'enemy-applier',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 0,
        });

        // The granting focus (speed 2000) acts first, so the block is up before the holder's own
        // burst; the holder (speed 1000) does NOT self-cast (that would re-arm nothing here, but
        // mirrors the production Oleander/Quixilver-ally shape); the enemy (speed 1) attacks last.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            speed: 2000,
            shipSkills: {
                slots: [{ slot: 'active', abilities: [allAlliesShieldConverter(), noopDamage()] }],
            },
            teamActors: [holderTeamActor('holder', 'M4', [noopDamage()])],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            __testTapActors: (actors: CombatActor[]) => {
                // countdown 1 → bursts at the START of the holder's round-1 turn, after the focus
                // has already granted the status and before the enemy's attack lands.
                actors.find((a) => a.id === 'holder')?.pendingBombs.push(timedBomb(BURST, 1));
            },
        });
        const { hpChanges, result } = collectFor(input, 'holder');

        // The burst landed IN FULL — round 1's total HP loss is exactly BURST, not 0 (had the
        // burst itself been converted) and not BURST + DIRECT_HIT (had the enemy's hit landed
        // too, i.e. the status never got consumed at all).
        expect(hpLossForRound(hpChanges, 1, HP)).toBeCloseTo(BURST, 6);
        // The status survived the burst and was spent by the enemy's real hit instead: the shield
        // pool reads exactly DIRECT_HIT, not BURST + DIRECT_HIT (which it would if the burst had
        // ALSO been converted).
        expect(result.rounds[0].perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[0].perActorShield?.['holder']?.pool).toBeCloseTo(DIRECT_HIT, 6);
    });

    it('a DoT tick does NOT spend it', () => {
        const CORROSION_TICK = 0.03 * 500_000; // 3% of the corrosion base, capped at 500k.
        const allAlliesShieldConverter = (): Ability => ({
            id: 'sc-allies',
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: SHIELD_CONVERTER,
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

        // The focus (speed 3000, the applier AND the granter) acts before the holder (speed
        // 1000), so the corrosion tick lands from round 1 onward; the enemy (speed 1) attacks last.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            speed: 3000,
            position: 'M2',
            shipSkills: {
                slots: [{ slot: 'active', abilities: [allAlliesShieldConverter(), noopDamage()] }],
            },
            teamActors: [holderTeamActor('holder', 'M4', [noopDamage()])],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            __testTapActors: (actors: CombatActor[]) => {
                actors
                    .find((a) => a.id === 'holder')
                    ?.corrosionEntries.push({
                        stacks: 1,
                        tier: 3,
                        remainingRounds: 9, // outlives the run — only consumption can end anything here
                        sourceId: 'attacker', // the focus: has acted by the holder's turn, so it ticks
                    });
            },
        });
        const { hpChanges, result } = collectFor(input, 'holder');

        // The DoT landed IN FULL — round 1's total HP loss is exactly CORROSION_TICK, not 0 (had
        // the tick itself been converted) and not CORROSION_TICK + DIRECT_HIT (had the enemy's
        // hit landed too, i.e. the status never got consumed at all).
        expect(hpLossForRound(hpChanges, 1, HP)).toBeCloseTo(CORROSION_TICK, 6);
        // The status survived the tick and was spent by the enemy's real hit instead: the shield
        // pool reads exactly DIRECT_HIT, not CORROSION_TICK + DIRECT_HIT (which it would if the
        // tick had ALSO been converted).
        expect(result.rounds[0].perActorIncoming?.['holder']?.convertedToShield).toBeCloseTo(
            DIRECT_HIT,
            6
        );
        expect(result.rounds[0].perActorShield?.['holder']?.pool).toBeCloseTo(DIRECT_HIT, 6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Per-victim damage ACCOUNTING across a converted hit — the display channels, not the HP.
//
// `.incoming` is NOT reversed for a conversion (unlike Hit Mitigation's deferred DoT, which
// re-books later and must not double-count). So `incomingBooked` — what `emitHit` books into
// `perTargetDamage`/`perTargetDealt` — stays the FULL original hit, exactly as it does for a
// Barrier-nullified hit. The identity holds even though live HP never moved:
//
//     Σ perTargetDealt[attacker]  ==  Σ perTargetDamage  ==  Σ perActorIncoming[].incoming
//
// Positional (not the file's default non-positional shape) because `emitHit` — the site that
// books the victim's own row — exists only on the positional path; in non-positional mode the
// victim gets NO `perTargetDamage` entry at all, which would make a per-victim row assertion pass
// vacuously.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe('preserves the per-victim accounting identity across a converted hit (positional)', () => {
    it('sum(dealt) === sum(taken) === sum(incoming), all equal to the full original hit', () => {
        const input = BASE_PLAYER_SIDE({
            mode: 'battle',
            numRounds: 1,
            teamActors: [
                holderTeamActor(
                    'holder',
                    'M4',
                    [noopDamage()],
                    [{ slot: 'charged', abilities: [shieldConverterSelfBuff(), noopDamage()] }],
                    { chargeCount: 99, startCharged: true }
                ),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { result } = collectFor(input, 'holder');
        const r1 = result.rounds[0];

        const taken = r1.perTargetDamage ?? {};
        const dealt = r1.perTargetDealt?.['enemy-1'] ?? {};
        const incoming = r1.perActorIncoming ?? {};
        const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
        const incomingSum = sum(
            Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.incoming]))
        );

        // The hit still ARRIVED for accounting purposes, even though it did no HP damage.
        expect(sum(dealt)).toBeCloseTo(DIRECT_HIT, 6);
        expect(sum(taken)).toBeCloseTo(DIRECT_HIT, 6);
        expect(incomingSum).toBeCloseTo(DIRECT_HIT, 6);
        // And the three channels reconcile exactly, not just each hitting the same target value.
        expect(sum(dealt)).toBeCloseTo(sum(taken), 6);
        expect(sum(taken)).toBeCloseTo(incomingSum, 6);
    });
});
