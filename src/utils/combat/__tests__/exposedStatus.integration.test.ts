/**
 * `Exposed` amplifies the next direct hit and one stack of it is consumed by that hit.
 *
 * Game text (constants/buffs.ts): "Increases the incoming damage of the next direct hit by 100%,
 * removed after taking direct damage or at the end of the round."
 *
 * LOCKED game rule (owner ruling, 2026-08-10): a hit READS every stack the victim holds (+100%
 * each) and SPENDS EXACTLY ONE, leaving the rest armed. Each stack therefore arms its own hit, and
 * Amartya's 2 stacks amplify two consecutive hits (+200%, then +100%) rather than one (+200%).
 *
 * Two corpus appliers — Amartya's reactive "inflicts 2 stacks of Exposed on that defender"
 * (on-enemy-taunt-gained) and Nayra's charged skill. It built as a name-only debuff (empty
 * parsedEffects) and NO engine code read the name, so the status registered, showed in the log,
 * counted toward enemy-debuff conditions, and amplified nothing.
 *
 * Like Stealth / Barrier / the Affinity Overrides, the mechanic is keyed on the NAME rather than on
 * a `parsedEffects` stat entry: the amount is not a standing modifier (it evaporates on the first
 * hit), so folding it into `parsedEffects.incomingDamage` would leak a permanent +100% into every
 * non-consuming consumer of that channel (DPS-mode scalars, effective-HP, the UI's buff display).
 *
 * Both fixtures place Exposed through the REAL per-victim seam Amartya uses — a reactive `debuff`
 * intent, which lands via `applyTimedAbilityStatus` keyed on the resolved victim id — and both
 * directions are exercised: the engine is team-symmetric, so an enemy's Exposed must amplify a
 * player victim exactly as a player's amplifies an enemy.
 */
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { runCombat, type CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';

const HITS = 2;

/** An N-hit attack. `multiplier` already includes the hit count (victimDamage's contract), so each
 *  hit lands attack × 1.0 — making the per-hit amplification readable straight off the totals: a
 *  run's total is simply the sum of each hit's `1 + amplification`, in "half-shares" of the cast. */
const nHitAttack = (hits: number): Ability => ({
    id: 'atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 * hits, hits },
});

/** The default 2-hit attack. */
const twoHitAttack = (): Ability => nHitAttack(HITS);

const noopAttack = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0, hits: 1 },
});

/** Nayra's shape — the OTHER corpus applier: a plain on-cast enemy debuff, which lands through
 *  playerTurn's per-victim `applyTimedAbilityStatus` rather than the reactive executor's. */
const castStatus = (buffName: string, stacks = 1): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks,
        // Matches BOTH corpus appliers: Nayra's parsed config declares isStackable false, and
        // Amartya's reactive payload does not carry the flag at all. So a multi-stack Exposed here
        // is faithful to the real thing — the live stack count must not depend on that flag.
        isStackable: false,
        duration: 5,
        application: 'apply',
    },
});

/** The on-attacked reactive that plants the status on its attacker — Amartya's routing shape
 *  (`target: 'enemy'` + a per-victim `applyTimedAbilityStatus`). `application: 'apply'` always
 *  lands, isolating the amplification behaviour from the landing roll. */
const reactiveStatus = (buffName: string, stacks = 1): Ability => ({
    id: `reactive-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-attacked',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks,
        isStackable: false,
        duration: 5, // long enough that only consumption — never expiry — can end it
        application: 'apply',
    },
});

const stats = (attack: number, speed: number) => ({
    attack,
    crit: 0,
    critDamage: 0,
    speed,
    defence: 0,
    hp: 1_000_000_000,
    security: 0,
});

/**
 * PLAYER → ENEMY. The enemy 'foe' is faster and hits first; the focus actor's on-attacked reaction
 * plants `statusName` on foe; the focus then attacks foe twice.
 *
 * `applier: 'cast'` swaps that for Nayra's shape — the status rides the focus actor's own cast,
 * alongside the attack, exercising playerTurn's application path instead of the reactive executor's.
 *
 * `hits` widens the focus actor's attack beyond the default 2, so a multi-stack run can be watched
 * decaying over more hits than it has stacks.
 */
function playerHitsExposedEnemy(
    statusName: string,
    stacks = 1,
    applier: 'reactive' | 'cast' | 'scheduled' = 'reactive',
    hits = HITS
): number {
    const attack = nHitAttack(hits);
    const focusSkills: ShipSkills =
        applier === 'cast'
            ? { slots: [{ slot: 'active', abilities: [castStatus(statusName), attack] }] }
            : applier === 'scheduled'
              ? { slots: [{ slot: 'active', abilities: [attack] }] }
              : {
                    slots: [
                        { slot: 'active', abilities: [attack] },
                        { slot: 'passive', abilities: [reactiveStatus(statusName, stacks)] },
                    ],
                };

    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1,
        selfBuffs: [],
        // `applier: 'scheduled'` is the calculator buff-picker's exact output shape: no skillSource
        // and no skillDuration, which the status engine classifies as ALWAYS-ACTIVE.
        enemyDebuffs:
            applier === 'scheduled'
                ? [
                      {
                          id: statusName,
                          buffName: statusName,
                          stacks,
                          parsedEffects: {},
                          isStackable: false,
                      },
                  ]
                : [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100, // slower than foe → foe hits first, waking the reaction
        hacking: 100_000,
        healTargetId: 'attacker',
        positionalTeamBattle: true,
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'foe',
                stats: stats(1_000, 900),
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: { slots: [{ slot: 'active', abilities: [twoHitAttack()] }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
    };

    const result = runCombat(input);
    return result.rounds[0]?.perTargetDamage?.['foe'] ?? 0;
}

/**
 * ENEMY → PLAYER (team symmetry). The focus actor is faster and hits foe first; foe's own
 * on-attacked reaction plants `statusName` on the focus actor; foe then attacks it twice.
 */
function enemyHitsExposedPlayer(statusName: string): number {
    const focusSkills: ShipSkills = {
        slots: [{ slot: 'active', abilities: [noopAttack()] }],
    };

    const input: CombatEngineInput = {
        attack: 1_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills,
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        hp: 1_000_000_000,
        speed: 900, // faster than foe → the focus hits first, waking FOE's reaction
        hacking: 100_000,
        healTargetId: 'attacker',
        positionalTeamBattle: true,
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'foe',
                stats: stats(10_000, 100),
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                hacking: 100_000,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [twoHitAttack()] },
                        { slot: 'passive', abilities: [reactiveStatus(statusName)] },
                    ],
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
    };

    const result = runCombat(input);
    return result.rounds[0]?.perTargetDamage?.['attacker'] ?? 0;
}

// A control run plants an unmodelled status name through the identical path, so the comparison
// isolates the 'Exposed' name and nothing else about the fixture.
const CONTROL = 'Inert Marker';

describe('Exposed — +100% per stack on the next direct hit, one stack spent per hit', () => {
    it('doubles the FIRST hit against an enemy and leaves the second unamplified', () => {
        const control = playerHitsExposedEnemy(CONTROL);
        const exposed = playerHitsExposedEnemy('Exposed');

        expect(control).toBeGreaterThan(0);
        // Control: 2 plain hits. Exposed: hit 1 doubled + hit 2 plain = 3 half-shares vs 2.
        expect(exposed / control).toBeCloseTo(1.5, 5);
    });

    // Amartya's real shape: "inflicts 2 stacks of Exposed on that defender". LOCKED game rule
    // (owner ruling 2026-08-10): a hit READS all the stacks and SPENDS exactly one, so each stack
    // arms its own hit.
    //
    // Derivation over the 2-hit attack, in half-shares (each hit's base slice = 1):
    //   control  : 1 + 1                     = 2
    //   spend-one: (1 + 2.00) + (1 + 1.00)   = 5   → ratio 2.5   ← the rule
    //   spend-all: (1 + 2.00) + 1            = 4   → ratio 2.0
    //   spend-none:(1 + 2.00) + (1 + 2.00)   = 6   → ratio 3.0
    // The three ratios are distinct, so this assertion cannot be satisfied by the wrong rule.
    it('scales with stacks — 2 stacks amplify the first hit by 200%, and the second by 100%', () => {
        const control = playerHitsExposedEnemy(CONTROL, 2);
        const exposed = playerHitsExposedEnemy('Exposed', 2);

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(2.5, 5);
    });

    // The three-STEP decay, over a 3-hit attack — the assertion that pins the whole rule, because
    // it needs one more hit than there are stacks and so also fixes where the decay STOPS.
    //   control  : 1 + 1 + 1                            = 3
    //   spend-one: (1 + 2.00) + (1 + 1.00) + 1          = 6   → ratio 2.0     ← the rule
    //   spend-all: (1 + 2.00) + 1 + 1                    = 5   → ratio 1.666…
    //   spend-none:(1 + 2.00) + (1 + 2.00) + (1 + 2.00) = 9   → ratio 3.0
    it('2 stacks decay in three steps — +200%, then +100%, then unamplified', () => {
        const control = playerHitsExposedEnemy(CONTROL, 2, 'reactive', 3);
        const exposed = playerHitsExposedEnemy('Exposed', 2, 'reactive', 3);

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(2, 5);
    });

    // The regression fence for the common case (Nayra, Amartya R2): ONE stack must behave exactly
    // as it did before stacks became spendable one at a time — a single amplified hit, then nothing.
    // Same shape as the first test in this block but stated as an explicit 1-stack invariant, since
    // the spend-one change reaches this path too (it now walks 1 → 0 rather than deleting outright).
    //   control: 1 + 1 + 1 = 3;  one stack: (1 + 1.00) + 1 + 1 = 4  → ratio 4/3.
    it('1 stack still amplifies exactly one hit and nothing after it', () => {
        const control = playerHitsExposedEnemy(CONTROL, 1, 'reactive', 3);
        const exposed = playerHitsExposedEnemy('Exposed', 1, 'reactive', 3);

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(4 / 3, 5);
    });

    // The second corpus applier (Nayra's charged skill) lands Exposed through playerTurn's cast
    // path rather than the reactive executor's — a different application site into the same
    // per-victim store, so it needs its own guard.
    //
    // The ratio here is 2.0, not 1.5: this `applier: 'cast'` shape puts the Exposed clause BEFORE
    // the damage clause in the same slot, so each of the cast's sub-attacks applies its own Exposed,
    // rides it into its own hit, and spends it — see the inline comment below for the full
    // breakdown of why that differs from the REACTIVE (pre-planted, non-reapplying) fixture above.
    it('works when applied by a cast (Nayra) as well as by a reaction (Amartya)', () => {
        const control = playerHitsExposedEnemy(CONTROL, 1, 'cast');
        const exposed = playerHitsExposedEnemy('Exposed', 1, 'cast');

        expect(control).toBeGreaterThan(0);
        // 2.0, not the 1.5 the REACTIVE fixture above reads, and the difference is the point.
        // This `applier: 'cast'` shape puts the Exposed clause BEFORE the damage clause in the same
        // slot, and since PR8 (multi-hit full-walk epic) a 2-hit cast is two full attacks that each
        // run the whole pipeline — so each attack applies its own Exposed and then spends it on its
        // own hit. The reactive fixture plants ONE Exposed before the cast with nothing re-applying
        // it, so only its first hit is amplified: that pair is what shows the doubling here comes
        // from per-sub-attack re-application rather than from a blanket always-on amplification.
        expect(exposed / control).toBeCloseTo(2, 5);
    });

    it('is team-symmetric — an enemy-applied Exposed amplifies a PLAYER victim identically', () => {
        const control = enemyHitsExposedPlayer(CONTROL);
        const exposed = enemyHitsExposedPlayer('Exposed');

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(1.5, 5);
    });
});

// A MANUALLY SELECTED Exposed is INERT — it must amplify nothing.
//
// The DPS calculator's debuff picker offers every entry in constants/buffs.ts and emits a
// SelectedGameBuff with no skillSource and no skillDuration, which the status engine treats as
// ALWAYS-ACTIVE: the entry is injected into every target's snapshot as `turnsRemaining: 'recurring'`
// and is keyed to the global `__enemy__` store, so the per-victim `removeTimedEnemyStatus` this
// status consumes through can never delete it. Reading that channel therefore did not model
// "Exposed" at all — it amplified EVERY direct hit of the battle by +100%, flatly contradicting the
// status's own "the next direct hit ... removed after taking direct damage".
//
// A one-shot has no honest standing rendering (the same reason it is name-keyed rather than a
// `parsedEffects.incomingDamage` entry), so the read now spans only the channel the removal can
// spend and a manual selection goes quiet. Both corpus appliers land on that channel, and the four
// cases above are what keep this from being a licence to ignore the status.
describe('a scheduled always-active Exposed is inert', () => {
    it('amplifies neither hit — identical damage to the same fixture with no debuff selected', () => {
        const control = playerHitsExposedEnemy(CONTROL, 1, 'scheduled');
        const exposed = playerHitsExposedEnemy('Exposed', 1, 'scheduled');

        expect(control).toBeGreaterThan(0);
        // Pre-fix: 2.0 — both hits carried the +100%, every round, for the whole battle.
        expect(exposed / control).toBeCloseTo(1, 5);
    });
});

// =============================================================================
// Secondary hit types must not SPEND Exposed (CodeRabbit, PR #289).
//
// `applyVictimDamage` is the shared funnel, so the consumption sits where reflect, counter and
// Protection-transfer sub-hits also pass through with `byDirectDamage: true`. None of those three
// reads the per-victim incoming-damage channel Exposed rides:
//   - reflect  — `reflectedDamageForHit` folds the attacker's incoming-REDUCTION only,
//   - counter  — passes `incomingDamageModifierPct: 0` outright (documented approximation),
//   - transfer — the chunk is computed off the ORIGINAL victim's cascade, then redirected.
// Consuming there would cost the holder the status for a hit that was never amplified. The engine
// already carried a guard of exactly this shape for Protection-transfer eligibility.
//
// Driven through the counter leg (the cheapest of the three to fixture end-to-end): Exposed sits on
// the ENEMY, and the PLAYER's on-attacked counter is what lands on it. The foe's attack is what
// triggers that counter, so the counter necessarily precedes the player's own next cast — the hit
// that must still be amplified.
// =============================================================================

const counterAbility = (): Ability => ({
    id: 'counter',
    type: 'counter',
    target: 'enemy',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'counter', multiplier: 100, hits: 1 },
});

/**
 * Per-round damage dealt to the foe over two rounds. The player casts damage-then-Exposed (a
 * post-damage clause), and is SLOWER than the foe, so each round runs: foe attacks → player's
 * counter lands on the foe → player casts.
 *
 * The cast is two full sub-attacks, so round 1 already self-amplifies: attack 0 lands plain and
 * applies Exposed, attack 1 rides and spends that stack (then reapplies its own, left standing).
 * Round 2's first hit rides the Exposed round 1 left behind — unless a hit in between wrongly spent
 * it. Counter damage is a per-round constant, so comparing the round2−round1 DELTA against the
 * counter-free run cancels it out exactly.
 */
function foeDamagePerRound(withCounter: boolean, stacks = 1): { r1: number; r2: number } {
    const focusSlots: ShipSkills['slots'] = [
        { slot: 'active', abilities: [twoHitAttack(), castStatus('Exposed', stacks)] },
    ];
    if (withCounter) focusSlots.push({ slot: 'passive', abilities: [counterAbility()] });

    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: focusSlots },
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
        hp: 1_000_000_000,
        speed: 100, // slower than the foe → the foe attacks first, waking the counter
        hacking: 100_000,
        healTargetId: 'attacker',
        positionalTeamBattle: true,
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'foe',
                stats: stats(1_000, 900),
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: { slots: [{ slot: 'active', abilities: [twoHitAttack()] }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
    };

    const result = runCombat(input);
    return {
        r1: result.rounds[0]?.perTargetDamage?.['foe'] ?? 0,
        r2: result.rounds[1]?.perTargetDamage?.['foe'] ?? 0,
    };
}

describe('Exposed is not spent by hit types that never amplified it', () => {
    it("a counterattack leaves the victim's Exposed intact for the next real cast", () => {
        const plain = foeDamagePerRound(false);
        expect(plain.r1).toBeGreaterThan(0);
        // Premise: round 2 IS amplified by the Exposed round 1 left standing.
        //
        // The ratio is 4/3, not the pre-PR8 1.5, because since PR8 (multi-hit full-walk epic) each
        // of the cast's 2 hits is a full attack that lands its own post-damage Exposed:
        //   round 1 = plain + doubled  (attack 0 lands it, attack 1 spends it) = 3 half-shares,
        //   round 2 = doubled + doubled (attack 0 spends the one left standing and re-lands it,
        //             attack 1 spends that)                                    = 4 half-shares.
        // Still strictly greater than 1, which is all this premise needs to set up the invariant
        // below — the ratio itself is pinned only to catch a silent change in the fixture's shape.
        expect(plain.r2 / plain.r1).toBeCloseTo(4 / 3, 5);

        // With the counter in play the round-over-round GAIN must be identical: the counter lands on
        // the Exposed holder first, but it is not an amplified hit, so it must not consume it.
        const countered = foeDamagePerRound(true);
        expect(countered.r2 - countered.r1).toBeCloseTo(plain.r2 - plain.r1, 5);
    });

    // The same exclusion at TWO stacks, which is where "spends nothing" and "spends one" finally
    // part company: at one stack both readings leave the victim with a status that amplifies the
    // next hit either fully or not at all, so the test above cannot tell a stack-spend from a
    // no-op. Here it can — the counter must leave the victim holding 2, not 1.
    //
    // In half-shares of the round-2 cast (each of its 2 hits has base slice 1):
    //   holding 2 (correct)      : (1 + 2.00) + (1 + 1.00) = 5, vs round 1's unamplified 2 → delta 3
    //   holding 1 (counter spent): (1 + 1.00) + 1          = 3                            → delta 1
    // The counter-free run supplies the expected delta, so the counter's own constant damage cancels.
    it('a counterattack leaves BOTH of a 2-stack victim’s Exposed stacks intact', () => {
        const plain = foeDamagePerRound(false, 2);
        expect(plain.r1).toBeGreaterThan(0);
        // Premise: round 2 reads +200% then +100% off round 1's two stacks → 5 vs 2.
        expect(plain.r2 / plain.r1).toBeCloseTo(2.5, 5);

        const countered = foeDamagePerRound(true, 2);
        expect(countered.r2 - countered.r1).toBeCloseTo(plain.r2 - plain.r1, 5);
    });
});
