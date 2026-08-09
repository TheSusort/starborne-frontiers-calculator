/**
 * Multi-hit full-walk attacks, PR6 Tier 2 — the INCOMING damage funnel resolves per sub-attack.
 *
 * R1 says each sub-attack runs the ENTIRE pipeline. For the victim that means the funnel —
 * shield absorption, Protection redirect, the incoming-block proc shave — runs N times against N
 * separate arrivals, not once against a summed cast.
 *
 * This tier is not redundant with Tier 1 (`incomingPerHitReactives.integration.test.ts`). Tier 1
 * proves the EVENTS arrive N times; this proves the DAMAGE ACCOUNTING behind them is per-arrival.
 * Those are different failures: an engine that emitted 3 events while booking one summed hit
 * would pass Tier 1 and fail here. The per-victim accounting defect class (#247-#249, #293, and
 * again in PR7) lives on this side of the line.
 *
 * CHARACTERIZATION: expected to pass on first run. See Tier 1's header.
 *
 * DEVIATIONS FROM task-2-brief.md (all measured against source before writing a single
 * assertion, per the task's three corrections plus what surfaced verifying them):
 *
 * 1. DAMAGE ARITHMETIC. As in Tier 1: `focusCast` sets `crit: 100, critDamage: 100`, so every
 *    hit crits and doubles. The measured per-sub-attack slice is 10,000, not the brief's assumed
 *    5,000. Every HP/pool number below is sized off the measured 10,000, confirmed via a
 *    throwaway probe before writing the real assertions (see each test's own comment).
 *
 * 2. THE SHIELD FIXTURE'S TRIGGER DOESN'T EXIST. The brief's `selfShield` used
 *    `trigger: 'on-combat-start'`. `AbilityTrigger` (src/types/abilities.ts) has no such value —
 *    the nearest is `'pre-combat'`, which is explicitly "annotation-only... NOT in LIVE_TRIGGERS
 *    — there is no combat event for it" (consumed only by the battle-sim's pre-fight layer,
 *    never by `runCombat`'s reactive listener machinery). So no on-cast/on-trigger ability can
 *    seed a shield before the enemy's turn without ALSO giving the shielded actor an active turn
 *    of its own to fire it on — which our passive-only victim (mirroring Tier 1's `enemyAt`) does
 *    not have.
 *
 *    Fix: `createActor` (src/utils/combat/state.ts:212) already seeds
 *    `shieldPool = maxHp * (preFight?.startingShieldPctOfHp ?? 0) / 100` at actor construction,
 *    independent of any cast — the same mechanism the pre-fight combat-modifier layer (sub-
 *    project F) uses for "start combat shielded for N% of max HP". `EnemyActorInput.preFight` is
 *    threaded straight into `buildEnemyPlayerActorRuntime`'s `createActor` call (engine.ts:682),
 *    so setting `preFight.startingShieldPctOfHp` on the enemy input reproduces the fixture's
 *    intent (a pool that partially survives the cast) with zero engine changes and no invented
 *    trigger.
 *
 * 3. PROTECTION'S REAL SHAPE (confirmed, matching the task's correction #2). Not
 *    `protectionPct`/`protectorId` fields — Protection is a NAME-KEYED SELF-BUFF read via
 *    `protectionStacks`/`selfBuffStacksForOwner(statusEngine, id, 'Protection')`
 *    (protectionTransfer.ts). `protectorsFor` (engine.ts ~3337) scans ALL living same-side allies
 *    of the victim for that stack count — there is no `protectorId` field anywhere; coverage is
 *    automatic, not addressed. The PRODUCTION grant shape (copied verbatim from
 *    `damageDealtBasis.integration.test.ts`'s `protectionAuraPassive`, itself copied from
 *    `protectionTransfer.integration.test.ts`) is a passive-slot `buff` ability, `target: 'self'`,
 *    config `{ type: 'buff', buffName: 'Protection', parsedEffects: {}, stacks, isStackable:
 *    true }` — deliberately no `duration`, which is what makes `registerActorAbilityStatuses`
 *    (engine.ts ~303) classify it as an AURA (`cfg.duration === undefined` and not
 *    accumulating/hit-counted/cheat-death) — permanently active from combat start, registered
 *    once at runtime construction, needing no turn to "fire".
 *
 * 4. `runCombat`'s RESULT HAS NO TOP-LEVEL `perTargetDamage`. The brief's `perTargetDamageFor`
 *    read `result.perTargetDamage`; the real field is `RoundData.perTargetDamage`, one map PER
 *    ROUND (`result.rounds[i].perTargetDamage` — confirmed against `counterAttack.test.ts`'s
 *    `totalPerTargetDamage` helper, which sums it across rounds). Fixed below; with
 *    `numRounds: 1` there is exactly one round to sum, so this is cosmetic here, but the helper
 *    is written generally (as the corpus precedent does) rather than hardcoding `rounds[0]`.
 *
 * 5. NO EVENT DISTINGUISHES A BLOCKED SUB-ATTACK, AND `attacked.damage` DOES NOT WORK AS A
 *    STAND-IN (measured, not assumed — see the block describe block's own header for the full
 *    argument and the probe that ruled it out). The working signal is
 *    `ability-performed.deliveredDamage` (PR7's post-funnel "what this sub-attack actually
 *    delivered"), confirmed by a forced-full-block probe to read exactly 0 when the block proc
 *    fires and the measured 10,000 slice when it does not.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setKeyedRng, resetRateGateRng, mulberry32 } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { emptyPreFightModifiers } from '../preFight/types';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Attacked = Extract<CombatEvent, { type: 'attacked' }>;
type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

const HP = 10_000_000;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pr6t2-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const attackSkill = (hits: number, multiplier = 100): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A positioned enemy carrying `slots`, which never attacks unless given an active. */
const enemyAt = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as EnemyAttacker;

/** The focus player at M1 fires `slots` at the front enemy (column 4). */
const focusCast = (
    slots: ShipSkills['slots'],
    enemies: EnemyAttacker[],
    pattern: ParsedPattern = basePattern()
): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: HP,
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
    affinity: 'antimatter',
    defence: 0,
    hp: HP,
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    positionalTeamBattle: true,
    enemyAttackers: enemies,
});

/** A player team actor at `position` carrying `slots`, which never attacks (it has no `active`
 *  slot) but MAY still deal REACTIVE damage (a counter reads the OWNER's own attack stat, unlike
 *  its passive incoming role) — hence the `attack` param. `hp` defaults to the standard `HP`
 *  constant, `speed` to `1`, and `attack` to `0` so existing call sites (Sections A-C, which
 *  never counter) are unaffected; PR6's DoT-transform block (Section D) overrides `speed` to
 *  outrun the attacker (mirroring `transformIncomingToDot.test.ts`'s turn-order requirement) and
 *  the counter block (Section F) overrides `attack` to a nonzero value so its counter has
 *  something to hit with (`applyCounterAttack` computes `raw` off the OWNER's `effectiveAttack`
 *  and no-ops when `raw <= 0` — confirmed by a throwaway probe: attack:0 produced ZERO counter
 *  events, not the expected one-per-turn-collapse, until this override was added). */
const teamVictim = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    hp: number = HP,
    speed: number = 1,
    attack: number = 0
): TeamActor =>
    ({
        id,
        speed,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots },
            stats: {
                attack,
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
    }) as TeamActorEngineInput;

/** An enemy that fires an N-hit cast at the player front. */
const offensiveEnemy = (id: string, position: Position, hits: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 100, critDamage: 100, defence: 0, hp: HP, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [attackSkill(hits)] },
    }) as EnemyAttacker;

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 0 } })],
};

/** The player side is inert; the enemy does all the attacking. */
const enemyDrivenBattle = (team: TeamActor[], enemies: EnemyAttacker[]): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
    enemyDefense: 0,
    enemyHp: HP,
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
    affinity: 'antimatter',
    defence: 0,
    hp: HP,
    healTargetId: 'attacker',
    position: 'M1',
    positionalTeamBattle: true,
    teamActors: team,
    enemyAttackers: enemies,
});

// ── Tier 2, Section A: shield absorption ───────────────────────────────────────────────────

/** Collects `attacked` events' `shieldWasHit` flags for one victim, in cast order. */
const shieldFlagsOn = (input: CombatEngineInput, victimId: string): boolean[] => {
    const bus = createEventBus();
    const flags: boolean[] = [];
    bus.on('attacked', (e: Attacked) => {
        if (e.targetId === victimId) flags.push(e.shieldWasHit === true);
    });
    runCombat({ ...input, bus });
    return flags;
};

/**
 * An enemy victim carrying a pre-seeded shield pool of exactly `pool` HP (via
 * `preFight.startingShieldPctOfHp` — see DEVIATION 2 above), at HP `hp`.
 */
const enemyWithShieldPool = (
    id: string,
    position: Position,
    hp: number,
    pool: number
): EnemyAttacker =>
    ({
        ...enemyAt(id, position, []),
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: (pool / hp) * 100 },
    }) as EnemyAttacker;

describe('PR6 Tier 2 — shield absorption resolves per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('a pool that covers the first sub-attack and part of the second absorbs [true, true, false] — not a uniform verdict', () => {
        // MEASURED (deviation 1): each sub-attack of a 3-hit `focusCast` delivers 10,000 (crit
        // doubles), confirmed via a throwaway probe before picking the pool size. Pool 15,000
        // against three 10,000 slices:
        //   sub-attack 1: pool 15000 covers the full 10000  -> absorbed, pool -> 5000, hp -0
        //   sub-attack 2: pool 5000 covers PART of 10000    -> absorbed (partial), pool -> 0, hp -5000
        //   sub-attack 3: pool 0, nothing left to absorb    -> hp -10000, shieldWasHit false
        // Victim HP 100,000 survives the whole cast (15,000 total HP loss) with room to spare, so
        // no death-dropout confound (Tier 1's ADAPTATION NOTE 2 trap).
        //
        // ANTI-VACUITY: a funnel that resolved shield absorption ONCE against the CAST's 30,000
        // aggregate (rather than per sub-attack) has only ONE verdict to hand out — "the pool was
        // touched this cast" — and can only stamp that SAME boolean onto all three already-proven
        // (Tier 1) per-sub-attack events, giving a UNIFORM array: [true,true,true] (the aggregate
        // pool nonzero at some point) or [false,false,false]. It can never produce the MIXED
        // [true,true,false] this fixture measures, because that requires the THIRD sub-attack to
        // see a pool that the FIRST TWO sub-attacks already drained — a fact only visible if the
        // funnel re-checks the live pool at each arrival.
        const victim = enemyWithShieldPool('victim', 'M4', 100_000, 15_000);
        const flags = shieldFlagsOn(focusCast([attackSkill(3)], [victim]), 'victim');
        expect(flags).toEqual([true, true, false]);
    });

    it('N=1 against the same pool is fully absorbed — one arrival, one true', () => {
        const victim = enemyWithShieldPool('victim', 'M4', 100_000, 15_000);
        const flags = shieldFlagsOn(focusCast([attackSkill(1)], [victim]), 'victim');
        expect(flags).toEqual([true]);
    });
});

// ── Tier 2, Section B: Protection redirect ─────────────────────────────────────────────────

/**
 * Grants SELF `Protection` the PRODUCTION way (deviation 3) — a passive-slot `buff` ability with
 * NO `duration`, which `registerActorAbilityStatuses` classifies as a permanent AURA rather than
 * a cast-triggered grant. Copied verbatim (shape, not code-shared) from
 * `damageDealtBasis.integration.test.ts`'s `protectionAuraPassive` / `protectionTransfer
 * .integration.test.ts`. `protectorsFor` (engine.ts) then treats ANY living same-side ally
 * holding this stack count as a protector for every OTHER same-side actor — there is no
 * `protectorId` targeting field; coverage is automatic.
 */
const protectionAura = (stacks: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'pr6t2-protection-aura',
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
        } as Ability,
    ],
});

/** Total damage booked against one actor across the run, from `RoundData.perTargetDamage`
 *  (deviation 4 — the brief assumed a top-level `result.perTargetDamage`; the real field is
 *  per-round, summed here as `counterAttack.test.ts`'s `totalPerTargetDamage` does). */
const perTargetDamageFor = (input: CombatEngineInput, actorId: string): number => {
    const result = runCombat(input);
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

/** Same as `perTargetDamageFor`, but reads multiple actors' totals from a single run — used
 *  when both the protector's and the protected actor's booked damage are needed from the same
 *  fixture (avoids re-running combat once per actor). */
const perTargetDamagesFor = (
    input: CombatEngineInput,
    actorIds: string[]
): Record<string, number> => {
    const result = runCombat(input);
    const sums: Record<string, number> = {};
    for (const id of actorIds) sums[id] = 0;
    for (const rd of result.rounds) {
        for (const id of actorIds) sums[id] += rd.perTargetDamage?.[id] ?? 0;
    }
    return sums;
};

describe('PR6 Tier 2 — Protection redirect resolves per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('a protector absorbs a share of EVERY sub-attack, so its booked damage scales with N (linearity baseline)', () => {
        // LINEARITY BASELINE — this test does NOT by itself discriminate a per-sub-attack funnel
        // from a per-cast one. A per-cast funnel that redirects a fixed fraction of the summed
        // cast damage ONCE would ALSO scale perfectly linearly with N here (the fixture's damage
        // is a fixed 100% multiplier x hits, not re-split, so the aggregate triples from N=1 to
        // N=3 exactly as three separate redirects would). What actually discriminates the two
        // models is the dying-protector test below: killing the protector mid-cast breaks this
        // linearity in a way a per-cast rollup cannot reproduce under any ordering.
        //
        // MEASURED (throwaway probe, matching production's protectionCascade at 10%/stack): 3
        // Protection stacks -> 30% redirect fraction. A living protector at defence 0 absorbs 30%
        // of each 10,000-per-sub-attack cast:
        //   N=1: protector books 3,000 (one redirect of 10,000 * 30%)
        //   N=3: protector books 9,000 (three redirects of 10,000 * 30%, exactly 3x N=1)
        const build = (hits: number) =>
            enemyDrivenBattle(
                [
                    teamVictim('protected', 'M4', []),
                    teamVictim('protector', 'M3', [protectionAura(3)]),
                ],
                [offensiveEnemy('foe', 'M1', hits)]
            );
        const one = perTargetDamageFor(build(1), 'protector');
        const three = perTargetDamageFor(build(3), 'protector');
        expect(one).toBeCloseTo(3_000, 6);
        expect(three).toBeCloseTo(9_000, 6);
    });

    it('a protector that dies mid-cast stops covering later sub-attacks — the result a per-cast rollup cannot reach', () => {
        // Same redirect math as the linearity baseline above (3 stacks -> 30% of each 10,000
        // sub-attack, defence 0), but the protector's hp is set to 2,000 — below the 3,000 it
        // absorbs from sub-attack 1 — so it dies on sub-attack 1. `protectorsFor` (engine.ts
        // ~3337) filters on `a.currentHp > 0` and is re-evaluated per arrival inside
        // `applyVictimDamage`'s recursive redirect call, so under a per-sub-attack funnel, once
        // the protector is dead, sub-attacks 2 and 3 find no living protector and land
        // unredirected on 'protected'.
        //
        // MEASURED (probe, not derived):
        //   model                            | protector           | protected
        //   per-sub-attack (correct, actual)  | 3000.0000000000005  | 27000
        //   per-cast (the bug)                | 9000                | 21000
        //   no Protection at all              | 0                   | 30000
        //
        // 27,000 = 7,000 (sub-attack 1's unredirected remainder, 10,000 - 3,000) + 10,000 +
        // 10,000 (sub-attacks 2 and 3, arriving unredirected once the protector is dead). A
        // per-cast funnel that redirects a fixed fraction of the summed 30,000 aggregate cannot
        // produce this number however the protector's death is ordered — it only ever has ONE
        // redirect roll to spend against the aggregate, never one split partway through by a
        // death that only a per-sub-attack funnel can even observe.
        const build = (hits: number) =>
            enemyDrivenBattle(
                [
                    teamVictim('protected', 'M4', []),
                    teamVictim('protector', 'M3', [protectionAura(3)], 2_000),
                ],
                [offensiveEnemy('foe', 'M1', hits)]
            );
        const rows = perTargetDamagesFor(build(3), ['protector', 'protected']);
        expect(rows.protected).toBe(27_000);
        expect(rows.protector).toBeCloseTo(3_000, 6);
    });

    it('N=1 against the same dying-protector fixture matches the living-protector case — the fixture only diverges over a multi-hit cast', () => {
        const build = (hits: number) =>
            enemyDrivenBattle(
                [
                    teamVictim('protected', 'M4', []),
                    teamVictim('protector', 'M3', [protectionAura(3)], 2_000),
                ],
                [offensiveEnemy('foe', 'M1', hits)]
            );
        const rows = perTargetDamagesFor(build(1), ['protector', 'protected']);
        expect(rows.protector).toBeCloseTo(3_000, 6);
        expect(rows.protected).toBe(7_000);
    });
});

// ── Tier 2, Section C: incoming-block proc ─────────────────────────────────────────────────

/**
 * A synthetic `incoming-block` passive (D-PR3's shape — `src/types/abilities.ts` ~line 900,
 * exercised end-to-end in `incomingBlockEngine.test.ts`). `condition: 'always'` (a real
 * `IncomingCondition` variant, abilities.ts ~line 529 — used for unconditional per-hit gates)
 * makes every direct sub-attack eligible; `oncePerRound: false` means each of the cast's 3
 * sub-attacks rolls its OWN proc, not a single once-per-round consumption.
 */
const blockPassive = (procChance: number, blockPct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'incoming-block',
            target: 'self',
            config: {
                type: 'incoming-block',
                condition: 'always',
                procChance,
                blockPct,
                oncePerRound: false,
            },
        }),
    ],
});

/**
 * Collects `ability-performed.deliveredDamage` for the given actor's own attack events, in
 * sub-attack order.
 *
 * NOT `attacked.damage`, and this is a MEASURED deviation (task-2-report.md has the full probe
 * transcript), not a stylistic choice: `attacked.damage` is documented (emitAttacked.ts /
 * events.ts) as the PRE-FUNNEL display basis, and a throwaway probe forcing `procChance: 1,
 * blockPct: 1` (every sub-attack fully blocked) confirmed it empirically — `attacked.damage`
 * stayed 10,000 on all 3 sub-attacks even though every one was fully blocked. `ability-performed
 * .deliveredDamage` (PR7's post-funnel "what this sub-attack actually delivered", events.ts
 * ~line 88) DID read exactly 0 on all 3 under that same forced-full-block probe, and 10,000 on
 * the matching no-block control — the discriminating signal the brief asked for when "no event
 * distinguishes a blocked sub-attack".
 */
const deliveredDamagesOf = (input: CombatEngineInput, actorId: string): (number | undefined)[] => {
    const bus = createEventBus();
    const out: (number | undefined)[] = [];
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === actorId) out.push(e.deliveredDamage);
    });
    runCombat({ ...input, bus });
    return out;
};

describe('PR6 Tier 2 — the incoming-block proc rolls per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('a deterministic full block (procChance 1) shaves EVERY sub-attack to 0 delivered — the control the seeded test below diffs against', () => {
        const victim = enemyAt('victim', 'M4', [blockPassive(1, 1)]);
        const delivered = deliveredDamagesOf(focusCast([attackSkill(3)], [victim]), 'attacker');
        expect(delivered).toEqual([0, 0, 0]);
    });

    it('no block ability — every sub-attack delivers the full measured 10,000', () => {
        const victim = enemyAt('victim', 'M4');
        const delivered = deliveredDamagesOf(focusCast([attackSkill(3)], [victim]), 'attacker');
        expect(delivered).toEqual([10_000, 10_000, 10_000]);
    });

    it('a 50%-chance block over a 3-hit cast draws 3 times, not 1 — proven by seeds giving a PARTIAL block count', () => {
        // A per-CAST roll (the bug this guards against) can only ever produce a block count of 0
        // or 3 for a given cast — the roll fires once and its verdict applies to the whole cast.
        // A per-SUB-ATTACK roll can additionally produce 1 or 2. Finding ANY seed that yields a
        // count in {1,2} is a direct disproof of the per-cast model: that observation is
        // impossible under it, however the RNG stream is seeded.
        //
        // MEASURED (throwaway probe, seeds 1-12 against this exact fixture): seed 1 delivers
        // [10000, 10000, 0] (count 1); seed 3 delivers [0, 10000, 0] (count 2). Both are pinned
        // exactly below — a mixed array like these is impossible under a per-cast roll, which is
        // what proves the roll is per-sub-attack rather than merely that blocking happened. The
        // 12-seed sweep is kept as well, so a future engine change has to break BOTH the two
        // concrete seeds and the general search to pass.
        setKeyedRng(mulberry32(1));
        const seed1Victim = enemyAt('victim', 'M4', [blockPassive(0.5, 1)]);
        expect(deliveredDamagesOf(focusCast([attackSkill(3)], [seed1Victim]), 'attacker')).toEqual([
            10_000, 10_000, 0,
        ]);

        setKeyedRng(mulberry32(3));
        const seed3Victim = enemyAt('victim', 'M4', [blockPassive(0.5, 1)]);
        expect(deliveredDamagesOf(focusCast([attackSkill(3)], [seed3Victim]), 'attacker')).toEqual([
            0, 10_000, 0,
        ]);

        const counts = new Set<number>();
        for (let seed = 1; seed <= 12; seed++) {
            setKeyedRng(mulberry32(seed));
            const victim = enemyAt('victim', 'M4', [blockPassive(0.5, 1)]);
            const delivered = deliveredDamagesOf(focusCast([attackSkill(3)], [victim]), 'attacker');
            counts.add(delivered.filter((d) => d === 0).length);
        }
        const partial = [...counts].filter((c) => c === 1 || c === 2);
        expect(partial.length).toBeGreaterThan(0);
    });
});

// ── Tier 2, Section D: the DoT transform resolves per sub-attack ──────────────────────────
//
// DEVIATIONS FROM task-3-brief.md (measured against source before writing assertions, per the
// task's three corrections plus what surfaced verifying them):
//
// 1. DAMAGE ARITHMETIC (task correction #1): as in every prior section, `crit: 100,
//    critDamage: 100` on both `focusCast` and `offensiveEnemy` means every hit crits and
//    doubles — each sub-attack of a 3-hit cast delivers 10,000, not the brief's assumed 5,000.
//
// 2. NO EVENT MARKS DoT-ENTRY CREATION. `convertHitToSelfDot` (engine.ts ~1602) pushes straight
//    onto `victim.genericDoTEntries` with no accompanying emit — `dot-applied` (events.ts:164)
//    is a DIFFERENT mechanism (inflicted corrosion/inferno), never fired by the transform path,
//    confirmed by reading every call site of `bus.emit({ type: 'dot-applied', ...})` (none is
//    inside convertHitToSelfDot or its two call sites). So `dotEntryCountFor` cannot read
//    `dot-applied`, as the brief assumed.
//
//    The working signal: `tickDoTs` (engine.ts ~1049) sums ALL generic entries into a SINGLE
//    `dot-ticked` event per tick round (`emitTicked('generic', genericSum, genericStacks, 0)`,
//    engine.ts:1060) — so the event's own COUNT never discriminates (always <= 1 per victim per
//    round, an instance of the brief's own linearity warning). But `convertHitToSelfDot` always
//    pushes `stacks: 1` per entry (engine.ts:1602), so the event's `stacks` FIELD is the summed
//    stack count across every entry that ticked together — i.e., the entry count itself. A
//    per-cast bug that created ONE entry (carrying the whole 3x damage, since `attackSkill`
//    multiplies) would tick with `stacks: 1` regardless of N; a correct per-sub-attack model
//    that created N entries ticks with `stacks: N`. `dotEntryCountFor` below reads exactly that
//    field, matching the brief's own request for something that "breaks the linearity" of a
//    plain damage/tick sum.
//
// 3. TURN ORDER (per the reference file's own requirement, reused here): the victim needs a
//    HIGHER speed than the attacker so its OWN tick step (which reads whatever entries already
//    exist at the start of ITS turn) does not fire mid-creation. `teamVictim`'s speed defaults
//    to 1 (Sections A-C's implicit assumption) and `offensiveEnemy`'s to 1000 — the OPPOSITE of
//    what this block needs, so `teamVictim`'s now-optional 5th `speed` param (see its own
//    comment) is used to override it to 2000 here. `numRounds` is bumped from
//    `enemyDrivenBattle`'s default 1 to 2 (via a spread override) so a tick round actually
//    occurs after the creating round.

/** Voron/Orel's transform-incoming-to-dot passive (task-3-brief.md's own shape) — unconditional,
 *  self-targeted, on-attacked. */
const voronTransform = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'transform-incoming-to-dot',
            target: 'self',
            trigger: 'on-attacked',
            config: { type: 'transform-incoming-to-dot', turns, condition: 'always' },
        }),
    ],
});

/** Reads the STACKS field of the first `dot-ticked` (dotType 'generic') event targeting
 *  `victimId` — the summed entry count of whichever entries ticked together this round (see
 *  DEVIATION 2 above for why this, not a `dot-applied` count or the tick's own event count, is
 *  the discriminating signal). Round 1 (the creating round) never ticks anything created that
 *  same round under the turn-order fixture below, so the FIRST event observed is round 2's tick
 *  of round 1's freshly-created entries — exactly the count this test wants. */
const dotEntryCountFor = (input: CombatEngineInput, victimId: string): number => {
    const bus = createEventBus();
    let stacks: number | undefined;
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (stacks === undefined && e.targetId === victimId && e.dotType === 'generic') {
            stacks = e.stacks;
        }
    });
    runCombat({ ...input, bus });
    return stacks ?? 0;
};

describe('PR6 Tier 2 — the DoT transform creates one entry PER sub-attack — PLAYER side', () => {
    afterEach(() => resetRateGateRng());

    it('a 3-hit cast against a transform carrier creates 3 independent DoT entries, so the next tick round sums 3 stacks', () => {
        // ANTI-VACUITY: total tick DAMAGE is non-discriminating here (the brief's own flagged
        // trap) — a per-cast bug funnels the whole 3x10,000 into ONE entry, and since
        // `attackSkill` multiplies the CAST's damage by `hits`, that single entry's total ticked
        // damage over its lifetime is the SAME 30,000 a correct 3-entry model produces. What
        // differs is the ENTRY COUNT feeding that total: 1 vs 3. `dotEntryCountFor` reads
        // exactly that (via the tick event's summed `stacks`), which is why this assertion, and
        // not a damage total, is the one that discriminates the two models.
        const build = (hits: number) => ({
            ...enemyDrivenBattle(
                [teamVictim('voron', 'M4', [voronTransform(3)], HP, 2000)],
                [offensiveEnemy('foe', 'M1', hits)]
            ),
            numRounds: 2,
        });
        expect(dotEntryCountFor(build(3), 'voron')).toBe(3);
        expect(dotEntryCountFor(build(1), 'voron')).toBe(1);
    });
});

describe('PR6 Tier 2 — the DoT transform on the ENEMY side (team symmetry)', () => {
    it('a 3-hit player cast against an enemy transform carrier also creates 3 independent DoT entries', () => {
        // Mirrors the player-side test above via this file's own `focusCast`/`enemyAt` pair
        // (already proven positional-enemy-victim helpers, Section C). `enemyAt`'s hardcoded
        // speed (1) is already LOWER than the player focus's default, so the enemy's own tick
        // step naturally lands on its OWN following turn — no speed override needed here.
        const build = (hits: number) => ({
            ...focusCast([attackSkill(hits)], [enemyAt('voron-e', 'M4', [voronTransform(3)])]),
            numRounds: 2,
        });
        expect(dotEntryCountFor(build(3), 'voron-e')).toBe(3);
        expect(dotEntryCountFor(build(1), 'voron-e')).toBe(1);
    });
});

// ── Tier 2, Section E: damage reflection resolves per sub-attack ──────────────────────────
//
// Reflection is applied INSIDE `applyVictimDamage` itself (engine.ts ~4970-5043), the SAME
// per-arrival funnel Tier 1/2's shield/Protection/block tests already proved runs once per
// sub-attack — so, unlike the counter block below, no separate guard layer is in play here. The
// reflect's LOG-ONLY event is `reactive-damage-performed` (task correction #3; confirmed at
// events.ts:229 and its sole emit sites, engine.ts:3984/4229/5043) — `sourceId` is the
// REFLECTOR (the wearer who took the hit and bounced it back), `targetId` the original attacker.
// There is no separate discriminator between a reflect and a counter on this event (both funnel
// through the same LOG-ONLY shape) — but filtering by `sourceId === <the reflecting victim's
// id>` isolates reflection unambiguously here, since only the reflector ever carries that id as
// a `sourceId` in this fixture (the attacker never reflects).

const reflectPct = (pct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            // DEVIATION from the brief's own `type: 'damage-reflection'`: that string is not a
            // member of `AbilityType` at all (tsc rejects it) — 'damage-reflection' only ever
            // appears as an `AbilityConfig.type` discriminant. `incomingAbilitiesOf` (engine.ts
            // ~3199) collects a passive-slot ability purely by `config.type`, ignoring the outer
            // `type`/`trigger` entirely, so the REAL production shape (Reflect gear set,
            // buildEquipmentAbilities.ts REFLECT) uses `type: 'modifier'` as a placeholder —
            // matched here.
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'damage-reflection', pct },
        }),
    ],
});

/** Counts `reactive-damage-performed` events sourced from `victimId` (see the section header for
 *  why `sourceId` alone disambiguates reflect from counter in this fixture). */
const reflectEventCount = (input: CombatEngineInput, victimId: string): number => {
    const bus = createEventBus();
    let count = 0;
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === victimId) count++;
        }
    );
    runCombat({ ...input, bus });
    return count;
};

describe('PR6 Tier 2 — damage reflection fires per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    it('reflects 3 times off a 3-hit cast, each off its OWN sub-attack damage', () => {
        // ANTI-VACUITY: a COUNT of reflect events is only discriminating because reflection has
        // no once-per-attack guard at all (unlike the counter below) — a per-cast bug would have
        // to emit the reflect ONCE, off the summed 30,000, which this test's N=1 control (1
        // reflect off 10,000) already rules out being confused with by cardinality alone: 3
        // distinct events vs 1 is impossible to produce from a single aggregate application. A
        // TOTAL-damage assertion would not discriminate (3 reflects of ~pct% each of D sum to
        // the same total as 1 reflect of pct% of 3D) — cardinality, not magnitude, is pinned.
        const build = (hits: number) =>
            enemyDrivenBattle(
                [teamVictim('mirror', 'M4', [reflectPct(20)])],
                [offensiveEnemy('foe', 'M1', hits)]
            );
        expect(reflectEventCount(build(3), 'mirror')).toBe(3);
        expect(reflectEventCount(build(1), 'mirror')).toBe(1);
    });
});

// ── Tier 2, Section F: counterattacks fire per sub-attack ─────────────────────────────────
//
// HISTORY (Task 3 found the defect here; Task 3b fixed it — this section now pins the FIX, and
// the record of what it replaced is kept deliberately so a future reader does not re-derive it).
//
// task-3-brief.md's correction #3 pointed at triggers.ts's `reactionFiredThisAttack` key
// (`ownerId:abilityId:victimId:subAttackIndex`) as the guard to watch — but that key belongs to
// the SIBLING 'damage'-type reactive branch (procScope:'per-attack', e.g. Insidiousness), NOT
// the 'counter' ability type this block exercises. The COUNTER branch guards with its OWN set,
// `ctx.counterFiredThisTurn`, cleared only at every actor TURN-START (engine.ts, unconditionally,
// once per actor whose turn begins) — never per-sub-attack.
//
// THE DEFECT, as this section originally measured it: that set was keyed `ownerId:abilityId` —
// NO victimId, NO subAttackIndex. So within a 3-hit cast, sub-attack 1's `on-attacked` fired,
// found the key absent, countered, and set the key; sub-attacks 2 and 3 of the SAME cast found it
// already set and were silently suppressed. A 100%-chance counter fired exactly ONCE per
// multi-hit cast, regardless of N. That keying was CORRECT before this epic (one attack == one
// turn) and the guard's own comment predicted its own obsolescence; R1 (`hits: N` is N full
// attacks inside one turn) broke the equivalence, and this branch was never re-keyed with the
// sub-attack index the sibling branch gained in PR4.
//
// THE FIX (Task 3b): the key gained the triggering event's `subAttackIndex`, exactly as its own
// SCOPE NOTE prescribed and matching `oncePerAttackGuardKey`'s convention. A counter is an
// INCOMING-triggered reaction, and R2 resolves those per hit — so a victim of a 3-hit cast
// counters three times. The assertions below now pin 3-for-N=3 / 1-for-N=1. They previously
// pinned 1 for BOTH, which was a faithful characterization of the code at the time but, left
// standing after the fix, would have been a test whose assertion blessed a defect — the failure
// mode this repo has shipped before.

const counterOnAttacked = (procChancePct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'counter',
            target: 'self',
            trigger: 'on-attacked',
            // procChance is a top-level Ability field (0..1); >= 1 bypasses the proc gate
            // entirely (passesProcChanceGate, triggers.ts:2177-2179), leaving only the
            // counterFiredThisTurn guard this block exercises.
            procChance: procChancePct / 100,
            config: { type: 'counter', multiplier: 30 },
        }),
    ],
});

/** Counts `reactive-damage-performed` events sourced from `victimId` — the counter owner (see
 *  Section E's header for why `sourceId` alone disambiguates in this fixture: only the
 *  countering victim, never the attacking 'foe', ever appears as a `sourceId` here). */
const counterEventCount = (input: CombatEngineInput, victimId: string): number => {
    const bus = createEventBus();
    let count = 0;
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === victimId) count++;
        }
    );
    runCombat({ ...input, bus });
    return count;
};

describe('PR6 Tier 2 — counterattacks fire once per sub-attack — PLAYER side', () => {
    afterEach(() => resetRateGateRng());

    it('a 100%-chance counter fires 3 times against a 3-hit cast and once against a 1-hit cast', () => {
        // ANTI-VACUITY: cardinality, not magnitude, is the discriminator (same argument as
        // Section E's reflect test). The pre-fix engine produced 1 for BOTH N=3 and N=1 — the
        // signature of a per-TURN collapse — so the N=3 assertion alone would fail against it.
        // The N=1 control is what keeps the fix honest in the other direction: a guard that had
        // simply been DELETED (rather than re-keyed per sub-attack) would over-fire wherever a
        // single attack fans into multiple `attacked` events, and N=1 pinned at exactly 1 is the
        // assertion that catches that.
        //
        // `teamVictim`'s `attack` override (see its own comment) is set to 10,000 here:
        // `applyCounterAttack` computes its raw damage off the OWNER's `effectiveAttack` and
        // no-ops when that raw is <= 0 (engine.ts ~5283) — a throwaway probe with the default
        // attack:0 produced ZERO `reactive-damage-performed` events, which would have made this
        // whole block vacuous.
        const build = (hits: number) =>
            enemyDrivenBattle(
                [teamVictim('counter', 'M4', [counterOnAttacked(100)], HP, 1, 10_000)],
                [offensiveEnemy('foe', 'M1', hits)]
            );
        expect(counterEventCount(build(3), 'counter')).toBe(3);
        expect(counterEventCount(build(1), 'counter')).toBe(1);
    });
});

describe('PR6 Tier 2 — counterattacks on the ENEMY side (team symmetry)', () => {
    afterEach(() => resetRateGateRng());

    it('an ENEMY counter carrier hit by a 3-hit PLAYER cast also counters 3 times', () => {
        // Team symmetry is mandatory in this engine and the enemy path has silently dropped
        // mechanics before (the enemy passive slot went entirely unwired once, #306). The counter
        // guard lives in the SIDE-AGNOSTIC intent executor, so a side-specific regression could
        // only come from the enemy-side `attacked` emit failing to stamp `subAttackIndex` — which
        // is precisely what this mirror pins.
        //
        // Mirrors the player-side test via this file's own `focusCast`/`enemyAt` pair. `enemyAt`
        // hardcodes attack:0, so the stats are overridden here for the same `applyCounterAttack`
        // raw > 0 reason the player-side fixture needs its `attack` override.
        const build = (hits: number) => {
            const carrier = {
                ...enemyAt('counter-e', 'M4', [counterOnAttacked(100)]),
                stats: { attack: 10_000, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
            } as EnemyAttacker;
            return focusCast([attackSkill(hits)], [carrier]);
        };
        expect(counterEventCount(build(3), 'counter-e')).toBe(3);
        expect(counterEventCount(build(1), 'counter-e')).toBe(1);
    });
});
