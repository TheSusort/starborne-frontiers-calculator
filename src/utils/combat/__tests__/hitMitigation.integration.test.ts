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
 * verified working by transformIncomingToDot.test.ts's `tauntSelfBuff`. Three fixtures need a
 * different grant and say why in their own comments: the detonation and DoT-tick cases take it from
 * a faster ALLY (Oleander's real shape), because the block has to be armed before the holder's own
 * turn begins; the Barrier case takes it from the holder's own CHARGED slot, because that is the
 * only way to grant something ONCE — an active-slot cast re-arms every round, and there the point is
 * that a co-granted 1-turn Barrier must be allowed to lapse.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
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

/** The same shape as {@link hitMitigationSelfBuff} for the other named statuses these fixtures
 *  need — `Barrier` (full damage immunity while up, never consumed on hit: barrierBuffs.ts) and
 *  `Taunt` (what gates Orel's conditional transform below). */
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
 *  from elsewhere. `extraSlots` adds passive reactives or a one-shot `charged` grant — with a charged
 *  slot present, `charge` wires the cadence (`{ chargeCount: 99, startCharged: true }` fires it in
 *  round 1 and never again, since 99 more turns of cadence never accrue). `attack` stays 0 for every
 *  fixture except the counterattack one, whose counter damage is a percentage OF the owner's attack
 *  (a 0-attack counter computes 0 and never fires). All three default to the original
 *  single-active-slot, zero-attack shape, so every fixture written before they existed is unchanged. */
const holderTeamActor = (
    id: string,
    position: Position,
    abilities: Ability[] = [hitMitigationSelfBuff(), noopDamage()],
    extraSlots: ShipSkills['slots'] = [],
    charge: { chargeCount: number; startCharged: boolean } = {
        chargeCount: 0,
        startCharged: false,
    },
    attack = 0
): TeamActor =>
    ({
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
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: extraSlots.some((s) => s.slot === 'charged'),
        },
    }) as TeamActor;

/** `speed` stays 1 (slower than every holder above, so its hit lands after the block is armed) for
 *  every fixture except the bounce-back ones, where the holder IS this attacker and has to act
 *  BEFORE the player attacker that tests the spent block. */
const offensiveEnemy = (
    id: string,
    position: Position,
    abilities: Ability[] = [basicAttack()],
    speed = 1
): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed },
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

/** The round's Barrier-nullified total for one target — the channel that proves a hit was stopped
 *  by Barrier rather than converted (a conversion nets `incoming` back to 0 and leaves this at 0). */
function barrierAbsorbedFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    return entry.perActorIncoming?.[targetId]?.barrierAbsorbed ?? 0;
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

    it('is team-symmetric — an enemy holder blocks a player hit and spreads it identically', () => {
        // Holder on the ENEMY side, hit by the player focus attacker. Both halves of the player-side
        // behaviour are pinned here — the zero immediate loss (case 1) AND the resulting self-DoT
        // (case 2) — because an enemy-side block that converted nothing would satisfy the first half
        // on its own. No amount is compared ACROSS sides (RNG is keyed by ownerId): each side is
        // checked against its own expected value, DIRECT_HIT / ROUNDS, derived from its own attacker.
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
            // Two rounds so the round-1 conversion has a turn-start tick step to land on: the holder
            // (speed 1000) ticks before the slow focus (speed 1) attacks, so round 1 shows no tick
            // and round 2 shows exactly the round-1 stack.
            numRounds: 2,
            attack: DIRECT_HIT, // the player focus now deals the hit
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
            speed: 1,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [enemyHolder()],
        });
        const { genericTicks, result } = collectFor(input, 'holder');
        expect(simHpLossFor(result, 1, 'holder')).toBe(0);
        expect(genericTicks.map((t) => t.round)).toEqual([2]);
        expect(genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
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
// A hit a transform converts leaves the victim's `Exposed` ARMED.
//
// OWNER RULING (2026-08-03). One premise governs the whole funnel: a hit whose full amount became a
// DoT landed NOTHING AT THAT INSTANT. That is already why the engine suppresses such a hit's
// `attacked` signal (`fullyTransformedToDot`), and Exposed's consumption reads the same value the
// same way — "removed after taking direct damage" is not satisfied by a hit that took none. So a
// transform (Hit Mitigation, or the ability-based Voron/Orel step) leaves Exposed armed for the next
// real hit, exactly as a Barrier-nullified hit does.
//
// ACCEPTED CONSEQUENCE, pinned by both assertions below rather than hidden: the amplification is
// folded in UPSTREAM of the damage funnel, so the converted DoT carries the +100% AND Exposed
// survives — the +100% is banked twice. The owner accepted this deliberately; making it once-only
// would mean converting the unamplified amount, which contradicts what a deferral is.
//
// Fixture: one enemy that casts `statusName` on the holder and then attacks it TWICE in the same
// cast. Hit 1 is amplified and blocked, so the resulting DoT ticks at double; hit 2 must then land
// STILL amplified. A control run plants an unmodelled status name down the identical path, so every
// comparison isolates the 'Exposed' name and nothing else about the fixture.
// =============================================================================

describe('Exposed survives the hit Hit Mitigation converts', () => {
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

    it('the converted DoT carries the amplification, and the attack’s second hit is still amplified', () => {
        // Premise: the control run is the plain one-shot case — hit 1 blocked into a DIRECT_HIT/3
        // tick, hit 2 landing in full.
        const control = runWith('Inert Marker');
        expect(control.firstTick).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
        expect(control.round1HpLoss).toBeCloseTo(DIRECT_HIT, 6);

        const exposed = runWith('Exposed');
        // The amount converted was the AMPLIFIED one — twice the control's per-tick damage.
        expect(exposed.firstTick).toBeCloseTo((2 * DIRECT_HIT) / ROUNDS, 6);
        // And the status was NOT spent by that converted hit, so hit 2 is amplified too: twice the
        // control's landed amount. This is the assertion that pins the ruling — if the guard were
        // flipped to consume on a transformed hit, hit 2 would land at the control's amount instead.
        expect(exposed.round1HpLoss).toBeCloseTo(2 * control.round1HpLoss, 6);
    });
});

// =============================================================================
// The one-shot must SURVIVE hits it never actually blocked. Regression locks, not red tests: the
// guard already encodes all three rules, and each case below was verified non-vacuous by breaking
// the clause (or, once, the clause PAIR) it covers and watching it fail — see the per-case notes.
//
// The three not-consumed cases the guard's five clauses spell out, and where each is pinned:
//   `!carriesBarrier`                        → 'survives a Barrier-nullified hit', below.
//   `damage > 0` + `transformedToDot === 0`  → 'survives a hit the ability transform already
//                                              converted', below (jointly — see its closing note).
//   `byDirectDamage`                         → 'is not consumed by a DoT tick', below.
//   `bombPortion === 0`                      → 'a detonation neither converts nor consumes Hit
//                                              Mitigation', above.
// The remaining not-consumed rule — a hit fully converted BY Hit Mitigation itself does not spend
// the victim's Exposed — is the owner-ruling block above.
// =============================================================================

describe('Hit Mitigation is not spent by hits it never blocked', () => {
    it('survives a Barrier-nullified hit and blocks a later one instead', () => {
        // Barrier grants full damage immunity while it is up and is NOT consumed by the hit it
        // stops (barrierBuffs.ts), so a Barrier-nullified hit reaches the funnel with nothing left
        // to block — spending the one-shot on it would waste it.
        //
        // Getting Barrier to LAPSE is what this fixture is built around: a status re-cast from the
        // active slot every round can never expire, so the grant comes from the holder's CHARGED
        // slot with `startCharged` + `chargeCount: 99` — it fires once, in round 1, and the 99
        // turns of cadence needed to recharge never accrue. One cast arms both the 99-turn Hit
        // Mitigation and a 1-turn Barrier. Duration 1 is enough to cover round 1 because a buff
        // applied on the holder's OWN turn gets the own-turn reprieve (it survives until that
        // actor's next turn), and the sole enemy is far slower, so its round-1 attack still lands
        // inside the reprieve; by its round-2 attack the Barrier has lapsed.
        //
        // So: round 1's hit is Barrier-nullified, round 2's hit is the one the surviving block
        // converts, and that single 3-round DoT ticks at the holder's turn start in rounds 3-5.
        const input = BASE_PLAYER_SIDE({
            numRounds: 5,
            teamActors: [
                holderTeamActor(
                    'holder',
                    'M4',
                    [noopDamage()],
                    [
                        {
                            slot: 'charged',
                            abilities: [
                                hitMitigationSelfBuff(),
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
        const { genericTicks, result } = collectFor(input, 'holder');

        // Round 1's hit was ABSORBED, not converted: a conversion nets `incoming` back to 0 and
        // never touches barrierAbsorbed, so a non-zero barrierAbsorbed is the discriminator.
        expect(barrierAbsorbedFor(result, 1, 'holder')).toBeCloseTo(DIRECT_HIT, 6);

        // The tick ROUNDS are what pin non-consumption. The block survived round 1 and was spent on
        // round 2's hit, so its 3-round DoT ticks in 3, 4, 5. Break `!carriesBarrier` out of the
        // guard and round 1's hit converts instead: barrierAbsorbed drops to 0 and the ticks move
        // to 2, 3, 4 — both assertions fail.
        expect(genericTicks.map((t) => t.round)).toEqual([3, 4, 5]);
        // Exactly ONE stack all three rounds — one conversion total, from one unblocked hit.
        genericTicks.forEach((t) => expect(t.damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6));
    });

    it('survives a hit the ability transform already converted', () => {
        // Orel's `transform-incoming-to-dot` runs one step earlier in the funnel and zeroes the hit
        // when it fires, so there is nothing left for Hit Mitigation to block — and the block must
        // stay armed for a hit the transform does NOT eat. Orel's condition
        // ('attacker-taunted-or-provoke') is what makes both outcomes observable in a single round:
        // the taunted enemy's hit is transformed, the plain enemy's hit is not.
        //
        // Round 1: the holder (speed 1000) arms the status, then both enemies (speed 1) hit it. One
        // hit is transformed, the other is blocked → TWO conversions, so nothing lands and round 2
        // ticks at two stacks. If the transformed hit had spent the block, the plain enemy's hit
        // would land in full and round 2 would tick at one — which is exactly the control run's
        // signature, so the control is not just a sanity check but the precise failure shape.
        const orelTransform = (): Ability => ({
            id: 'orel-transform',
            type: 'transform-incoming-to-dot',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'transform-incoming-to-dot',
                turns: ROUNDS,
                condition: 'attacker-taunted-or-provoke',
            },
        });
        /** `taunted` decides whether the first enemy self-applies the Taunt that opens the
         *  transform's gate — the ONLY difference between the two runs. */
        const runWith = (taunted: boolean) => {
            const first = taunted ? [namedSelfBuff('Taunt', 99), basicAttack()] : [basicAttack()];
            const input = BASE_PLAYER_SIDE({
                numRounds: 2,
                teamActors: [
                    holderTeamActor(
                        'holder',
                        'M4',
                        [hitMitigationSelfBuff(), noopDamage()],
                        [{ slot: 'passive', abilities: [orelTransform()] }]
                    ),
                ],
                enemyAttackers: [
                    offensiveEnemy('taunter', 'M1', first),
                    offensiveEnemy('plain', 'M2', [basicAttack()]),
                ],
            });
            const { genericTicks, result } = collectFor(input, 'holder');
            return { genericTicks, round1HpLoss: simHpLossFor(result, 1, 'holder') };
        };

        // Control — the transform's gate stays shut, so this is the plain one-shot case: one of the
        // two hits is blocked, the other lands, and round 2 ticks at a single stack.
        const control = runWith(false);
        expect(control.round1HpLoss).toBeCloseTo(DIRECT_HIT, 6);
        expect(control.genericTicks.map((t) => t.round)).toEqual([2]);
        expect(control.genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);

        const withTransform = runWith(true);
        // Both hits were converted, so NOTHING landed in round 1 — the transform ate one and the
        // still-armed block ate the other.
        expect(withTransform.round1HpLoss).toBe(0);
        // Two stacks ticking together: 2 × DIRECT_HIT / ROUNDS, twice the control's tick.
        expect(withTransform.genericTicks.map((t) => t.round)).toEqual([2]);
        expect(withTransform.genericTicks[0].damage).toBeCloseTo((2 * DIRECT_HIT) / ROUNDS, 6);

        // NOTE on which clauses this locks. `damage > 0` and `transformedToDot === 0` are JOINTLY
        // load-bearing and individually redundant: the transform zeroes `damage` on the very path
        // that sets `transformedToDot`, so either clause alone already rejects the hit. Verified —
        // removing `transformedToDot === 0` alone changes nothing, loosening `damage > 0` to
        // `damage >= 0` alone changes nothing, and doing BOTH makes this case fail with round 1's
        // loss reading DIRECT_HIT instead of 0 (the transformed hit converts 0, spends the block,
        // and the plain enemy's hit lands) — i.e. it collapses exactly onto the control's values.
        // The redundancy is deliberate defence, not the thing under test.
    });

    it('is not consumed by a DoT tick — a later direct hit is still blocked', () => {
        // The block is DIRECT-intake only. A DoT-tick batch reaches the same funnel, but as
        // `{ byDirectDamage: false }` (an aggregate of appliers with no single killer), and a tick
        // must never be re-transformed into another DoT — nor spend a block meant for a real hit.
        //
        // Fixture: a corrosion stack is seeded straight onto the holder, and the FOCUS actor is the
        // applier — corrosion only ticks for an applier that has already taken a turn this run, and
        // the focus (speed 3000) acts before the holder (speed 1000), so the tick lands from round 1
        // onward. The focus is also the granter, Oleander-style, so each round runs the full
        // sequence: arm the block, tick the corrosion (must not spend it), then take the slow
        // enemy's hit (must be blocked). Corrosion ticks for 3% of the holder's HP capped at the
        // 500k corrosion base = 15000, deliberately unlike DIRECT_HIT so the two are never
        // confusable.
        const CORROSION_TICK = 0.03 * 500_000;
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            speed: 3000,
            position: 'M2',
            shipSkills: {
                slots: [{ slot: 'active', abilities: [allAlliesHitMitigation(), noopDamage()] }],
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
        const { genericTicks, result } = collectFor(input, 'holder');

        // The tick landed in FULL — it was not converted away. (A conversion would net the round's
        // incoming to 0 and let the enemy's DIRECT_HIT through instead, reading 5000 here.)
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(CORROSION_TICK, 6);
        // And the block was still there for the enemy's hit: the ONE generic DoT in the run ticks at
        // DIRECT_HIT / ROUNDS, so it came from the attack. Drop `byDirectDamage === true` from the
        // guard and the round-1 tick converts and consumes instead: this reads CORROSION_TICK /
        // ROUNDS and the assertion above reads DIRECT_HIT — both fail.
        expect(genericTicks.map((t) => t.round)).toEqual([2]);
        expect(genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
    });
});

// =============================================================================
// A Protection-REDIRECTED chunk DOES read the block: it converts, and it SPENDS.
//
// This is the deliberate divergence from `Exposed`'s consumption guard, which excludes reflected,
// countered and Protection-transferred hits explicitly. All three of those reach the Hit Mitigation
// guard stamped `byDirectDamage: true, bombPortion: 0`, so the guard's silence about them is a
// RULE, not an oversight: they are real incoming direct damage on this victim and the text is
// "blocks the next direct hit". Exposed excludes them because none of the three folds the
// per-victim incoming-AMPLIFICATION channel it rides — a reason with no analogue for a block.
//
// Without a fixture the rule lives only in a comment, and the obvious next move for a future author
// is to make the two guards match — adding `!cause.isProtectionTransfer` (and its two siblings)
// breaks nothing else in the suite. This case, and the two bounce-back cases below it, are what
// break: one leg per excluded flag.
//
// The Protection leg is the one worth pinning: Oleander grants Hit Mitigation to ALL allies, so its
// own protectors hold the block, and a redirected chunk landing on one of them is the everyday
// case. It also exercises the transfer block's `intakeTotal` accounting note: a converted sub-hit
// contributes 0 instant damage, so the protector is credited nothing and NO
// `reactive-damage-performed` is emitted for it that round — asserted below rather than assumed.
//
// Fixture: a victim and a protector, both player team actors. The protector holds one Protection
// stack (10%/stack) granted the production way — an AURA ability status, which is what a real
// Meatshield's start-of-combat grant parses to — plus ONE Hit Mitigation, armed from its CHARGED
// slot (`startCharged` + `chargeCount: 99`, the same one-shot trick the Barrier case uses; an
// active-slot re-cast every round would re-arm the block and hide the consumption). The single slow
// enemy hits the victim once per round, so round 1's chunk is converted and round 2's chunk — same
// hit, same redirect — must land in full.
// =============================================================================

/** One Protection stack on the holder, granted the PRODUCTION way: an aura ability status (a buff
 *  config with NO duration + isStackable), the classification a real Meatshield's start-of-combat
 *  "gains N stacks of Protection" passive parses to. `protectorsFor` aggregates it via
 *  `selfBuffStacksForOwner`, which reads the aura channel `snapshot().activeSelfBuffs` misses. */
const protectionAuraPassive = (stacks: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'protection-aura',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Protection',
                parsedEffects: {},
                stacks,
                isStackable: true,
            },
        },
    ],
});

/** Rounds in which a `reactive-damage-performed` — the transfer block's instant-damage emission —
 *  named `targetId` as the recipient; one entry per emission. */
function redirectEmissionRoundsFor(input: CombatEngineInput, targetId: string): number[] {
    const bus = createEventBus();
    const rounds: number[] = [];
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.targetId === targetId) rounds.push(e.round);
        }
    );
    runCombat({ ...input, bus });
    return rounds;
}

describe('a Protection-redirected chunk is blocked by the protector’s Hit Mitigation', () => {
    const PROT_STACKS = 1;
    const CHUNK = 0.1 * PROT_STACKS * DIRECT_HIT; // 10%/stack, defence 0 both sides → mit 1.

    const protectionFixture = (): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            // 4 rounds: the round-1 conversion's 3-round DoT ticks in 2, 3, 4.
            numRounds: 4,
            teamActors: [
                // The victim of the enemy's hit — no Hit Mitigation of its own, front-most so the
                // enemy's 'front' selection binds to it and not to the protector.
                holderTeamActor('victim', 'M4', [noopDamage()]),
                holderTeamActor(
                    'protector',
                    'M1',
                    [noopDamage()],
                    [
                        protectionAuraPassive(PROT_STACKS),
                        { slot: 'charged', abilities: [hitMitigationSelfBuff(), noopDamage()] },
                    ],
                    { chargeCount: 99, startCharged: true }
                ),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });

    it('converts the chunk, then is gone for the next round’s chunk', () => {
        const input = protectionFixture();
        const { genericTicks, result } = collectFor(input, 'protector');

        // The redirect happened at all: the victim keeps only the non-transferred remainder.
        expect(simHpLossFor(result, 1, 'victim')).toBeCloseTo(DIRECT_HIT - CHUNK, 6);

        // The protector's chunk drained nothing that round — it was converted. THIS is the
        // assertion that fails the moment `!cause.isProtectionTransfer` joins the guard: the chunk
        // would land instead and read CHUNK here.
        expect(simHpLossFor(result, 1, 'protector')).toBe(0);

        // One conversion, spread over exactly ROUNDS rounds at chunk/ROUNDS. The FLAT profile is
        // what pins consumption: rounds 2, 3 and 4 each deliver one stack's worth, so the round-2
        // chunk produced no second stack. Had the redirect left the block armed, every round's
        // chunk would convert and the amount would climb 1, 2, 3 stacks instead.
        expect(genericTicks.map((t) => t.round)).toEqual([2, 3, 4]);
        genericTicks.forEach((t) => expect(t.damage).toBeCloseTo(CHUNK / ROUNDS, 6));

        // And the same redirect one round later lands in full, on top of that round's single tick:
        // the block is spent, so nothing stops it.
        expect(simHpLossFor(result, 2, 'protector')).toBeCloseTo(CHUNK + CHUNK / ROUNDS, 6);
    });

    it('credits the protector no instant damage for the converted chunk', () => {
        // The transfer block sums `incomingBooked` per protector sub-hit and suppresses the
        // emission below 1e-9 — exactly so a sub-hit the protector's own block converted is not
        // booked as damage taken (the conversion reverses the intake it recorded). A fully-converted round therefore emits NOTHING for the
        // protector, and the rounds that follow — chunks landing with the block spent — each emit
        // once. (An emission in round 1 would mean the converted chunk was double-counted: deferred
        // into the DoT and credited as instant.)
        expect(redirectEmissionRoundsFor(protectionFixture(), 'protector')).toEqual([2, 3, 4]);
    });
});

// =============================================================================
// The other two legs of the same rule: a REFLECTED and a COUNTERED hit read the block too.
//
// Both bounce back onto the ORIGINAL ATTACKER, so the HOLDER here is the ENEMY attacker: it arms Hit
// Mitigation on itself and then attacks the reactive's owner (clauses resolve in written order, so
// the self-buff is up before its own hit lands). The bounce comes straight back at it, inside its
// own turn — and a SLOW player focus then attacks it later in the same round, which is what makes
// consumption observable: with the block spent on the bounce, the focus's hit must land in full.
//
// Two amounts, deliberately unequal, split the two questions:
//   the DoT ticks at BOUNCE / ROUNDS  → the bounce is what got CONVERTED;
//   the round-1 intake reads FOCUS_HIT → the follow-up hit was NOT blocked, so the bounce SPENT it.
// Add `!cause.isReflected` / `!cause.isCounter` to the guard and the two swap places: the bounce
// lands (intake reads BOUNCE) and the focus's hit is converted instead (ticks at FOCUS_HIT / ROUNDS)
// — both assertions fail, in both legs.
//
// Why the follow-up hit rather than a second bounce in the same turn: a counterattack fires at most
// once per SUB-ATTACK (`counterFiredThisTurn`, keyed with the sub-attack index since the multi-hit
// epic's PR6), so the per-HIT fan-out of a single attack still draws only one counter. A reflect
// does bounce per hit, but pinning both legs the same way keeps them comparable. (Before PR6 this
// read "once per attacking turn", which would have made a `hits: 2` cast draw one counter too —
// this fixture is single-hit either way, so the correction is to the reasoning, not the fixture.)
//
// `perActorIncoming` is the primary channel here (the conversion nets it back out) — but
// `perTargetDamage`, which `simHpLossFor` falls back to when a round leaves no `perActorIncoming`
// bucket for the actor, now agrees: both reactive paths book the intake the funnel RECORDED
// (`incomingBooked`), so neither display channel reads a bounce that never landed. The two `does
// not book a converted …` cases at the bottom of this block are what pin that.
// =============================================================================

/** The Reflect gear set's shape (mirrored from protectionTransfer.integration.test.ts): the engine
 *  keys on `config.type: 'damage-reflection'`, not on the placeholder top-level type. */
const reflectPassive = (pct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'reflect-thorns',
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage-reflection', pct },
        },
    ],
});

/** A Stalwart-shaped counterattack, minus its `requirePrimaryTarget` gate (nothing here is a
 *  splash victim). Counter damage is `multiplier`% of the OWNER's effective attack. */
const counterPassive = (multiplier: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'counter',
            type: 'counter',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            config: { type: 'counter', multiplier },
        },
    ],
});

describe('a bounced-back hit is blocked by the attacker’s own Hit Mitigation', () => {
    const FOCUS_HIT = 7000; // the follow-up hit — ≠ DIRECT_HIT and ≠ either bounce below.

    /** The holder is the ENEMY attacker: fast (speed 1000, so it acts before the focus), it arms the
     *  block on itself and then hits `reactive`'s owner once. `reactive` is the passive that bounces
     *  damage back at it; `reactiveOwnerAttack` feeds a counter's percentage-of-attack basis. */
    const bounceFixture = (
        reactive: ShipSkills['slots'][number],
        reactiveOwnerAttack = 0
    ): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            numRounds: 2,
            // The player focus is the FOLLOW-UP attacker, and deliberately the slowest actor on the
            // board so its hit lands after the bounce has already spent the block.
            attack: FOCUS_HIT,
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
            speed: 1,
            position: 'M2',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [
                // M4 is front-most, so the holder's 'front' selection binds to the reactive's owner
                // rather than to the focus at M2.
                holderTeamActor(
                    'reactor',
                    'M4',
                    [noopDamage()],
                    [reactive],
                    { chargeCount: 0, startCharged: false },
                    reactiveOwnerAttack
                ),
            ],
            enemyAttackers: [
                offensiveEnemy('holder', 'M1', [hitMitigationSelfBuff(), basicAttack()], 1000),
            ],
        });

    /** The bounce was converted (the DoT ticks at BOUNCE / ROUNDS) and the block was gone by the
     *  time the focus's follow-up hit arrived (round 1's intake is the whole FOCUS_HIT). */
    const expectBounceConvertedAndSpent = (input: CombatEngineInput, bounce: number) => {
        const { genericTicks, result } = collectFor(input, 'holder');
        expect(simHpLossFor(result, 1, 'holder')).toBeCloseTo(FOCUS_HIT, 6);
        expect(genericTicks.map((t) => t.round)).toEqual([2]);
        expect(genericTicks[0].damage).toBeCloseTo(bounce / ROUNDS, 6);
    };

    /** The DISPLAY-channel half of the same rule: a converted bounce is booked into NEITHER
     *  accounting channel this round. Both are per-round maps the battle simulator reads directly —
     *  `perTargetDamage` → the victim's `damageTaken` (and its HP curve, whenever the round leaves no
     *  `perActorIncoming` bucket for that actor to prefer), `perTargetDealt` → the bouncer's
     *  `damageDealt` — and the converted amount arrives LATER as DoT ticks, each booking its own
     *  increment into both. Booking the bounce here as well would count it twice.
     *
     *  Round 1's only honest entry for the holder is therefore the focus's follow-up hit, which
     *  landed in full; the bouncer dealt nothing (the DoT is credited to the holder itself, per
     *  `convertHitToSelfDot`'s `sourceId: victim.id`). Asserted on the exact round-1 numbers rather
     *  than "less than" so an over-correction that drops the follow-up hit fails too. */
    const expectBounceNotBooked = (input: CombatEngineInput) => {
        const { result } = collectFor(input, 'holder');
        const r1 = result.rounds.find((r) => r.round === 1)!;
        expect(r1.perTargetDamage?.['holder'] ?? 0).toBeCloseTo(FOCUS_HIT, 6);
        expect(r1.perTargetDealt?.['reactor']?.['holder'] ?? 0).toBeCloseTo(0, 6);
    };

    it('a REFLECTED hit converts and spends it', () => {
        const REFLECT_PCT = 40;
        // reflectedDamageForHit: pct% × netHpDamage — and with the holder's defence 0, neutral
        // affinity on both sides and no incoming-reduction ability, no other factor applies.
        expectBounceConvertedAndSpent(
            bounceFixture(reflectPassive(REFLECT_PCT)),
            (REFLECT_PCT / 100) * DIRECT_HIT
        );
    });

    it('a COUNTERED hit converts and spends it', () => {
        const COUNTER_ATTACK = 3000;
        // multiplier 100% of the OWNER's attack, mitigated by the holder's defence (0), crit 0 on
        // both sides → the counter is worth exactly the owner's attack.
        expectBounceConvertedAndSpent(
            bounceFixture(counterPassive(100), COUNTER_ATTACK),
            COUNTER_ATTACK
        );
    });

    it('does not book a converted REFLECT into damage-taken / damage-dealt', () => {
        expectBounceNotBooked(bounceFixture(reflectPassive(40)));
    });

    it('does not book a converted COUNTER into damage-taken / damage-dealt', () => {
        expectBounceNotBooked(bounceFixture(counterPassive(100), 3000));
    });
});
