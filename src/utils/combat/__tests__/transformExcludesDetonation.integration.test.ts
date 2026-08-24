/**
 * Voron/Orel's damage→DoT transform applies to DIRECT damage ONLY (owner ruling, #355).
 *
 * "When directly damaged, transforms the damage into a Damage over Time effect lasting N turns."
 * Bomb DETONATION damage and bomb SPLASH damage are detonation damage, not direct damage, so
 * neither transforms. Both arrive at `applyVictimDamage` stamped `byDirectDamage: true` with their
 * whole amount in `bombPortion` (the burst sites pass `bombPortion: damage`, the splash site
 * `bombPortion: splash`), so the funnel's own definition of a direct hit —
 * `byDirectDamage === true && bombPortion === 0` — is exactly the discriminator, and it is the one
 * the transform step now carries. That also makes the step agree with its one-shot siblings (Hit
 * Mitigation, Shield Converter), which have always carried that clause for their own reason.
 *
 * OBSERVABLE. A transformed hit is REVERSED out of the victim's `.incoming` bucket
 * (`convertHitToSelfDot` books `addIncoming(-damage)`) because the amount is deferred and re-books
 * per DoT tick. So `perActorIncoming[victim].incoming` nets to ~0 on a transformed hit and reads
 * the full amount on an untransformed one. That single number separates the two outcomes cleanly,
 * in the round the hit lands.
 *
 * INSTRUMENT VALIDITY. Every "not transformed" case is paired with a DIRECT hit on the SAME actor
 * carrying the SAME passive, asserted to BE transformed. Without that pair, a fixture whose passive
 * silently failed to attach would report "not transformed" for every arm and read as a pass while
 * proving nothing.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';
import { splashDamageForBomb } from '../bombSplash';

const BURST = 1000; // stacks × damagePerStack, neutral mults
const HP = 10_000_000; // nothing dies except where a case wants it to

/** Voron: transforms any direct hit into a 3-round DoT, unconditionally. */
const voronTransform: Ability = {
    id: 'voron-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'transform-incoming-to-dot', turns: 3, condition: 'always' },
};

/** A player team actor. `hp` is overridable so the splash case can make its carrier die. */
const teamActor = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'] = [],
    hp = HP
): TeamActorEngineInput => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    position,
    walk: {
        shipSkills: { slots },
        stats: {
            attack: 0,
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
        hasChargedSkill: false,
    },
});

/** A positioned enemy. `attack` > 0 makes it fire one real 100% direct hit at the front player. */
const enemy = (attack: number) =>
    ({
        id: 'enemy-1',
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M1',
        target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} } as ParsedPattern,
        shipSkills: {
            slots: attack
                ? [
                      {
                          slot: 'active',
                          abilities: [
                              {
                                  id: 'enemy-hit',
                                  type: 'damage',
                                  target: 'enemy',
                                  trigger: 'on-cast',
                                  conditions: [],
                                  config: { type: 'damage', multiplier: 100 },
                              },
                          ],
                      },
                  ]
                : [],
        } as ShipSkills,
    }) as unknown as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A timed bomb that bursts on its carrier's OWN next turn. */
const timedBomb = (): PendingBomb => ({
    countdown: 1,
    damagePerStack: BURST,
    stacks: 1,
    tier: 100,
    sourceId: 'enemy-1',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

/** The focus is inert — only the enemy hit and the burst/splash write the player channels. */
const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [enemy(0)],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    healModifier: 0,
    healTargetId: 'voron',
    mode: 'battle',
    position: 'M2',
    ...overrides,
});

/** Round-1 intake for one actor, plus the burst/splash evidence and any DoT ticks it took across
 *  the whole run. A transformed hit nets `.incoming` to ~0 AND shows up later as generic ticks —
 *  both halves matter, because a hit that never landed at all also nets to ~0. */
const intake = (input: CombatEngineInput, id: string) => {
    const bus = createEventBus();
    const bursts: CombatEvent[] = [];
    const ticks: CombatEvent[] = [];
    bus.on('bomb-detonated', (e) => bursts.push(e as CombatEvent));
    bus.on('dot-ticked', (e) => ticks.push(e as CombatEvent));
    const r1 = runCombat({ ...input, bus }).rounds[0];
    const genericTicks = ticks.filter(
        (e) =>
            (e as { targetId: string; dotType: string }).targetId === id &&
            (e as { dotType: string }).dotType === 'generic'
    );
    return {
        incoming: r1.perActorIncoming?.[id]?.incoming ?? 0,
        splash: r1.perActorSplash?.[id] ?? 0,
        bursts,
        genericTicks,
        genericTickTotal: genericTicks.reduce((t, e) => t + (e as { damage: number }).damage, 0),
    };
};

describe('the damage→DoT transform excludes detonation damage (owner ruling, #355)', () => {
    it('CONTROL: a DIRECT hit on the same actor IS transformed — the passive is armed', () => {
        // The enemy's 1000 direct hit lands on 'voron' at M4 (the front-most player). Transformed →
        // reversed out of `.incoming`. If this read 1000 the passive never attached and every "not
        // transformed" assertion below would be vacuous.
        //
        // Two rounds, and BOTH halves asserted. `.incoming ≈ 0` alone only proves the immediate
        // intake was reversed — it is equally consistent with the hit never landing at all (a
        // mis-positioned victim, an enemy that never fired), which is exactly the vacuity this
        // control exists to rule out. The generic DoT ticking in round 2 is the positive evidence
        // that the hit landed AND was converted.
        const c = intake(
            BASE({
                numRounds: 2,
                teamActors: [
                    teamActor('voron', 'M4', [{ slot: 'passive', abilities: [voronTransform] }]),
                ],
                enemyAttackers: [enemy(BURST)],
            }),
            'voron'
        );
        expect(c.incoming).toBeCloseTo(0, 6); // deferred out of round 1
        expect(c.genericTicks.length).toBeGreaterThan(0); // and it really became a DoT
        expect(c.genericTickTotal).toBeGreaterThan(0);
    });

    it('a bomb DETONATION on a transform carrier is NOT transformed — it lands in full', () => {
        const c = intake(
            BASE({
                teamActors: [
                    teamActor('voron', 'M4', [{ slot: 'passive', abilities: [voronTransform] }]),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'voron')?.pendingBombs.push(timedBomb());
                },
            }),
            'voron'
        );

        // The burst fired (not a fixture that silently failed to seed).
        expect(c.bursts).toHaveLength(1);
        expect(c.bursts[0]).toMatchObject({ victimId: 'voron', damage: BURST });
        // Detonation damage, so no transform: the whole burst is recorded as intake NOW rather than
        // deferred into a DoT. Before the ruling this read ~0 with the amount ticking later.
        expect(c.incoming).toBeCloseTo(BURST, 6);
        expect(c.genericTicks).toHaveLength(0); // the mirror of the control's positive tick
    });

    it('a bomb SPLASH on a transform carrier is NOT transformed either', () => {
        // 'carrier' at M4 holds a bomb and has only 1 HP of slack below the burst, so the burst
        // KILLS it and its still-pending bomb death-splashes to the adjacent 'voron' at M3.
        const bomb = timedBomb();
        const SPLASH = splashDamageForBomb(bomb); // 1 × 1000 × 0.25 = 250
        const c = intake(
            BASE({
                teamActors: [
                    teamActor('carrier', 'M4', [], BURST - 1), // dies to its own burst
                    teamActor('voron', 'M3', [{ slot: 'passive', abilities: [voronTransform] }]),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    // Two bombs: one bursts lethally, the second is the one that splashes. (A single
                    // bomb also splashes — it is spliced only after the burst — but seeding two keeps
                    // this case independent of that ordering, which its own test in
                    // bombSplashOnDeath.integration.test.ts already pins.)
                    const carrier = actors.find((a) => a.id === 'carrier');
                    carrier?.pendingBombs.push(timedBomb());
                    carrier?.pendingBombs.push({ ...timedBomb(), countdown: 5 });
                },
            }),
            'voron'
        );

        // The splash really reached 'voron'.
        expect(c.splash).toBeGreaterThan(0);
        // Splash is detonation damage: recorded now, not deferred into a DoT. `perActorSplash`
        // always reported the full throw; `.incoming` is what the transform would have zeroed.
        expect(c.incoming).toBeCloseTo(c.splash, 6);
        expect(c.incoming).toBeGreaterThanOrEqual(SPLASH);
        expect(c.genericTicks).toHaveLength(0);
    });
});
