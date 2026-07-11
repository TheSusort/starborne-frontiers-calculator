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

    it('positional mode: Protection covers a NON-adjacent ally (all-allies, not hex-neighbours)', () => {
        // Wiring `position` on the victim AND another player actor makes `anyOtherPositioned`
        // true, so `adjacentAllyIdsFor` (adjacency.ts) would narrow to hex-neighbours instead of
        // falling back to "all living same-side allies". T1's hex-neighbours are {T2, M1, M2}
        // (see board.ts's AXIAL table / DIRECTIONS) — T4 is deliberately NOT one of them. Under
        // the OLD adjacency-based resolution this protector would be excluded from
        // `protectorsFor`; Protection's confirmed model (coverage = ALL living same-side allies,
        // independent of board adjacency) must still redirect to it.
        const input = BASE_INPUT({
            selfBuffs: [], // the focus carries no Protection — the protector is a team actor.
            defence: 0,
            teamActors: [
                { ...teamActor('ally-1', 0), position: 'T1' }, // victim
                {
                    ...teamActor('prot-1', PROTECTOR_DEFENCE, [protectionAuraPassive(3)]),
                    position: 'T4', // NOT a hex-neighbour of T1 — proves all-allies coverage.
                },
            ],
            enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
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
            } as Ability,
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
            // Healing mode is required for `enemyAttackers` to be built into real CombatActors at
            // all (engine.ts throws "enemyAttackers require healTargetId" otherwise) — same
            // requirement every test above already carries via `healTargetId`.
            healTargetId: 'attacker',
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
});
