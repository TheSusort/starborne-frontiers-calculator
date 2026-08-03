/**
 * `Hit Mitigation` blocks the next direct hit and spreads it over the HOLDER as a 3-round
 * self-DoT. Oleander grants it to all allies for 3 turns; it built as a name-only buff (empty
 * parsedEffects) so nothing read it.
 *
 * Name-keyed rather than a parsedEffects entry: a one-shot block has no honest standing value,
 * so routing it through an incoming channel would leak permanent damage immunity into
 * effective-HP and the DPS aggregate — the same reasoning that made Exposed name-keyed.
 *
 * Harness mirrors transformIncomingToDot.test.ts: the victim's speed is far higher than the
 * attacker's so its own turn-start DoT tick runs BEFORE that round's incoming hit, keeping
 * "0 immediate damage this hit" and "the tick lands next turn" cleanly separated.
 *
 * The status is self-cast from the victim's ACTIVE slot, not its passive slot: a passive-slot
 * `on-cast` self-buff does not reliably apply in this engine, whereas the active-slot pattern is
 * verified working by transformIncomingToDot.test.ts's `tauntSelfBuff`. The one exception is the
 * detonation fixture at the bottom, which takes the grant from a faster ALLY (Oleander's real
 * shape) because the block has to be armed before the holder's own turn begins — see its comment.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.
const ROUNDS = 3; // Hit Mitigation's DoT spread, per its buff description.

const hitMitigationSelfBuff = (): Ability => ({
    id: 'hit-mitigation',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Hit Mitigation',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99, // long enough that expiry never confounds one-shot consumption
    },
});

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
/** `hits` separate applications of attack × 100% each — the funnel sees one hit per application. */
const basicAttack = (hits = 1): Ability => ({
    id: `basic-${++atkCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits },
});

/** Nayra's shape (see exposedStatus.integration.test.ts): a plain on-cast enemy debuff, applied
 *  by the caster before its own attack in the same cast resolves. `application: 'apply'` always
 *  lands, isolating the behaviour under test from the landing roll. */
const castStatus = (buffName: string): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 5, // long enough that only consumption — never expiry — can end it
        application: 'apply',
    },
});

/** The Hit Mitigation holder: fast (acts first, so the buff is up), never deals real damage.
 *  `abilities` defaults to self-casting the status; pass a list without it when the grant must come
 *  from elsewhere. */
const holderTeamActor = (
    id: string,
    position: Position,
    abilities: Ability[] = [hitMitigationSelfBuff(), noopDamage()]
): TeamActor =>
    ({
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities }] },
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
            hasChargedSkill: false,
        },
    }) as TeamActor;

const offensiveEnemy = (
    id: string,
    position: Position,
    abilities: Ability[] = [basicAttack()]
): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities }] },
    }) as EnemyAttacker;

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
    enemyDefense: 0,
    enemyHp: HP,
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
    ...overrides,
});

/** Collects hp-changed and generic dot-ticked events for one target. */
function collectFor(input: CombatEngineInput, targetId: string) {
    const bus = createEventBus();
    const hpChanges: { round: number; oldPct: number; newPct: number }[] = [];
    const genericTicks: { round: number; damage: number }[] = [];
    bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
        if (e.targetId === targetId)
            hpChanges.push({ round: e.round, oldPct: e.oldPct, newPct: e.newPct });
    });
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === targetId && e.dotType === 'generic')
            genericTicks.push({ round: e.round, damage: e.damage });
    });
    const result = runCombat({ ...input, bus });
    return { hpChanges, genericTicks, result };
}

/** battleSimulator's `incomingHpThisRound` derivation, verbatim, for one round/target. */
function simHpLossFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    const taken = entry.perTargetDamage?.[targetId] ?? 0;
    const inc = entry.perActorIncoming?.[targetId];
    return inc ? Math.max(0, inc.incoming - inc.shieldAbsorbed - inc.barrierAbsorbed) : taken;
}

describe('Hit Mitigation blocks the next direct hit and spreads it as a self-DoT', () => {
    it('the blocked hit drains no HP immediately — the sim HP derivation nets to 0 that round', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { result } = collectFor(input, 'holder');
        expect(simHpLossFor(result, 1, 'holder')).toBe(0); // pre-fix: DIRECT_HIT
    });

    it('creates a generic self-DoT ticking at DIRECT_HIT / 3', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { genericTicks } = collectFor(input, 'holder');
        expect(genericTicks.length).toBeGreaterThanOrEqual(1);
        expect(genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
    });

    it('spreads the hit over exactly ROUNDS rounds — the plateau, not just the divisor', () => {
        // The divisor alone (the case above) does not pin the DoT's LIFETIME: a 5-round entry
        // ticking DIRECT_HIT/3 would satisfy it. This does. The holder re-casts Hit Mitigation from
        // its active slot each round, so every round's hit is blocked and adds one stack, and
        // generic ticks emit ONE aggregated event per tick step — so the per-round amount, in units
        // of DIRECT_HIT/ROUNDS, counts the stacks alive that round. It climbs 1, 2, 3 and then
        // PLATEAUS at 3: the round-1 stack retires after its third tick exactly as the fourth stack
        // arrives. A longer spread at the same divisor would keep climbing (1, 2, 3, 4, 5).
        const input = BASE_PLAYER_SIDE({
            numRounds: 6,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { genericTicks } = collectFor(input, 'holder');
        expect(genericTicks.map((t) => t.round)).toEqual([2, 3, 4, 5, 6]);
        const expectedUnits = [1, 2, 3, 3, 3];
        genericTicks.forEach((t, i) => {
            expect(t.damage / (DIRECT_HIT / ROUNDS)).toBeCloseTo(expectedUnits[i], 6);
        });
    });

    it('is ONE-SHOT — a second attacker in the same round lands at full strength', () => {
        // Two attackers, both hitting the holder. Exactly one hit is blocked, so total HP lost
        // must equal the generic-tick damage PLUS one unblocked DIRECT_HIT.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1'), offensiveEnemy('enemy-2', 'M2')],
        });
        const { hpChanges, genericTicks } = collectFor(input, 'holder');
        const totalHpLost = hpChanges.reduce(
            (sum, c) => sum + ((c.oldPct - c.newPct) / 100) * HP,
            0
        );
        const totalTicks = genericTicks.reduce((sum, t) => sum + t.damage, 0);
        expect(totalHpLost - totalTicks).toBeCloseTo(DIRECT_HIT, 4);
    });

    it('is team-symmetric — an enemy holder blocks a player hit identically', () => {
        // Holder on the ENEMY side, hit by the player focus attacker. Same invariant as case 1;
        // amounts are NOT compared across sides (RNG is keyed by ownerId).
        const enemyHolder = (): EnemyAttacker =>
            ({
                id: 'holder',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
                chargeCount: 0,
                startCharged: false,
                position: 'M4' as Position,
                target: parsedTarget('front'),
                pattern: basePattern(),
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [hitMitigationSelfBuff(), noopDamage()] }],
                },
            }) as EnemyAttacker;

        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            attack: DIRECT_HIT, // the player focus now deals the hit
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
            speed: 1,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [enemyHolder()],
        });
        const { result } = collectFor(input, 'holder');
        expect(simHpLossFor(result, 1, 'holder')).toBe(0);
    });
});

// =============================================================================
// A manually SELECTED Hit Mitigation is INERT — it must not block anything.
//
// The calculator's buff picker offers every entry in constants/buffs.ts, `Hit Mitigation` included,
// and emits a SelectedGameBuff with no skillSource and no skillDuration — which the status engine
// classifies as ALWAYS-ACTIVE and re-injects into every `snapshot('attacker')` as
// `turnsRemaining: 'recurring'`. Nothing owns that entry in a per-actor map, so
// `removeSelfBuffByName` can never delete it: a read that saw the scheduled channel made the block
// permanent, converting every direct hit for the whole battle and — since each conversion reports
// `transformedToDot > 0` — suppressing the holder's `attacked` signal along with it, silently
// disabling its on-attacked reactives.
//
// A one-shot has no honest always-active rendering, so the read is narrowed to the channel the
// removal can spend and the manual selection goes quiet instead. Fixture: the FOCUS actor (ownerId
// 'attacker' — the only owner the always-active list is injected for) carries the picker's exact
// shape and is attacked once.
// =============================================================================

const manualSelection = (buffName: string) => ({
    id: buffName,
    buffName,
    stacks: 1,
    parsedEffects: {},
    isStackable: false,
});

describe('a scheduled always-active Hit Mitigation is inert', () => {
    it('the hit lands in full and no self-DoT is created', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            speed: 1000, // the focus acts first, exactly as the holder does in the cases above
            position: 'M4',
            selfBuffs: [manualSelection('Hit Mitigation')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { genericTicks, result } = collectFor(input, 'attacker');

        // Pre-fix: 0 — the unspendable block converted the hit away.
        expect(simHpLossFor(result, 1, 'attacker')).toBeCloseTo(DIRECT_HIT, 6);
        // Round 2's hit is blocked just as little as round 1's, so no generic DoT ever exists.
        expect(simHpLossFor(result, 2, 'attacker')).toBeCloseTo(DIRECT_HIT, 6);
        expect(genericTicks).toEqual([]);
    });
});

// =============================================================================
// A bomb burst is NOT a direct hit, so it neither converts nor spends the block.
//
// The funnel's own definition of a direct hit is `byDirectDamage === true && bombPortion === 0` —
// the threshold-shield check's `isDirect` and Exposed's consumption guard both spell it that way. A
// detonation arrives stamped `byDirectDamage: true` with the whole amount in `bombPortion`, so
// guarding on `byDirectDamage` alone would let a bomb burst convert AND consume a one-shot block,
// leaving the next real hit unprotected. Conversion and consumption live in the same branch, so
// this fixture pins both at once.
//
// Fixture (Oleander's real shape — the grant comes from an ALLY, not from the holder itself, which
// is what lets the block be armed BEFORE the holder's own turn-start burst): the focus actor is the
// fastest and grants Hit Mitigation to all allies; the holder then bursts a pre-seeded timed bomb at
// the start of its own turn; the slow enemy attacks it afterwards. The holder deliberately does NOT
// self-cast the status — a re-cast later in its own turn would re-arm the block and mask a burst
// that wrongly spent it.
// =============================================================================

const allAlliesHitMitigation = (): Ability => ({
    id: 'hm-allies',
    type: 'buff',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Hit Mitigation',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

/** Bursts for damagePerStack once `countdown` reaches 0 on the holder's own turn. */
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

describe('a detonation neither converts nor consumes Hit Mitigation', () => {
    const BURST = 2000; // deliberately ≠ DIRECT_HIT so the two amounts are never confusable.

    it('the burst lands in full and the block survives for the real hit that follows', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            speed: 2000, // the granting focus acts first, so the block is up before the burst
            shipSkills: {
                slots: [{ slot: 'active', abilities: [allAlliesHitMitigation(), noopDamage()] }],
            },
            teamActors: [holderTeamActor('holder', 'M4', [noopDamage()])],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            __testTapActors: (actors: CombatActor[]) => {
                // countdown 1 → bursts at the START of the holder's round-1 turn, after the focus
                // has already granted the block and before the enemy's attack lands.
                actors.find((a) => a.id === 'holder')?.pendingBombs.push(timedBomb(BURST, 1));
            },
        });
        const { genericTicks, result } = collectFor(input, 'holder');

        // Round 1 = the burst landing in full (the enemy's DIRECT_HIT was blocked, netting 0).
        // Pre-fix: DIRECT_HIT — the burst was converted away and took the block with it, so the
        // enemy's real hit landed instead.
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(BURST, 6);
        // And the DoT that exists came from the ATTACK, not the burst: DIRECT_HIT/3, not BURST/3.
        expect(genericTicks.map((t) => t.round)).toEqual([2]);
        expect(genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
    });
});

// =============================================================================
// A hit a transform converts still SPENDS the victim's `Exposed`.
//
// Exposed ("+100% incoming damage on the next direct hit, removed after taking direct damage") is
// amplified UPSTREAM of the damage funnel, so the amount a transform converts ALREADY carries the
// +100%. The governing distinction: a transform (Hit Mitigation, or the ability-based Voron/Orel
// step) merely DEFERS the hit — it still lands, spread over the DoT's rounds, carrying the
// amplification — whereas Barrier ANNIHILATES it. So a converted hit must consume Exposed, while a
// Barrier-nullified one must leave it armed. Leaving it armed here would bank the same +100% twice:
// once inside the DoT, again on the following hit.
//
// Fixture: one enemy that casts `statusName` on the holder and then attacks it TWICE in the same
// cast. Hit 1 is amplified and blocked, so the resulting DoT ticks at double; hit 2 must then land
// unamplified. A control run plants an unmodelled status name down the identical path, so every
// comparison isolates the 'Exposed' name and nothing else about the fixture.
// =============================================================================

describe('Exposed is spent by the hit Hit Mitigation converts', () => {
    function runWith(statusName: string) {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [
                offensiveEnemy('enemy-1', 'M1', [castStatus(statusName), basicAttack(2)]),
            ],
        });
        const { genericTicks, result } = collectFor(input, 'holder');
        return {
            // Round 2's aggregated tick — the round-1 stack alone (the holder ticks before that
            // round's hit creates the next one).
            firstTick: genericTicks[0].damage,
            round1HpLoss: simHpLossFor(result, 1, 'holder'),
        };
    }

    it('the DoT carries the amplification, and the attack’s second hit is no longer amplified', () => {
        // Premise: the control run is the plain one-shot case — hit 1 blocked into a DIRECT_HIT/3
        // tick, hit 2 landing in full.
        const control = runWith('Inert Marker');
        expect(control.firstTick).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
        expect(control.round1HpLoss).toBeCloseTo(DIRECT_HIT, 6);

        const exposed = runWith('Exposed');
        // The amount converted was the AMPLIFIED one — twice the control's per-tick damage.
        expect(exposed.firstTick).toBeCloseTo((2 * DIRECT_HIT) / ROUNDS, 6);
        // And it was PAID for: hit 2 lands at the control's amount. Pre-fix: 2 × DIRECT_HIT, the
        // amplification banked a second time because a fully converted hit did not consume Exposed.
        expect(exposed.round1HpLoss).toBeCloseTo(control.round1HpLoss, 6);
    });
});
