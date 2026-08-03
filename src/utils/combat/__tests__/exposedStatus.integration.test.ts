/**
 * `Exposed` amplifies the next direct hit and is consumed by it.
 *
 * Game text (constants/buffs.ts): "Increases the incoming damage of the next direct hit by 100%,
 * removed after taking direct damage or at the end of the round."
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

/** A 2-hit attack. `multiplier` already includes the hit count (victimDamage's contract), so each
 *  hit lands attack × 1.0 — making the per-hit amplification readable straight off the totals. */
const twoHitAttack = (): Ability => ({
    id: 'atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 * HITS, hits: HITS },
});

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
 */
function playerHitsExposedEnemy(
    statusName: string,
    stacks = 1,
    applier: 'reactive' | 'cast' = 'reactive'
): number {
    const focusSkills: ShipSkills =
        applier === 'cast'
            ? { slots: [{ slot: 'active', abilities: [castStatus(statusName), twoHitAttack()] }] }
            : {
                  slots: [
                      { slot: 'active', abilities: [twoHitAttack()] },
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

describe('Exposed — +100% on the next direct hit, then consumed', () => {
    it('doubles the FIRST hit against an enemy and leaves the second unamplified', () => {
        const control = playerHitsExposedEnemy(CONTROL);
        const exposed = playerHitsExposedEnemy('Exposed');

        expect(control).toBeGreaterThan(0);
        // Control: 2 plain hits. Exposed: hit 1 doubled + hit 2 plain = 3 half-shares vs 2.
        expect(exposed / control).toBeCloseTo(1.5, 5);
    });

    // Amartya's real shape: "inflicts 2 stacks of Exposed on that defender". Stacks scale the
    // amplification and are spent TOGETHER on one hit (see exposedIncomingPct's open game-rule
    // note): hit 1 lands at +200% (3 half-shares), hit 2 plain → 4 vs the control's 2.
    it('scales with stacks — 2 stacks triple the first hit, still consumed in one go', () => {
        const control = playerHitsExposedEnemy(CONTROL, 2);
        const exposed = playerHitsExposedEnemy('Exposed', 2);

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(2, 5);
    });

    // The second corpus applier (Nayra's charged skill) lands Exposed through playerTurn's cast
    // path rather than the reactive executor's — a different application site into the same
    // per-victim store, so it needs its own guard.
    //
    // Note the ratio is 1.5, not 1.0: a debuff applied by a cast is in the store by the time that
    // same cast's damage resolves, so it amplifies the cast's own first hit. That is INHERITED
    // ordering, not something Exposed introduces — a cast-applied `Inc. Damage Up II` on the same
    // fixture amplifies both of its own hits (ratio 2.0) through the identical channel.
    it('works when applied by a cast (Nayra) as well as by a reaction (Amartya)', () => {
        const control = playerHitsExposedEnemy(CONTROL, 1, 'cast');
        const exposed = playerHitsExposedEnemy('Exposed', 1, 'cast');

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(1.5, 5);
    });

    it('is team-symmetric — an enemy-applied Exposed amplifies a PLAYER victim identically', () => {
        const control = enemyHitsExposedPlayer(CONTROL);
        const exposed = enemyHitsExposedPlayer('Exposed');

        expect(control).toBeGreaterThan(0);
        expect(exposed / control).toBeCloseTo(1.5, 5);
    });
});
