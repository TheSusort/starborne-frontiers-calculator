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
    enemyAttackers: [],
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
    mode: 'healing',
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
    splashModifier: 0,
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

    // ─── (b) Chain reaction ───────────────────────────────────────────────────
    // A (M4) dies to direct hit → splashes B (M3, pre-seeded bombs, low HP) → B dies
    // from splash → B's bombs splash C (M2, high HP, adjacent to B but NOT to A).
    // The chain terminates naturally: each ship's bombs are consumed up-front.
    it('(b) chain reaction: A dies → splashes B → B dies → splashes C', () => {
        idc = 0;
        // A's bomb splash: 2 × (5000 × (200/100)) × 0.50 = 10000 (same as EXPECTED_SPLASH).
        // B's pre-seeded bomb: tier=100, stacks=1, damagePerStack=500 → splash = 1×500×0.25=125.
        const bBomb: PendingBomb = {
            countdown: 3,
            damagePerStack: 500,
            stacks: 1,
            tier: 100,
            sourceId: 'enemy-b',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 0,
        };
        const expectedBSplash = splashDamageForBomb(bBomb); // 125

        // C has huge HP → survives B's splash.
        const input = BASE({
            enemyAttackers: [
                enemyAt('enemy-a', 'M4', 5000), // dies to 5000 direct hit
                enemyAt('enemy-b', 'M3', 50), // dies to A's 10000 splash (HP 50 < 10000)
                enemyAt('enemy-c', 'M2', 1_000_000_000), // adjacent to B, survives B's splash
            ],
            __testTapActors: (actors) => {
                // Pre-seed B's pending bomb so it splashes when B dies.
                const b = actors.find((a) => a.id === 'enemy-b');
                if (b) b.pendingBombs.push(bBomb);
            },
        });

        const result = runCombat(input);
        const round = result.rounds[0];

        // A → B splash fired (A's bomb).
        expect(round.perActorSplash?.['enemy-b']).toBe(EXPECTED_SPLASH);
        // B → C splash fired (B's bomb; chain worked).
        expect(round.perActorSplash?.['enemy-c']).toBe(expectedBSplash);
        // C is alive (didn't die from B's small splash).
        expect(round.perActorSplash?.['enemy-a']).toBeUndefined(); // A was the first to die
    });

    // ─── (c) Non-positional no-op ─────────────────────────────────────────────
    // No ships have board positions. A ship has pendingBombs and dies.
    // The victim.position gate (Task 1) must prevent any splash.
    it('(c) non-positional: dying bombed ship with no position produces no splash', () => {
        idc = 0;
        // Override BASE to remove all positions. The focus attacker fires and kills the dummy
        // enemy (via the skill), which has no position. The bomb is applied to it. On death,
        // victim.position === undefined → splash gate blocks.
        const noPositionInput: CombatEngineInput = {
            enemyAttackers: [],
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [bombAndStrike()] },
            enemyDefense: 0,
            enemyHp: 5000, // dies to first hit → bomb is pending at death
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
            mode: 'healing',
            // NO position on the attacker, and NO enemyAttackers (no positions at all).
        };

        const result = runCombat(noPositionInput);
        const round = result.rounds[0];

        // No splash: victim.position was undefined → gate blocked.
        expect(round.perActorSplash).toBeUndefined();
    });

    // ─── (d) Multi-bomb / multi-ally ─────────────────────────────────────────
    // A dying ship has TWO pending bombs (tiers 100 and 300) and TWO living adjacent allies.
    // Each ally takes the SUM of both bombs' splash. One bomb carries a non-neutral affinityMult
    // (1.5) — the splash formula must ignore it (no-affinity proof, end-to-end).
    it('(d) multi-bomb + multi-ally: each ally takes sum of all bombs; affinityMult is ignored', () => {
        idc = 0;
        // Carrier at M4 (dies to direct hit). Adjacent allies at M3 and B4.
        // M4 (q=2,r=1); M3 (q=1,r=1) Δ=(-1,0) ✓ adjacent.
        // B4 (q=2,r=2); M4 Δ=(0,1) ✓ adjacent.
        // Bomb 1: tier=100, stacks=1, damagePerStack=1000, affinityMult=1.5 (must NOT affect splash).
        //   splash = 1×1000×0.25 = 250.
        // Bomb 2: tier=300, stacks=1, damagePerStack=2000, affinityMult=1 (neutral).
        //   splash = 1×2000×0.75 = 1500.
        // Expected per-ally: 250 + 1500 = 1750.
        const bomb1: PendingBomb = {
            countdown: 3,
            damagePerStack: 1000,
            stacks: 1,
            tier: 100,
            sourceId: 'attacker',
            affinityMult: 1.5, // non-neutral — must not change splash
            detonationDamageModifier: 0,
            splashModifier: 0,
        };
        const bomb2: PendingBomb = {
            countdown: 3,
            damagePerStack: 2000,
            stacks: 1,
            tier: 300,
            sourceId: 'attacker',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 0,
        };
        const expectedPerAlly = splashDamageForBomb(bomb1) + splashDamageForBomb(bomb2); // 250 + 1500 = 1750

        // Use a skill-free carrier to isolate the pre-seeded bombs (no bomb from the skill).
        const isolatedInput = BASE({
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                        ],
                    },
                ],
            },
            enemyAttackers: [
                enemyAt('enemy-carrier', 'M4', 5000),
                enemyAt('enemy-ally1', 'M3', 1_000_000_000),
                enemyAt('enemy-ally2', 'B4', 1_000_000_000),
            ],
            __testTapActors: (actors) => {
                const carrier = actors.find((a) => a.id === 'enemy-carrier');
                if (carrier) {
                    carrier.pendingBombs.push(bomb1, bomb2);
                }
            },
        });

        const result = runCombat(isolatedInput);
        const round = result.rounds[0];

        expect(round.perActorSplash?.['enemy-ally1']).toBe(expectedPerAlly);
        expect(round.perActorSplash?.['enemy-ally2']).toBe(expectedPerAlly);
    });

    // ─── (e) Dead applier still splashes ─────────────────────────────────────
    // The bomb's sourceId refers to an actor that is already destroyed (destroyedRound set)
    // when the carrier dies. The splash must still fire (no applier-liveness check).
    it('(e) dead applier: splash fires even when the bomb sourceId actor is already destroyed', () => {
        idc = 0;
        // Carrier at M4, ally at M3. Carrier has a pre-seeded bomb whose sourceId is
        // 'enemy-dead-applier', a separate enemy actor that is already marked destroyed
        // (destroyedRound set before rounds start via __testTapActors).
        const deadApplierBomb: PendingBomb = {
            countdown: 3,
            damagePerStack: 5000 * (BOMB_TIER / 100), // same math as EXPECTED_SPLASH
            stacks: BOMB_STACKS,
            tier: BOMB_TIER,
            sourceId: 'enemy-dead-applier',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 0,
        };
        const expectedDeadApplierSplash = splashDamageForBomb(deadApplierBomb); // 10000

        const input = BASE({
            // Use a damage-only skill (no bomb from skill) so only the pre-seeded bomb fires.
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                        ],
                    },
                ],
            },
            enemyAttackers: [
                enemyAt('enemy-carrier', 'M4', 5000),
                enemyAt('enemy-mid', 'M3', 1_000_000_000),
                // The applier is part of the roster but at a non-adjacent position and pre-marked dead.
                enemyAt('enemy-dead-applier', 'M1', 1_000_000_000),
            ],
            __testTapActors: (actors) => {
                const carrier = actors.find((a) => a.id === 'enemy-carrier');
                if (carrier) carrier.pendingBombs.push(deadApplierBomb);
                // Mark the applier as already destroyed before rounds start.
                const applier = actors.find((a) => a.id === 'enemy-dead-applier');
                if (applier) applier.destroyedRound = 0;
            },
        });

        const result = runCombat(input);
        const round = result.rounds[0];

        // Splash fired despite the applier being dead.
        expect(round.perActorSplash?.['enemy-mid']).toBe(expectedDeadApplierSplash);
    });

    // ─── (f) Cheat-death survivor does NOT splash ─────────────────────────────
    // An enemy with pendingBombs takes a lethal hit but has a recurring Cheat-Death aura
    // (registered via a passive self-buff ability). The engine intercepts the death, sets
    // HP to 1 — the ship never enters the splash branch → no splash fires.
    it('(f) cheat-death save: fatal hit intercepted → ship survives → no splash', () => {
        idc = 0;
        // Front enemy (M4) HP 5000 → lethal 5000 hit. Has Cheat Death aura via passive ability.
        // Mid ally at M3 (adjacent). If splash fired, ally would take EXPECTED_SPLASH; it must not.
        const cheatDeathAuraAbility = ab({
            type: 'buff',
            target: 'self',
            trigger: 'on-cast', // trigger unused for aura; aura is always-active
            config: {
                type: 'buff',
                buffName: 'Cheat Death',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 'recurring', // recurring → registered as aura, always active
            },
        });
        const cheatDeathEnemy: NonNullable<CombatEngineInput['enemyAttackers']>[number] = {
            id: 'enemy-cheat-death',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 5000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            // Passive slot → castPathCheatDeath = false → registered as aura
            shipSkills: {
                slots: [
                    {
                        slot: 'passive',
                        abilities: [cheatDeathAuraAbility],
                    },
                ],
            },
        };
        const input = BASE({
            enemyAttackers: [
                cheatDeathEnemy,
                enemyAt('enemy-mid', 'M3', 1_000_000_000), // adjacent ally — MUST take no splash
            ],
        });

        const result = runCombat(input);
        const round = result.rounds[0];

        // Cheat Death intercepted → no splash → enemy-mid is unharmed by splash.
        expect(round.perActorSplash).toBeUndefined();
        // enemy-mid took no damage at all (outside the base footprint, no splash fired).
        expect(round.perTargetDamage?.['enemy-mid']).toBeUndefined();
    });

    // ─── (g) splashModifier: 50 gives 1.5× splash ────────────────────────────
    // A pre-seeded bomb with splashModifier=50 must produce 1.5× the baseline splash.
    // Uses __testTapActors to inject the bomb directly onto the carrier, isolating the
    // splashModifier field. Mirrors case (e) structurally.
    it('(g) splashModifier: 50 on a pre-seeded bomb gives 1.5× the baseline splash', () => {
        idc = 0;
        const baselineBomb: PendingBomb = {
            countdown: 3,
            damagePerStack: 5000 * (BOMB_TIER / 100), // 10000
            stacks: BOMB_STACKS,
            tier: BOMB_TIER,
            sourceId: 'enemy-carrier',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 50,
        };
        const expectedSplash = splashDamageForBomb(baselineBomb, 50); // 10000 × 1.5 = 15000

        const input = BASE({
            // Damage-only skill: the direct hit kills the carrier; no bomb from the skill.
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                        ],
                    },
                ],
            },
            enemyAttackers: [
                enemyAt('enemy-carrier', 'M4', 5000),
                enemyAt('enemy-mid', 'M3', 1_000_000_000),
            ],
            __testTapActors: (actors) => {
                const carrier = actors.find((a) => a.id === 'enemy-carrier');
                if (carrier) carrier.pendingBombs.push(baselineBomb);
            },
        });

        const result = runCombat(input);
        const round = result.rounds[0];

        // The splash must be 1.5× the default (splashModifier flows through to the helper).
        expect(round.perActorSplash?.['enemy-mid']).toBe(expectedSplash);
    });
});
