/**
 * SP-4b-2 D1 — the accumulate-detonate (Echoing Burst) gather on a POSITIONAL run.
 *
 * `processAccumulators` grows each pending accumulator by "the direct damage the ACCUMULATING
 * side dealt this round" and bursts `accumulated × pct/100` on expiry. That input used to be a
 * bare sum over the scalar `roundDamage` map — a map a positional cast never writes, because its
 * direct credit is deliberately suppressed in favour of the per-victim apply. So on every
 * positional run the gather was 0 by construction and the whole Echoing Burst gear-set family
 * detonated for nothing, for every user.
 *
 * Measured @841e1bc0 (pre-positional) vs HEAD on the `teamWalk` Echoing Burst fixture:
 * burst 60000 (with a damaging team ship) / 30000 (without) → 0 / 0.
 *
 * These tests pin the three properties a bare `> 0` assertion cannot:
 *   • the burst SCALES with the gathered damage (two runs, different gather, proportional burst);
 *   • the gather is SIDE-SCOPED and works from the player side too (the enemy-side mirror);
 *   • the two credit channels do not DOUBLE-COUNT (a positional cast contributes exactly once).
 *
 * Crit 0 everywhere → every value is an exact integer and no RNG is drawn.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingAccumulator } from '../state';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

let idc = 0;
const damageAbility = (multiplier: number): Ability => ({
    id: `agd${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});
const damageSlot = (multiplier: number): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [damageAbility(multiplier)] }],
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
/** Single origin cell — the anchor alone (range MUST be 0; see DEFAULT_BASE_PATTERN). */
const singleCell = (): ParsedPattern => ({ raw: 'single', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
const enemyAt = (
    id: string,
    position: Position,
    hp: number,
    attack = 0,
    speed = 1,
    shipSkills: ShipSkills = { slots: [] }
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills,
    }) as EnemyAttacker;

/** An identical-to-the-focus walked team ship: same attack, so it doubles the side's direct. */
const TEAM_STATS = {
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    hacking: 0,
    security: 0,
    defence: 0,
    hp: 1_000_000,
    speed: 140,
};

const accumulator = (
    accumulated: number,
    pct: number,
    roundsRemaining: number,
    sourceId: string
): PendingAccumulator => ({ accumulated, pct, roundsRemaining, sourceId });

/** A positional player→enemy base: focus at M4, single-cell cast at the front enemy. */
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageSlot(100),
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
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    speed: 100,
    position: 'M4',
    target: frontTarget(),
    pattern: singleCell(),
    enemyAttackers: [enemyAt('enemy-front', 'M4', 1_000_000_000)],
    ...overrides,
});

describe('SP-4b-2 D1 — accumulate-detonate gathers real direct damage on a positional run', () => {
    // The gather is the ONLY variable between the two runs below: same accumulator, same focus,
    // same enemy. Run B adds a walked team actor whose own positional cast doubles the side's
    // direct output, so a burst that truly scales with the gather must double too. A single
    // `> 0` assertion would pass on a constant; a RATIO cannot.
    it('the burst scales with the gathered direct damage (player side)', () => {
        const run = (withTeam: boolean) =>
            runCombat(
                BASE({
                    __testTapActors: (actors: CombatActor[]) => {
                        // Seeded on the ENEMY (the accumulate-detonate victim), gathering the
                        // PLAYER side's direct — the normal Echoing Burst direction.
                        actors
                            .find((a) => a.id === 'enemy-front')
                            ?.pendingAccumulators.push(accumulator(0, 100, 1, 'attacker'));
                    },
                    ...(withTeam
                        ? {
                              teamActors: [
                                  {
                                      id: 'team-1',
                                      speed: 140, // acts before the focus and before the enemy
                                      chargeCount: 0,
                                      startCharged: false,
                                      selfBuffs: [],
                                      enemyDebuffs: [],
                                      shipSkills: damageSlot(100),
                                      stats: TEAM_STATS,
                                      walk: {
                                          shipSkills: damageSlot(100),
                                          stats: TEAM_STATS,
                                          selfDotModifier: 0,
                                          defensePenetrationBuff: 0,
                                          affinityDamageModifier: 0,
                                          affinityCritCap: 100,
                                          affinityCritPenalty: 0,
                                          hasChargedSkill: false,
                                      },
                                  },
                              ],
                          }
                        : {}),
                })
            );

        const solo = run(false);
        const withTeam = run(true);

        // Focus alone: 1000 attack × 100% = 1000 direct, gathered once, pct 100 → burst 1000.
        expect(solo.rounds[0].perActorDetonation?.['attacker']).toBe(1000);
        // Focus + an identical team ship: the side dealt 2000 this round → burst 2000.
        expect(withTeam.rounds[0].perActorDetonation?.['attacker']).toBe(2000);
        // The RATIO is the point: the burst tracks the gather, it is not a constant.
        expect(withTeam.rounds[0].perActorDetonation!['attacker']).toBe(
            2 * solo.rounds[0].perActorDetonation!['attacker']
        );
    });

    // Team symmetry (LOCKED): the same gather has to work when the accumulating side is the
    // ENEMY side and the accumulator sits on a PLAYER actor. Before D1 this direction was
    // documented in the engine as "an INERT placeholder — the symmetric all-enemies-direct sum is
    // not exposed", which was true only because nothing ever fed it.
    it('the enemy-side mirror gathers the ENEMY side direct damage, not the player side', () => {
        const result = runCombat(
            BASE({
                // The focus deals a LARGE hit; the enemy deals a small one. If the gather read the
                // wrong side, the burst would be 5000 rather than 700 — the sides are deliberately
                // far apart so a mix-up cannot hide inside a rounding tolerance.
                attack: 5000,
                speed: 1, // the enemy (speed 50) acts FIRST, so its direct is already credited
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000, 700, 50, damageSlot(100)),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    // Seeded on the PLAYER focus: it bursts on the focus's OWN turn, gathering the
                    // damage its OPPOSING (enemy) roster has dealt this round.
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingAccumulators.push(accumulator(0, 100, 1, 'enemy-front'));
                },
            })
        );

        // 700 attack × 100% = 700 enemy direct, gathered once, pct 100 → burst 700 on the focus.
        expect(result.rounds[0].perActorDetonation?.['enemy-front']).toBe(700);
        // …and NOT the focus's own 5000 — proof the sum is scoped to the accumulating side.
        expect(result.rounds[0].perActorDetonation?.['enemy-front']).not.toBe(5000);
    });

    // No double-count. The scalar credit and its positional twin sit in the two branches of ONE
    // `if (positional)`, so a cast can only reach one of them. Measured here as an exact equality
    // rather than an inequality: with pct 100 and one gathering round the burst IS the round's
    // direct damage — 2× would mean both channels fired for the same cast.
    it('a positional cast contributes to the gather EXACTLY once', () => {
        const result = runCombat(
            BASE({
                attack: 1234,
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-front')
                        ?.pendingAccumulators.push(accumulator(0, 100, 1, 'attacker'));
                },
            })
        );
        const focusDirect = result.rounds[0].perTargetDealt?.['attacker']?.['enemy-front'];
        // The victim's dealt tally this round is the firing hit PLUS the burst that landed on it,
        // so the firing hit alone is that total minus the burst.
        const burst = result.rounds[0].perActorDetonation?.['attacker'] ?? 0;
        expect(focusDirect! - burst).toBe(1234);
        expect(burst).toBe(1234); // one contribution, not two
    });

    // SP-4c-2a (B1): this fixture used to build the "0-max-HP pressure source" roster
    // (`bareEnemy({ stats: { hp: 0 } })`) specifically to keep the run NON-positional — every
    // opposing member had 0 max HP, so `resolvesPositionalVictim` found nobody targetable
    // (positionalBinding.ts) and the cast fell back to the legacy scalar `enemy` sink. The
    // targetable-HP floor (`normalizeRoster.ts`, MIN_TARGETABLE_MAX_HP) now raises that enemy to
    // 1,000,000 HP unconditionally, so it is a real, hittable roster member and the run IS
    // positional — the non-positional shape this test used to pin is gone (SP-4c-2a Task 1). The
    // legacy `'enemy'` dummy actor still exists (engine.ts still creates it unconditionally) but is
    // inert on a positional run — dropped from the turn order and never credited — so the tap moves
    // onto the real enemy (`BARE_ENEMY_ID`) instead. The dummy's deletion is rung 4c-2d's job. The
    // read moves to the per-victim channel, the same migration as
    // "a positional cast contributes to the gather EXACTLY once" above.
    it('a run that used to be a NON-positional pressure source is now positional, and the accumulator gathers through the per-victim channel', () => {
        const result = runCombat({
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
            attack: 4321,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: damageSlot(100),
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
            healModifier: 0,
            __testTapActors: (actors: CombatActor[]) => {
                // The floor makes this enemy real and hittable, so the accumulator sits on ITS id.
                // The legacy dummy (`'enemy'`) still exists but is inert here — dropped from the
                // turn order and never credited on a positional run — so it would receive nothing.
                actors
                    .find((a) => a.id === BARE_ENEMY_ID)
                    ?.pendingAccumulators.push(accumulator(0, 100, 1, 'attacker'));
            },
        } as CombatEngineInput);
        // Same shape as the "contributes EXACTLY once" case above: the victim's per-victim tally
        // is the firing hit plus the burst that lands on it, so the firing hit alone is the total
        // minus the burst.
        const focusDirect = result.rounds[0].perTargetDealt?.['attacker']?.[BARE_ENEMY_ID];
        const burst = result.rounds[0].perActorDetonation?.['attacker'] ?? 0;
        expect(focusDirect! - burst).toBe(4321);
        expect(burst).toBe(4321);
        // Anti-vacuity: on a positional run the scalar channel stays empty. If a future change
        // made this shape non-positional again, this would fail and flag the drift.
        expect(result.rounds[0].directDamage).toBe(0);
        expect(result.rounds[0].perTargetDealt).not.toBeUndefined();
    });
});
