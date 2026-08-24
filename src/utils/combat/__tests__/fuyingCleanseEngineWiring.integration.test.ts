/**
 * #363 (Fuying) — engine-level coverage for the crit-power-scaled cleanse CALL SITE.
 *
 * The unit tests in `fuyingCleanseScaling.test.ts` only exercise `scaledStatusCount` and
 * `parseCleanse` in isolation — nothing proves that `playerTurn.ts`'s cleanse branch actually
 * FEEDS the scaled count to `statusEngine.cleanse`. A revert of only that call site (putting
 * back `statusEngine.cleanse(rid, cfg.count)`, the unscaled parsed `1`) would leave every one of
 * those unit tests green. This file closes that gap by firing a hand-built Fuying-shaped kit
 * through the real `runCombat` entry point (mirrors `amartyaCritPurge.test.ts`, which does the
 * same thing for the identically-worded purge) and asserting the number of debuffs actually
 * removed from a living recipient.
 *
 * Harness: an ENEMY "debuffer" (speed 1000, acts first) lands FOUR distinct removable debuffs on
 * every player-side actor via an `all-enemies`-targeted `application: 'apply'` debuff (always
 * lands — no RNG, see `plainAllyCleanseFootprintReach.integration.test.ts`, which pioneers this
 * exact "seed removable debuffs on the player side from an enemy cast" technique). The player
 * focus (Fuying stand-in, crit power 150) then casts a `cleanse` ability — `count: 1,
 * countScaling: { stat: 'critDamage', per: 50 }`, target `'all-allies'` — which must remove
 * 1 × floor(150/50) = 3 of the 4 debuffs, leaving exactly 1.
 *
 * SCOPING NOTE — read before "simplifying" this back to a total: in production, Fuying now HAS
 * real targeting data (`activeTarget: 'other-allies'`, `activePattern:
 * 'Pattern-Wings-Support-Not-Self-Range-2'`) that narrows her `'all-allies'` recipients to a
 * footprint EXCLUDING the caster herself. This file's focus kit deliberately carries NO
 * support-scoped pattern instead — it is not trying to reproduce Fuying's live footprint, only
 * to isolate the count-scaling call site (`playerTurn.ts` feeding `statusEngine.cleanse` the
 * SCALED count) from footprint narrowing, which other tests already cover. Because of that
 * choice, the assertion is scoped to ONE NAMED ALLY (`'ally-wing'`, a team actor, never the
 * caster) rather than a cross-ally total. `'ally-wing'` sits inside a wings-support footprint
 * just as much as it does inside this file's un-narrowed "whole side" stand-in — a
 * caster-excluding pattern still reaches every OTHER ally — so this assertion is unaffected by
 * which pattern the kit actually carries. A total across every recipient (which would include
 * Fuying herself under this file's un-narrowed stand-in pattern) would silently drop if the kit
 * ever switched to a caster-excluding pattern. Do not assert anything about Fuying's own
 * recipient status here.
 *
 * Determinism: every debuff uses `application: 'apply'` (always lands, no RNG draw — see the
 * reference file above), the focus's own crit rate is 0, and nothing deals damage. No seeding
 * needed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { parseTarget, parsePattern } from '../../targetingParser';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `fce${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A plain, NON-support pattern — deliberately so `recipientsFor`'s footprint narrowing stays
// OFF (`supportFootprintAllyIds` returns undefined for a pattern with no `modifiers.support`).
// This is a synthetic stand-in, not a reproduction of Fuying's real (now-live) narrowed
// footprint — see the file-header SCOPING NOTE for why this file isolates the count-scaling
// call site instead of exercising footprint narrowing.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A distinct, removable, non-stacking timed debuff — landed via `application: 'apply'`, which
// always lands (no landing roll drawn).
const namedDebuff = (name: string): Ability =>
    ab({
        type: 'debuff',
        target: 'all-enemies',
        config: {
            type: 'debuff',
            buffName: name,
            parsedEffects: { attack: -10 },
            stacks: 1,
            isStackable: false,
            application: 'apply',
            duration: 99,
        },
    });

// The enemy debuffer: acts first (speed 1000), casts FOUR distinct debuffs at `'all-enemies'`
// (from its own perspective the player side) over a whole-team pattern, so every living player
// actor — the focus AND every team actor — picks up all four.
const debuffer = (): EnemyAttacker => ({
    id: 'debuffer',
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1000,
        security: 100,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('all'),
    pattern: parsePattern('Pattern-All'),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    namedDebuff('Fuying-Wiring-Debuff-A'),
                    namedDebuff('Fuying-Wiring-Debuff-B'),
                    namedDebuff('Fuying-Wiring-Debuff-C'),
                    namedDebuff('Fuying-Wiring-Debuff-D'),
                ],
            },
        ],
    },
});

// A bystander team ally inside the future wings-support-not-self footprint — it never acts
// itself, it only needs a position (so the debuffer's whole-team AoE finds it) and a name that
// is never the caster.
const allyWing = (position: Position, hp: number): TeamActor => ({
    id: 'ally-wing',
    speed: 5,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [] },
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

// Fuying's charged skill: "cleanses 1 debuff for every 50% crit power this Unit has",
// target `'all-allies'`, count 1, countScaling per 50 — same shape Amartya's purge uses.
const fuyingCleanseSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'cleanse',
                    target: 'all-allies',
                    config: {
                        type: 'cleanse',
                        count: 1,
                        countScaling: { stat: 'critDamage', per: 50 },
                    },
                }),
            ],
        },
    ],
});

const BASE = (critDamage: number): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: fuyingCleanseSkills(),
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
    speed: 50, // slower than the debuffer (1000), so the debuffs land before Fuying cleanses
    position: 'M1',
    // No support-scoped pattern on the focus's own kit (see file-header scoping note).
    pattern: basePattern(),
    healTargetId: 'attacker',
    mode: 'healing',
    teamActors: [allyWing('M2', 50_000)],
    enemyAttackers: [debuffer()],
});

const run = (critDamage: number): { remaining: number } => {
    idc = 0;
    let engine: StatusEngine | undefined;
    runCombat({
        ...BASE(critDamage),
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    // `timedAbilityStatuses('enemy', ownerId, enemyTargetId)` reads the per-victim debuff store
    // keyed by `enemyTargetId` — the same `enemyMaps.get(actorId)` store `statusEngine.cleanse`
    // removes from (statusEngine.ts's `removeNewestFirst(actorId, 'debuffs', count)`). `ownerId`
    // is ignored on the 'enemy' side.
    return { remaining: engine!.timedAbilityStatuses('enemy', 'attacker', 'ally-wing').length };
};

describe('#363 engine wiring: Fuying-shaped cleanse count reaches statusEngine.cleanse SCALED, not the parsed 1', () => {
    it('ANTI-VACUITY: ally-wing actually carries all 4 removable debuffs before any cleanse runs', () => {
        // A run with critDamage 0 → floor(0/50) = 0 scaled count → cleanse-performed never fires
        // (mirrors amartyaCritPurge.test.ts's critDamage-40 case) → all 4 debuffs survive.
        const { remaining } = run(0);
        expect(remaining).toBe(4);
    });

    it('critDamage 150 → scaledStatusCount(1, {critDamage, per:50}, 150) = 3 removed from ally-wing, 1 remains', () => {
        const { remaining } = run(150);
        // If the call site fed the parsed, UNSCALED count (1) instead, this would be 3, not 1.
        // A test that would still pass with count 1 is worthless here — this is why the number
        // must differ from the parsed literal.
        expect(remaining).toBe(1);
    });
});
