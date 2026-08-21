/**
 * SP-4e Task 4, fix wave 1 — the MISSING coverage for a shipped plain-`'ally'` CAST cleanse.
 *
 * Task 4 deleted the mode-flag arms in `recipientsFor` (playerTurn.ts), which changed plain
 * `'ally'` cast routing from "the single heal anchor / lowest-HP ally" to "the caster's own side,
 * narrowed by its support footprint". The Task-4 report claimed that change was *corpus-empty* on
 * the cast path. It was not: `recipientsFor` is shared by the heal, shield AND cleanse branches,
 * and while plain-`'ally'` cast HEALS and SHIELDS are genuinely zero in the corpus, plain-`'ally'`
 * cast CLEANSES are not. Re-measured over all 147 rows of `docs/ship-skills.csv` through
 * `buildShipAbilities` + `partitionReactiveAbilities`: **10 plain-`'ally'` cast cleanses on 7
 * shipped ships** — AEGIS (charged), Cultivator (active + charged), Harvester (active), Makoli
 * (active), Nyxen (active + charged), Paracelsus (charged), Purifier (active + charged).
 *
 * The behaviour is CORRECT and must not be reverted (owner ruling, 2026-08-21): a plain `'ally'`
 * cleanse covers the SAME allies as its co-cast buff. On 8 of those 10 abilities the sibling clause
 * in the very same sentence parses to `all-allies` ("grants Defense Up III **and** cleanses 1
 * debuff"), so pre-4e was internally inconsistent — the buff reached the whole footprint while the
 * cleanse hit one lowest-HP/anchor ally. (The two exceptions sit beside a `self` shield instead:
 * AEGIS charged and Nyxen charged. The ruling still governs them; it is just not evidenced by a
 * sibling there.) This file is the coverage that was missing when that change shipped.
 *
 * Subject: **Cultivator**, chosen over Purifier for two reasons.
 *  1. Its real active pattern `Pattern-Circle-Support-Range-1` anchored at M1 covers M1/M2/T1/B1,
 *     so a 4-ship side splits cleanly into three ON-footprint allies (the caster included) and one
 *     OFF-footprint ally. Purifier's `Pattern-Wings-Support-Not-Self-Range-2` at M1 covers only
 *     T1/B1 and never the caster — a weaker 1→2 delta that cannot show the caster-inclusion half.
 *  2. Cultivator's own refit-active passive carries the SECOND-ORDER effect this widening feeds:
 *     "When this Unit cleanses a Debuff, it also repairs that ally for 4% of this Unit's Max HP"
 *     routes off `cleanse-performed.targets` → `eventCtx.cleansedAllyIds`, so its reactive repair
 *     now fans out over every footprint ally that actually lost a debuff. Purifier has no such
 *     passive, so pinning the second-order effect on it would need a contrived fixture.
 *
 * Both placements (locked team-symmetry rule): Cultivator as the player FOCUS, and Cultivator as
 * an ENEMY attacker. Real kit throughout — abilities, active target and active pattern all come
 * from `buildTraceShip` + `buildShipAbilities` (docs/ship-skills.csv is the parser's source of
 * truth), never hand-built. Only the debuff SOURCE (something has to put a removable debuff on
 * every actor) is hand-built, following `ownCleanseReactivePromotion.integration.test.ts`.
 *
 * NON-VACUITY (measured, see the fix-wave-1 report): reverting `recipientsFor` to its pre-Task-4
 * arm chain turns every recipient assertion below RED — the player leg because the pre-4e base was
 * `[healing.targetId]` and this fixture deliberately anchors the heal target OFF the footprint, the
 * enemy leg because the pre-4e enemy arm was `[lowestHpAllyId(enemyIds) ?? actor.id]` and this
 * fixture puts the source-order winner of that ranking OFF the footprint. Both legs collapse to
 * ZERO recipients, so `cleanse-performed` never even fires.
 *
 * Determinism: no RNG is consulted — every debuff/buff uses `application: 'apply'`, no actor deals
 * damage, and every crit rate in the fixture is 0. No seeding needed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type CleansePerformed = Extract<CombatEvent, { type: 'cleanse-performed' }>;
type BuffApplied = Extract<CombatEvent, { type: 'buff-applied' }>;
type DebuffApplied = Extract<CombatEvent, { type: 'debuff-applied' }>;
type ReactiveHealPerformed = Extract<CombatEvent, { type: 'reactive-heal-performed' }>;

const CULTIVATOR_HP = 100_000;
const REACTIVE_REPAIR_PCT = 4; // "repairs that ally for 4% of this Unit's Max HP"

/** The REAL Cultivator kit: parsed skill text, active target and active pattern.
 *  Throws rather than silently degrading — `docs/` is gitignored reference data (CLAUDE.md), and a
 *  fixture that quietly falls back to a hand-built kit would stop testing what it claims to. */
function cultivatorKit(): {
    skills: ShipSkills;
    target: ReturnType<typeof parseTarget>;
    pattern: ReturnType<typeof parsePattern>;
} {
    const ship = buildTraceShip('Cultivator');
    if (!ship) {
        throw new Error(
            'plainAllyCleanseFootprintReach: Cultivator did not resolve — docs/ship-skills.csv / ' +
                'docs/ship-data.json are gitignored reference data expected on dev machines.'
        );
    }
    if (!ship.activeTarget || !ship.activePattern) {
        throw new Error('plainAllyCleanseFootprintReach: Cultivator has no active targeting');
    }
    return {
        skills: buildShipAbilities(ship),
        target: parseTarget(ship.activeTarget),
        pattern: parsePattern(ship.activePattern),
    };
}

/** Mutation guard: the subject really is a plain-`'ally'` cast cleanse sitting beside an
 *  `all-allies` buff, and the reactive repair really is the `'ally'` on-own-cleanse one. If the
 *  parser ever flips either target, every routing assertion below silently changes meaning. */
describe('Cultivator — the extracted real kit (mutation guard)', () => {
    it("carries a plain-'ally' active cleanse beside an all-allies buff, plus the on-own-cleanse ally repair", () => {
        const { skills, pattern } = cultivatorKit();
        const active = skills.slots.find((s) => s.slot === 'active')?.abilities ?? [];
        const passive = skills.slots.find((s) => s.slot === 'passive')?.abilities ?? [];

        const cleanses = active.filter((a) => a.config.type === 'cleanse');
        expect(cleanses).toHaveLength(1);
        expect(cleanses[0].target).toBe('ally');
        expect(cleanses[0].trigger).toBe('on-cast');

        const buffs = active.filter((a) => a.config.type === 'buff');
        expect(buffs.map((a) => a.target)).toEqual(['all-allies']);
        expect(buffs[0].config.type === 'buff' && buffs[0].config.buffName).toBe('Defense Up III');

        const repair = passive.find(
            (a: Ability) => a.config.type === 'heal' && a.trigger === 'on-own-cleanse'
        );
        expect(repair?.target).toBe('ally');
        // NOT patternScoped: the reactive repair follows the cleansed ids themselves, so it inherits
        // the cast cleanse's reach rather than re-filtering by the footprint.
        expect(repair?.patternScoped ?? false).toBe(false);

        // The footprint this file's positions are chosen against.
        expect(pattern.modifiers.support).toBe(true);
        expect(pattern.shape).toBe('circle');
        expect(pattern.range).toBe(1);
    });
});

// A removable debuff aimed at EVERY actor on the opposing page: `all-enemies` on a whole-team
// pattern (`shape: 'all'` → resolveCells returns ALL_POSITIONS), so both the ON- and the
// OFF-footprint ally carry something to cleanse. `application: 'apply'` always lands, so the
// landing roll never enters the picture.
const allOpposingDebuff = (id: string): Ability =>
    ({
        id,
        type: 'debuff',
        target: 'all-enemies',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'debuff',
            buffName: 'Attack Down',
            parsedEffects: { attack: -30 },
            stacks: 1,
            isStackable: false,
            application: 'apply',
            duration: 5,
        },
    }) as unknown as Ability;

const wholeTeamPattern = () => parsePattern('Pattern-All');

/** A bystander ally that never acts — it only needs a POSITION (so it is on or off the caster's
 *  footprint) and a debuff to lose. No active skill at all, so it cannot damage anyone and cannot
 *  fire Cultivator's OTHER passive (the patternScoped `on-ally-attacked` 8% repair): with zero
 *  damage anywhere in the fixture, the only reactive repair that can fire is the on-own-cleanse one. */
const bystanderAlly = (id: string, position: Position, hp: number): TeamActor =>
    ({
        id,
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
    }) as TeamActor;

const bystanderEnemy = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 5, security: 100 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: { slots: [] },
    }) as EnemyAttacker;

function runWithBus(input: CombatEngineInput) {
    const bus = createEventBus();
    const cleanses: CleansePerformed[] = [];
    const buffs: BuffApplied[] = [];
    const debuffs: DebuffApplied[] = [];
    const reactiveHeals: ReactiveHealPerformed[] = [];
    bus.on('cleanse-performed', (e) => cleanses.push(e));
    bus.on('buff-applied', (e) => buffs.push(e));
    bus.on('debuff-applied', (e) => debuffs.push(e));
    bus.on('reactive-heal-performed', (e) => reactiveHeals.push(e));
    runCombat({ ...input, bus });
    return { cleanses, buffs, debuffs, reactiveHeals };
}

// ==============================================================================================
// PLAYER placement — Cultivator is the focus at M1.
//
//   footprint (Circle-Support-Range-1 @ M1) = M1, M2, T1, B1
//   attacker  M1  ON  (the caster itself)
//   ally-m2   M2  ON
//   ally-t1   T1  ON
//   ally-m4   M4  OFF   ← and it is ALSO the heal target, which is what makes the revert red:
//                         the pre-4e base was `[healing.targetId]`, and intersecting an
//                         off-footprint anchor with the footprint yields NOTHING.
// ==============================================================================================
const PLAYER_LEG = (): CombatEngineInput => {
    const kit = cultivatorKit();
    return {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: kit.skills,
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
        hp: CULTIVATOR_HP,
        speed: 50, // slower than the debuffer, faster than the bystanders
        position: 'M1',
        target: kit.target,
        pattern: kit.pattern,
        mode: 'healing',
        // Deliberately the OFF-footprint ally: the pre-4e rule routed the cleanse HERE.
        healTargetId: 'ally-m4',
        teamActors: [
            bystanderAlly('ally-m2', 'M2', 50_000),
            bystanderAlly('ally-t1', 'T1', 50_000),
            bystanderAlly('ally-m4', 'M4', 50_000),
        ],
        enemyAttackers: [
            {
                id: 'debuffer',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 1000, // acts FIRST — every player actor is debuffed before Cultivator casts
                    security: 100,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                target: parseTarget('all'),
                pattern: wholeTeamPattern(),
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [allOpposingDebuff('deb-all-players')] }],
                },
            } as EnemyAttacker,
        ],
    };
};

describe("SP-4e fix wave 1: a shipped plain-'ally' CAST cleanse reaches the caster's whole support footprint (player placement)", () => {
    it('Cultivator cleanses all THREE on-footprint allies (itself included), not the single heal anchor', () => {
        const { cleanses, debuffs } = runWithBus(PLAYER_LEG());

        // ANTI-VACUITY, load-bearing: the off-footprint ally must actually CARRY a removable
        // debuff, or "it was not cleansed" is trivially true and this test observes nothing.
        const debuffedIds = debuffs.flatMap((e) => e.targetId);
        expect(debuffedIds).toContain('ally-m4');
        expect(debuffedIds).toContain('attacker');
        expect(debuffedIds).toContain('ally-m2');
        expect(debuffedIds).toContain('ally-t1');

        const own = cleanses.filter((e) => e.casterId === 'attacker');
        expect(own).toHaveLength(1);
        // Recipients arrive in `healing.playerIds` order (focus first, then team actors), narrowed
        // by the footprint. Pre-Task-4 this was `[healing.targetId]` → intersected to [].
        expect(own[0].targets).toEqual(['attacker', 'ally-m2', 'ally-t1']);
        // One debuff each (`cleanses 1`), three allies.
        expect(own[0].count).toBe(3);
        // The footprint STILL narrows — this is not "the whole own side".
        expect(own[0].targets).not.toContain('ally-m4');
    });

    it("RULING 1: the cleanse covers exactly the allies its co-cast 'all-allies' buff covers", () => {
        const { cleanses, buffs } = runWithBus(PLAYER_LEG());
        const cleansed = [
            ...(cleanses.find((e) => e.casterId === 'attacker')?.targets ?? []),
        ].sort();
        const buffed = [
            ...new Set(buffs.filter((b) => b.buffName === 'Defense Up III').map((b) => b.actorId)),
        ].sort();
        // Anti-vacuity: both sets must be non-trivial, or "equal" is a statement about two empties.
        expect(buffed).toHaveLength(3);
        expect(cleansed).toEqual(buffed);
    });

    it('SECOND-ORDER: the on-own-cleanse repair fans out over every cleansed ally, not just one', () => {
        const { reactiveHeals } = runWithBus(PLAYER_LEG());
        const own = reactiveHeals.filter((e) => e.casterId === 'attacker');
        expect(own).toHaveLength(1);
        const expected = (CULTIVATOR_HP * REACTIVE_REPAIR_PCT) / 100;
        expect(own[0].perTarget.map((t) => t.targetId)).toEqual(['attacker', 'ally-m2', 'ally-t1']);
        for (const row of own[0].perTarget) expect(row.amount).toBeCloseTo(expected, 6);
        // Gross across the fan-out: 3 × 4% of Cultivator's Max HP, where pre-4e it was 1 ×.
        expect(own[0].amount).toBeCloseTo(expected * 3, 6);
    });
});

// ==============================================================================================
// ENEMY placement — the same kit on the other side of the board (locked team-symmetry rule).
//
//   footprint (Circle-Support-Range-1 @ M1) = M1, M2, T1, B1
//   foe-m4          M4  OFF  ← FIRST in enemyAttackers, so with every actor at full HP it is the
//                              source-order winner of `lowestHpAllyId(enemyIds)`: the pre-4e enemy
//                              arm routed the cleanse HERE, and the footprint then dropped it.
//   foe-m2          M2  ON
//   foe-t1          T1  ON
//   foe-cultivator  M1  ON   (the caster itself)
// ==============================================================================================
const ENEMY_LEG = (): CombatEngineInput => {
    const kit = cultivatorKit();
    return {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        // The player focus is the debuff SOURCE here: one whole-team debuff, no damage.
        shipSkills: {
            slots: [{ slot: 'active', abilities: [allOpposingDebuff('deb-all-enemies')] }],
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
        speed: 1000, // acts FIRST — the whole enemy page is debuffed before Cultivator's turn
        position: 'M1',
        target: parseTarget('all'),
        pattern: wholeTeamPattern(),
        mode: 'healing',
        healTargetId: 'attacker',
        enemyAttackers: [
            bystanderEnemy('foe-m4', 'M4', 50_000),
            bystanderEnemy('foe-m2', 'M2', 50_000),
            bystanderEnemy('foe-t1', 'T1', 50_000),
            {
                id: 'foe-cultivator',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: CULTIVATOR_HP,
                    speed: 50,
                    security: 100,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: kit.target,
                pattern: kit.pattern,
                shipSkills: kit.skills,
            } as EnemyAttacker,
        ],
    };
};

describe("SP-4e fix wave 1: the same plain-'ally' CAST cleanse on the ENEMY side (team symmetry)", () => {
    it('an enemy Cultivator cleanses all THREE on-footprint enemy allies, not the lowest-HP one', () => {
        const { cleanses, debuffs } = runWithBus(ENEMY_LEG());

        // ANTI-VACUITY: the off-footprint enemy really is debuffed.
        const debuffedIds = debuffs.flatMap((e) => e.targetId);
        for (const id of ['foe-m4', 'foe-m2', 'foe-t1', 'foe-cultivator']) {
            expect(debuffedIds).toContain(id);
        }

        const own = cleanses.filter((e) => e.casterId === 'foe-cultivator');
        expect(own).toHaveLength(1);
        // `healing.enemyIds` order, narrowed by the footprint.
        expect(own[0].targets).toEqual(['foe-m2', 'foe-t1', 'foe-cultivator']);
        expect(own[0].count).toBe(3);
        expect(own[0].targets).not.toContain('foe-m4');
    });

    it('SECOND-ORDER on the enemy side: the on-own-cleanse repair fans out over the same three', () => {
        const { reactiveHeals } = runWithBus(ENEMY_LEG());
        const own = reactiveHeals.filter((e) => e.casterId === 'foe-cultivator');
        expect(own).toHaveLength(1);
        expect(own[0].perTarget.map((t) => t.targetId)).toEqual([
            'foe-m2',
            'foe-t1',
            'foe-cultivator',
        ]);
        const expected = (CULTIVATOR_HP * REACTIVE_REPAIR_PCT) / 100;
        for (const row of own[0].perTarget) expect(row.amount).toBeCloseTo(expected, 6);
    });
});
