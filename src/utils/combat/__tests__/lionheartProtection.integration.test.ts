/**
 * Lionheart Protection — clear-on-redirect ENGINE integration (Task 4, consumer of Task 1's
 * `hasAnyProtectionGrant` precompute + Task 3's `clearAllOnRedirect` buff-config field).
 *
 * Lionheart R4 grants itself 10 stacks of Protection at the top of every round (a real
 * ABILITY-SOURCED ACCUMULATING status: `type:'buff'`, `stackTrigger:'per-round'`,
 * `isStackable:true`, `maxStacks:10` — registered via `registerActorAbilityStatuses` into
 * `accumSelfMaps`, read via `selfBuffStacksForOwner`'s 3-source fold). At 10 stacks (100%
 * redirect fraction, 10%/stack), Lionheart intercepts the FIRST ally hit each round in full —
 * then, per its kit text ("all Protection is removed" after a redirect), the WHOLE pool is
 * cleared (not just decremented), so a SECOND hit the same round is NOT redirected. The next
 * round's `beginRound` top-of-round tick re-accumulates 0 -> min(0+10,10) = 10, so the redirect
 * resumes.
 *
 * This mirrors protectionTransfer.integration.test.ts's "PRODUCTION PATH" aura-protector test,
 * but the protector's Protection is the real accumulating-ability shape (not the static aura
 * helper `protectionAuraPassive`), and TWO enemies fire at the SAME adjacent ally in round 1 so
 * both the redirect and its one-shot consumption are exercised within a single round.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A flat enemy attacker (no shipSkills -> engine synthesizes a single 100% basic hit). */
const manualEnemy = (id: string, attack: number): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
});

/** A walked player team actor (a pure victim/protector stat block, role ATTACKER so it is a
 *  valid victim). Optional `passive` slots carry an ability (e.g. Lionheart's Protection grant).
 *  Optional `hp` (default a large sink) lets a protector be given a LOW hp so it can be killed
 *  by its own redirected chunk mid-round (used by the chunk.total===0 guard test below).
 */
const teamActor = (
    id: string,
    defence: number,
    passive?: ShipSkills['slots'],
    speed = 100,
    hp = 1_000_000_000
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

/** A passive slot that grants SELF `Protection` the AURA way (Meatshield-style: a static buff
 *  config, no duration, isStackable) — used as the "Other" fully-stacked, SLOWER protector in
 *  the chunk.total===0 guard test below. Distinct from `lionheartProtectionPassive`'s per-round
 *  accumulating shape; either shape reads through the same all-sources stack resolver. */
const otherProtectionAuraPassive = (stacks: number): ShipSkills['slots'][number] => {
    const ability: Ability = {
        id: 'other-protection',
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

/** Lionheart R4's round-start Protection grant, as the parser really emits it: a per-round
 *  ACCUMULATING buff (rate = stacks = 10, capped at maxStacks = 10) whose config carries
 *  `clearAllOnRedirect: true` — the field Task 3 threaded onto the buff-config type and this
 *  task's engine consumer (`clearProtectionOnRedirectIds`) scans for. */
const lionheartProtectionPassive = (): ShipSkills['slots'][number] => {
    const ability: Ability = {
        id: 'lionheart-protection',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Protection',
            parsedEffects: {},
            stacks: 10,
            isStackable: true,
            maxStacks: 10,
            stackTrigger: 'per-round',
            clearAllOnRedirect: true,
        },
    };
    return { slot: 'passive', abilities: [ability] };
};

const ENEMY_ATTACK = 1000;
const LIONHEART_DEFENCE = 300;

const BASE_INPUT: CombatEngineInput = {
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] }, // the focus deals no offence itself; it is only a bystander.
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
    healTargetId: 'ally-1', // both manual enemies fire at this single shared victim.
    mode: 'healing',
    // SP-4b-1: `ally-1` claims the front-middle cell and BOTH enemies are pinned to the middle
    // row. The normalization boundary places every actor and synthesizes the enemies' `front
    // enemy` targeting, so "both enemies fire at this single shared victim" is now a claim about
    // board geometry rather than about `healTargetId`. Two things have to be stated for it to hold:
    // the auto-placed focus would otherwise take the M4 anchor and soak both hits, and `front`
    // scans ROWS from the caster's own row first (selectTargets) — so an enemy left on the
    // index-derived T-row default would hit whoever the collision pushed into row T instead.
    teamActors: [
        { ...teamActor('ally-1', 0), position: 'M4' }, // the direct-hit victim (no Protection).
        {
            ...teamActor('lionheart', LIONHEART_DEFENCE, [lionheartProtectionPassive()]),
            position: 'M2',
        }, // the protector
    ],
    enemyAttackers: [
        { ...manualEnemy('enemy-A', ENEMY_ATTACK), position: 'M4' },
        { ...manualEnemy('enemy-B', ENEMY_ATTACK), position: 'M3' },
    ],
};

describe('Lionheart Protection — clear-on-redirect (integration)', () => {
    it('redirects the FIRST ally-hit each round, then clears — the SECOND hit is NOT redirected; refresh-to-10 re-grants the redirect next round', () => {
        const res = runCombat(BASE_INPUT);

        const lionheartR1 = res.rounds[0]?.perActorIncoming?.['lionheart']?.incoming ?? 0;
        const allyR1 = res.rounds[0]?.perActorIncoming?.['ally-1']?.incoming ?? 0;
        const lionheartR2 = res.rounds[1]?.perActorIncoming?.['lionheart']?.incoming ?? 0;

        // Round 1, hit 1 (enemy-A): 10 stacks = 100% redirect fraction -> Lionheart takes the
        // WHOLE hit (re-mitigated on its own defence); the ally takes nothing from this hit.
        expect(lionheartR1).toBeGreaterThan(0);
        // Round 1, hit 2 (enemy-B): Protection was cleared after hit 1 -> NOT redirected -> the
        // ally takes this hit directly. If the clear loop did not reach the ability-sourced
        // accumulating Protection, this hit would ALSO redirect and allyR1 would be 0.
        expect(allyR1).toBeGreaterThan(0);
        // Round 2: beginRound's top-of-round tick re-accumulates 0 -> 10 (refresh-to-10) ->
        // the redirect resumes on round 2's first hit.
        expect(lionheartR2).toBeGreaterThan(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// Finding 1 (final-review) — the clear-on-redirect loop must be gated on the protector's OWN
// cascade chunk having actually redirected something (`chunk.total > 0`), not fired
// unconditionally for every `clearProtectionOnRedirectIds` member present in `protectors`.
//
// Reachable scenario: TWO protectors cover the same victim — Lionheart (FASTER, 10 stacks via
// its per-round accumulating grant) and a second, SLOWER, fully-stacked (10 stacks, aura-granted)
// protector "other". `protectionCascade`'s cascade math (protectionTransfer.ts) computes each
// protector's `kept` share as `(1 - nextFrac) * flow * mit`, where `nextFrac` is the fraction the
// NEXT (slower) protector in the chain drains before the current protector's share is realized.
// Because "other" also has max stacks (frac = 1.0), Lionheart's OWN kept share collapses to
// `(1 - 1.0) * flow * mit = 0` — "other" fully drains whatever cascades through Lionheart before
// Lionheart's cut is realized, even though Lionheart is the FASTER (first) protector in the chain
// and genuinely holds 10 Protection stacks. This is the `chunk.total === 0` case the guard exists
// for. Verified directly with `protectionCascade` inputs mirroring this exact setup (both
// protectors at max stacks, mit=1): chunks = [{total: 0}, {total: 1000}] — confirming Lionheart's
// own chunk is genuinely 0 while "other" absorbs the full redirected amount.
//
// "other" is given deliberately low HP (500) so it DIES partway through absorbing its ~1000
// chunk (10 sub-hits of ~100 each) — removing it from `protectorsFor` for the round's SECOND
// hit. That isolates the observable difference: with the buggy unconditional clear, Lionheart's
// Protection is wiped after hit 1 (despite its chunk being 0) -> by hit 2, BOTH protectors are
// gone (other dead, Lionheart cleared) -> the ally eats the full second hit. With the guard, hit
// 1 leaves Lionheart's Protection intact (its chunk was 0, so the clear never fires) -> by hit 2,
// Lionheart is the sole living protector and still redirects it in full.
describe('Lionheart Protection — clear-on-redirect guard: chunk.total === 0 must NOT clear (Finding 1)', () => {
    const OTHER_DEFENCE = 0;
    const OTHER_HP = 500; // < the ~1000 total chunk "other" absorbs on hit 1 -> dies mid-hit-1.

    const guardInput: CombatEngineInput = {
        ...BASE_INPUT,
        numRounds: 1,
        teamActors: [
            teamActor('ally-1', 0), // the direct-hit victim (no Protection of its own).
            teamActor('lionheart', LIONHEART_DEFENCE, [lionheartProtectionPassive()], 100), // FASTER protector.
            teamActor('other', OTHER_DEFENCE, [otherProtectionAuraPassive(10)], 50, OTHER_HP), // SLOWER, max-stack, low-HP protector.
        ],
        enemyAttackers: [
            manualEnemy('enemy-A', ENEMY_ATTACK),
            manualEnemy('enemy-B', ENEMY_ATTACK),
        ],
    };

    it("Lionheart's own chunk is drained to 0 by a slower, fully-stacked protector on hit 1 (that protector then dies); Lionheart's Protection must survive to redirect hit 2 in full", () => {
        const res = runCombat(guardInput);

        const allyR1 = res.rounds[0]?.perActorIncoming?.['ally-1']?.incoming ?? 0;
        const lionheartR1 = res.rounds[0]?.perActorIncoming?.['lionheart']?.incoming ?? 0;
        const otherR1 = res.rounds[0]?.perActorIncoming?.['other']?.incoming ?? 0;

        // "other" (the last/slowest protector in the cascade) absorbed the (near-)full hit-1
        // amount and died from it — confirms the chunk-math setup landed as designed.
        expect(otherR1).toBeGreaterThan(0);

        // THE GUARD ASSERTION: with the fix, Lionheart's Protection was NOT cleared after hit 1
        // (its own chunk there was 0) — so it is still the sole living protector for hit 2 and
        // redirects that hit in full. Under the unconditional-clear bug, Lionheart would have
        // been cleared after hit 1 (despite absorbing nothing), "other" is already dead, so hit 2
        // would land entirely on the ally instead (allyR1 ~= ENEMY_ATTACK, lionheartR1 ~= 0).
        expect(allyR1).toBeCloseTo(0, 4);
        expect(lionheartR1).toBeGreaterThan(0);
    });
});
