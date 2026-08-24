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
 * ALSO covered as a pure-function property in protectionTransfer.test.ts ("multi-protector
 * cascade: each protector skims the PREVIOUS protector chunk") and is additionally driven
 * END-TO-END here (two AURA-granted, non-focus team-actor protectors of different speeds — the
 * same PRODUCTION PATH pattern as the aura test below), since two snapshot-visible ('attacker'-
 * owned) protectors cannot be staged in this harness (only 'attacker' carries scheduled
 * self-buffs).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { protectionCascade } from '../protectionTransfer';
import { createStatusEngine } from '../statusEngine';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

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

/** Finding 4 (#358 review): `manualEnemy` plus an explicit basic-hit active slot (mirroring the
 *  engine's own no-shipSkills synthesis, `buildEnemyPlayerActorRuntime`) and a PASSIVE aura
 *  self-buff granting the attacker defence PENETRATION. Needed because a fixture with pen: 0 no
 *  longer discriminates on the `cause.targetMitigation` threading below — post-A2 the funnel's
 *  `effectiveStatsOf(...).defence` re-derivation fallback ALSO folds a scheduled/timed self-defence
 *  buff, so it agrees with the caller even with the threading removed. Only defence penetration
 *  (never folded by the re-derivation, threaded or not) still forces the two paths apart. */
const manualEnemyWithPen = (id: string, attack: number, pen: number): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${id}-basic`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    {
                        id: `${id}-pen`,
                        type: 'buff',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'buff',
                            buffName: 'Defense Penetration',
                            parsedEffects: { defensePenetration: pen },
                            stacks: 1,
                            isStackable: true,
                        },
                    },
                ],
            },
        ],
    },
});

/** A walked player team actor (a pure victim stat block, role ATTACKER so it is a valid victim).
 *  Optional `passive` slots carry an ability (e.g. an aura Protection grant) for the actor.
 *  Optional `speed` (default 100) lets multi-protector tests stage a deterministic fastest-first
 *  cascade order (`protectorsFor` sorts protectors by effective speed descending). */
const teamActor = (
    id: string,
    defence: number,
    passive?: ShipSkills['slots'],
    speed = 100
): TeamActorEngineInput => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    walk: {
        shipSkills: { slots: passive ?? [] },
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

/** A passive slot that grants SELF `Protection` the PRODUCTION way — an AURA (buff config with an
 *  undefined duration + isStackable), the same classification a real Meatshield's start-of-combat
 *  "gains N stacks of Protection" passive parses to (SP-G G1b). It flows through
 *  `activeAbilityStatuses`, NOT `snapshot().activeSelfBuffs` — so it exercises the exact source the
 *  old `snapshot()`-only read missed. */
const protectionAuraPassive = (stacks: number): ShipSkills['slots'][number] => {
    const ability: Ability = {
        id: 'meatshield-protection',
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
    };
    return { slot: 'passive', abilities: [ability] };
};

/** Total damage the actor actually TOOK across the run (post-transfer), read from the per-actor
 *  intake bucket (NOT the `attacked` event, which reports the pre-transfer hit value). */
const totalIncoming = (input: CombatEngineInput, id: string): number => {
    const res = runCombat(input);
    let sum = 0;
    for (const rd of res.rounds) sum += rd.perActorIncoming?.[id]?.incoming ?? 0;
    return sum;
};

/** The focus's ACTIVE self-buff names, read from the same status engine the run uses. Proves a
 *  fixture's self-buff actually landed — a buff that silently fails to apply makes a "buffed vs
 *  unbuffed" comparison vacuous, since the two arms become the same board. (Scheduled `selfBuffs`
 *  are pre-applied config, so they emit no `buff-applied` event; the snapshot is the observable.) */
const activeSelfBuffNames = (input: CombatEngineInput): string[] =>
    createStatusEngine({ selfBuffs: input.selfBuffs, enemyDebuffs: input.enemyDebuffs })
        .snapshot('attacker')
        .activeSelfBuffs.map((b) => b.buffName);

/** The `amount` of every reactive-damage-performed event targeting `id`, in emission order. */
const reactiveAmountsTargeting = (input: CombatEngineInput, id: string): number[] => {
    const bus = createEventBus();
    const amounts: number[] = [];
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.targetId === id) amounts.push(e.amount);
        }
    );
    runCombat({ ...input, bus });
    return amounts;
};

/** Count of reactive-damage-performed events targeting `id`. Derived from the amounts helper so
 *  the two cannot drift; declared AFTER it so there is no temporal dead zone. */
const reactiveEventsTargeting = (input: CombatEngineInput, id: string): number =>
    reactiveAmountsTargeting(input, id).length;

const ENEMY_ATTACK = 1000;
const PROTECTOR_DEFENCE = 300; // < victim defence (0) so the redirected chunk is amplified.
const mit = (defence: number): number =>
    defence > 0 ? 1 - calculateDamageReduction(defence) / 100 : 1;

const BASE_INPUT = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] }, // the focus deals no offence itself; it is only the protector.
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
    mode: 'healing',
    // SP-4b-1: the normalization boundary places EVERY actor, so the focus can no longer sit off
    // the board as a pure bystander. Left unplaced it would be auto-placed on the front-middle
    // anchor `M4`, win the enemy's `front` selection outright, and become the direct-hit victim
    // instead of `ally-1` — which is the one thing every test in this file needs `ally-1` to be.
    // `M2` keeps it in the middle row (so it never outranks a team actor's default `M3`/`M4` in the
    // front->back scan) while staying clear of `M1`/`M4`, the two cells the positional tests below
    // place explicitly.
    position: 'M2',
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

        // One reactive-damage-performed per redirected SUB-HIT (3 stacks → 3 rows), matching what
        // the game shows the player. See the dedicated per-stack test below for the amounts.
        expect(reactiveEventsTargeting(withProtector(true), 'attacker')).toBe(3);
    });

    it('a 3-stack protector logs THREE reactive-damage rows (one per redirected sub-hit), each carrying that sub-hit’s own booked intake', () => {
        // The game shows N separate procs for an N-stack protector ("4643 ×3" as three rows), not
        // one aggregate. The engine already APPLIES the chunk as `stacks` separate sub-hits; this
        // pins that the LOG surfaces them one-for-one.
        const build = (stacks: number): CombatEngineInput =>
            BASE_INPUT({
                selfBuffs: [protectionAccum(stacks)],
                teamActors: [teamActor('ally-1', 0)],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
            });

        const amounts = reactiveAmountsTargeting(build(3), 'attacker');
        expect(amounts).toHaveLength(3);

        // Each row carries its OWN sub-hit intake (chunk.total / 3), not the aggregate.
        const expectedChunk = 0.3 * ENEMY_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));
        for (const a of amounts) expect(a).toBeCloseTo(expectedChunk / 3, 4);
        // …and the rows still sum to the full chunk — the display split moved no total.
        expect(amounts.reduce((s, a) => s + a, 0)).toBeCloseTo(expectedChunk, 4);
        // The per-row amount is genuinely a THIRD, not the aggregate repeated (the instrument
        // would fail if the emission had simply been duplicated N times).
        expect(amounts[0]).toBeLessThan(expectedChunk * 0.9);

        // The count tracks the STACK count, so it is reading the sub-hit loop and not a constant:
        // a 1-stack protector still logs exactly one row.
        expect(reactiveAmountsTargeting(build(1), 'attacker')).toHaveLength(1);
    });

    it('redirect keeps the TARGET affinity, not the protector matchup', () => {
        // The enemy carries a +25% affinity edge vs its TARGET (the ally): a REAL thermal→chemical
        // matchup, not a hand-set scalar. SP-4b-1: the hit now resolves positionally, and the
        // positional apply RE-RESOLVES the matchup per victim from the raw affinities
        // (victimHitDamage → computeAffinityModifiers(attackerAffinity, victim.affinity)) rather
        // than reading the pre-resolved `affinityDamageModifier` scalar. In production the two
        // always agree, because the adapter derives the scalar FROM those same raw affinities — so
        // stating the matchup rather than its pre-computed output is the shape this test needs.
        // The protector (the focus) is deliberately ELECTRIC, i.e. thermal→electric = −25%: exactly
        // the wrong matchup the redirect must NOT re-resolve onto the chunk. The wiring passes the
        // already-affinity-baked `damage` into protectionCascade, which only swaps the DEFENSE
        // factor, so the chunk scales with the target's +25%, never the protector's −25%.
        const AFF = 25;
        const build = (withProt: boolean): CombatEngineInput =>
            BASE_INPUT({
                selfBuffs: withProt ? [protectionAccum(3)] : [],
                affinity: 'electric', // the protector's own (disadvantaged) matchup — the trap.
                teamActors: [
                    {
                        ...teamActor('ally-1', 0),
                        walk: { ...teamActor('ally-1', 0).walk!, affinity: 'chemical' },
                    },
                ],
                enemyAttackers: [
                    { ...manualEnemy('enemy-1', ENEMY_ATTACK, AFF), affinity: 'thermal' },
                ],
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

    it("two protectors cascade by speed: slower protector skims the faster one's chunk (pure protectionCascade seam)", () => {
        // Fastest-first order is protectorsFor's responsibility; the cascade consumes the
        // already-ordered list. Here P1 (2 stacks) is the faster protector, P2 (1 stack) the
        // slower. The END-TO-END equivalent (real aura-granted protectors, driven through
        // applyVictimDamage) is the next test below.
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

    it("PRODUCTION PATH multi-protector cascade: two AURA-granted protectors of DIFFERENT speeds — the slower one derives from the faster one's chunk, not the original hit", () => {
        // Two non-focus team actors each grant THEMSELVES Protection via the production aura
        // path (mirrors the single-protector "PRODUCTION PATH" test above). 'prot-fast' (speed
        // 150, 2 stacks) is faster than 'prot-slow' (speed 50, 1 stack); protectorsFor sorts by
        // effective speed descending, so 'prot-fast' is P1 and 'prot-slow' is P2 in the cascade.
        const FAST_STACKS = 2; // frac1 = 0.2
        const SLOW_STACKS = 1; // frac2 = 0.1
        const FAST_DEFENCE = PROTECTOR_DEFENCE; // 300
        const SLOW_DEFENCE = 600;
        const input = BASE_INPUT({
            selfBuffs: [], // focus carries no Protection — both protectors are team actors.
            defence: 0,
            teamActors: [
                teamActor('ally-1', 0), // victim, 0 defence → targetMit = 1 → P = ENEMY_ATTACK.
                teamActor(
                    'prot-fast',
                    FAST_DEFENCE,
                    [protectionAuraPassive(FAST_STACKS)],
                    150 // faster
                ),
                teamActor(
                    'prot-slow',
                    SLOW_DEFENCE,
                    [protectionAuraPassive(SLOW_STACKS)],
                    50 // slower
                ),
            ],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
        });

        const victim = totalIncoming(input, 'ally-1');
        const fastProtector = totalIncoming(input, 'prot-fast');
        const slowProtector = totalIncoming(input, 'prot-slow');

        const frac1 = 0.1 * FAST_STACKS;
        const frac2 = 0.1 * SLOW_STACKS;
        const P = ENEMY_ATTACK; // targetMit = mit(0) = 1

        // Target loses only the FIRST hop (frac1 of its own hit).
        expect(victim).toBeCloseTo((1 - frac1) * ENEMY_ATTACK, 4);

        // Faster protector keeps (1 − frac2) of its P-space inflow (frac1 × P), re-mitigated on
        // its OWN defence.
        const expectedFast = (1 - frac2) * frac1 * P * mit(FAST_DEFENCE);
        expect(fastProtector).toBeCloseTo(expectedFast, 4);

        // THE CASCADE ASSERTION: the slower protector's damage derives from the FASTER
        // protector's chunk (frac2 × (frac1 × P)), NOT from the original hit (frac2 × P).
        const expectedSlow = frac2 * (frac1 * P) * mit(SLOW_DEFENCE);
        expect(slowProtector).toBeCloseTo(expectedSlow, 4);

        // Proof it is genuinely cascaded, not a direct skim of the original hit: a direct skim
        // of frac2 off the untouched original hit would be materially LARGER (no frac1 discount).
        const wouldBeDirectSkim = frac2 * P * mit(SLOW_DEFENCE);
        expect(slowProtector).toBeLessThan(wouldBeDirectSkim * 0.5);
        expect(slowProtector).toBeCloseTo(wouldBeDirectSkim * frac1, 4);
    });

    it('no Protection anywhere on the board → no redirect (hasAnyProtectionGrant gate short-circuits protectorsFor)', () => {
        // No ability anywhere on the board grants Protection (focus selfBuffs empty, no aura
        // passives on the team actor) — hasAnyProtectionGrant is false, so protectorsFor
        // short-circuits to [] and the ally eats the full, non-redirected hit.
        const input = BASE_INPUT({
            selfBuffs: [],
            teamActors: [teamActor('ally-1', 0)],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
        });

        const victim = totalIncoming(input, 'ally-1');
        const focus = totalIncoming(input, 'attacker');

        // Full hit lands on the ally — no redirect.
        expect(victim).toBeCloseTo(ENEMY_ATTACK, 6);
        // No chunk was ever redirected to the focus (which would be the protector if Protection existed).
        expect(focus).toBe(0);
    });

    it('PRODUCTION PATH: aura-granted Protection on a NON-focus team-actor protector fires the redirect (reads exactly the granted stacks, no double-count)', () => {
        // The whole point of the all-sources read: a real Meatshield grants Protection as an AURA
        // (activeAbilityStatuses), which the old snapshot()-only read MISSED — and it sits on a
        // TEAM actor, not the focus. Here 'prot-1' (a non-focus team actor) grants ITSELF 3 stacks
        // of Protection via an aura passive; 'ally-1' (also a team actor) is the direct-hit victim.
        const input = BASE_INPUT({
            selfBuffs: [], // the FOCUS carries NO Protection — the protector is a team actor.
            defence: 0, // focus is irrelevant here
            teamActors: [
                teamActor('ally-1', 0), // victim
                teamActor('prot-1', PROTECTOR_DEFENCE, [protectionAuraPassive(3)]), // aura protector
            ],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
        });

        const victim = totalIncoming(input, 'ally-1');
        const protector = totalIncoming(input, 'prot-1');

        // The redirect FIRES from an aura-granted, non-focus protector — proving the all-sources
        // read (not snapshot-only) is what makes real Protection live.
        expect(protector).toBeGreaterThan(0);
        // DOUBLE-COUNT GUARD: the victim keeps EXACTLY 70% → the resolver read EXACTLY 3 stacks
        // (0.30 transferred). A double-count (3 in snapshot + 3 in aura = 6) would transfer 0.60
        // and leave 40% — this asserts the single-source read (the aura instance appears in ONLY
        // the activeAbilityStatuses source, never also snapshot).
        expect(victim).toBeCloseTo(0.7 * ENEMY_ATTACK, 6);
        // Protector chunk matches the same 3-stack magnitude as the focus-seeded case (a).
        const expectedChunk = 0.3 * ENEMY_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));
        expect(protector).toBeCloseTo(expectedChunk, 4);
    });

    it('Barrier on the target suppresses the redirect — protector takes nothing (Component A)', () => {
        // Same aura-protector harness as the "PRODUCTION PATH" test above (a non-focus team-actor
        // 'prot-1' grants ITSELF 3 Protection stacks via an aura passive; 'ally-1' is the
        // direct-hit victim) — but the VICTIM additionally carries an always-active 'Barrier'
        // self-buff. Barrier must be granted the SAME way Protection is here — as an aura ability
        // (`type:'buff'`, no `duration`, `target:'self'`) — because a plain entry on a team actor's
        // `selfBuffs` array only ever folds into the STATUS ENGINE's global 'attacker'-only
        // snapshot (statusEngine.ts's `alwaysSelf`/`accumSelf`, gated to `ownerId === 'attacker'`
        // in `snapshot()`); `selfBuffNamesForOwners` would never see it for 'ally-1''s own id.
        // Routing it through `activeAbilityStatuses('self', ..., 'ally-1')` (the aura branch,
        // per-owner) is what makes it visible to the victim's OWN `carriesBarrier` check.
        // Barrier fully nullifies the hit BEFORE the transfer block runs, so nothing is left to
        // redirect: the protector must take zero, and the victim's own barrierAbsorbed must equal
        // the full (non-vacuous) hit while its `.incoming` stays what it always is under Barrier
        // (the damage still "arrives" for accounting — see engine.ts's carriesBarrier comment —
        // it just never touches HP).
        const barrierAuraPassive = (): ShipSkills['slots'][number] => {
            const ability: Ability = {
                id: 'barrier-self-aura',
                type: 'buff',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'buff',
                    buffName: 'Barrier',
                    parsedEffects: {},
                    stacks: 1,
                    isStackable: false,
                },
            };
            return { slot: 'passive', abilities: [ability] };
        };
        const input = BASE_INPUT({
            selfBuffs: [], // the focus carries no Protection — the protector is a team actor.
            defence: 0,
            teamActors: [
                teamActor('ally-1', 0, [barrierAuraPassive()]), // victim, Barrier-immune this hit
                teamActor('prot-1', PROTECTOR_DEFENCE, [protectionAuraPassive(3)]), // aura protector
            ],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
        });

        const protector = totalIncoming(input, 'prot-1');
        const result = runCombat(input);
        const round1 = result.rounds[0];

        // Protector takes nothing: no redirect happened (Barrier suppressed it upstream).
        expect(protector).toBe(0);
        // Non-vacuous: the hit genuinely reached the victim and was fully absorbed by Barrier —
        // NOT a no-op where nothing fired at all.
        expect(round1.perActorIncoming?.['ally-1']?.barrierAbsorbed).toBeCloseTo(ENEMY_ATTACK, 6);
    });

    it('a PROTECTOR that also carries a full incoming-block ability credits ZERO damage taken for the blocked redirected chunk (the funnel\u2019s recorded intake, not chunk.total \u2212 transformedToDot)', () => {
        // Same aura-protector harness as the "PRODUCTION PATH" test above ('prot-1' grants ITSELF
        // 3 Protection stacks via an aura passive; 'ally-1' is the direct-hit victim) — but the
        // PROTECTOR additionally carries an always-active, 100%-chance, 100%-block
        // 'incoming-block' ability on ITSELF (granted the same aura way Protection/Barrier are
        // granted elsewhere in this file, so it is visible to the protector's OWN block check at
        // the applyVictimDamage funnel for its redirected sub-hit).
        //
        // The redirected chunk still leaves the target (cascade math is computed from the
        // protector's Protection stacks, independent of its block ability) — 'ally-1' keeps 70%
        // exactly like the PRODUCTION PATH test. But the protector's OWN incoming-block ability
        // then fully blocks its post-redirect sub-hit: the protector takes ZERO real damage and
        // transforms nothing into a DoT. The buggy accounting (`chunk.total − transformedToDot`)
        // would still credit the FULL chunk as damage taken by the protector, because
        // transformedToDot stays 0 for a pure block (no transform ability involved) — the fixed
        // accounting (summed `incomingBooked`, the intake applyVictimDamage recorded after its own
        // block and transform steps) must read 0 instead.
        const blockAuraPassive = (): ShipSkills['slots'][number] => {
            const ability: Ability = {
                id: 'full-block-self-aura',
                type: 'incoming-block',
                target: 'self',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'incoming-block',
                    condition: 'always',
                    procChance: 1,
                    blockPct: 1.0,
                    oncePerRound: false,
                },
            };
            return { slot: 'passive', abilities: [ability] };
        };
        const input = BASE_INPUT({
            selfBuffs: [], // the focus carries no Protection — the protector is a team actor.
            defence: 0,
            teamActors: [
                teamActor('ally-1', 0), // victim
                teamActor('prot-1', PROTECTOR_DEFENCE, [
                    protectionAuraPassive(3),
                    blockAuraPassive(),
                ]), // aura protector that ALSO fully blocks its own redirected sub-hit
            ],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
        });

        const victim = totalIncoming(input, 'ally-1');
        const protector = totalIncoming(input, 'prot-1');
        const result = runCombat(input);
        const round1 = result.rounds[0];
        const reactiveHitsOnProtector = reactiveEventsTargeting(input, 'prot-1');

        // The target still keeps 70% — the redirect itself is unaffected by the protector's OWN
        // block ability (that ability only gates what the PROTECTOR takes from its own chunk).
        expect(victim).toBeCloseTo(0.7 * ENEMY_ATTACK, 6);
        // The protector's `.incoming` bucket shows ZERO — the redirected chunk was fully blocked
        // before it ever landed as real intake.
        expect(protector).toBe(0);
        // THE CORE ASSERTION: the protector's credited round damage must NOT include the (fully
        // blocked) chunk. `perTargetDamage` is set ONLY when non-empty (RoundData's "absent when
        // empty" rule), so a wrongly-credited chunk would show up as a truthy, non-zero entry —
        // the fixed accounting must leave this key ABSENT entirely.
        expect(round1.perTargetDamage?.['prot-1']).toBeUndefined();
        // No reactive-damage-performed event should have fired for the protector either — the
        // `intakeTotal > 1e-9` guard must suppress emission for a fully-blocked chunk exactly like
        // it does for a fully DoT-transformed one. (NOT for a Barrier-nullified chunk: Barrier
        // leaves the intake recorded and nets it out via `barrierAbsorbed`, so that one is booked
        // and logged like any other barriered hit — pinned in the accounting block at the bottom
        // of this file.)
        expect(reactiveHitsOnProtector).toBe(0);
    });

    it('positional mode: Protection covers a NON-adjacent ally (all-allies, not hex-neighbours)', () => {
        // Every actor carries a position (SP-4b-1's boundary guarantees it), so `adjacentAllyIdsFor`
        // (adjacency.ts) narrows to hex-neighbours instead of falling back to "all living same-side
        // allies". T1's hex-neighbours are {T2, M1, M2} (see board.ts's AXIAL table / DIRECTIONS) —
        // B4 is deliberately NOT one of them. Under an adjacency-based resolution this protector
        // would be excluded from `protectorsFor`; Protection's confirmed model (coverage = ALL
        // living same-side allies, independent of board adjacency) must still redirect to it.
        //
        // Targeting geometry (SP-4b-1): `front` selection scans ROWS from the caster's own row and
        // only then picks the front-most column WITHIN that row (selectTargets). Pinning the enemy
        // to T1 makes row T the scan row, and `ally-1` is the sole player actor there — so the hit
        // lands on the victim rather than on the protector or the (row-M) focus. The protector
        // therefore has to leave row T, which is why it sits on B4 rather than T4.
        const input = BASE_INPUT({
            selfBuffs: [], // the focus carries no Protection — the protector is a team actor.
            defence: 0,
            teamActors: [
                { ...teamActor('ally-1', 0), position: 'T1' }, // victim — alone in row T
                {
                    ...teamActor('prot-1', PROTECTOR_DEFENCE, [protectionAuraPassive(3)]),
                    position: 'B4', // NOT a hex-neighbour of T1 — proves all-allies coverage.
                },
            ],
            enemyAttackers: [{ ...manualEnemy('enemy-1', ENEMY_ATTACK), position: 'T1' }],
        });

        const victim = totalIncoming(input, 'ally-1');
        const protectorIncoming = totalIncoming(input, 'prot-1');

        // The redirect fires even though the protector is NOT a hex-neighbour of the victim.
        expect(protectorIncoming).toBeGreaterThan(0);
        // Same 3-stack magnitude as the non-positional aura test above (identical coverage).
        expect(victim).toBeCloseTo(0.7 * ENEMY_ATTACK, 6);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// Task 6 — composition with `defense-substitution` (Meatshield R4, engine.ts:2907-2925).
//
// A carrier that BOTH substitutes its (high) defence for non-defender allies' incoming damage
// AND holds Protection stacks. Design doc §6: because transfer peels off P BEFORE the defence
// term, the non-transferred remainder correctly reads the SUBSTITUTED defence (this "just
// works" via the shared defence-read sites). But the transfer block's OWN `targetMit` (used to
// recover pre-defence P from the post-defence `damage`) must ALSO use the substituted defence —
// not the victim's own — or the recovered P (and every protector chunk) is skewed. This is the
// bug Task 6 fixes (engine.ts's Protection-transfer block, `targetMit` computation).
// ───────────────────────────────────────────────────────────────────────────────────────
describe('Protection transfer × defense-substitution composition (Task 6)', () => {
    const CARRIER_DEFENCE = 8000; // high, mirrors the spec's Cultivator-order-of-magnitude example.
    const STACKS = 3;
    const FRAC = 0.1 * STACKS;

    const defenseSubstitutionAbility: Ability = {
        id: 'meatshield-defense-sub',
        type: 'defense-substitution',
        target: 'all-allies',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'defense-substitution' },
    };
    const defenseSubstitutionSlot: ShipSkills['slots'][number] = {
        slot: 'passive',
        abilities: [defenseSubstitutionAbility],
    };

    /** Carrier = Meatshield-style: BOTH the R4 defense-substitution passive (substitutes its own
     *  HIGH defence for non-defender allies' incoming damage) AND N Protection stacks (redirects a
     *  fraction of allies' direct damage to itself). Protects 'ally-1', a LOW (0) defence
     *  non-defender ally (this file's `teamActor` hardcodes role 'ATTACKER'). */
    const buildInput = (grantProtection: boolean): CombatEngineInput =>
        BASE_INPUT({
            selfBuffs: [], // focus is an inert bystander — carries neither ability.
            defence: 0,
            teamActors: [
                teamActor('ally-1', 0),
                teamActor(
                    'carrier',
                    CARRIER_DEFENCE,
                    grantProtection
                        ? [defenseSubstitutionSlot, protectionAuraPassive(STACKS)]
                        : [defenseSubstitutionSlot]
                ),
            ],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
        });

    it('non-transferred remainder reads the SUBSTITUTED (carrier) defence; transferred chunk recovers P from that same substituted mitigation', () => {
        const input = buildInput(true);
        const allyDamage = totalIncoming(input, 'ally-1');
        const carrierDamage = totalIncoming(input, 'carrier');

        const substitutedMit = mit(CARRIER_DEFENCE);
        const expectedRemainder = (1 - FRAC) * ENEMY_ATTACK * substitutedMit;
        const expectedChunk = FRAC * ENEMY_ATTACK * substitutedMit;

        // (1) Composition holds: the ally's retained (1 - frac) share is computed AS IF it had
        // the carrier's HIGH defence (substitution), not its own (0, unmitigated) defence —
        // much smaller than the unsubstituted (1 - frac) x full hit would be.
        expect(allyDamage).toBeCloseTo(expectedRemainder, 4);
        expect(allyDamage).toBeLessThan((1 - FRAC) * ENEMY_ATTACK);

        // (2) THE FIX: the protector (carrier) chunk correctly recovers the pre-defence P from
        // the SUBSTITUTED mitigation (not the ally's own 0-defence no-op mitigation), then
        // re-mitigates on the protector's own defence (here, the same carrier).
        expect(carrierDamage).toBeCloseTo(expectedChunk, 4);

        // (3) Proof the fix matters: under the OLD bug (`targetMit` read off the victim's OWN
        // defence — 0, so targetMit = 1 short-circuits), the recovered P is just `damage`
        // unchanged, giving the chunk an extra spurious `substitutedMit` factor — a materially
        // SMALLER value than the correct chunk above. This is what the old code would have
        // produced; assert the real (fixed) result diverges from it well beyond noise.
        const oldBuggyChunk = FRAC * ENEMY_ATTACK * substitutedMit * substitutedMit;
        expect(oldBuggyChunk).toBeLessThan(expectedChunk);
        expect(carrierDamage).toBeGreaterThan(oldBuggyChunk * 1.5);
    });

    it('control: WITHOUT Protection stacks, the ally still gets the full substituted-defence hit (pure defense-substitution, no transfer)', () => {
        const allyDamage = totalIncoming(buildInput(false), 'ally-1');
        expect(allyDamage).toBeCloseTo(ENEMY_ATTACK * mit(CARRIER_DEFENCE), 4);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// Enemy-side symmetry (spec §8): the engine is team-agnostic by construction — `protectorsFor`
// resolves `bySide(isEnemySide(victim.id) ? 'enemy' : 'player')`, and the transfer block runs
// inside the shared `applyVictimDamage` core regardless of which sink (`playerSink`/`enemySink`)
// invokes it. This proves the redirect fires identically when the ATTACKER is on the PLAYER side
// and the protector+victim are on the ENEMY side (the mirror image of every test above).
//
// Staging note: a player→enemy hit only reaches `applyVictimDamage` (via `applyOutgoingToEnemy`)
// on the POSITIONAL apply path (drivePositionalApply) — reachable in this harness by giving the
// focus a board `position` + parsed `target`/`pattern` against a positioned `enemyAttackers[]`
// roster (mirrors src/utils/combat/__tests__/positionalDamage.integration.test.ts). The victim
// ('enemy-front') is positioned so the focus's `target:'front'` selection resolves it; the
// protector ('enemy-protector') is deliberately left UNPOSITIONED so `adjacentAllyIdsFor` falls
// back to "all living same-side allies" (adjacency.ts's non-positional branch — true whenever no
// OTHER same-side actor besides the owner carries a position), avoiding the need to compute a real
// hex-neighbour cell. Both enemy actors have `attack: 0` (pure damageable targets) so only the
// focus's positional hit is in play. The post-transfer per-actor intake is read the SAME way as
// every player-side test above (`totalIncoming` / `perActorIncoming`) — `applyOutgoingToEnemy`
// records into that identical bucket, keyed by the enemy victim's id.
describe('Protection transfer — enemy-side symmetry (protector + victim on the ENEMY side)', () => {
    // A no-passive single-hit basic-attack active slot (mirrors positionalDamage.integration.test.ts's
    // `basicAttack()`): multiplier 100 (1x), 1 hit, target:'enemy' — so the focus's firing-hit
    // damage equals its raw attack stat against a 0-defence victim.
    const positionalBasicAttack = (): ShipSkills['slots'][number] => ({
        slot: 'active',
        abilities: [
            {
                id: 'sym-basic-attack',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 100 },
            },
        ],
    });
    const parsedTargetFront: ParsedTarget = { raw: 'front', side: 'enemy', selection: 'front' };
    const basePattern: ParsedPattern = { raw: 'base', shape: 'base', range: 0, modifiers: {} };

    it('an enemy-side protector redirects a PLAYER attack the same way a player-side protector redirects an enemy attack; the enemy target keeps 70%', () => {
        const FOCUS_ATTACK = ENEMY_ATTACK; // same magnitude as the core player-side test, for a direct numeric mirror.

        const build = (withProt: boolean): CombatEngineInput => ({
            attack: FOCUS_ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [positionalBasicAttack()] },
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
            // `enemyAttackers` are built into real CombatActors from their presence; this test sets
            // healTargetId so the enemy attacks resolve against a real (healing-mode) heal target —
            // the same setup every test above already carries via `healTargetId`.
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTargetFront,
            pattern: basePattern,
            enemyAttackers: [
                {
                    id: 'enemy-front', // the VICTIM — positioned so target:'front' resolves it.
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    shipSkills: { slots: [] },
                },
                {
                    id: 'enemy-protector', // the PROTECTOR — deliberately unpositioned (see file note above).
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: PROTECTOR_DEFENCE,
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: { slots: withProt ? [protectionAuraPassive(3)] : [] },
                },
            ],
        });

        const victimWithout = totalIncoming(build(false), 'enemy-front');
        const victimWith = totalIncoming(build(true), 'enemy-front');
        const protectorWith = totalIncoming(build(true), 'enemy-protector');

        // Control: the unprotected enemy target takes the full firing-hit damage.
        expect(victimWithout).toBeCloseTo(FOCUS_ATTACK, 6);
        // Target keeps EXACTLY 70% — identical fraction to the player-side core test.
        expect(victimWith).toBeCloseTo(0.7 * victimWithout, 6);
        // Protector chunk = 0.30 × fullTargetDamage × mit(D_p)/mit(D_t); D_t = 0 → mit(D_t) = 1.
        const expectedChunk = 0.3 * FOCUS_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));
        expect(protectorWith).toBeCloseTo(expectedChunk, 4);
        // The protector actually took damage (the redirect fired), not a zero no-op.
        expect(protectorWith).toBeGreaterThan(0);
    });

    it('recovers the pre-defence amount using the mitigation the CALLER applied, including the attacker’s defence PENETRATION', () => {
        // The cascade recovers `P` (the pre-defence hit) by dividing the mitigated `damage` the
        // caller handed the funnel by the target's mitigation factor. If the funnel re-derives
        // that factor instead of being told it, any mitigation term the caller applied but the
        // funnel does not model skews P — and with it every protector chunk. Defence PENETRATION
        // is exactly such a term: the caller mitigates on `defence × (1 − pen/100)`, the funnel's
        // old recompute read the raw defence.
        //
        // `P` is invariant here BY CONSTRUCTION: no crit, no affinity edge, no outgoing/incoming
        // modifiers, multiplier 1× — so the pre-defence amount is exactly the focus's attack stat,
        // whatever mitigation the victim ends up applying. That makes `0.3 × FOCUS_ATTACK ×
        // mit(D_p)` the correct chunk for BOTH the pen and the no-pen run, which is what the
        // control below pins.
        const FOCUS_ATTACK = ENEMY_ATTACK;
        const VICTIM_DEFENCE = 500;

        const build = (pen: number): CombatEngineInput => ({
            attack: FOCUS_ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: pen,
            chargeCount: 0,
            shipSkills: { slots: [positionalBasicAttack()] },
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
            target: parsedTargetFront,
            pattern: basePattern,
            enemyAttackers: [
                {
                    id: 'enemy-front',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: VICTIM_DEFENCE, // non-zero, so penetration actually changes the mitigation
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    shipSkills: { slots: [] },
                },
                {
                    id: 'enemy-protector',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: PROTECTOR_DEFENCE,
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: { slots: [protectionAuraPassive(3)] },
                },
            ],
        });

        const expectedChunk = 0.3 * FOCUS_ATTACK * mit(PROTECTOR_DEFENCE);

        // Control (no penetration): the funnel's recompute and the caller's read agree, so this
        // arm passes both before and after the fix. It is here to prove the oracle above is the
        // right number, not an arbitrary constant.
        const noPenVictim = totalIncoming(build(0), 'enemy-front');
        expect(noPenVictim).toBeCloseTo(0.7 * FOCUS_ATTACK * mit(VICTIM_DEFENCE), 4);
        expect(totalIncoming(build(0), 'enemy-protector')).toBeCloseTo(expectedChunk, 4);

        // With 50% penetration the caller mitigates on HALF the victim's defence — proven by the
        // victim's own remainder, which must track mit(250), not mit(500). (Without this the
        // fixture could be vacuous: a penetration that never reached the damage read would leave
        // both arms identical and the assertion below meaningless.)
        const penVictim = totalIncoming(build(50), 'enemy-front');
        expect(penVictim).toBeCloseTo(0.7 * FOCUS_ATTACK * mit(VICTIM_DEFENCE / 2), 4);
        expect(penVictim).toBeGreaterThan(noPenVictim);

        // THE CORE ASSERTION: the protector's chunk is still 30% of the SAME pre-defence amount.
        // Pre-fix the funnel recovered P from mit(500) while the caller had used mit(250),
        // inflating the chunk by mit(250)/mit(500) ≈ 1.071.
        expect(totalIncoming(build(50), 'enemy-protector')).toBeCloseTo(expectedChunk, 4);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// The mitigation the cascade divides by must be the mitigation the CALLER applied — not a value
// the funnel re-derives from the victim's live stats. The two used to be computed independently
// and drifted for any victim whose mitigation the caller sourced differently from
// `effectiveStatsOf(...).defence`.
describe('Protection transfer — the cascade divides by the caller’s own mitigation', () => {
    /** A plain (non-accumulating) self-buff that raises the owner's Defense by `pct`%. */
    const defenceUp = (pct: number): SelectedGameBuff => ({
        id: 'def-up-1',
        buffName: 'Defense Up',
        stacks: 1,
        parsedEffects: { defense: pct },
        isStackable: false,
    });

    const VICTIM_DEFENCE = 500;
    // Finding 4 (#358 review): non-zero, so this fixture still DISCRIMINATES on the
    // `cause.targetMitigation` threading below. With pen: 0, post-A2 the funnel's
    // `effectiveStatsOf(...).defence` re-derivation fallback also folds the victim's SCHEDULED
    // 'Defense Up', so removing the threading would leave this test passing for the wrong reason
    // (measured). Penetration is never folded by that re-derivation either way, so it alone still
    // forces the caller's read and a re-derived read apart when the threading is removed.
    const ENEMY_PEN = 50;

    /** The FOCUS is the victim here (it is the only actor in this harness that reliably carries a
     *  SCHEDULED self-buff — see the file header), sitting front-most in row M so the enemy's
     *  `front` selection binds to it; the protector is an aura-granted team actor behind it. */
    const build = (buffed: boolean): CombatEngineInput =>
        BASE_INPUT({
            selfBuffs: buffed ? [defenceUp(100)] : [],
            defence: VICTIM_DEFENCE,
            position: 'M4',
            healTargetId: 'attacker',
            teamActors: [
                {
                    ...teamActor('prot-1', PROTECTOR_DEFENCE, [protectionAuraPassive(3)]),
                    position: 'M1',
                },
            ],
            enemyAttackers: [
                { ...manualEnemyWithPen('enemy-1', ENEMY_ATTACK, ENEMY_PEN), position: 'T1' },
            ],
        });

    it('a defence-BUFFED victim does not inflate its protector’s chunk', () => {
        // `P` (pre-defence) is ENEMY_ATTACK by construction — no crit, no affinity, no
        // outgoing/incoming modifiers — so the protector's chunk is 0.3 × ENEMY_ATTACK × mit(D_p)
        // regardless of what the victim's own mitigation (defence buff OR penetration) turns out
        // to be — the cascade recovers pre-defence P and re-mitigates on the PROTECTOR's own
        // defence only.
        const expectedChunk = 0.3 * ENEMY_ATTACK * mit(PROTECTOR_DEFENCE);

        // Control: unbuffed. Passes before and after the fix — it pins the oracle.
        expect(totalIncoming(build(false), 'prot-1')).toBeCloseTo(expectedChunk, 4);

        // NON-VACUITY, and asserted rather than assumed (CodeRabbit, PR #353): every other
        // assertion here passes when `build(true)` never applies the buff at all — `build(true)`
        // would simply BE `build(false)`, which the control already pins. Two halves, because a
        // silent failure could sit in either. (i) the buff is ACTIVE, and only in the buffed arm:
        expect(activeSelfBuffNames(build(true))).toContain('Defense Up');
        expect(activeSelfBuffNames(build(false))).not.toContain('Defense Up');
        // (ii) `parsedEffects.defense` is a key that actually produces a DEFENCE bonus — a rename
        // or a typo there would leave the buff active but inert, which is the same vacuum.
        expect(toSimBuffs([defenceUp(100)])).toContainEqual(
            expect.objectContaining({ stat: 'defence', value: 100 })
        );

        // The buff moves the victim's own damage read, so this fixture's two arms really are two
        // different mitigations — which is what makes the core assertion below a test of the
        // cascade rather than a tautology.
        //
        // PREMISE UPDATED BY ADDENDUM A2. This line used to assert `buffedVictim` was CLOSE TO
        // `unbuffedVictim`: pre-fix the buff moved the victim's LIVE effective defence (what the
        // funnel's old recompute read) while leaving the caller's damage read on the BASE stat.
        // That gap WAS the A2 defect, and the equality was pinning it. Now the victim's own
        // 'Defense Up' folds into `defenceModifierPct`, so a +100% buff really does mitigate on
        // 2x VICTIM_DEFENCE (further reduced by the enemy's own ENEMY_PEN penetration) and the
        // victim takes strictly LESS. The core assertion below is unchanged and passed both
        // before and after the fix — it is about the PROTECTOR's chunk, which must stay pinned to
        // the protector's own defence no matter what the victim's mitigation turns out to be.
        const unbuffedVictim = totalIncoming(build(false), 'attacker');
        const buffedVictim = totalIncoming(build(true), 'attacker');
        expect(unbuffedVictim).toBeCloseTo(
            0.7 * ENEMY_ATTACK * mit(VICTIM_DEFENCE * (1 - ENEMY_PEN / 100)),
            4
        );
        expect(buffedVictim).toBeCloseTo(
            0.7 * ENEMY_ATTACK * mit(2 * VICTIM_DEFENCE * (1 - ENEMY_PEN / 100)),
            4
        );
        // Direction, stated outright: more defence must mean less damage taken.
        expect(buffedVictim).toBeLessThan(unbuffedVictim);

        // THE CORE ASSERTION, and the one FINDING 4 (#358 review) restored the discriminating
        // power of. Pre-fix the funnel divided by mit(1000) (the buffed live stat, ignoring pen)
        // while the caller had mitigated with mit(250) (500 halved by 50% pen), inflating the
        // chunk. Post-A2, with pen: 0 the caller and the funnel's `effectiveStatsOf(...).defence`
        // re-derivation fallback would agree on the DEFENCE-BUFF term too — measured: deleting the
        // `cause.targetMitigation ??` threading and falling back to re-derivation left this
        // fixture passing anyway, because the fallback also folds a SCHEDULED self-buff. The
        // non-zero ENEMY_PEN above restores real discriminating power: the fallback never folds
        // penetration, threaded or not, so removing the threading reliably diverges again. The
        // assertion itself is unchanged — `cause.targetMitigation` is threaded down rather than
        // re-derived, so the protector's chunk tracks the PROTECTOR's defence either way.
        expect(totalIncoming(build(true), 'prot-1')).toBeCloseTo(expectedChunk, 4);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// Task 4 (Component B runtime) — Meatshield's transform-incoming-to-dot passive turns a
// Protection-REDIRECTED chunk into a 2-turn self-DoT instead of instant HP loss. Reuses this
// file's PRODUCTION PATH aura-protector harness (protectionAuraPassive: Protection granted as an
// aura ability, visible to the all-sources protectorsFor read) plus the SAME 3-stack / 30%
// magnitude as the core aura test above, so `expectedChunk` below is the IDENTICAL arithmetic
// (0.3 × ENEMY_ATTACK × mit(PROTECTOR_DEFENCE)/mit(0)) already proven correct for the instant
// case — only now summed across the DoT's 2 ticks instead of read as one instant hit.
//
// Positional requirement (NOT present in the non-positional aura-protector tests above): a
// non-heal-target team/enemy actor's OWN genericDoTEntries only tick at its own turn-start when
// `isPositional(actor.position, opposingLiving)` is true (engine.ts's per-victim DoT-tick
// prologue) — the always-ticking path is reserved for the heal target. So the protector (which is
// NOT the heal target here — the direct-hit victim is) must carry a board position, mirroring
// transformIncomingToDot.test.ts's positional harness. The direct-hit victim keeps a LOWER board
// column than the protector so 'front' targeting is unambiguous.
//
// Single-hit isolation: the enemy roster's manualEnemy-style attacker fires every round it is
// alive (no charge-gating in this harness), so left unchecked it would redirect a fresh chunk
// every round and contaminate the "ticks sum to ONE chunk" assertion. Each test's direct-hit
// victim therefore carries a throwaway `damage-reflection` "kill switch" (100% reflect) purely as
// a test-harness device: the attacker's `stats.hp`/`hp` is seeded at 1, so ANY nonzero reflected
// sliver (inevitable once the redirect leaves a real remainder on the victim) kills it via the
// engine's ordinary recordDestroyed path immediately after its round-1 attack — isolating the
// redirected chunk's DoT lifecycle to exactly that one hit for the remaining 2 rounds of pure
// ticking. This is NOT a claim about Meatshield/production kits; it only exists to pin the
// attacker to a single shot inside this test.
describe('Protection transfer × transform-incoming-to-dot composition (Task 4, Component B runtime)', () => {
    // Meatshield's R4-style reactive: fires only on a Protection-REDIRECTED hit (Task 2's
    // 'self-protection-redirect' condition + `viaProtectionRedirect`, Task 3's ability shape).
    const transformAbility: Ability = {
        id: 'meatshield-transform',
        type: 'transform-incoming-to-dot',
        target: 'self',
        trigger: 'on-attacked',
        conditions: [],
        config: {
            type: 'transform-incoming-to-dot',
            turns: 2,
            condition: 'self-protection-redirect',
        },
    };
    // Test-only kill switch — see file-section comment above.
    const killSwitchReflect: Ability = {
        id: 'kill-switch-reflect',
        // Top-level type:'modifier' is a placeholder (mirrors buildEquipmentAbilities.ts's
        // REFLECT gear-set entry) — the engine keys on config.type:'damage-reflection', not the
        // top-level type.
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage-reflection', pct: 100 },
    };
    const basicAttack = (): Ability => ({
        id: 'ks-basic-attack',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100 },
    });
    const targetFront: ParsedTarget = { raw: 'front', side: 'enemy', selection: 'front' };
    const basicPattern: ParsedPattern = { raw: 'base', shape: 'base', range: 0, modifiers: {} };

    /** Runs `input` through a fresh bus, collecting every `dot-ticked` (dotType 'generic') event
     *  landing on `targetId`. Returns the summed tick amount. */
    const genericDotSum = (input: CombatEngineInput, targetId: string): number => {
        const bus = createEventBus();
        let sum = 0;
        bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
            if (e.dotType === 'generic' && e.targetId === targetId) sum += e.damage;
        });
        runCombat({ ...input, bus });
        return sum;
    };

    it('PLAYER side: a redirected chunk becomes a 2-turn self-DoT on the protector, not instant HP loss', () => {
        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [] },
            numRounds: 3,
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
            healTargetId: 'ally-1',
            mode: 'healing',
            // SP-4b-1: the focus is an inert bystander, but the normalization boundary places every
            // actor — so it has to be told where to stand. Left unplaced it takes the front-middle
            // anchor, wins the enemy's `front` selection and becomes the direct-hit victim itself,
            // and then nothing is ever redirected to `prot-1`. `M2` sits in the same row as the
            // intended victim but behind it (column 2 < 4), so `ally-1` stays the front-most.
            position: 'M2',
            teamActors: [
                {
                    id: 'ally-1', // direct-hit victim — front column (M4), the kill-switch reflector.
                    speed: 10,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M4',
                    walk: {
                        shipSkills: {
                            slots: [{ slot: 'passive', abilities: [killSwitchReflect] }],
                        },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 1_000_000_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
                {
                    id: 'prot-1', // protector — back column (M1), high speed so its own DoT-tick
                    // step (turn-start) runs BEFORE the redirect lands each round.
                    speed: 1000,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M1',
                    walk: {
                        shipSkills: {
                            slots: [
                                protectionAuraPassive(3),
                                { slot: 'passive', abilities: [transformAbility] },
                            ],
                        },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: PROTECTOR_DEFENCE,
                            hp: 1_000_000_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
            ] as TeamActorEngineInput[],
            enemyAttackers: [
                // SP-4c-1: an inert survivor so the kill-switch death below is not a WIPE, which
                // would end the match before the 2-turn DoT can tick.
                {
                    id: 'bystander-enemy',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'B1',
                    target: targetFront,
                    pattern: basicPattern,
                    shipSkills: { slots: [] },
                },
                {
                    id: 'enemy-1',
                    stats: {
                        attack: ENEMY_ATTACK,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'T1',
                    target: targetFront,
                    pattern: basicPattern,
                    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
                },
            ],
        };

        const result = runCombat(input);
        const round1 = result.rounds.find((r) => r.round === 1)!;
        // Turn of redirect: the protector's instant intake nets to ZERO (fully deferred to DoT).
        expect(round1.perActorIncoming?.['prot-1']?.incoming ?? 0).toBe(0);

        // The generic DoT ticks on the protector over the following 2 rounds, summing to the
        // FULL redirected chunk (spread over 2 turns) — the SAME magnitude as the instant-case
        // aura-protector test above.
        const tickSum = genericDotSum(input, 'prot-1');
        const expectedChunk = 0.3 * ENEMY_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));
        expect(tickSum).toBeCloseTo(expectedChunk, 4);

        // …and NOTHING is logged as instant redirected damage. The per-sub-hit emission (one row
        // per redirected stack) must still suppress the float sliver a fully transformed sub-hit
        // leaves behind: three phantom ~1e-10 rows would be three lies in the log. The same helper
        // reports 3 for an untransformed 3-stack protector (see the per-stack test above), so a
        // zero here is a real suppression, not a dead instrument.
        expect(reactiveEventsTargeting(input, 'prot-1')).toBe(0);
    });

    it('ENEMY side (team symmetry): identical redirect-to-DoT behavior when the protector + victim are on the ENEMY side', () => {
        const FOCUS_ATTACK = ENEMY_ATTACK; // same magnitude, direct numeric mirror.
        const input: CombatEngineInput = {
            attack: FOCUS_ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
            numRounds: 3,
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
            // Kill-switch symmetry: the FOCUS is the attacker here, so IT is the one that dies to
            // the reflected sliver after its round-1 attack — seeded at 1 HP for the same reason
            // the enemy attacker is in the player-side test above.
            hp: 1,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: targetFront,
            pattern: basicPattern,
            // SP-4c-1: the focus dies to the kill-switch reflection, and alone it IS the whole
            // player side — that wipe now ends the match before the DoT can tick. An inert ally
            // (0 attack, no skills, speed 1) keeps the side alive and draws nothing.
            teamActors: [
                {
                    id: 'bystander-ally',
                    speed: 1,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'B1',
                    walk: {
                        shipSkills: { slots: [] },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 1_000_000_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
            ],
            enemyAttackers: [
                {
                    id: 'enemy-front', // direct-hit victim — front column (M4), kill-switch reflector.
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    shipSkills: { slots: [{ slot: 'passive', abilities: [killSwitchReflect] }] },
                },
                {
                    id: 'enemy-protector', // protector — back column (M1), high speed.
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: PROTECTOR_DEFENCE,
                        hp: 1_000_000_000,
                        speed: 1000,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M1',
                    shipSkills: {
                        slots: [
                            protectionAuraPassive(3),
                            { slot: 'passive', abilities: [transformAbility] },
                        ],
                    },
                },
            ],
        };

        const result = runCombat(input);
        const round1 = result.rounds.find((r) => r.round === 1)!;
        expect(round1.perActorIncoming?.['enemy-protector']?.incoming ?? 0).toBe(0);

        const tickSum = genericDotSum(input, 'enemy-protector');
        const expectedChunk = 0.3 * FOCUS_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));
        expect(tickSum).toBeCloseTo(expectedChunk, 4);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// Per-victim damage ACCOUNTING under a redirect — the display channels, not the HP.
//
// `RoundData.perTargetDamage` (→ each ship's `Damage taken` card) and `perTargetDealt` (→ its
// `Damage dealt`) are booked by the CALLERS of applyVictimDamage, while `.incoming` is booked by
// the funnel itself. Everything the funnel does to a hit BEFORE recording it — an incoming-block
// proc shaving it, a Protection cascade diverting a chunk, a transform deferring it into a DoT —
// therefore has to be mirrored by every caller or the two channels disagree.
//
// The victim's own booking is the one that had drifted: the positional hit path booked the hit it
// COMPUTED, so a redirect left the victim credited with damage the protector took. That inflates
// the victim's `damageTaken` AND the attacker's `damageDealt` (the chunk is counted on both rows),
// which is why the fix is pinned as a reconciliation identity rather than two magic numbers:
//
//     Σ perTargetDealt[attacker]  ==  Σ perTargetDamage  ==  Σ perActorIncoming[].incoming
//
// A redirect is invisible to that identity — it MOVES intake between two rows, it does not create
// any. Live HP was never affected: `hpPct` reads `.incoming`, which was always post-redirect.
//
// Positional (not the file's default non-positional shape) because `emitHit` — the site that books
// the victim's own row — exists only on the positional path. In non-positional mode the victim gets
// no `perTargetDamage` entry at all, which is a separate pre-existing gap that never reaches the
// battle simulator (`simulateBattle` always sets `mode: 'battle'`).
// ───────────────────────────────────────────────────────────────────────────────────────

/** A positioned enemy that fires one real 100% hit at the FRONT-most player (M4 in this harness's
 *  column order), so the attack resolves through the positional apply path and `emitHit` runs. */
const positionedEnemy = (id: string, attack: number): EnemyAttacker =>
    ({
        ...manualEnemy(id, attack),
        position: 'M1',
        target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} } as ParsedPattern,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'positioned-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        } as Ability,
                    ],
                },
            ],
        },
    }) as unknown as EnemyAttacker;

/** A self-cast named status from the ACTIVE slot, paired with a 0-damage ability so the actor still
 *  takes a normal cast turn. The active slot (not passive) because a passive-slot `on-cast` self
 *  buff does not reliably apply in this engine. */
const activeSelfBuffSlot = (buffName: string): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
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
                duration: 99, // never lapses inside the run
            },
        },
        {
            id: `noop-${buffName}`,
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
});

/** A self-aura incoming-block that ALWAYS procs and blocks 100% — the same shape the
 *  fully-blocked-chunk case above builds locally. Blocks the protector's own redirected sub-hit
 *  before the funnel records any intake for it. */
const fullBlockAuraPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'full-block-self-aura',
            type: 'incoming-block',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-block',
                condition: 'always',
                procChance: 1,
                blockPct: 1.0,
                oncePerRound: false,
            },
        },
    ],
});

describe('per-victim damage accounting under a Protection redirect (positional)', () => {
    const PROT_STACKS = 3;

    /** Victim at M4 (front-most → the enemy's 'front' selection binds to it), protector at M1.
     *  `protectorSlots` adds whatever else the protector should carry (e.g. a Barrier grant). */
    const fixture = (protectorSlots: ShipSkills['slots'] = []): CombatEngineInput =>
        BASE_INPUT({
            selfBuffs: [], // the focus is inert here — the protector is a team actor
            defence: 0,
            mode: 'battle',
            teamActors: [
                { ...teamActor('ally-1', 0), position: 'M4' },
                {
                    ...teamActor('prot-1', PROTECTOR_DEFENCE, [
                        protectionAuraPassive(PROT_STACKS),
                        ...protectorSlots,
                    ]),
                    position: 'M1',
                },
            ],
            enemyAttackers: [positionedEnemy('enemy-1', ENEMY_ATTACK)],
        });

    /** The three channels for round 1, plus the identity that must hold across them. */
    const channels = (input: CombatEngineInput) => {
        const r1 = runCombat(input).rounds[0];
        const taken = r1.perTargetDamage ?? {};
        const dealt = r1.perTargetDealt?.['enemy-1'] ?? {};
        const incoming = r1.perActorIncoming ?? {};
        const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
        return {
            taken,
            dealt,
            incoming,
            takenSum: sum(taken),
            dealtSum: sum(dealt),
            incomingSum: sum(
                Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.incoming]))
            ),
        };
    };

    it('books the victim only what survived the redirect, so dealt/taken/incoming reconcile', () => {
        const c = channels(fixture());
        const chunk = 0.1 * PROT_STACKS * ENEMY_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));

        // The protector's row is unchanged by this fix — it was already booked from the funnel.
        expect(c.taken['prot-1']).toBeCloseTo(chunk, 6);
        // The victim keeps 70%: the redirected chunk is the PROTECTOR's intake, not the victim's.
        // Pre-fix this read the whole ENEMY_ATTACK — the hit as computed, before the cascade.
        expect(c.taken['ally-1']).toBeCloseTo(0.7 * ENEMY_ATTACK, 6);
        // Each row agrees with what the funnel actually recorded for that actor.
        expect(c.taken['ally-1']).toBeCloseTo(c.incoming['ally-1'].incoming, 6);
        expect(c.taken['prot-1']).toBeCloseTo(c.incoming['prot-1'].incoming, 6);
        // And the attacker is credited exactly the intake it caused — no phantom. Pre-fix this
        // summed to ENEMY_ATTACK + chunk (~1277 for a 1000 hit): the chunk on both rows.
        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.dealtSum).toBeCloseTo(c.takenSum, 6);
    });

    it('books a Barrier-nullified redirected chunk like any other barriered hit', () => {
        // Barrier on the PROTECTOR. Barrier nullifies the chunk's effect but does NOT un-record it:
        // the funnel books `.incoming` and the equal `barrierAbsorbed` that nets it back out, so the
        // protector's row must read the chunk with 0 HP lost — exactly what a DIRECTLY barriered hit
        // reads. Pre-fix the chunk was dropped from both display channels entirely (the protector
        // showed 0 taken while its barrier-absorbed card showed the chunk, and the attacker was
        // credited nothing for it), because that path booked `immediateDamage`, which Barrier zeroes.
        const c = channels(fixture([activeSelfBuffSlot('Barrier')]));
        const chunk = 0.1 * PROT_STACKS * ENEMY_ATTACK * (mit(PROTECTOR_DEFENCE) / mit(0));

        expect(c.incoming['prot-1'].barrierAbsorbed).toBeCloseTo(chunk, 6);
        expect(c.taken['prot-1']).toBeCloseTo(chunk, 6);
        expect(c.dealt['prot-1']).toBeCloseTo(chunk, 6);
        // Nullified, so no HP moved — the battle simulator's own derivation.
        expect(
            c.incoming['prot-1'].incoming -
                c.incoming['prot-1'].shieldAbsorbed -
                c.incoming['prot-1'].barrierAbsorbed
        ).toBeCloseTo(0, 6);
        // The redirect is no longer silent in the log either: the rows that explain where the
        // protector's barrier absorption came from now fire — one per redirected sub-hit, because
        // Barrier leaves each sub-hit's `.incoming` recorded (it is netted out by barrierAbsorbed,
        // not un-booked), so every sub-hit clears the phantom threshold.
        expect(reactiveEventsTargeting(fixture([activeSelfBuffSlot('Barrier')]), 'prot-1')).toBe(
            PROT_STACKS
        );
    });

    it('still books nothing for a chunk the protector’s own block ability fully absorbed', () => {
        // The counterpart the fix must NOT break (pinned non-positionally above too): a fully
        // proc-blocked chunk never became intake at all — `.incoming` is 0 — so both display
        // channels must stay silent for it. This is what makes `immediateDamage`'s replacement
        // safe: the funnel's recorded intake already excludes a blocked portion.
        const c = channels(fixture([fullBlockAuraPassive()]));

        expect(c.incoming['prot-1']?.incoming ?? 0).toBe(0);
        expect(c.taken['prot-1']).toBeUndefined();
        expect(c.dealt['prot-1']).toBeUndefined();
        // The victim's row is untouched by the protector's block — it still keeps only 70%.
        expect(c.taken['ally-1']).toBeCloseTo(0.7 * ENEMY_ATTACK, 6);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// CodeRabbit (PR #353): the always-active PASSIVE SLOT's own damage instance is a SECOND positional
// path into `applyVictimDamage`, and it was not handing the cascade its mitigation factor. It
// computes a per-victim `victimDefenseProfileOf` exactly like the firing hit does, so it owed the
// same factor — omitting it left this one path on the fallback re-derivation, which is blind to the
// attacker's defence penetration. A passive-slot instance landing on a protected victim therefore
// over-transferred to the protector while the firing hit beside it was correct.
describe('Protection transfer — the PASSIVE-SLOT instance divides by its own mitigation too', () => {
    const FOCUS_ATTACK = 1000;
    const PEN_PCT = 50;
    const VICTIM_DEFENCE = 500; // → the attacker sees 250 through 50% penetration.
    const ACTIVE_PCT = 100; // pre-defence P of the firing hit = FOCUS_ATTACK.
    const PASSIVE_PCT = 50; // pre-defence P of the passive instance = FOCUS_ATTACK / 2.

    const damageAbility = (id: string, multiplier: number, target: Ability['target']): Ability => ({
        id,
        type: 'damage',
        target,
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier },
    });

    const build = (withProt: boolean): CombatEngineInput => ({
        attack: FOCUS_ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: PEN_PCT,
        chargeCount: 0,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [damageAbility('ps-active', ACTIVE_PCT, 'enemy')] },
                {
                    slot: 'passive',
                    abilities: [damageAbility('ps-passive', PASSIVE_PCT, 'all-enemies')],
                },
            ],
        },
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
        target: { raw: 'front', side: 'enemy', selection: 'front' },
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        enemyAttackers: [
            {
                id: 'enemy-front',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: VICTIM_DEFENCE,
                    hp: 1_000_000_000,
                    speed: 1,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                shipSkills: { slots: [] },
            },
            {
                id: 'enemy-protector',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: PROTECTOR_DEFENCE,
                    hp: 1_000_000_000,
                    speed: 1,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: { slots: withProt ? [protectionAuraPassive(3)] : [] },
            },
        ],
    });

    it('a passive-slot instance does not inflate the protector’s chunk under defence penetration', () => {
        // The protector is unpositioned, but the passive slot's `all-enemies` footprint still lands
        // on it DIRECTLY, so its total intake mixes a direct hit with the redirect. Assert the
        // redirected rows instead — `reactive-damage-performed` fires only for a cascade chunk, so
        // this reads the transfer alone with no subtraction.
        const rows = reactiveAmountsTargeting(build(true), 'enemy-protector');

        // Six rows: two redirected instances (the firing hit and the passive one) × 3 Protection
        // stacks each, per the per-stack logging this PR introduces.
        expect(rows).toHaveLength(6);

        // Each instance redirects 30% of its PRE-DEFENCE amount, re-mitigated on the protector and
        // split across 3 stacks. P is FOCUS_ATTACK for the firing hit and FOCUS_ATTACK/2 for the
        // passive instance, both by construction (no crit, no affinity, no other modifiers).
        const perStack = (P: number) => (0.3 * P * mit(PROTECTOR_DEFENCE)) / 3;
        const firingStack = perStack(FOCUS_ATTACK);
        const passiveStack = perStack(FOCUS_ATTACK / 2);
        for (const row of rows.slice(0, 3)) expect(row).toBeCloseTo(firingStack, 4);
        // THE CORE ASSERTION. Pre-fix this path recovered P from the victim's UNPENETRATED defence
        // (mit(500)) while the caller had mitigated with mit(250), inflating the passive instance's
        // chunk by ≈7.1% — the firing rows above stayed correct, which is exactly why only a
        // passive-slot-specific fixture catches it.
        for (const row of rows.slice(3)) expect(row).toBeCloseTo(passiveStack, 4);

        // NON-VACUITY: the two instances are separable (so a passive-only defect cannot hide behind
        // the firing rows), and the penetration is live — the victim's intake tracks mit(250).
        expect(firingStack).toBeCloseTo(passiveStack * 2, 6);
        expect(totalIncoming(build(false), 'enemy-front')).toBeCloseTo(
            (FOCUS_ATTACK + FOCUS_ATTACK / 2) * mit(VICTIM_DEFENCE * (1 - PEN_PCT / 100)),
            4
        );
    });
});
