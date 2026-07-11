/**
 * Protection damage transfer — ENGINE integration (Task 5, apply seam in applyVictimDamage).
 *
 * A living ally that holds >=1 Protection stack intercepts a fraction (10%/stack) of an ally's
 * DIRECT hit. The redirected chunk keeps the ORIGINAL target's affinity/outgoing (both already
 * baked into the hit's `damage`) and re-mitigates on the PROTECTOR's own defense — realized by
 * the mit-ratio inside `protectionCascade`. This file drives the wiring END-TO-END through
 * `runCombat` and reads the post-transfer per-actor intake from `RoundData.perActorIncoming`.
 *
 * Harness note (seeding Protection where `protectorsFor` can see it): `protectorsFor` reads
 * `statusEngine.snapshot(id).activeSelfBuffs`, which surfaces only SCHEDULED (non ability-sourced)
 * self-buffs, and scheduled self-buffs land on the 'attacker' owner. So the reliably snapshot-
 * visible protector in this harness is the FOCUS ('attacker'); the VICTIM is a team-actor ally it
 * is adjacent to (non-positional adjacency = all same-side allies). We seed the focus with a
 * per-round accumulating 'Protection' buff (rate = N, maxStacks = N) so round 1's top-of-round
 * tick lands exactly N stacks in the focus's snapshot. See the report for the production-visibility
 * caveat (real Meatshield-style Protection is granted as an AURA ability status, which snapshot
 * excludes — a Task 2/4 design concern outside this task's scope).
 *
 * The multi-protector CASCADE math + fastest-first ordering intent (the original test (c)) is
 * covered as a pure-function property in protectionTransfer.test.ts ("multi-protector cascade:
 * each protector skims the PREVIOUS protector chunk"). Two snapshot-visible protectors cannot be
 * staged end-to-end in this harness (only 'attacker' carries scheduled self-buffs), so (c) is
 * asserted at that `protectionCascade` seam here for completeness.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { protectionCascade } from '../protectionTransfer';
import type { SelectedGameBuff } from '../../../types/calculator';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A flat enemy attacker (no shipSkills → engine synthesizes a single 100% basic hit). An optional
 *  `affinityDamageModifier` folds the attacker's affinity edge vs its TARGET into the hit. */
const manualEnemy = (id: string, attack: number, affinityDamageModifier = 0): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    affinityDamageModifier,
});

/** A walked player team actor (a pure victim stat block, role ATTACKER so it is a valid victim). */
const teamActor = (id: string, defence: number): TeamActorEngineInput => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** A per-round accumulating 'Protection' self-buff: rate = stacks, capped at stacks, so the round-1
 *  top-of-round accumulation lands EXACTLY `stacks` in the owner's snapshot. */
const protectionAccum = (stacks: number): SelectedGameBuff => ({
    id: 'prot-1',
    buffName: 'Protection',
    stacks,
    parsedEffects: {},
    isStackable: true,
    maxStacks: stacks,
    stackTrigger: 'per-round',
});

/** Total damage the actor actually TOOK across the run (post-transfer), read from the per-actor
 *  intake bucket (NOT the `attacked` event, which reports the pre-transfer hit value). */
const totalIncoming = (input: CombatEngineInput, id: string): number => {
    const res = runCombat(input);
    let sum = 0;
    for (const rd of res.rounds) sum += rd.perActorIncoming?.[id]?.incoming ?? 0;
    return sum;
};

/** Count of reactive-damage-performed events targeting `id`. */
const reactiveEventsTargeting = (input: CombatEngineInput, id: string): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.targetId === id) n++;
        }
    );
    runCombat({ ...input, bus });
    return n;
};

const ENEMY_ATTACK = 1000;
const PROTECTOR_DEFENCE = 300; // < victim defence (0) so the redirected chunk is amplified.
const mit = (defence: number): number =>
    defence > 0 ? 1 - calculateDamageReduction(defence) / 100 : 1;

const BASE_INPUT = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] }, // the focus deals no offence itself; it is only the protector.
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
    defence: PROTECTOR_DEFENCE, // the focus (protector) defence — drives the redirected chunk's mit.
    hp: 1_000_000_000,
    healTargetId: 'ally-1',
    ...overrides,
});

describe('Protection damage transfer (integration)', () => {
    it('a 3-stack protector takes 30% of the target hit (re-mitigated on its own defense); target keeps 70%', () => {
        // Focus ('attacker') is a 3-stack Protection protector; the team ally 'ally-1' (defence 0)
        // is the direct-hit victim. One enemy fires a single 1000 hit at the ally.
        const withProtector = (withProt: boolean): CombatEngineInput =>
            BASE_INPUT({
                selfBuffs: withProt ? [protectionAccum(3)] : [],
                teamActors: [teamActor('ally-1', 0)],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
            });

        const victimWithout = totalIncoming(withProtector(false), 'ally-1');
        const victimWith = totalIncoming(withProtector(true), 'ally-1');
        const protectorWith = totalIncoming(withProtector(true), 'attacker');

        // Control: full unmitigated hit lands on the 0-defence ally.
        expect(victimWithout).toBeCloseTo(ENEMY_ATTACK, 6);
        // Target keeps EXACTLY 70% (3 stacks → 30% transferred).
        expect(victimWith).toBeCloseTo(0.7 * victimWithout, 6);
        // Protector chunk = 0.30 × fullTargetDamage × mit(D_p)/mit(D_t). D_t = 0 → mit(D_t) = 1.
        const expectedChunk = 0.3 * ENEMY_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));
        expect(protectorWith).toBeCloseTo(expectedChunk, 4);
        // …and it is genuinely re-mitigated (protector defence > 0 → chunk < the raw 30% slice).
        expect(protectorWith).toBeLessThan(0.3 * ENEMY_ATTACK);

        // One aggregate reactive-damage-performed surfaces per protector (the per-stack sub-hits
        // are applied via recursive applyVictimDamage but the HP-curve/log surface is one event
        // carrying chunk.total — see the wiring; the brief's "one per stack" comment is inaccurate).
        expect(reactiveEventsTargeting(withProtector(true), 'attacker')).toBe(1);
    });

    it('redirect keeps the TARGET affinity, not the protector matchup', () => {
        // The enemy carries a +25% affinity edge vs its TARGET (the ally), folded into the hit via
        // affinityDamageModifier (thermal→chemical-style advantage). The protector's OWN matchup
        // (a hypothetical −25%) must NEVER be re-resolved onto the redirected chunk: the wiring
        // passes the already-affinity-baked `damage` into protectionCascade, which only swaps the
        // DEFENSE factor. So the chunk scales with the +25%, not a −25%.
        const AFF = 25;
        const build = (withProt: boolean): CombatEngineInput =>
            BASE_INPUT({
                selfBuffs: withProt ? [protectionAccum(3)] : [],
                teamActors: [teamActor('ally-1', 0)],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK, AFF)],
            });

        // The +25% edge is real: the ally-without-protector takes 1.25× the base hit.
        const fullTargetDamage = totalIncoming(build(false), 'ally-1');
        expect(fullTargetDamage).toBeCloseTo(ENEMY_ATTACK * (1 + AFF / 100), 4);

        const victimWith = totalIncoming(build(true), 'ally-1');
        const protectorWith = totalIncoming(build(true), 'attacker');
        // Target still keeps exactly 70% of its (affinity-boosted) hit.
        expect(victimWith).toBeCloseTo(0.7 * fullTargetDamage, 6);

        // The protector chunk reflects the TARGET's +25% edge (ratio ≈ 1.0 vs the +25% expectation).
        const expectedChunk = 0.3 * fullTargetDamage * (mit(PROTECTOR_DEFENCE) / mit(0));
        expect(protectorWith / expectedChunk).toBeCloseTo(1.0, 3);
        // …and it is NOT the −25% trap: had the redirect wrongly re-resolved to the protector's own
        // −25% matchup, the chunk would be ~0.6× the +25% expectation (0.75/1.25). It is not.
        expect(protectorWith / expectedChunk).toBeGreaterThan(0.9);
    });

    it("two protectors cascade by speed: slower protector skims the faster one's chunk", () => {
        // Two snapshot-visible protectors cannot be staged in the runCombat harness (only the
        // 'attacker' owner carries scheduled self-buffs — see the file header), so the cascade
        // property is asserted at the protectionCascade seam the wiring calls. Fastest-first order
        // is protectorsFor's responsibility; the cascade consumes the already-ordered list. Here P1
        // (2 stacks) is the faster protector, P2 (1 stack) the slower.
        // D=1000, targetMit=0.25 → P = 4000. frac1 = 0.2, frac2 = 0.1.
        const cascade = protectionCascade(1000, 0.25, [
            { mit: 0.5, stacks: 2 }, // P1 — faster
            { mit: 0.4, stacks: 1 }, // P2 — slower
        ]);
        // P1 inflow (P-space) = frac1 × P = 0.2 × 4000 = 800; P1 keeps (1 − frac2) × 800 × mit1.
        expect(cascade.chunks[0].total).toBeCloseTo((1 - 0.1) * 800 * 0.5, 6); // 360
        // P2 derives from P1's inflow (frac2 × 800 = 80), NOT the original hit; keeps 80 × mit2.
        expect(cascade.chunks[1].total).toBeCloseTo(0.1 * 800 * 0.4, 6); // 32
        // The target loses only the FIRST hop (frac1), not the full transferred sum.
        expect(cascade.targetRemainder).toBeCloseTo((1 - 0.2) * 1000, 6); // 800
    });
});
