/**
 * Bomb-splash-on-death (NEW core combat mechanic, positional-only).
 *
 * When a ship dies while carrying un-detonated bombs (`pendingBombs`), each LIVING same-side
 * adjacent ally takes a tier-scaled fraction (`splashDamageForBomb`, tier/4% — no affinity) of
 * each bomb's damage. The death seam is `recordDestroyed` (engine.ts), so every kill path
 * (positional, aggregate, DoT, reflected) routes through it; adjacency is positional-only
 * (`adjacentAllyIdsFor` returns [] without board positions → non-positional sims byte-identical).
 *
 * FIXTURE STRATEGY (mirrors positionalDamage.integration.test.ts):
 * A positional player attacker at M4 fires a basic attack at the FRONT enemy with a BASE
 * (origin-only) pattern, AND its active also applies a Blast bomb to that same anchor enemy.
 * The firing hit kills the bombed front enemy (HP sized at/below the direct damage) WHILE the
 * bomb is still pending (countdown ≥ 1 — never decremented before death). On death the front
 * enemy splashes to its LIVING adjacent same-side ally (a high-HP enemy at M3, which is OUTSIDE
 * the origin-only footprint so it takes NO direct damage — isolating the splash). The splash to
 * M3 is observed via `round.perTargetDamage['enemy-mid']`, which the engine writes for the splash
 * exactly as the firing path writes per-victim damage. Healing mode is required for the positioned
 * enemy roster to be built (see positionalDamage.integration.test.ts).
 *
 * Bomb math: damagePerStack = attacker effectiveAttack × (tier/100); splash =
 * stacks × damagePerStack × (tier/4)/100, no affinity (defence 0, affinity neutral here anyway).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { splashDamageForBomb } from '../bombSplash';
import type { PendingBomb } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bs${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Bomb knobs used by both the skill and the expected-splash math.
const BOMB_TIER = 200; // splashPct = tier/4 = 50%
const BOMB_STACKS = 2;
const BOMB_DURATION = 3; // countdown ≥ 1 → still pending at the round-1 kill

// A single-hit basic attack that ALSO applies a Blast bomb to the target on cast.
const bombAndStrike = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'dot',
            target: 'enemy',
            config: {
                type: 'dot',
                dotType: 'bomb',
                tier: BOMB_TIER,
                stacks: BOMB_STACKS,
                duration: BOMB_DURATION,
            },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Origin-only footprint: the direct hit touches ONLY the anchor enemy (front), not the ally.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// Focus attacker at M4: attack 5000 vs defence 0, multiplier 100% (1x), 1 hit, no crit →
// firing-hit damage = 5000 (kills the front enemy when its HP ≤ 5000). Its active also applies
// the Blast bomb to the front enemy.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [bombAndStrike()] },
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
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...overrides,
});

// The expected splash one tier-200 bomb deals to one adjacent ally, given the attacker's
// effectiveAttack (5000) → damagePerStack = 5000 × (200/100) = 10000, stacks 2, splashPct 50%:
//   2 × 10000 × 0.50 = 10000.
const expectedBomb: PendingBomb = {
    countdown: BOMB_DURATION,
    damagePerStack: 5000 * (BOMB_TIER / 100),
    stacks: BOMB_STACKS,
    tier: BOMB_TIER,
    sourceId: 'attacker',
    affinityMult: 1,
    detonationDamageModifier: 0,
};
const EXPECTED_SPLASH = splashDamageForBomb(expectedBomb); // 10000

describe('bomb-splash-on-death (positional core mechanic)', () => {
    it('a bombed enemy killed by a direct hit splashes splashDamageForBomb to its LIVING adjacent ally', () => {
        idc = 0;
        // Front enemy (M4) HP 5000 → dies to the 5000 firing hit while bombed. Adjacent ally at M3
        // (a hex-neighbour of M4) is huge-HP and OUTSIDE the origin-only footprint → takes ONLY
        // the splash. The splash to M3 surfaces in perTargetDamage['enemy-mid'].
        const input = BASE({
            enemyAttackers: [
                enemyAt('enemy-front', 'M4', 5000),
                enemyAt('enemy-mid', 'M3', 1_000_000_000),
            ],
        });
        const result = runCombat(input);
        const round = result.rounds[0];

        expect(round.perTargetDamage).toBeDefined();
        // The adjacent ally took EXACTLY the splash (no direct damage — outside the footprint).
        expect(round.perTargetDamage?.['enemy-mid']).toBe(EXPECTED_SPLASH);
        // The splash is surfaced on the dedicated per-actor map too.
        expect(round.perActorSplash).toBeDefined();
        expect(round.perActorSplash?.['enemy-mid']).toBe(EXPECTED_SPLASH);
    });

    it('no adjacent ally → no splash (lone bombed enemy dies cleanly)', () => {
        idc = 0;
        // Front enemy at M4 with a NON-adjacent ally at M1 (not a hex-neighbour of M4). The ally
        // takes no splash; perActorSplash stays absent.
        const input = BASE({
            enemyAttackers: [
                enemyAt('enemy-front', 'M4', 5000),
                enemyAt('enemy-far', 'M1', 1_000_000_000),
            ],
        });
        const result = runCombat(input);
        const round = result.rounds[0];
        expect(round.perActorSplash).toBeUndefined();
        expect(round.perTargetDamage?.['enemy-far']).toBeUndefined();
    });

    it('a bombed enemy that SURVIVES the hit does not splash (no death = no splash)', () => {
        idc = 0;
        // Front enemy HP 5001 > 5000 firing hit → survives → no death → no splash, even though it
        // carries the bomb and has an adjacent ally.
        const input = BASE({
            enemyAttackers: [
                enemyAt('enemy-front', 'M4', 5001),
                enemyAt('enemy-mid', 'M3', 1_000_000_000),
            ],
        });
        const result = runCombat(input);
        const round = result.rounds[0];
        expect(round.perActorSplash).toBeUndefined();
        // enemy-mid took no damage (outside the footprint, and the front survived → no splash).
        expect(round.perTargetDamage?.['enemy-mid']).toBeUndefined();
    });
});
