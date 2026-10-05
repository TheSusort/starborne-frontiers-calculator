/**
 * Lionheart Protection — the REAL kit's round-start grant, redirect, and clear-on-redirect.
 *
 * Lionheart R2+ passive: "At the start of the round, this Unit gains 10 stacks of Protection.
 * After taking damage redirected through Protection, all Protection is removed." The parser emits
 * it as a `start-of-round` buff (`stacks: 10`, `maxStacks: 10`, `duration: 'recurring'`,
 * `clearAllOnRedirect: true`), which makes it a REACTIVE ability. The reactive executor adds the
 * 10 stacks to his accumulating store, capped at 10, so each round starts him at exactly 10
 * (refresh-to-10). Nothing times them out: the only removal is the redirect, after which
 * `removeSelfBuffByName` zeroes the pool until the next round start re-grants it.
 *
 * At 10 stacks (100% redirect fraction, 10%/stack) Lionheart intercepts the FIRST ally hit each
 * round in full; a SECOND hit the same round is NOT redirected.
 *
 * Every fixture here reads the grant off the production parser (`buildTraceShip` +
 * `buildShipAbilities` over `docs/ship-skills.csv`) — a hand-authored config is how this suite once
 * stayed green while the real kit redirected nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { selfBuffStacksForOwner } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A flat enemy attacker (no shipSkills -> engine synthesizes a single 100% basic hit). */
const manualEnemy = (id: string, attack: number): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
});

/** An enemy that stands on a cell and never deals damage (attack 0, huge HP). */
const idleEnemy = (id: string, position: EnemyAttacker['position']): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [] },
});

const front = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A plain 100% single-target hit. */
const plainHit = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
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
 *  the chunk.total===0 guard test below. Distinct from `lionheartProtectionPassive`'s round-start
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

/** The reference data is gitignored, so its absence is a BROKEN WORKTREE, not a reason to pass. */
const requireReferenceData = (): void => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read the REAL Lionheart kit and cannot run without it.'
        );
    }
};

/** The real Lionheart's Protection grant, straight off the production parser. Only the Protection
 *  ability is kept: his other passive clause (the start-of-combat HP gift to adjacent allies) would
 *  only blur the incoming-damage reads below. */
const realLionheartProtection = (): Ability => {
    const ship = buildTraceShip('Lionheart');
    if (!ship) throw new Error('Lionheart is missing from the reference data in this worktree');
    const grants = buildShipAbilities(ship).slots.flatMap((slot) =>
        slot.abilities.filter((a) => a.config.type === 'buff' && a.config.buffName === 'Protection')
    );
    if (grants.length !== 1) {
        throw new Error(`expected exactly one real Protection grant, found ${grants.length}`);
    }
    return grants[0];
};

const lionheartProtectionPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [realLionheartProtection()],
});

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
    // `ally-1` claims the front-middle cell and BOTH enemies are pinned to the middle
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
    beforeAll(requireReferenceData);
    it('redirects the FIRST ally-hit each round, then clears — the SECOND hit is NOT redirected; refresh-to-10 re-grants the redirect next round', () => {
        const res = runCombat(BASE_INPUT);

        const lionheartR1 = res.rounds[0]?.perActorIncoming?.['lionheart']?.incoming ?? 0;
        const allyR1 = res.rounds[0]?.perActorIncoming?.['ally-1']?.incoming ?? 0;
        const lionheartR2 = res.rounds[1]?.perActorIncoming?.['lionheart']?.incoming ?? 0;
        const allyR2 = res.rounds[1]?.perActorIncoming?.['ally-1']?.incoming ?? 0;

        // Round 1, hit 1 (enemy-A): 10 stacks = 100% redirect fraction -> Lionheart takes the
        // WHOLE hit (re-mitigated on its own defence); the ally takes nothing from this hit.
        expect(lionheartR1).toBeGreaterThan(0);
        // Round 1, hit 2 (enemy-B): Protection was cleared after hit 1 -> NOT redirected -> the
        // ally takes this hit directly, in FULL (it has no defence of its own). A partial pool
        // left behind by the clear would shave this.
        expect(allyR1).toBeCloseTo(ENEMY_ATTACK, 4);
        // Round 2: the round-start grant re-adds 10 stacks (refresh-to-10) -> the redirect
        // resumes on round 2's first hit, and again only the second hit reaches the ally.
        expect(lionheartR2).toBeGreaterThan(0);
        expect(allyR2).toBeCloseTo(ENEMY_ATTACK, 4);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// The clear-on-redirect loop is gated on the protector's OWN cascade chunk having actually
// redirected something (`chunk.total > 0`), not fired unconditionally for every
// `clearProtectionOnRedirectIds` member present in `protectors`.
//
// Reachable scenario: TWO protectors cover the same victim — Lionheart (FASTER, 10 stacks via
// his round-start grant) and a second, SLOWER, fully-stacked (10 stacks, aura-granted)
// protector "other". `protectionCascade`'s cascade math (protectionTransfer.ts) computes each
// protector's `kept` share as `(1 - nextFrac) * flow * mit`, where `nextFrac` is the fraction the
// NEXT (slower) protector in the chain drains before the current protector's share is realized.
// Because "other" also has max stacks (frac = 1.0), Lionheart's OWN kept share collapses to
// `(1 - 1.0) * flow * mit = 0` — "other" fully drains whatever cascades through Lionheart before
// Lionheart's cut is realized, even though Lionheart is the FASTER (first) protector in the chain
// and genuinely holds 10 Protection stacks. This is the `chunk.total === 0` case the guard exists
// for: with both protectors at max stacks and mit=1, `protectionCascade` returns chunks
// [{total: 0}, {total: 1000}].
//
// "other" is given deliberately low HP (500) so it DIES partway through absorbing its ~1000
// chunk (10 sub-hits of ~100 each) — removing it from `protectorsFor` for the round's SECOND
// hit. That isolates the observable difference: with the buggy unconditional clear, Lionheart's
// Protection is wiped after hit 1 (despite its chunk being 0) -> by hit 2, BOTH protectors are
// gone (other dead, Lionheart cleared) -> the ally eats the full second hit. With the guard, hit
// 1 leaves Lionheart's Protection intact (its chunk was 0, so the clear never fires) -> by hit 2,
// Lionheart is the sole living protector and still redirects it in full.
describe('Lionheart Protection — clear-on-redirect guard: chunk.total === 0 must NOT clear', () => {
    beforeAll(requireReferenceData);
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

// ───────────────────────────────────────────────────────────────────────────────────────
// THE STOLEN-STACK LEDGER FOLLOWS THE BUFF'S OWN LIFECYCLE.
//
// A buff steal records its stack movement as a signed per-owner delta (`adjustSelfBuffStacks`)
// that `selfBuffStacksForOwner` folds in, because an accumulating/aura-granted count cannot be
// mutated in place. That delta must be cleared wherever the buff it adjusts is cleared —
// `removeSelfBuffByName`, which zeroes the accumulating entry precisely so the next round-start
// grant can re-accrue it. A delta that survives that reset becomes a permanent per-theft tax: Lionheart
// re-grants his full 10 stacks at the top of round 2 but reads 9, so his redirect covers 90%
// instead of 100% and the ally he is protecting eats the remaining tenth — forever, compounding
// with every further theft.
describe('Lionheart Protection — a stolen stack does not tax the next round-start re-grant', () => {
    beforeAll(requireReferenceData);
    /** An enemy thief that fires Pallas's "steals 1 buff" ONCE, on its charged opener, and never
     *  again (its active slot is empty and the charge does not re-arm inside two rounds). Faster
     *  than the attacker below so the theft lands BEFORE the round-1 redirect clears Lionheart's
     *  pool — steal-then-clear is the ordering that leaves a delta behind to survive the reset. */
    const chargedThief = (id: string): EnemyAttacker => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, speed: 300 },
        chargeCount: 3,
        startCharged: true,
        position: 'M3',
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'charged',
                    abilities: [
                        {
                            id: 'thief-steal',
                            type: 'buff-steal',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'buff-steal', count: 1 },
                        },
                    ],
                },
            ],
        },
    });

    /** Lionheart front-most in row M so the thief (also row M) resolves HIM; the undefended ally
     *  is front-most in row T with its own attacker there. Protection is not adjacency-scoped, so
     *  Lionheart still soaks for the ally across rows. */
    const ledgerInput = (withThief: boolean): CombatEngineInput => ({
        ...BASE_INPUT,
        numRounds: 2,
        teamActors: [
            { ...teamActor('ally-1', 0), position: 'T4' },
            {
                ...teamActor('lionheart', LIONHEART_DEFENCE, [lionheartProtectionPassive()]),
                position: 'M4',
            },
        ],
        enemyAttackers: [
            { ...manualEnemy('enemy-A', ENEMY_ATTACK), position: 'T3' },
            ...(withThief ? [chargedThief('thief')] : []),
        ],
    });

    it('CONTROL: with no thief, a full 10 stacks cover the ally completely in BOTH rounds', () => {
        const res = runCombat(ledgerInput(false));

        expect(res.rounds[0]?.perActorIncoming?.['ally-1']?.incoming ?? 0).toBeCloseTo(0, 4);
        expect(res.rounds[1]?.perActorIncoming?.['ally-1']?.incoming ?? 0).toBeCloseTo(0, 4);
    });

    it('round 2 re-grants the FULL 10 even though a stack was stolen in round 1', () => {
        const res = runCombat(ledgerInput(true));

        const allyR1 = res.rounds[0]?.perActorIncoming?.['ally-1']?.incoming ?? 0;
        const allyR2 = res.rounds[1]?.perActorIncoming?.['ally-1']?.incoming ?? 0;

        // Round 1 is the INSTRUMENT: the theft really landed, so Lionheart covered only 9/10 of
        // the hit and the ally took the remaining tenth. Without this the round-2 assertion could
        // pass because nothing was ever stolen.
        expect(allyR1).toBeGreaterThan(0);
        // Round 2: the redirect cleared Lionheart's pool in round 1 and his round-start grant re-added
        // all 10, so the ally is covered in full again. With the delta surviving that reset he
        // reads 9 and the ally keeps taking the same tenth, round after round.
        expect(allyR2).toBeCloseTo(0, 4);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// The real kit, by speed order and by side. The grant lands at the START of the round, so it is
// standing whether the attacker moves before or after Lionheart, and nothing times it out at the
// end of his own turn.
describe("Lionheart's real round-start Protection — both speed orders, both sides", () => {
    beforeAll(requireReferenceData);

    it('PRECONDITION: the parser emits the grant as a start-of-round, 10-stack, recurring buff', () => {
        expect(realLionheartProtection()).toMatchObject({
            trigger: 'start-of-round',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Protection',
                stacks: 10,
                maxStacks: 10,
                duration: 'recurring',
                clearAllOnRedirect: true,
            },
        });
    });

    /** One enemy hits the undefended ally once a round; Lionheart's speed sets who moves first. */
    const playerSide = (lionheartSpeed: number, numRounds = 1): CombatEngineInput => ({
        ...BASE_INPUT,
        numRounds,
        teamActors: [
            { ...teamActor('ally-1', 0), position: 'M4' },
            {
                ...teamActor(
                    'lionheart',
                    LIONHEART_DEFENCE,
                    [lionheartProtectionPassive()],
                    lionheartSpeed
                ),
                position: 'M2',
            },
        ],
        enemyAttackers: [{ ...manualEnemy('enemy-A', ENEMY_ATTACK), position: 'M4' }],
    });

    const incoming = (res: ReturnType<typeof runCombat>, round: number, id: string): number =>
        res.rounds[round]?.perActorIncoming?.[id]?.incoming ?? 0;

    it('a SLOWER attacker (Lionheart moves first) is redirected in full — the stacks outlive his turn', () => {
        const res = runCombat(playerSide(150));

        expect(incoming(res, 0, 'ally-1')).toBeCloseTo(0, 4);
        expect(incoming(res, 0, 'lionheart')).toBeGreaterThan(0);
    });

    it('a FASTER attacker (hits before Lionheart moves) is redirected in full — 10 stacks, not 1', () => {
        const res = runCombat(playerSide(10));

        expect(incoming(res, 0, 'ally-1')).toBeCloseTo(0, 4);
        expect(incoming(res, 0, 'lionheart')).toBeGreaterThan(0);
    });

    /** Reads an actor's Protection at the END of the run through the aggregator `protectorsFor`
     *  acts on. */
    const endStacks = (input: CombatEngineInput, id: string): number => {
        let engine: StatusEngine | undefined;
        runCombat({
            ...input,
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return selfBuffStacksForOwner(engine!, id, 'Protection');
    };

    it('with nothing to redirect, he holds exactly 10 across rounds (refresh-to-10, no timer)', () => {
        const input = { ...playerSide(150, 3), enemyAttackers: [idleEnemy('idle', 'M4')] };
        expect(endStacks(input, 'lionheart')).toBe(10);
    });

    it('a redirect removes ALL his stacks until the next round start', () => {
        expect(endStacks(playerSide(150, 2), 'lionheart')).toBe(0);
    });

    // ── Enemy-side twin ────────────────────────────────────────────────────────────────
    /** A second player hitter for the two-hits-a-round case. */
    const playerHitter = (id: string): TeamActorEngineInput => {
        const base = teamActor(id, 0);
        return {
            ...base,
            position: 'M3',
            target: front(),
            pattern: basePattern(),
            walk: {
                ...base.walk!,
                shipSkills: { slots: [{ slot: 'active', abilities: [plainHit(`${id}-hit`)] }] },
                stats: { ...base.walk!.stats, attack: ENEMY_ATTACK },
            },
        };
    };

    /** An enemy Lionheart behind an undefended enemy front-liner; the player focus (and, with
     *  `twoHitters`, a second player ship) hits that front-liner once a round each. */
    const enemySide = (
        lionheartSpeed: number,
        focusSpeed: number,
        numRounds = 1,
        twoHitters = false
    ): CombatEngineInput => {
        const lionheart = idleEnemy('e-lionheart', 'M2');
        return {
            ...BASE_INPUT,
            numRounds,
            attack: ENEMY_ATTACK,
            speed: focusSpeed,
            shipSkills: { slots: [{ slot: 'active', abilities: [plainHit('focus-hit')] }] },
            position: 'M4',
            target: front(),
            pattern: basePattern(),
            healTargetId: 'attacker',
            teamActors: twoHitters ? [playerHitter('p2')] : [],
            enemyAttackers: [
                idleEnemy('e-front', 'M4'),
                {
                    ...lionheart,
                    stats: {
                        ...lionheart.stats,
                        defence: LIONHEART_DEFENCE,
                        speed: lionheartSpeed,
                    },
                    shipSkills: { slots: [lionheartProtectionPassive()] },
                },
            ],
        };
    };

    it('ENEMY twin: a slower player hitter is redirected onto the enemy Lionheart in full', () => {
        const res = runCombat(enemySide(150, 50));

        expect(incoming(res, 0, 'e-front')).toBeCloseTo(0, 4);
        expect(incoming(res, 0, 'e-lionheart')).toBeGreaterThan(0);
    });

    it('ENEMY twin: a faster player hitter is redirected onto the enemy Lionheart in full', () => {
        const res = runCombat(enemySide(10, 300));

        expect(incoming(res, 0, 'e-front')).toBeCloseTo(0, 4);
        expect(incoming(res, 0, 'e-lionheart')).toBeGreaterThan(0);
    });

    it('ENEMY twin: after a redirect his stacks are gone until the next round start', () => {
        const input = enemySide(150, 50, 2, true);
        const res = runCombat(input);

        for (const round of [0, 1]) {
            // The first player hit each round is redirected; the second lands in full.
            expect(incoming(res, round, 'e-lionheart')).toBeGreaterThan(0);
            expect(incoming(res, round, 'e-front')).toBeCloseTo(ENEMY_ATTACK, 4);
        }
        expect(endStacks(input, 'e-lionheart')).toBe(0);
    });
});
