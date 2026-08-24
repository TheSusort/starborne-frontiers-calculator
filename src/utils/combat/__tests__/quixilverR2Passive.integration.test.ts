/**
 * Quixilver's R2 passive, end to end — the three axes of the Part B spec in one fixture.
 *
 * Skill text (docs/ship-skills.csv, Quixilver `second_passive_skill_text`, verbatim below): "At
 * the end of this Unit's turn if it has shield equal to 100% of its max HP, this Unit grants all
 * allies Barrier for 1 hit and applies Barrier Recharging for 3 turns."
 *
 * Every earlier test on this branch drives ONE of the pieces — the parser rows, the status
 * layer's `consumeStatusHit`, the lockout predicate, the recipient loop through `executeIntent`
 * directly. None of them puts the REAL parsed abilities through `runCombat`, so two things were
 * unverifiable until now and are the reason this file exists:
 *
 *   a. that the lockout gate actually SKIPS A GRANT in the live wiring, not just that its
 *      predicate returns true when poked in isolation; and
 *   b. that `Barrier Recharging` genuinely lands in the SELF-side status store — the store
 *      `holdsBarrierRecharging` reads. That store choice is inherited from the engine's
 *      pre-existing `hasBarrierRecharging` read and had never been checked against a live
 *      fixture. If the grant landed anywhere else the gate would silently never fire, and every
 *      isolated test above would still pass.
 *
 * Both are settled by case 3: the grant cadence is only R1/R4 if the recharge status the R1 grant
 * left behind is visible to the gate that suppresses R2 and R3.
 *
 * FIXTURE SHAPE. Positional (teamActors + positions + a positioned enemy roster): `emitHit` is
 * positional-only, so the legacy path folds a multi-hit attack into one damage multiplier and a
 * per-hit assertion there would be vacuous — a 1-hit Barrier would look like it blocked the whole
 * attack. Column 4 is the FRONT row, so Quixilver sits at M1 (back) and the enemy's `front`
 * targeting lands on the M4 ally: Quixilver is never hit, and its tapped shield pool therefore
 * stays exactly where the case put it. Modelled on hitCountedBarrier.integration.test.ts (same
 * feature, engine-level suite) and protectionTransfer.integration.test.ts (positional conventions).
 *
 * NARROWING — Quixilver's ACTIVE and CHARGE slots are deliberately replaced with a no-op. The real
 * active gains "Shield equal to 20% of the damage dealt" and its own damage scales off current
 * shield, so on the negative fixture (`shieldPool === maxHp - 1`) the caster's own turn would top
 * the pool straight back to the maxHp cap BEFORE the end-of-turn drain read it, and case 1's
 * negative arm would silently assert nothing. The passive slot is the REAL parsed one, whole — its
 * first clause (the 25%-of-damage-taken shield gain) is inert here because nothing ever hits
 * Quixilver.
 *
 * RNG: src/setupTests.ts already installs a fixed-seed keyed provider per test; the explicit pin
 * below restates it locally so this file does not silently depend on that global. Every stat block
 * carries crit 0 regardless, and nothing compares an amount ACROSS sides (the keyed stream is keyed
 * by owner id), so no assertion here rides on a rate-gate roll.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedTestRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { BARRIER_RECHARGING } from '../barrierRecharging';
import type { Ship } from '../../../types/ship';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

const RNG_SEED = 0x5eed1234;
beforeEach(() => setupKeyedTestRng(RNG_SEED));
afterEach(() => resetRateGateRng());

/** docs/ship-skills.csv, Quixilver, `second_passive_skill_text` — copied verbatim, tags and all.
 *  The tags matter: the parser's clause scoping reads them. */
const QUIXILVER_P2 =
    'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of the damage taken when taking HP damage and still having Shield.<br /><br />' +
    "At the end of this Unit's turn if it has shield equal to 100% of its max HP, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit and applies <unit-skill>Barrier Recharging</unit-skill> for 3 turns.";

/** The REAL parsed passive slot, straight off the registry — two refits so `getShipSkillRows`
 *  selects the R2 row (Quixilver has no R4 passive, so a fully refit ship resolves here too). */
function quixilverPassiveSlot(): ShipSkills['slots'][number] {
    const ship = { refits: [{}, {}], secondPassiveSkillText: QUIXILVER_P2 } as unknown as Ship;
    const slot = buildShipAbilities(ship).slots.find((s) => s.slot === 'passive');
    if (!slot) throw new Error('Quixilver R2 passive did not parse into a passive slot');
    return slot;
}

const HP = 10_000_000; // nothing dies; big enough that maxHp-1 is a hair-thin margin.
const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.

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
/** `hits` separate applications of attack × 100% each — one hit per application through the
 *  damage funnel, which is what a per-charge Barrier assertion needs. */
const basicAttack = (hits = 1): Ability => ({
    id: `qx-basic-${++atkCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits },
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** A plain ally: no offence, no passive, slower than Quixilver so it never acts before the grant. */
const ally = (id: string, position: Position): TeamActor => ({
    id,
    speed: 2,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
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
});

/** Slowest actor on the board, so its hits always land after Quixilver's end-of-turn grant. */
const offensiveEnemy = (abilities: Ability[]): EnemyAttacker => ({
    id: 'enemy-1',
    stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities }] },
});

/**
 * Quixilver as the FOCUS actor at M1 (back row), fastest on the board, carrying the real parsed
 * passive. `shieldPool` is tapped onto the live CombatActor before round 1 — nothing in the fixture
 * ever damages Quixilver, so whatever the tap sets is still there at every end-of-turn drain.
 */
const quixilverFixture = (opts: {
    shieldPool: number;
    numRounds: number;
    enemyAbilities?: Ability[];
}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    speed: 1000,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: {
        slots: [{ slot: 'active', abilities: [noopDamage()] }, quixilverPassiveSlot()],
    },
    numRounds: opts.numRounds,
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
    teamActors: [ally('ally-front', 'M4'), ally('ally-back', 'M3')],
    enemyAttackers: [offensiveEnemy(opts.enemyAbilities ?? [noopDamage()])],
    __testTapActors: (actors: CombatActor[]) => {
        const qx = actors.find((a) => a.id === 'attacker');
        if (qx) qx.shieldPool = opts.shieldPool;
    },
});

interface BuffEvent {
    round: number;
    actorId: string;
    buffName: string;
}

/** Runs the fixture and taps the whole-board buff-applied / buff-expired streams. */
function run(input: CombatEngineInput) {
    const bus = createEventBus();
    const applied: BuffEvent[] = [];
    const expired: BuffEvent[] = [];
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) =>
        applied.push({ round: e.round, actorId: e.actorId, buffName: e.buffName })
    );
    bus.on('buff-expired', (e: Extract<CombatEvent, { type: 'buff-expired' }>) =>
        expired.push({ round: e.round, actorId: e.actorId, buffName: e.buffName })
    );
    const result = runCombat({ ...input, bus });
    return { applied, expired, result };
}

const holdersOf = (applied: BuffEvent[], buffName: string): string[] =>
    applied.filter((e) => e.buffName === buffName).map((e) => e.actorId);

const grantRounds = (applied: BuffEvent[], buffName: string, actorId: string): number[] =>
    applied.filter((e) => e.buffName === buffName && e.actorId === actorId).map((e) => e.round);

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

const barrierAbsorbedFor = (
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number =>
    result.rounds.find((r) => r.round === round)!.perActorIncoming?.[targetId]?.barrierAbsorbed ??
    0;

// =============================================================================
// The parsed shape. Everything below drives THESE abilities, so pin them first — if the parser
// regresses on any of the three axes (trigger, condition, target/hits/duration) the engine cases
// would fail with a confusing "nothing happened" instead of naming the axis that broke.
// =============================================================================

describe("Quixilver R2 — the parsed passive's three axes", () => {
    it('parses to an end-of-turn, self-shield-full-gated, all-allies Barrier + Barrier Recharging', () => {
        const abilities = quixilverPassiveSlot().abilities;
        const barrier = abilities.find(
            (a) => a.type === 'buff' && a.config.type === 'buff' && a.config.buffName === 'Barrier'
        )!;
        const recharging = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                a.config.buffName === BARRIER_RECHARGING
        )!;

        for (const a of [barrier, recharging]) {
            expect(a.trigger).toBe('end-of-turn');
            expect(a.target).toBe('all-allies');
            expect(a.conditions).toEqual([{ subject: 'self-shield-full', derivable: true }]);
        }
        // "for 1 hit" → a hit count and NO turn window; "for 3 turns" → a plain 3-turn duration.
        expect(barrier.config).toMatchObject({ hits: 1 });
        expect((barrier.config as { duration?: number }).duration).toBeUndefined();
        expect(recharging.config).toMatchObject({ duration: 3 });
    });
});

// =============================================================================
// Case 1 — the gate. Fires at maxHp, does not fire one point below it.
// =============================================================================

describe('Quixilver R2 — case 1: fires only on a full shield', () => {
    it('grants Barrier to every ally when the shield pool is at max HP', () => {
        const { applied } = run(quixilverFixture({ shieldPool: HP, numRounds: 1 }));

        // `all-allies` is the whole friendly side INCLUDING the caster (the engine's standing
        // convention for the target), so Quixilver's own 'attacker' id is in the list too.
        expect(holdersOf(applied, 'Barrier').sort()).toEqual([
            'ally-back',
            'ally-front',
            'attacker',
        ]);
        // Team-scoped, not board-scoped: the enemy is not an "ally".
        expect(holdersOf(applied, 'Barrier')).not.toContain('enemy-1');
    });

    it('grants nothing one point below max HP', () => {
        // A single point short. Nothing in this fixture can move the pool back up (the real
        // shield-gaining active is stubbed out, and Quixilver is never hit), so the drain-time
        // `selfShieldFullFor` read is genuinely false at the end of the turn.
        const { applied } = run(quixilverFixture({ shieldPool: HP - 1, numRounds: 1 }));

        expect(holdersOf(applied, 'Barrier')).toEqual([]);
        expect(holdersOf(applied, BARRIER_RECHARGING)).toEqual([]);
    });
});

// =============================================================================
// Case 2 — Barrier Recharging lands on ALLIES (Task 7's axis), friendly-side only.
// =============================================================================

describe('Quixilver R2 — case 2: Barrier Recharging lands on allies for 3 turns', () => {
    it('applies the lockout to every ally, never to the enemy', () => {
        const { applied } = run(quixilverFixture({ shieldPool: HP, numRounds: 1 }));

        const lockouts = applied.filter((e) => e.buffName === BARRIER_RECHARGING);
        // Same friendly-side roster as the Barrier itself — this is Task 7's axis: before it,
        // the lockout parsed as an ENEMY-side application and landed on nobody who could be
        // gated by it.
        expect(lockouts.map((e) => e.actorId).sort()).toEqual([
            'ally-back',
            'ally-front',
            'attacker',
        ]);
        expect(lockouts.map((e) => e.actorId)).not.toContain('enemy-1');
    });
});

// =============================================================================
// Case 3 — the real 3-turn cooldown, and the two things only a live fixture can prove.
//
// This is the case that answers (a) and (b) from the header. The lockout is granted at the end of
// round 1 and decays one turn per ally Post-Turn: 3 → 2 (R2) → 1 (R3) → gone (R4). Rounds 2 and 3
// therefore find the recipient still holding it and SKIP the grant entirely — which is only
// possible if the R1 grant is sitting in the SELF-side store `holdsBarrierRecharging` reads. A
// fresh grant then lands in round 4.
// =============================================================================

describe('Quixilver R2 — case 3: a real 3-turn cooldown, blocked then re-armed', () => {
    it('grants in round 1, skips rounds 2 and 3, then grants again in round 4', () => {
        // The shield stays full for all four rounds (nothing hits Quixilver), so the gate itself
        // is met EVERY round — the only thing that can suppress rounds 2 and 3 is the lockout.
        const { applied } = run(quixilverFixture({ shieldPool: HP, numRounds: 4 }));

        expect(grantRounds(applied, 'Barrier', 'ally-front')).toEqual([1, 4]);
        expect(grantRounds(applied, 'Barrier', 'ally-back')).toEqual([1, 4]);
        // The lockout re-arms on exactly the same cadence — it gates its own re-application too,
        // so it decays to zero rather than being refreshed back to 3 every round.
        expect(grantRounds(applied, BARRIER_RECHARGING, 'ally-front')).toEqual([1, 4]);
    });

    it('the skipped rounds are silent — no event, not merely a suppressed status', () => {
        // The recipient loop `continue`s BEFORE both applyTimedAbilityStatus and the bus emit, so
        // rounds 2 and 3 must produce no Barrier traffic at all for either ally. Counting events
        // (rather than checking presence) is what makes this non-vacuous: the round-1 Barrier is
        // still held, so a presence check would pass even if a new grant landed every round.
        const { applied } = run(quixilverFixture({ shieldPool: HP, numRounds: 4 }));

        const inSkippedRounds = applied.filter(
            (e) =>
                (e.round === 2 || e.round === 3) &&
                (e.buffName === 'Barrier' || e.buffName === BARRIER_RECHARGING)
        );
        expect(inSkippedRounds).toEqual([]);
    });
});

// =============================================================================
// Case 4 — the granted Barrier is HIT-counted, not duration-based.
// =============================================================================

describe('Quixilver R2 — case 4: the granted Barrier is spent by one direct hit', () => {
    it('nullifies the first hit, books it as barrierAbsorbed, and lets the second land', () => {
        // The enemy fires twice at the front row in one cast — two separate applications through
        // the damage funnel. It is the slowest actor on the board, so both land after the grant.
        const { expired, result } = run(
            quixilverFixture({ shieldPool: HP, numRounds: 1, enemyAbilities: [basicAttack(2)] })
        );

        expect(barrierAbsorbedFor(result, 1, 'ally-front')).toBeCloseTo(DIRECT_HIT, 6);
        expect(simHpLossFor(result, 1, 'ally-front')).toBeCloseTo(DIRECT_HIT, 6);
        // The charge-spend removal is announced exactly once, like a turn expiry — without it the
        // Barrier would vanish from the combat log and the round status panel silently.
        expect(
            expired.filter((e) => e.buffName === 'Barrier' && e.actorId === 'ally-front')
        ).toEqual([{ round: 1, actorId: 'ally-front', buffName: 'Barrier' }]);
    });

    it('the untargeted ally keeps its charge — the spend is per holder, not team-wide', () => {
        // Only the M4 front ally is hit. If the absorb site spent charges globally, ally-back's
        // Barrier would expire here too.
        const { expired } = run(
            quixilverFixture({ shieldPool: HP, numRounds: 1, enemyAbilities: [basicAttack(2)] })
        );

        expect(expired.filter((e) => e.actorId === 'ally-back')).toEqual([]);
    });
});
